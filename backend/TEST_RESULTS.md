# Проверки после аудита · 19 октября 2026

| Проверка | Фактический результат |
|---|---|
| Исходный pytest до изменений | 56 passed |
| `cd backend && .venv/bin/python -m pytest -q` | **90 passed**, 24.31 с, Python 3.13.15 |
| `.venv/bin/python tests/smoke.py` | **PASS**, реальный Uvicorn/HTTP на свободном порту, два пользователя, профиль, чаты, вопросы/ответы, план, повтор, изоляция, production CORS, аннуитет и рестарт процесса с сохранением данных/JWT |
| `cd contracts && npm run check` | **18 проверок успешны**: 13 примеров, 2 отрицательных случая plan_id, 2 смысловые проверки, аннуитет |
| `.venv/bin/python -m pip check` | No broken requirements found |
| Проверка PyPI version JSON metadata после обновлений | 31 установленный пакет; неотозванных advisories нет, сетевых пропусков нет |
| Compose YAML / основные инварианты, Ruby Psych | PASS: парсинг YAML, build context = корень репозитория, только Caddy публикует 80/443, AI не обязателен |
| `git diff --check` | PASS |

У pytest одно предупреждение StarletteDeprecationWarning: использование httpx в TestClient объявлено deprecated, пока поддерживается. httpx сохранён согласно стеку проекта; дополнительный httpx2 не вводился.

npm использован из установленного runtime (через pnpm dlx); исходники и lockfile контрактов не изменены. Предыдущий npm ci уже установил контрактные зависимости.

Новые регрессии: `tests/test_audit.py` — 34 проверки; исходные тесты сохранены с настройкой лимитов фикстуры и явным новым текстом после готового плана. Полное описание находок — `AUDIT.md`.

**Не проверены:** Docker build, полноценная интерполяция `docker compose config`, Caddy validate/HTTPS и развёртывание на Ubuntu (соответствующих исполняемых файлов/облака нет); настоящий AI/GigaChat; браузерный frontend. API сверено с `origin/frontend` b81264b и его BACKEND_DEPLOY.md. Подготовленная инструкция запуска и проверок — `deploy/README.md`.
