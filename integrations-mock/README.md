# integrations-mock

Все данные синтетические. Сервис не обращается к реальным реестрам и БКИ.
Контракт: `contracts/integrations.md`. Шесть фиксированных компаний — `data/companies.json`.
Для прочих корректных ИНН данные получаются из SHA-256, включая корректный ОГРН.
Для личного ИНН будущего ИП `772519083310` БКИ возвращает чистую историю 24 месяца.

Из корня репозитория:

```bash
python3 -m venv integrations-mock/.venv
integrations-mock/.venv/bin/pip install -r integrations-mock/requirements.txt
cd integrations-mock
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8002
```

Или Docker:

```bash
docker build -t xronix-integrations integrations-mock
docker run --rm -p 8002:8002 xronix-integrations
```

`GET /health`, `GET /egrul/{inn}`, `GET /fns/{inn}`,
`POST /bki/report` с `{"inn":"7715881399","consent":true}`.
`FAIL_INN=7715881399` перед запуском включает 503 для этого ИНН на всех трёх методах.

Код интеграции и сквозные сценарии проверяются из `backend`:
`python -m pytest -q tests/test_conveyor.py`.
