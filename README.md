# GraphOfGod Frontend

Flask frontend для запуска построения social graph и визуализации результата из backend.

## Что умеет

- позволяет добавить от 1 до 5 профилей VK
- отправляет запрос во Flask frontend, а тот проксирует его в backend
- ждёт завершения backend job через polling
- после завершения рисует граф социальных связей на `canvas`
- показывает seed-профили, попарные пересечения и агрегированные счётчики

## Структура

- `graph_of_god_frontend/main.py` - запуск Flask frontend
- `graph_of_god_frontend/app.py` - создание Flask app
- `graph_of_god_frontend/core/` - конфиг и загрузка `.env`
- `graph_of_god_frontend/services/backend_client.py` - HTTP-клиент к backend
- `graph_of_god_frontend/routes/` - HTML и proxy API
- `graph_of_god_frontend/templates/index.html` - интерфейс
- `graph_of_god_frontend/static/` - стили и клиентский JS

## Установка

Зависимость сейчас одна:

```bash
./.venv/bin/pip3 install -r graph_of_god_frontend/requirements.txt
```

Создайте конфиг:

```bash
cp graph_of_god_frontend/.env.example graph_of_god_frontend/.env
```

Главная настройка:

```bash
GRAPH_OF_GOD_FRONTEND_BACKEND_BASE_URL=http://127.0.0.1:8000
```

## Запуск

Сначала поднимите backend, затем frontend:

```bash
./.venv/bin/python graph_of_god_backend/main.py
./.venv/bin/python graph_of_god_frontend/main.py
```

После этого откройте:

```text
http://127.0.0.1:5000
```

## Как это работает

Браузер не общается с backend напрямую, чтобы не упираться в CORS:

1. страница отправляет запрос во Flask frontend
2. Flask frontend проксирует запрос в backend
3. frontend polling-ом отслеживает статус backend job
4. готовый graph рисуется на клиенте
