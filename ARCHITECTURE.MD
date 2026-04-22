# GraphOfGod Frontend Architecture

## Назначение

`graph_of_god_frontend` это отдельный Flask frontend, который:

- отдает несколько HTML-страниц интерфейса в общей оболочке;
- принимает браузерные запросы на запуск social graph jobs;
- проксирует их в backend;
- poll-ит backend через собственный API-слой;
- рисует граф в браузере на `canvas`;
- управляет общей навигацией, темами, fullscreen режимом и интерактивностью графа.

Этот документ описывает текущее состояние frontend после перехода от одного монолитного экрана к общему site shell с несколькими страницами. После любого изменения структуры `templates`, `static/js`, `static/css`, API-прокси или графового движка файл нужно перепроверять и дополнять.

## Тип архитектуры

### 1. Flask BFF + multi-page server-rendered shell + client-side islands

Frontend сочетает три подхода:

- Flask выступает как BFF и HTML delivery layer;
- Jinja отдает общий server-rendered shell сайта и route-specific templates;
- браузерный JavaScript берет управление интерактивностью только там, где это нужно.

Это не SPA на React/Vue и не чисто серверный сайт. Скорее это hybrid frontend:

- сервер отдает общий каркас сайта, конфиг страницы и контент маршрута;
- `shell.js` оживляет общесайтовые элементы;
- страница графа подключает отдельный browser-side controller и canvas engine;
- страница `Теория 6ти рукопожатий` пока остается server-rendered заготовкой под отдельный сценарий.

### 2. Модульная browser-side архитектура без сборщика

Клиентская часть намеренно организована без bundler-а и без фреймворка:

- `static/js/shell.js` отвечает за общесайтовую оболочку;
- `static/js/app/` отвечает за orchestration страницы графа;
- `static/js/graph/` отвечает за viewport, layout и canvas rendering;
- page-specific entrypoints подключаются только на нужных страницах.

Это решение выбрано потому, что проекту нужна была управляемая модульность, а не полноценная framework migration.

### 3. Многослойная template/CSS архитектура

HTML и CSS разрезаны по двум осям: по страницам и по секциям.

На уровне templates это выглядит так:

- `base.html` задает общий shell;
- route templates отвечают только за содержимое своих страниц;
- partial templates переиспользуются там, где это имеет смысл.

На уровне CSS это выглядит так:

- `base.css` и `layout.css` задают общую визуальную систему;
- секционные файлы отвечают за графовую страницу;
- `theory.css` отвечает за вторую страницу.

Это ближе по удобству к компонентному подходу, но остается в рамках Flask + Jinja + статических CSS-файлов.

## Поток выполнения

### Загрузка страницы

1. Браузер открывает `/` или `/six-handshakes`.
2. Flask-роут из `routes/web.py` рендерит route-specific template.
3. Route template расширяет `templates/base.html`.
4. В `base.html` подключаются общие CSS-файлы, theme bootstrap script, `partials/_site_header.html` и `static/js/shell.js`.
5. Если открыта страница графа, `index.html` дополнительно подключает `static/js/app.js`.
6. После `DOMContentLoaded` общая оболочка включает theme toggle, а `GraphOfGodApp` запускается только на главной странице.

### Запуск построения графа

1. Пользователь вводит профили VK в форму на странице графа.
2. `GraphOfGodApp` валидирует список.
3. Браузер вызывает `POST /api/social-graphs/jobs` на Flask frontend.
4. `routes/api.py` валидирует payload и вызывает `BackendClient`.
5. `BackendClient` отправляет запрос в backend FastAPI.
6. После создания job frontend начинает polling через `GET /api/social-graphs/jobs/{job_id}`.
7. При готовности результата контроллер:
   - рендерит карточки seed-профилей и пересечений;
   - передает `graph-result` в `GraphRenderer`;
   - обновляет counters и toolbar.

### Работа графа в браузере

1. `GraphLayoutEngine` строит initial world layout.
2. `GraphViewport` отвечает за pan, zoom и fit.
3. `GraphRenderer` рисует nodes, edges, labels и tooltip.
4. Клик по вершине открывает VK-профиль в новой вкладке.
5. Дополнительные UI-функции:
   - fullscreen только для `graph-stage`;
   - light/dark theme toggle на уровне всего сайта;
   - фокусировка по seed и intersection groups.

## Ключевые архитектурные решения

### Почему Flask остается тонким

Flask frontend не должен повторять backend-логику. Его зона ответственности:

- отдать страницу;
- защитить браузер от прямой зависимости на backend и CORS;
- нормализовать запросы браузера;
- вернуть удобные для UI ответы.

Весь domain graph-building остается в backend.

### Почему появился общий `base.html`

После добавления второй страницы root template больше не должен быть завязан только на граф.

Поэтому:

- `base.html` хранит общий HTML shell, head, theme bootstrap и site navigation;
- route templates отвечают только за свой основной контент;
- общие элементы не дублируются между страницами;
- theme toggle и header не размножаются по шаблонам.

### Почему клиент разделен на `shell`, `app` и `graph`

Это главное архитектурное разделение frontend:

- `shell.js` знает только про общесайтовую оболочку и темы;
- `app/` знает про форму, polling, DOM и orchestration страницы графа;
- `graph/` знает только про отрисовку, layout, drag, zoom и hit detection.

Такое разделение позволяет:

- добавлять новые страницы без копирования graph-логики;
- менять общую оболочку без риска сломать canvas engine;
- развивать граф отдельно от навигации и theme system.

### Почему templates разбиты на partials

Jinja partials дают простой компонентный подход без сложного runtime:

- `base.html` остается общим root-shell;
- route templates остаются короткими;
- секции графовой страницы изолированы;
- шаблоны проще читать и поддерживать;
- менять layout можно локально, не трогая весь HTML-файл.

### Почему CSS разделен по секциям

Монолитный CSS-файл неудобен для сопровождения. Сейчас разделение такое:

- `base.css` задает design tokens, theme variables, site header и глобальные UI-примитивы;
- `layout.css` отвечает за сетку и responsive-перестройку;
- остальные файлы отвечают за конкретные зоны интерфейса или конкретную страницу.

Это уменьшает связность и ускоряет локальные изменения.

## Где что лежит

Ниже перечислены рабочие исходники и документация. Локальный `.env`, `.git` и `__pycache__` не считаются архитектурными единицами.

## Ответственность по файлам

### Корневые файлы

| Файл | Ответственность |
| --- | --- |
| `ARCHITECTURE.MD` | Архитектурная карта frontend. Должна обновляться вместе с изменениями структуры и runtime-поведения. |
| `.env.example` | Шаблон env-конфига Flask frontend. |
| `.gitkeep` | Технический placeholder-файл репозитория. На runtime не влияет. |
| `README.md` | Краткая документация по запуску frontend. |
| `requirements.txt` | Python-зависимости frontend. |
| `__init__.py` | Экспортирует `create_app` как публичную точку входа пакета. |
| `main.py` | Локальная точка запуска Flask development server. |
| `app.py` | Flask app factory: читает config, создает app, регистрирует blueprints и backend client. |
| `static/favicon.svg` | Явный favicon frontend, чтобы браузер не делал неявные запросы к отсутствующей иконке. |

### `core/`

| Файл | Ответственность |
| --- | --- |
| `core/__init__.py` | Маркер core-пакета frontend. |
| `core/config.py` | Чтение и валидация env-конфига frontend. |
| `core/dotenv.py` | Минимальная загрузка `.env` без внешней библиотеки. |

### `routes/`

| Файл | Ответственность |
| --- | --- |
| `routes/__init__.py` | Маркер пакета маршрутов. |
| `routes/web.py` | HTML-маршруты. Отдает страницу графа, страницу `Теория 6ти рукопожатий` и перенаправляет `/favicon.ico` на явный favicon в `static/`. |
| `routes/api.py` | Flask BFF endpoints для запуска social graph jobs и polling их статуса через backend. |

### `services/`

| Файл | Ответственность |
| --- | --- |
| `services/__init__.py` | Маркер service-пакета. |
| `services/backend_client.py` | Низкоуровневый HTTP-клиент к backend FastAPI и нормализация backend-ошибок для frontend. |

### `templates/`

| Файл | Ответственность |
| --- | --- |
| `templates/base.html` | Общий shell сайта: HTML head, theme bootstrap script, общие CSS, theme toggle button, site header и точки расширения для route-specific content. |
| `templates/index.html` | Route template страницы графа. Передает body dataset-конфиг, подключает graph-page partials и `static/js/app.js`. |
| `templates/six_handshakes.html` | Route template второй страницы. Пока это styled placeholder под отдельный сценарий теории 6 рукопожатий. |
| `templates/partials/_site_header.html` | Общий header с брендингом и навигацией между страницами. |
| `templates/partials/_hero.html` | Hero-блок графовой страницы и верхние counters. |
| `templates/partials/_workspace.html` | Композиция control panel и graph panel. |
| `templates/partials/_control_panel.html` | Форма профилей, кнопки действий, status panel и legend. |
| `templates/partials/_graph_panel.html` | Graph stage, toolbar, fullscreen button, canvas и tooltip-контейнеры. |
| `templates/partials/_insights.html` | Панель seed-профилей и панель пересечений. |

### `static/css/`

| Файл | Ответственность |
| --- | --- |
| `static/css/base.css` | Design tokens, theme variables, глобальные UI-примитивы, site header и кнопка переключения темы. |
| `static/css/layout.css` | Grid-layout страниц и responsive breakpoints. |
| `static/css/hero.css` | Стили hero-секции и counters страницы графа. |
| `static/css/control-panel.css` | Стили формы профилей, status panel и legend. |
| `static/css/graph-panel.css` | Стили `graph-stage`, toolbar, tooltip, fullscreen-состояния и cursor states canvas. |
| `static/css/insights.css` | Стили карточек seed-профилей и intersections. |
| `static/css/theory.css` | Page-specific стили для страницы `Теория 6ти рукопожатий`. |

### `static/js/`

| Файл | Ответственность |
| --- | --- |
| `static/js/shell.js` | Общесайтовый entrypoint: инициализирует theme toggle и рассылает theme change event для page-specific скриптов. |
| `static/js/app.js` | Entry point страницы графа: создает `GraphOfGodApp` после `DOMContentLoaded`. |

### `static/js/app/`

| Файл | Ответственность |
| --- | --- |
| `static/js/app/controller.js` | Главный UI-controller страницы графа: boot, form handling, polling, fullscreen, graph focus и state orchestration. |
| `static/js/app/dom.js` | Централизованное получение DOM references и чтение конфигурации со страницы графа. |
| `static/js/app/intersections.js` | Построение intersection groups для UI на основе backend graph-result. |
| `static/js/app/panels.js` | DOM-render карточек seed-профилей и пересечений. |
| `static/js/app/social-graph-api.js` | Browser-side client к Flask BFF API. |
| `static/js/app/theme.js` | Общие theme utilities: initial theme, `localStorage`, переключение dark/light и имя browser event для синхронизации страниц. |
| `static/js/app/utils.js` | Вспомогательные утилиты UI-слоя, сейчас в основном HTML escaping. |

### `static/js/graph/`

| Файл | Ответственность |
| --- | --- |
| `static/js/graph/viewport.js` | Pan, zoom и fit-to-bounds модель viewport-а графа. |
| `static/js/graph/layout.js` | Раскладка seed-узлов и групп связей, collision resolution и world-layout. |
| `static/js/graph/renderer.js` | Canvas renderer, tooltip, drag, click activation узлов, hover и рендер с учетом active theme. |
| `static/js/graph/utils.js` | Геометрические, графические и текстовые утилиты для graph engine. |

## Ответственность по слоям

### Flask delivery / BFF слой

- `app.py`
- `main.py`
- `routes/web.py`
- `routes/api.py`
- `services/backend_client.py`
- `core/*`

Это код, который связывает браузер и backend.

### Site shell слой

- `templates/base.html`
- `templates/partials/_site_header.html`
- `static/js/shell.js`
- `static/js/app/theme.js`
- `static/css/base.css`
- `static/css/layout.css`

Это общая оболочка сайта, навигация и theme system.

### Graph page orchestration слой

- `templates/index.html`
- `templates/partials/_hero.html`
- `templates/partials/_workspace.html`
- `templates/partials/_control_panel.html`
- `templates/partials/_graph_panel.html`
- `templates/partials/_insights.html`
- `static/js/app.js`
- `static/js/app/controller.js`
- `static/js/app/dom.js`
- `static/js/app/social-graph-api.js`
- `static/js/app/intersections.js`
- `static/js/app/panels.js`
- `static/js/app/utils.js`
- `static/css/hero.css`
- `static/css/control-panel.css`
- `static/css/graph-panel.css`
- `static/css/insights.css`

Это код и шаблоны, которые обслуживают основной сценарий построения графа.

### Theory page слой

- `templates/six_handshakes.html`
- `static/css/theory.css`

Это отдельный маршрут под будущий сценарий теории 6 рукопожатий. Пока он не имеет собственного JS runtime.

### Graph engine слой

- `static/js/graph/viewport.js`
- `static/js/graph/layout.js`
- `static/js/graph/renderer.js`
- `static/js/graph/utils.js`

Это локальный визуальный движок графа.

## Внутренний runtime contract frontend

### Что frontend ожидает от backend

Frontend assumes, что backend возвращает:

- `job_id`, `status`, `status_url`;
- `result.seed_profiles`;
- `result.nodes`;
- `result.edges`;
- `result.stats`.

Browser-side логика пересечений дополнительно опирается на:

- `nodes[].is_seed`;
- `nodes[].connected_seed_indices`;
- `seed_profiles[].seed_index`;
- `seed_profiles[].node_id`.

Если backend меняет эти поля, `static/js/app/intersections.js`, `panels.js` и `controller.js` нужно проверять сразу.

## Интерактивность и состояния

### Navigation

Навигация строится на server-rendered ссылках, а не на client-side router:

- общий header живет в `_site_header.html`;
- `active_page` приходит из `routes/web.py`;
- переключение страниц идет обычным переходом по URL;
- theme choice переживает переход между страницами через `localStorage`.

### Theme system

Тема управляется так:

1. inline script в `base.html` выставляет `data-theme` до загрузки CSS;
2. `theme.js` определяет initial theme и helper-функции;
3. `shell.js` переключает тему, сохраняет выбор в `localStorage` и диспатчит `THEME_CHANGE_EVENT`;
4. страница графа слушает это событие в `controller.js` и перерисовывает canvas;
5. CSS и canvas renderer используют theme variables.

### Fullscreen

Fullscreen применяется только к `graph-stage`, а не ко всей странице:

- кнопка живет в `_graph_panel.html`;
- логика в `controller.js`;
- стили и размеры в `graph-panel.css`;
- `renderer.handleResize()` вызывается на `fullscreenchange`.

### Клик по вершине

Открытие профиля VK реализовано в графовом движке:

- renderer различает click и drag;
- если узел не был сдвинут, вызывается node activation callback;
- callback передается из `controller.js`;
- открытие происходит в новой вкладке через `window.open(..., "_blank", "noopener,noreferrer")`.

## Ограничения текущей архитектуры

### 1. Frontend все еще вычисляет часть производной доменной логики

`intersections.js` строит UI-группы пересечений на клиенте. Это удобно, но означает, что часть смысловой логики результата живет не только в backend.

### 2. Canvas renderer остается крупным модулем

После разбиения архитектура стала намного лучше, но `graph/renderer.js` все еще содержит сразу несколько зон ответственности:

- drawing;
- pointer events;
- tooltip logic;
- node activation;
- drag physics orchestration.

Если граф будет усложняться, следующим разумным шагом будет разделение renderer на подмодули.

### 3. Нет сборщика и type-checking для браузерного кода

Это сознательное упрощение, но оно означает:

- нет TypeScript;
- нет bundle optimization;
- нет compile-time guarantees на shape данных.

### 4. Вторая страница пока является только shell-подготовкой

`/six-handshakes` уже существует как отдельный маршрут и экран, но domain-логика для него еще не реализована. Это нормально, пока страница рассматривается как будущая точка расширения.

## Что нужно проверять при изменениях

Этот документ нужно обновлять, если меняется хотя бы одно из условий:

- появляются новые route templates или страницы;
- меняется структура общего `base.html` или site navigation;
- появляются новые partial templates;
- меняется состав CSS-файлов или design token system;
- появляется новый общесайтовый JavaScript вроде `shell.js`;
- меняется структура `static/js/app` или `static/js/graph`;
- меняется browser runtime flow: routing, polling, fullscreen, click behavior, theme handling;
- frontend начинает проксировать новые backend endpoints;
- меняется expected contract `SocialGraphResult`.

## Краткая проверка актуальности документа

На момент написания frontend состоит из:

- одного Flask app;
- двух Flask blueprints: `web` и `api`;
- общего server-rendered shell на Jinja;
- двух route pages: граф и `Теория 6ти рукопожатий`;
- отдельного site-shell слоя для navigation и theme;
- модульного browser-side controller layer для страницы графа;
- отдельного canvas graph engine;
- light/dark theme system;
- fullscreen режима для graph stage.

Если это описание перестало быть правдой, `ARCHITECTURE.MD` должен обновляться одновременно с кодом.
