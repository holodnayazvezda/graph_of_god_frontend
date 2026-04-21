# GraphOfGod Frontend Architecture

## Назначение

`graph_of_god_frontend` это отдельный Flask frontend, который:

- отдает HTML-страницу интерфейса;
- принимает браузерные запросы на запуск social graph jobs;
- проксирует их в backend;
- poll-ит backend через собственный API-слой;
- рисует граф в браузере на `canvas`;
- управляет темами, fullscreen режимом и интерактивностью графа.

Этот документ описывает текущее состояние frontend после разбиения монолитных `app.js` и `app.css` на секционные модули. После любого изменения структуры templates, `static/js`, `static/css`, API-прокси или графового движка файл нужно перепроверять и дополнять.

## Тип архитектуры

### 1. Flask BFF + server-rendered shell + client-side application

Frontend сочетает три подхода:

- Flask выступает как BFF и HTML delivery layer;
- Jinja отдает server-rendered shell страницы;
- браузерный JavaScript берет управление интерактивностью после загрузки DOM.

Это не SPA на React/Vue и не чисто серверный сайт. Скорее это hybrid frontend:

- сервер отдает каркас страницы и конфиг;
- клиентские ES-модули управляют состоянием UI;
- тяжелая визуализация графа живет в отдельном canvas renderer.

### 2. Модульная browser-side архитектура без сборщика

Клиентская часть намеренно организована без bundler-а и без фреймворка:

- `static/js/app/` отвечает за orchestration страницы;
- `static/js/graph/` отвечает за viewport, layout и canvas rendering;
- entrypoint остается один, но он только подключает контроллер.

Это решение выбрано потому, что проекту нужна была управляемая модульность, а не полноценная framework migration.

### 3. Секционная template/CSS архитектура

HTML и CSS разрезаны по зонам ответственности:

- hero;
- control panel;
- graph panel;
- insights.

Это ближе по удобству к компонентному подходу, но остается в рамках Flask + Jinja + статических CSS-файлов.

## Поток выполнения

### Загрузка страницы

1. Браузер открывает `/`.
2. Flask-роут `routes/web.py` рендерит `templates/index.html`.
3. В `index.html` подключаются секционные CSS-файлы и JS entrypoint.
4. До загрузки стилей маленький inline script выбирает initial theme.
5. После `DOMContentLoaded` запускается `GraphOfGodApp`.

### Запуск построения графа

1. Пользователь вводит профили VK в форму.
2. `GraphOfGodApp` валидирует список.
3. Браузер вызывает `POST /api/social-graphs/jobs` на Flask frontend.
4. `routes/api.py` валидирует payload и вызывает `BackendClient`.
5. `BackendClient` отправляет запрос в backend FastAPI.
6. После создания job frontend начинает polling через `GET /api/social-graphs/jobs/{job_id}`.
7. При готовности результата контроллер:
   - рендерит карточки seed-профилей и пересечений;
   - передает graph-result в `GraphRenderer`;
   - обновляет counters и toolbar.

### Работа графа в браузере

1. `GraphLayoutEngine` строит initial world layout.
2. `GraphViewport` отвечает за pan/zoom/fit.
3. `GraphRenderer` рисует nodes, edges, labels и tooltip.
4. Клик по вершине открывает VK-профиль в новой вкладке.
5. Дополнительные UI-функции:
   - fullscreen только для graph stage;
   - light/dark theme toggle;
   - фокусировка по seed и intersection groups.

## Ключевые архитектурные решения

### Почему Flask остается тонким

Flask frontend не должен повторять backend-логику. Его зона ответственности:

- отдать страницу;
- защитить браузер от прямой зависимости на backend и CORS;
- нормализовать запросы браузера;
- вернуть удобные для UI ответы.

Весь domain graph-building остается в backend.

### Почему клиент разбит на `app/` и `graph/`

Это главное архитектурное разделение frontend:

- `app/` знает про форму, polling, DOM и orchestration страницы;
- `graph/` знает только про отрисовку, layout, drag, zoom и hit detection.

Такое разделение позволяет менять UI-панели без риска сломать графовый движок и наоборот.

### Почему templates разбиты на partials

Jinja partials дают простой компонентный подход без сложного runtime:

- `index.html` остается root-shell;
- секции страницы изолированы;
- шаблон проще читать и поддерживать;
- менять layout можно локально, не трогая весь HTML-файл.

### Почему CSS разделен по секциям

Монолитный CSS-файл неудобен для сопровождения. Сейчас разделение такое:

- `base.css` - design tokens, глобальные примитивы, theme variables;
- `layout.css` - сетка страницы и responsive-правила;
- остальные файлы - стили конкретных секций.

Это уменьшает связность и ускоряет локальные изменения.

## Где что лежит

Ниже перечислены только рабочие исходники и документация. Локальный `.env`, `.git`, `.gitkeep`-служебные детали и `__pycache__` не участвуют в архитектуре как кодовые модули, хотя отдельные файлы вроде `.gitkeep` упомянуты для полноты дерева.

## Ответственность по файлам

### Корневые файлы

| Файл | Ответственность |
| --- | --- |
| `ARCHITECTURE.MD` | Архитектурная карта frontend. Должна обновляться вместе с изменениями структуры и runtime-поведения. |
| `.env.example` | Шаблон env-конфига Flask frontend. |
| `.gitkeep` | Технический placeholder-файл репозитория. На runtime не влияет. |
| `README.md` | Краткая пользовательская документация по запуску frontend. |
| `requirements.txt` | Python-зависимости frontend. |
| `__init__.py` | Экспортирует `create_app` как публичную точку входа пакета. |
| `main.py` | Локальная точка запуска Flask development server. |
| `app.py` | Flask app factory: читает config, создает app, регистрирует blueprints и backend client. |

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
| `routes/web.py` | HTML-маршруты. Сейчас отдает только главную страницу и передает в шаблон базовый конфиг. |
| `routes/api.py` | Flask BFF endpoints для запуска social graph jobs и polling их статуса через backend. |

### `services/`

| Файл | Ответственность |
| --- | --- |
| `services/__init__.py` | Маркер service-пакета. |
| `services/backend_client.py` | Низкоуровневый HTTP-клиент к backend FastAPI и нормализация backend-ошибок для frontend. |

### `templates/`

| Файл | Ответственность |
| --- | --- |
| `templates/index.html` | Главный shell страницы: подключает CSS, theme bootstrap script, кнопки верхнего уровня и partials. |
| `templates/partials/_hero.html` | Hero-блок и верхние counters. |
| `templates/partials/_workspace.html` | Композиция control panel и graph panel. |
| `templates/partials/_control_panel.html` | Форма профилей, кнопки действий, status panel и legend. |
| `templates/partials/_graph_panel.html` | Graph stage, toolbar, fullscreen button, canvas и tooltip-контейнеры. |
| `templates/partials/_insights.html` | Панель seed-профилей и панель пересечений. |

### `static/css/`

| Файл | Ответственность |
| --- | --- |
| `static/css/base.css` | Design tokens, theme variables, глобальные UI-примитивы, кнопка переключения темы. |
| `static/css/layout.css` | Grid-layout страницы и responsive breakpoints. |
| `static/css/hero.css` | Стили hero-секции и counters. |
| `static/css/control-panel.css` | Стили формы профилей, status panel и legend. |
| `static/css/graph-panel.css` | Стили graph-stage, toolbar, tooltip, fullscreen-состояния и cursor states canvas. |
| `static/css/insights.css` | Стили карточек seed-профилей и intersections. |

### `static/js/`

| Файл | Ответственность |
| --- | --- |
| `static/js/app.js` | Browser entrypoint: создает `GraphOfGodApp` после `DOMContentLoaded`. |

### `static/js/app/`

| Файл | Ответственность |
| --- | --- |
| `static/js/app/controller.js` | Главный UI-controller: boot, form handling, polling, fullscreen, theme toggle, state orchestration. |
| `static/js/app/dom.js` | Централизованное получение DOM references и чтение конфигурации со страницы. |
| `static/js/app/intersections.js` | Построение intersection groups для UI на основе backend graph-result. |
| `static/js/app/panels.js` | DOM-render карточек seed-профилей и пересечений. |
| `static/js/app/social-graph-api.js` | Browser-side client к Flask BFF API. |
| `static/js/app/theme.js` | Работа с theme state: initial theme, `localStorage`, переключение dark/light. |
| `static/js/app/utils.js` | Вспомогательные утилиты UI-слоя, сейчас в основном HTML escaping. |

### `static/js/graph/`

| Файл | Ответственность |
| --- | --- |
| `static/js/graph/viewport.js` | Pan/zoom/fit-to-bounds модель viewport-а графа. |
| `static/js/graph/layout.js` | Раскладка seed-узлов и групп связей, collision resolution и world-layout. |
| `static/js/graph/renderer.js` | Canvas renderer, tooltip, drag, click activation узлов, hover, рендер с учетом active theme. |
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

### Browser orchestration слой

- `static/js/app.js`
- `static/js/app/controller.js`
- `static/js/app/dom.js`
- `static/js/app/social-graph-api.js`
- `static/js/app/intersections.js`
- `static/js/app/panels.js`
- `static/js/app/theme.js`
- `static/js/app/utils.js`

Это код, который управляет состоянием интерфейса.

### Graph engine слой

- `static/js/graph/viewport.js`
- `static/js/graph/layout.js`
- `static/js/graph/renderer.js`
- `static/js/graph/utils.js`

Это локальный визуальный движок графа.

### Presentation слой

- `templates/*`
- `static/css/*`

Это структура страницы и визуальная система.

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

### Theme system

Тема управляется так:

1. inline script в `index.html` выставляет `data-theme` до загрузки CSS;
2. `theme.js` определяет final theme state;
3. `controller.js` переключает тему и сохраняет выбор в `localStorage`;
4. CSS и canvas renderer используют theme variables.

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

### 2. Canvas renderer достаточно крупный

После разбиения архитектура стала намного лучше, но `graph/renderer.js` все еще большой и содержит:

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

## Что нужно проверять при изменениях

Этот документ нужно обновлять, если меняется хотя бы одно из условий:

- появляются новые partial templates;
- меняется состав CSS-файлов или design token system;
- меняется структура `static/js/app` или `static/js/graph`;
- меняется browser runtime flow: polling, fullscreen, click behavior, theme handling;
- frontend начинает проксировать новые backend endpoints;
- меняется expected contract `SocialGraphResult`.

## Краткая проверка актуальности документа

На момент написания frontend состоит из:

- одного Flask app;
- двух Flask blueprints: web и api;
- server-rendered shell на Jinja;
- модульного browser-side controller layer;
- отдельного canvas graph engine;
- light/dark theme system;
- fullscreen режима для graph stage.

Если это описание перестало быть правдой, `ARCHITECTURE.MD` должен обновляться одновременно с кодом.
