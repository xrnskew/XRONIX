# Сервис `ai` — экспертная система XRONIX

Собственная экспертная система на правилах: словари, правила, разбор чисел, база фактов о городах и банк фраз. Нейросети, внешних API и ключей нет, во время работы сервис в сеть не ходит. Контракт — `contracts/ai.md`.

| Метод | Путь | Что делает |
|---|---|---|
| POST | `/ai/consult` | Чат подбора бизнеса: заполняет `state`, задаёт вопросы, называет факты о городе из базы. Суммы плана не называет. Подробно — [`app/rules/README.md`](app/rules/README.md) |
| POST | `/ai/parse-need` | Разбор фразы в поля мастера заявки |
| POST | `/ai/summarize` | Память чата v1: сказанное человеком без атак и тем не про бизнес |
| GET | `/ai/health` | `{"status": "ok"}` |

Ошибки в формате `{"error": {"code", "message"}}`: 422 `VALIDATION_ERROR`, 502 `AI_BAD_RESPONSE` (свой ответ не прошёл схему), 404 `NOT_FOUND`. Метод v1 `/ai/respond` с GigaChat удалён в раунде 3: бэкенд получает 404 и ведёт запасной диалог.

## Запуск (из папки `ai`)

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8001
```
Переменные окружения не нужны. Документация и ручные запросы: http://localhost:8001/docs. Docker: `docker compose up` из корня репозитория или `compose.yaml` здесь; в образ входит только `app/` (код и `app/rules/data`).

## Что где

| Папка | Что внутри | В образе |
|---|---|---|
| `app/` | сервис: `main.py`, правила `rules/`, данные `rules/data/` | да |
| `knowledge/` | сборщики базы фактов (Росстат, OpenStreetMap) и генератор банка фраз (GigaChat) — [`knowledge/README.md`](knowledge/README.md) | нет |
| `dataset/` | датасеты, ручной набор, оценка — [`dataset/README.md`](dataset/README.md) | нет |
| `tests/` | тесты | нет |

## Проверки

```powershell
.\.venv\Scripts\python -m pip install -r knowledge\requirements.txt    # dataset + openpyxl + gigachat, только для разработки
.\.venv\Scripts\python -m unittest discover -s tests                     # все тесты
.\.venv\Scripts\python -m dataset.validate                               # датасеты и ручной набор по схеме
.\.venv\Scripts\python -m knowledge.build --offline                      # база фактов из кеша, байт в байт
```

Лицензии данных и инструментов — [`LICENSES.md`](LICENSES.md).
