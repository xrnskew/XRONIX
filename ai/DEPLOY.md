# Деплой AI-сервиса на ВМ

AI-сервис живёт на той же ВМ в Яндекс Облаке, что и бэкенд Ильи (`backend/deploy/`), в отдельном контейнере.

```
браузер → https://api.xronix.ru → Caddy → backend ──(сеть xronix_ai)──→ ai:8001 → GigaChat
```

- Порт 8001 **наружу не открывается**. В сервис ходит только бэкенд, по адресу `http://ai:8001`.
- Сеть `xronix_ai` создаёт compose бэкенда, наш `compose.yaml` к ней только подключается. Поэтому **бэкенд поднимается первым**.
- Ключ GigaChat лежит только в `ai/.env` на сервере. В git, в чат и в образ он не попадает.

## 0. Что должно быть готово

| Что | Кто |
|---|---|
| ВМ Ubuntu, Docker и Compose установлены | Илья / Саша |
| Бэкенд запущен по `backend/deploy/README.md` (значит, сеть `xronix_ai` уже есть) | Илья |
| У Дани есть SSH-доступ на ВМ (шаг 1) | Илья добавляет ключ |

## 1. SSH-доступ (один раз)

На своём компьютере (PowerShell):
```powershell
ssh-keygen -t ed25519 -C "danya-xronix"
Get-Content $HOME\.ssh\id_ed25519.pub
```
На все вопросы `ssh-keygen` можно нажать Enter. Строку, которую вывела вторая команда (`ssh-ed25519 AAAA... danya-xronix`), отправь Илье. Это **публичный** ключ, его можно пересылать. Файл `id_ed25519` без `.pub` не отправляй никому.

Илья на ВМ:
```sh
echo 'ssh-ed25519 AAAA... danya-xronix' >> ~/.ssh/authorized_keys
```
SSH в группе безопасности открыт только с разрешённых IP. Если подключение висит, Илья добавляет туда твой IP.

Проверка:
```powershell
ssh xronix@<IP_ВМ>
```

## 2. Код на ВМ

Пока ветка `ai` не слита в `dev`, держим отдельную копию, чтобы не трогать checkout бэкенда:
```sh
git clone -b ai https://github.com/xrnskew/XRONIX.git ~/XRONIX-ai
cd ~/XRONIX-ai/ai
```

## 3. Ключ GigaChat

```sh
cp .env.example .env
chmod 600 .env
nano .env
```
Вписать `GIGACHAT_AUTH_KEY=` (тот же ключ, что в локальном `.env`). Остальное можно оставить как в примере. Сохранить: Ctrl+O, Enter, Ctrl+X.

## 4. Запуск

```sh
sudo docker network inspect xronix_ai > /dev/null && echo "сеть есть"
sudo docker compose config --quiet
sudo docker compose up -d --build
sudo docker compose ps
```
Через ~30 секунд в `ps` должно быть `healthy`. Логи:
```sh
sudo docker compose logs --tail=50 ai
```
Хороший знак: строка `GigaChat warmup: 0.Xs`. Если там `warmup не удался`, смотри таблицу внизу.

## 5. Проверка изнутри

Видит ли бэкенд AI-сервис по сети:
```sh
sudo docker exec xronix-backend-1 python -c "import urllib.request; print(urllib.request.urlopen('http://ai:8001/ai/health', timeout=5).read().decode())"
```
Ожидается `{"status":"ok"}`.

Настоящий запрос в GigaChat (вопросы по идее кофейни):
```sh
sudo docker exec -i xronix-ai-ai-1 python -c "import sys, urllib.request; r = urllib.request.Request('http://127.0.0.1:8001/ai/respond', data=sys.stdin.buffer.read(), headers={'Content-Type': 'application/json'}); print(urllib.request.urlopen(r, timeout=40).read().decode())" <<'EOF'
{"mode": "chat",
 "user_context": {"profile": {"name": "Тест", "city": "Москва", "experience": "Новичок", "budget_rub": 500000},
                  "tags": [], "memory": ""},
 "history": [],
 "message": "Хочу открыть кофейню у метро"}
EOF
```
Ожидается JSON с `"type": "questions"` или `"type": "message"`.

## 6. Переключить бэкенд на настоящий ИИ (Илья)

В `backend/deploy/.env`:
```
MOCK_AI=false
AI_SERVICE_URL=http://ai:8001
```
Из корня checkout бэкенда:
```sh
sudo docker compose --env-file backend/deploy/.env -f backend/deploy/compose.yaml up -d --force-recreate backend
```

## 7. Сквозная проверка

На https://xronix.ru: регистрация → чат → «Хочу открыть кофейню у метро» → ответить на вопросы → план → вкладки «План» и «Финансы». Перезагрузить страницу: план должен остаться.

## Обновление после пуша в `ai`

```sh
cd ~/XRONIX-ai && git pull && cd ai
sudo docker compose up -d --build
```
Бэкенд перезапускать не нужно. Пока контейнер пересобирается (~10–30 с), чат отвечает `AI_UNAVAILABLE`.

## Если что-то не так

| Симптом | Причина | Что делать |
|---|---|---|
| `network xronix_ai declared as external, but could not be found` | Бэкенд не запущен | Сначала поднять бэкенд (шаг 0) |
| В логах `CERTIFICATE_VERIFY_FAILED` | Не нашёлся сертификат Минцифры | Проверить `GIGACHAT_CA_BUNDLE_FILE=certs/russian_bundle.pem` в `.env` |
| В логах 400/401 от `ngw.devices.sberbank.ru` | Неверный ключ | Проверить `GIGACHAT_AUTH_KEY` в `.env` (без кавычек и пробелов), потом `sudo docker compose up -d` |
| `404 No such model` | Модели нет на этом ключе | Поменять `GIGACHAT_MODEL` в `.env` |
| Шаг 5 первой командой: `Name or service not known` | Бэкенд и ИИ в разных сетях | `sudo docker network inspect xronix_ai`: в списке должны быть оба контейнера |
| На сайте `AI_UNAVAILABLE`, а шаг 5 проходит | Бэкенд всё ещё на моках или со старым адресом | Шаг 6 |
| На сайте `AI_BAD_RESPONSE` | GigaChat вернул план, который не прошёл проверку | `sudo docker compose logs --tail=100 ai` и прислать Дане |

## После интеграции

Когда `ai` слита в `dev` и бэкенд деплоится из `dev`, отдельная копия `~/XRONIX-ai` не нужна. Запускать из `ai/` того же checkout, что и бэкенд, начиная с шага 3.
