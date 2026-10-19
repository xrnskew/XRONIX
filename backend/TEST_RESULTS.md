# Совместимость Windows · 19 октября 2026

Локально добавлены Windows LockFileEx вместо обязательного fcntl, переносимый open_private, обработка Windows-прав/fsync и run.cmd. Linux/macOS продолжают использовать flock, O_NOFOLLOW и POSIX-проверки.

Проверки на macOS / Python 3.13.15:
- Полный pytest: **114 passed**, 26.65 с (одно прежнее предупреждение Starlette/httpx).
- Шесть тестов переносимого слоя: shared/exclusive, upgrade/downgrade, взаимное исключение между процессами, отсутствие O_NOFOLLOW, отказ symlink, Windows API flags/contention через управляемую подмену native API.
- Реальный HTTP smoke, Backup API, offline restore и перезапуск — PASS.
- Все 18 проверок contracts npm run check — PASS.

**Реальный Windows здесь отсутствует.** Нативные WinAPI-вызовы и run.cmd нужно дополнительно запустить на компьютере участника. Подмена API проверяет нашу диспетчеризацию/флаги, а не заменяет Windows-интеграционный тест. Инструкции Git → run.cmd добавлены в README. Production Ubuntu-код сохраняет прежние гарантии; Windows использует NTFS ACL и не обещает POSIX directory fsync.

---

# SQLite: резервирование и миграции · 19 октября 2026

Базовый коммит этой доработки: `4127f5f`. API, контракты и бизнес-логика не изменялись; новых зависимостей нет.

| Проверка | Фактический результат |
|---|---|
| `cd backend && .venv/bin/python -m pytest -q` | **108 passed**, 29.73 с, Python 3.13.15 |
| `.venv/bin/python tests/smoke.py` | **PASS**: реальные HTTP, Backup API работающего сервера, запрет онлайн-restore, подтверждённое offline-restore и рестарт отдельного Uvicorn-процесса; пользователи/план/история/JWT сохранены |
| `cd contracts && npm run check` | **18 проверок успешны**, исходные файлы контрактов не изменены |
| `.venv/bin/python -m pip check` | No broken requirements found |
| Compose YAML, Ruby Psych | PASS: monorepo build context, отдельный backup volume только у backend, Caddy не получает копии, наружу только 80/443 |
| `git diff --check` | PASS |

18 новых регрессий в `tests/test_maintenance.py`: committed WAL в автономном снимке, сохранность пользователей/планов/сообщений, 0600/0700, недоступность через HTTP, подтверждение и offline-lock, повреждённые/обрезанные/чужие копии, миграция старой схемы и принятие create_all-БД, откат неудачного DDL, контроль истории, daily/retention/restart/concurrency, свободное место и безопасный health, запуск планировщика, проверенный export, очистка частичных копий, таймаут и активный внешний SQLite-писатель.

Остаётся одно прежнее предупреждение StarletteDeprecationWarning о httpx/TestClient. Docker CLI отсутствует: сборка контейнера, полноценный `docker compose config` и поведение томов на Ubuntu не проверены. Перед хранением важных данных нужны тестовое восстановление на отдельной ВМ и настройка внешнего защищённого хранилища; оно пока не подключалось. Операторские команды и ограничения: `deploy/DATABASE.md`.

---

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

## Окупаемость — 19 октября 2026

Backend пересчитывает `finance.payback_months` по пересчитанной месячной прибыли: округление вверх startup/profit при profit > 0, иначе null. Целочисленное деление избегает потери точности. Добавлены 6 граничных случаев и проверка перезаписи AI-значения с повторным чтением сохранённого плана через API. Полный pytest: 120 passed (одно прежнее предупреждение Starlette).
