# AI-сервис

FastAPI + GigaChat. Контракт: `contracts/ai.md` (пока в ветке `backend`).

| Метод | Путь | Что делает сейчас |
|---|---|---|
| GET | `/ai/health` | `{"status": "ok"}` |
| POST | `/ai/respond` | Первый ответ: уточняющие вопросы (мок). После ответа на вопросы: настоящий план от GigaChat |
| POST | `/ai/summarize` | Мок: склеивает старую память и сообщения пользователя |

Ошибки в формате `{"error": {"code", "message"}}`: 503 `AI_UNAVAILABLE`, 502 `AI_BAD_RESPONSE`, 422 `VALIDATION_ERROR`.

## Запуск локально (Windows, из папки `ai`)

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m uvicorn app.main:app --port 8001 --reload
```

Документация и ручные запросы: http://localhost:8001/docs

Чтобы бэк ходил в этот сервис, а не в моки: в `backend/.env` поставить `MOCK_AI=false`.

## Переменные окружения (`.env`)

| Переменная | Что это |
|---|---|
| `GIGACHAT_AUTH_KEY` | Authorization key из кабинета Сбера. Секрет |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` |
| `GIGACHAT_MODEL` | `GigaChat-2` |
| `GIGACHAT_CA_BUNDLE_FILE` | `certs/russian_bundle.pem`, путь от папки `ai` |
| `AI_DEADLINE_SEC` | Сколько секунд даём на ответ, по умолчанию 25 (у бэка таймаут 30) |

## Как устроена генерация плана

1. Промпт (`app/prompts.py`) + JSON-схема плана в `response_format` (`app/plan.py`).
2. Починка кодом (`app/repair.py`): суммы по формулам, нумерация, 12 месяцев, null в кредите.
3. Проверка схемой и правилами `checkPlan`, как у бэка.
4. Не прошло: один повтор, если хватает времени. Потом 502.

Проверка качества на наборе идей: `.\.venv\Scripts\python json_test.py`
