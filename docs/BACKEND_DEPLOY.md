# Памятка для бэкенда: HTTPS и CORS на api.xronix.ru

Фронт живёт на GitHub Pages (`https://xronix.ru`), бэкенд отдельно в Яндекс Облаке на `https://api.xronix.ru`. Две вещи обязательны, иначе кабинет не сможет обращаться к API.

## 1. Сервер в Яндекс Облаке (без Docker)

### Что делает Саша в консоли Яндекс Облака
1. **Compute Cloud → Виртуальные машины → Создать ВМ.**
   - Образ: **Ubuntu 24.04 LTS** (в ней сразу Python 3.12, которого требует бэкенд).
   - Зона доступности любая, например `ru-central1-a`.
   - Ресурсы для хакатона: 2 vCPU, 4 ГБ RAM, гарантированная доля vCPU 100 %, диск SSD 20 ГБ.
   - **«Прерываемая» не включать**: такая ВМ выключается раз в сутки и может упасть посреди защиты.
   - Сеть: публичный IP **автоматически**.
   - Доступ: логин `xronix`, в поле SSH-ключа вставить **публичный** ключ Ильи (строка из `~/.ssh/id_ed25519.pub`, начинается с `ssh-ed25519`). Приватный ключ никому не передаётся.
2. **Сделать IP постоянным:** Virtual Private Cloud → IP-адреса → у адреса ВМ «Сделать статическим». Иначе после перезапуска ВМ адрес сменится и `api.xronix.ru` перестанет работать.
3. **Группа безопасности** ВМ (Virtual Private Cloud → Группы безопасности), входящие правила:
   - TCP 22 только с IP Ильи (или с `0.0.0.0/0` на время настройки, потом сузить);
   - TCP 80 и TCP 443 с `0.0.0.0/0`;
   - больше ничего, порт 8000 наружу не открываем.
4. **Cloud DNS → зона `xronix.ru.` → Создать запись:** имя `api`, тип `A`, TTL 600, значение: статический IP ВМ.
5. Передать Илье IP и логин `xronix`.

### Что делает Илья на сервере
```sh
ssh xronix@<IP>
sudo apt update && sudo apt -y upgrade
sudo apt -y install git python3-venv
sudo mkdir -p /srv && sudo chown xronix /srv
git clone https://github.com/xrnskew/XRONIX.git /srv/xronix
cd /srv/xronix && git checkout backend
cp backend/.env.example backend/.env
```
В `backend/.env`:
```dotenv
CORS_ORIGINS=https://xronix.ru,https://www.xronix.ru,http://localhost:5173
JWT_SECRET=<вывод команды: openssl rand -hex 32>
MOCK_AI=true            # пока нет сервиса Дани
```
Проверка руками: `./backend/run.sh`, в другом окне `curl localhost:8000/health` → `{"status":"ok"}`.

Запуск как службы, `/etc/systemd/system/xronix-backend.service`:
```ini
[Unit]
Description=XRONIX backend
After=network.target

[Service]
User=xronix
WorkingDirectory=/srv/xronix/backend
ExecStart=/srv/xronix/backend/run.sh
Restart=always

[Install]
WantedBy=multi-user.target
```
```sh
sudo systemctl daemon-reload && sudo systemctl enable --now xronix-backend
systemctl status xronix-backend      # active (running)
```

HTTPS через Caddy (сам получает и продлевает сертификат Let's Encrypt):
```sh
sudo apt -y install debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt -y install caddy
```
`/etc/caddy/Caddyfile`:
```
api.xronix.ru {
  encode gzip
  reverse_proxy 127.0.0.1:8000
}
```
```sh
sudo systemctl reload caddy
curl https://api.xronix.ru/health    # {"status":"ok"} по HTTPS
```
Сертификат выпустится, только когда запись `api` уже указывает на этот IP (шаг 4 у Саши). Если Caddy ругается на сертификат, подождать несколько минут: он повторяет попытки сам.

Обновление после новых коммитов: `cd /srv/xronix && git pull && sudo systemctl restart xronix-backend`.

Вариант с Docker и docker-compose можно сделать позже, сейчас он не нужен.

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
- [ ] ВМ Ubuntu 24.04 с белым статическим IP, открыты 80 и 443 (Саша)
- [ ] `api` `A` → IP добавлено в зону `xronix.ru` (Саша)
- [ ] Бэкенд работает как служба `xronix-backend`, Caddy проксирует `api.xronix.ru` (Илья)
- [ ] `https://api.xronix.ru/health` отдаёт `ok` по HTTPS
- [ ] `curl OPTIONS` из раздела 2 возвращает нужные CORS-заголовки
- [ ] В репозитории `Settings → Variables`: `VITE_API_URL=https://api.xronix.ru`, `VITE_USE_MOCKS=false` (Саша)
- [ ] Сценарий в кабинете проходит: регистрация, чат, план
