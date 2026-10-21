# Запуск сервиса `ai` на сервере

С раунда 3 сервису не нужны ключи, сертификаты и `.env`: всё, что он использует, лежит в `app/rules/data`. Наружу порт не открывается, в сервис ходит только бэкенд (`AI_SERVICE_URL`).

## Docker (основной вариант)

Сервис `ai` входит в общий `docker-compose.yml` в корне репозитория (бэкенд обращается к нему как `http://ai:8001`). Отдельно, из папки `ai`:
```sh
sudo docker compose up -d --build
```
`compose.yaml` здесь подключает сервис к сети `xronix_ai`, которую создаёт compose бэкенда.

## systemd без Docker

```sh
git clone -b backend-ai https://github.com/xrnskew/XRONIX.git /srv/xronix-ai
cd /srv/xronix-ai/ai
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```
Служба `/etc/systemd/system/xronix-ai.service`:
```ini
[Unit]
Description=XRONIX ai (экспертная система)
After=network.target

[Service]
User=xronix
WorkingDirectory=/srv/xronix-ai/ai
ExecStart=/srv/xronix-ai/ai/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
```sh
sudo systemctl daemon-reload && sudo systemctl enable --now xronix-ai
curl -s http://127.0.0.1:8001/ai/health          # {"status":"ok"}
```

## Проверка после запуска

```sh
curl -s http://127.0.0.1:8001/ai/consult -H 'Content-Type: application/json' \
  -d '{"history":[],"message":"Хочу пекарню в Самаре, своих 900 тысяч","state":{"sphere":null,"city":null,"own_funds_rub":null,"answers":{}}}'
```
В ответе `type: "questions"`, `state.city: "Самара"` и фраза о числе пекарен «по данным OpenStreetMap».

## Обновление

```sh
cd /srv/xronix-ai && git pull && sudo systemctl restart xronix-ai     # или: sudo docker compose up -d --build
```
