# Деплой AI-сервиса на ВМ

AI-сервис живёт на той же ВМ в Яндекс Облаке, что и бэкенд Ильи (`xronix@178.154.249.21`). Запускается так же, как бэк: без Docker, systemd-служба `xronix-ai`.

```
браузер → https://api.xronix.ru → Caddy (80/443) → xronix-backend (127.0.0.1:8000) → xronix-ai (127.0.0.1:8001) → GigaChat
```

- Сервис слушает только `127.0.0.1:8001`, **наружу порт не открывается**. В него ходит только бэкенд (`AI_SERVICE_URL=http://127.0.0.1:8001` в `/srv/xronix/backend/.env`).
- Код лежит отдельно от бэка, в `/srv/xronix-ai` (ветка `ai`). Checkout бэка `/srv/xronix` не трогаем.
- Ключ GigaChat лежит только в `/srv/xronix-ai/ai/.env` на сервере. В git и в чат он не попадает.

## 0. Что должно быть готово

- SSH-доступ: публичный ключ Дани добавлен на ВМ (делает Илья).
- Бэкенд работает: `systemctl status xronix-backend` показывает `active (running)`.
- На ВМ есть Python 3.12 и `python3-venv` (Ubuntu 24.04, ставил Илья).

## 1. Код и окружение

На сервере:
```sh
git clone -b ai https://github.com/xrnskew/XRONIX.git /srv/xronix-ai
cd /srv/xronix-ai/ai
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## 2. Ключ GigaChat

На **своём компьютере**, во втором окне PowerShell:
```powershell
scp $HOME\Documents\XRONIX\ai\.env xronix@178.154.249.21:/srv/xronix-ai/ai/.env
```
На сервере:
```sh
chmod 600 /srv/xronix-ai/ai/.env
```

## 3. Служба

```sh
sudo tee /etc/systemd/system/xronix-ai.service > /dev/null <<'EOF'
[Unit]
Description=XRONIX AI service
After=network-online.target
Wants=network-online.target

[Service]
User=xronix
WorkingDirectory=/srv/xronix-ai/ai
ExecStart=/srv/xronix-ai/ai/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now xronix-ai
systemctl status xronix-ai --no-pager | head -5
journalctl -u xronix-ai -n 20 --no-pager
```
Должно быть `active (running)`, а в логе строка `GigaChat warmup: 0.Xs`.

## 4. Проверка

```sh
curl -s http://127.0.0.1:8001/ai/health
```
Ожидается `{"status":"ok"}`.

Настоящий запрос в GigaChat:
```sh
curl -s -m 40 http://127.0.0.1:8001/ai/respond -H 'Content-Type: application/json' -d '{"mode":"chat","user_context":{"profile":{"name":"Тест","city":"Москва","experience":"Новичок","budget_rub":500000},"tags":[],"memory":""},"history":[],"message":"Хочу открыть кофейню у метро"}'
```
Ожидается JSON с `"type":"questions"` (или `"message"`).

## 5. Переключить бэкенд на настоящий ИИ (Илья)

В `/srv/xronix/backend/.env` поставить `MOCK_AI=false` (`AI_SERVICE_URL=http://127.0.0.1:8001` там уже стоит), потом:
```sh
sudo systemctl restart xronix-backend
```

## 6. Сквозная проверка

На https://xronix.ru: регистрация → чат → «Хочу открыть кофейню у метро» → ответить на вопросы → план → вкладки «План» и «Финансы». Перезагрузить страницу: план должен остаться.

## Обновление после пуша в `ai`

```sh
cd /srv/xronix-ai && git pull
ai/.venv/bin/pip install -r ai/requirements.txt
sudo systemctl restart xronix-ai
```
Бэкенд перезапускать не нужно. Пока служба перезапускается (несколько секунд), чат отвечает `AI_UNAVAILABLE`.

## Если что-то не так

Логи: `journalctl -u xronix-ai -n 100 --no-pager`.

| Симптом | Причина | Что делать |
|---|---|---|
| `activating (auto-restart)`, в логе `Address already in use` | Порт 8001 занят | `sudo ss -ltnp \| grep 8001` и остановить того, кто его держит |
| В логе `CERTIFICATE_VERIFY_FAILED` | Не нашёлся сертификат Минцифры | Проверить `GIGACHAT_CA_BUNDLE_FILE=certs/russian_bundle.pem` в `.env` |
| `warmup не удался`, 400/401 от `ngw.devices.sberbank.ru` | Неверный ключ | Проверить `GIGACHAT_AUTH_KEY` в `.env` (без кавычек и пробелов), потом `sudo systemctl restart xronix-ai` |
| `404 No such model` | Модели нет на этом ключе | Поменять `GIGACHAT_MODEL` в `.env` |
| На сайте `AI_UNAVAILABLE`, а шаг 4 проходит | Бэкенд всё ещё на моках | Шаг 5 |
| На сайте `AI_BAD_RESPONSE` | GigaChat вернул план, который не прошёл проверку | Логи и прислать Дане |

## Вариант с Docker

Если ВМ переведут на Docker Compose (`backend/deploy/compose.yaml` в ветке `backend`), для ИИ есть `compose.yaml`: контейнер подключается к сети бэка `xronix_ai` как `http://ai:8001`. Запуск из папки `ai`: `sudo docker compose up -d --build`. Перед этим остановить службу: `sudo systemctl disable --now xronix-ai`.
