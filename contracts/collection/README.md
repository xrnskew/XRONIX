# XRONIX: конвейер без интерфейса

Bruno CLI **4.2.1**, Node.js 22+. Только локальная/одноразовая демо-БД: прогон создаёт заявку и принимает решение по «Вектору». Повторять на свежей БД — после первого прогона «Вектор» уже рассмотрен. Публичный сервер для прогона не нужен.

```sh
npm install --global @usebruno/cli@4.2.1
cd contracts/collection
bru run --env local --delay 1000 --bail
```

`local` задаёт `baseUrl=http://127.0.0.1:18000`. Другой локальный адрес: `--env-var baseUrl=http://127.0.0.1:8000`.

Сценарий: демо-клиент → компания «Северная выпечка» → подбор fast → черновик → подача → опрос статуса до approved (до 60 запросов, с `--delay 1000`) → принять → подписать → демо-аналитик → «Вектор» → встречное предложение 10 млн / 60 мес. → клиент видит предложение → сводка аналитика. JWT передаётся только через переменные времени выполнения; он не сохраняется в окружении или файлах коллекции.

Для запуска сервисов из корня репозитория, в отдельных терминалах:

```sh
python3.13 -m venv /tmp/xronix-round3-env
/tmp/xronix-round3-env/bin/pip install -r backend/requirements-dev.txt
# Терминал 1
cd integrations-mock
/tmp/xronix-round3-env/bin/uvicorn app.main:app --host 127.0.0.1 --port 18002
# Терминал 2, начиная из корня репозитория
cd backend
DATABASE_URL=sqlite:////tmp/xronix-round3-fresh.sqlite \
JWT_SECRET=local-demo-only-change-before-public-use-123456 \
INTEGRATIONS_URL=http://127.0.0.1:18002 AI_SERVICE_URL=http://127.0.0.1:18001 \
SEED_DEMO=true CONSULT_CHAT=true API_REQUESTS_PER_MINUTE=10000 \
/tmp/xronix-round3-env/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 18000
```

Путь `/tmp/xronix-round3-fresh.sqlite` должен быть новым для каждого полного прогона. AI для этой коллекции не требуется; его отсутствие не мешает конвейеру, чат использует запасной диалог.

OpenAPI выгружается без запуска сервиса и засева:

```sh
cd backend
python -m app.export_openapi ../contracts/openapi.json
```
