# Памятка для бэкенда: HTTPS и CORS на api.xronix.ru

Фронт живёт на GitHub Pages (`https://xronix.ru`), бэкенд отдельно в Яндекс Облаке на `https://api.xronix.ru`. Две вещи обязательны, иначе кабинет не сможет обращаться к API.

## 1. HTTPS обязателен
Сайт на HTTPS не может ходить на `http://`: браузер блокирует такие запросы (mixed content). Нужен сертификат на `api.xronix.ru`.

Самый простой путь: одна ВМ в Яндекс Облаке (Compute Cloud, Ubuntu) и **Caddy** перед бэкендом. Caddy сам получает и продлевает сертификат Let's Encrypt.

1. Создай ВМ, зарезервируй **статический публичный IP** (иначе он поменяется при перезапуске).
2. Группа безопасности: открыть входящие `80` и `443` (с любого адреса), `22` только с твоего IP. Порты бэкенда и ИИ-сервиса наружу не открывать.
3. Скажи Саше IP: он добавит в зону `xronix.ru` запись `api` `A` → IP. Пока домен `xronix.ru` не обновился в DNS (сейчас идёт обновление), сертификат не выпустится, Caddy будет повторять попытки сам.
4. `docker-compose.yml` на ВМ (схематично):

```yaml
services:
  caddy:
    image: caddy:2
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on: [backend]
  backend:
    build: ./backend
    env_file: .env
    expose: ["8000"]          # наружу не публикуем, только для Caddy
  ai:
    build: ./ai
    env_file: .env
    expose: ["8001"]          # только внутренняя сеть, бэкенд ходит на http://ai:8001
volumes:
  caddy_data:
```

`Caddyfile`:
```
api.xronix.ru {
  encode gzip
  reverse_proxy backend:8000
}
```

Другой вариант: Application Load Balancer + Certificate Manager. Он сложнее в настройке, для хакатона Caddy быстрее.

## 2. CORS
Фронт и API на разных адресах, поэтому браузер сначала шлёт предзапрос `OPTIONS`. Бэкенд должен на него отвечать.

Разрешить:
- **Origin**: `https://xronix.ru`, `https://www.xronix.ru`, `http://localhost:5173` (для разработки). Не `*`, список явный, из переменной окружения `CORS_ORIGINS`.
- **Методы**: `GET, POST, PATCH, OPTIONS`.
- **Заголовки**: `Authorization, Content-Type`.
- Куки не используются (токен в заголовке `Authorization: Bearer`), поэтому `allow_credentials` / `credentials` не нужны.
- Ответы на ошибки (401, 404, 502 и т. д.) тоже должны содержать CORS-заголовки, иначе фронт увидит «сетевую ошибку» вместо понятного текста.

FastAPI:
```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ["CORS_ORIGINS"].split(","),
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
```
Express:
```js
import cors from 'cors'
app.use(cors({
  origin: process.env.CORS_ORIGINS.split(','),
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
}))
```
Проверка с любого компьютера:
```
curl -i -X OPTIONS https://api.xronix.ru/api/me \
  -H 'Origin: https://xronix.ru' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```
В ответе должны быть `access-control-allow-origin: https://xronix.ru` и разрешённые методы и заголовки.

## 3. Остальное, что важно для фронта
- **Таймауты.** Фронт ждёт ответ на `POST /api/chats/{id}/messages` до 35 секунд (ИИ думает до 30), остальные запросы до 15. Прокси и сервер не должны обрывать соединение раньше. У Caddy по умолчанию лимита нет. Если будете использовать nginx: `proxy_read_timeout 60s`.
- **Формат ошибок** всегда `{ "error": { "code", "message" } }`, как в `contracts/api.md`, включая 404 на несуществующий путь и 500.
- **Проверка живости:** `GET /api/health` или `GET /health` без авторизации, `{ "status": "ok" }`. Удобно для мониторинга и быстрой проверки после деплоя.
- **Секреты.** Репозиторий публичный. Токен GigaChat, `JWT_SECRET`, пароль базы только в `.env` на сервере, в репозиторий не попадают. В репозитории лежит только `.env.example` без значений. `CORS_ORIGINS` в `.env` тоже.
- **ИИ-сервис не публичный.** Доступен только бэкенду по внутренней сети. Сертификаты Минцифры для GigaChat ставятся внутри его контейнера.
- **Лимиты.** Желательно ограничить частоту запросов к `/messages` (ответ `429 RATE_LIMITED` по контракту), чтобы никто не сжёг лимиты GigaChat.

## Чек-лист
- [ ] ВМ с белым статическим IP, открыты 80 и 443
- [ ] `api` `A` → IP добавлено в зону `xronix.ru` (Саша)
- [ ] `https://api.xronix.ru/health` отдаёт `ok` по HTTPS
- [ ] `curl OPTIONS` из раздела 2 возвращает нужные CORS-заголовки
- [ ] В репозитории `Settings → Variables`: `VITE_API_URL=https://api.xronix.ru`, `VITE_USE_MOCKS=false` (Саша)
- [ ] Сценарий в кабинете проходит: регистрация, чат, план
