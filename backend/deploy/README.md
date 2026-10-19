# Ubuntu / Яндекс Облако: api.xronix.ru

Подготовлено для одной Ubuntu ВМ и одного экземпляра backend с SQLite. Compose строит образ из корня монорепозитория, включая оригинальные `contracts/`. AI-сервис не является зависимостью запуска: при `MOCK_AI=true` он не нужен. Публичные порты приложения — только TCP 80 и 443 у Caddy; backend 8000 и AI 8001 наружу не публикуются.

## 1. ВМ, DNS и Docker

1. Создать Ubuntu ВМ со статическим публичным IP и диском для постоянных данных.
2. В группе безопасности Яндекс Облака разрешить вход TCP 80/443 от всех, SSH 22 только со своего административного IP. Не открывать 8000, 8001 и Caddy admin 2019. IPv6 также должен подчиняться этим ограничениям, если включён.
3. Передать IP Саше: DNS `api.xronix.ru A` должен указывать на ВМ. Удалить неправильный AAAA, если IPv6 не используется. Домен фронта `xronix.ru` остаётся у frontend.
4. Установить Docker Engine и Compose plugin из официального apt-репозитория Docker: https://docs.docker.com/engine/install/ubuntu/ . Проверить `sudo docker version` и `sudo docker compose version`. Группа docker даёт root-доступ; ниже команды используют sudo.
5. Установить Git, клонировать репозиторий и перейти в ветку с подготовленным backend. Данный аудит сам код в GitHub не публикует — до публикации нужна передача проверенного коммита на сервер.

Caddy автоматически получает и продлевает сертификат для домена при доступных DNS и 80/443. Документация: https://caddyserver.com/docs/automatic-https . Пока DNS не готов, HTTPS проверить нельзя; повторные попытки выпуска делает Caddy.

## 2. Запуск из корня XRONIX

```sh
cp backend/deploy/.env.example backend/deploy/.env
chmod 600 backend/deploy/.env
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml config --quiet
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml build --pull
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml up -d
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml ps
```

Секреты в приведённых командах не задаются. Пустой `JWT_SECRET` означает, что backend при первом старте создаёт случайный ключ в `/srv/backend/data/jwt.key` (0600) в постоянном томе `xronix_backend_data`. Он продолжит работать после пересоздания контейнера. Можно задать собственный случайный секрет от 32 байт в серверном `.env`; не использовать пример или пароль. При смене ключа старые токены перестают работать.

Там же хранится SQLite `xronix.db`, включая WAL/SHM. Каталог доступен непривилегированному UID 10001; остальная файловая система backend read-only. Создание отсутствующих таблиц автоматическое, существующие таблицы и данные не удаляются. Дополнительные таблицы лимитов создаются без пересоздания БД. Caddy сохраняет сертификаты в `xronix_caddy_data`, конфигурацию — в `xronix_caddy_config`.

Caddy admin доступен только внутри его контейнера на loopback. Между Caddy и backend — внутренняя сеть; backend дополнительно подключён к `xronix_ai` для будущего ИИ и исходящего доступа. Не подключайте к этим сетям недоверенные контейнеры: backend доверяет proxy-заголовкам внутри Docker, а Caddy заменяет входящий X-Forwarded-For реальным IP клиента. В публичном прямом запуске Uvicorn не включайте `--forwarded-allow-ips '*'`.

Если расширяете `CORS_ORIGINS`, синхронизируйте whitelist Origin в `Caddyfile/handle_errors`: он нужен для JSON-ошибок самого прокси при недоступном backend. Обычные ответы и OPTIONS обрабатывает backend. Origin — защита браузерного доступа, не замена JWT: небраузерный клиент может не посылать Origin.

## 3. Проверки после запуска

```sh
curl --fail https://api.xronix.ru/health
curl -i -X OPTIONS https://api.xronix.ru/api/me \
  -H 'Origin: https://xronix.ru' \
  -H 'Access-Control-Request-Method: PATCH' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
curl -i https://api.xronix.ru/api/me -H 'Origin: https://xronix.ru'
curl -i https://api.xronix.ru/api/me -H 'Origin: https://foreign.example'
```

Ожидания: health 200 `{"status":"ok"}`; OPTIONS 200 с `Access-Control-Allow-Origin: https://xronix.ru`; без JWT 401 `UNAUTHORIZED`, также с CORS; чужой Origin 400 `VALIDATION_ERROR`, без разрешающего CORS и без выполнения операции. Лимиты дают 429 `RATE_LIMITED` и `Retry-After`; ошибки не содержат секретов/SQL.

При проблемах:

```sh
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml logs --tail=100 backend caddy
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml exec caddy caddy validate --config /etc/caddy/Caddyfile
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml exec backend python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8000/health').read().decode())"
```

В GitHub Variables frontend Саша выставляет `VITE_API_URL=https://api.xronix.ru` (без `/api`) и `VITE_USE_MOCKS=false`, затем пересобирает frontend. Пройти регистрацию → профиль → чат → вопросы → ответы → план → перезагрузку. Браузер не должен обращаться к AI напрямую.

## 4. Подключение Дани позже

Backend обращается к `AI_SERVICE_URL + /ai/respond` и `/ai/summarize`; таймаут respond с ретраями — 30 секунд. Лимиты настроены окружением. Для сервиса на той же ВМ подключить его контейнер к сети `xronix_ai` с DNS-именем/alias `ai` и прослушиванием `0.0.0.0:8001`. **Не использовать `-p 8001:8001`.** Сеть уже создаёт Compose; сервис Дани может иметь собственный Compose с external network `xronix_ai`. Параметры его сборки, секреты GigaChat и сертификаты остаются в зоне Дани.

Установить в серверном `.env` `MOCK_AI=false`, оставить `AI_SERVICE_URL=http://ai:8001`; либо указать доступный защищённый URL сервиса на другом хосте. Затем:

```sh
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml up -d --force-recreate backend
```

`/health` проверяет backend/БД и остаётся доступен при сбое AI. В чате недоступный AI даёт 502 `AI_UNAVAILABLE`; это не повод рестартовать работающий backend. Совместный тест с реальным AI ещё требуется.

## 5. Обновления и резервная копия

Перед обновлением остановить backend для согласованного копирования **всего** тома данных с ключом и WAL; Caddy может продолжать работать. Хранить резервную копию вне репозитория и ограничить к ней доступ. Не копировать один `xronix.db` во время записи.

```sh
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml stop backend
sudo install -d -m 700 /var/backups/xronix
sudo docker run --rm -v xronix_backend_data:/data:ro -v /var/backups/xronix:/backup alpine sh -c 'umask 077; tar czf /backup/backend-data.tgz -C /data .'
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml start backend
```

Архив содержит приватный JWT-ключ и пользовательские данные; не отправлять его в чат или GitHub. Для восстановления остановить backend, распаковать архив в тот же том, сохранить владельца UID 10001 и права ключа 0600. Затем запустить backend и проверить авторизацию и планы. Проверку восстановления следует выполнить на отдельной тестовой ВМ перед хранением важных данных.

Обновление после резервного копирования: получить согласованный backend-коммит, повторить `build --pull` и `up -d`. Не выполнять `docker compose down -v`: это удалит постоянные данные и сертификаты. Штатное завершение ждёт фоновых сводок до 40 секунд. Сводка best-effort; принудительная остановка может прервать её, готовый план при этом уже сохранён.

Docker/HTTPS на реальной ВМ в текущей среде не проверены: Docker CLI здесь отсутствует. Перед публичным запуском обязательны `compose config`, сборка, `caddy validate` и HTTPS smoke-проверка выше.
