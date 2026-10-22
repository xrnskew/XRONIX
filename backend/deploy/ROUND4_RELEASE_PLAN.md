# План выкладки раунда 4 (backend 3e6a345 и AI)

Подготовил Саша (Claude) по образцу выкладок 21–22 октября из [ROUND3_RELEASE.md](ROUND3_RELEASE.md). **Ничего не выкладывалось.** Выкладку делает Илья, у которого есть доступ к серверу. Секреты в отчёты не выводить.

## Что меняется на production

Сейчас на `api.xronix.ru`: backend `bd65d9f`, режим «запасной диалог без AI» (`AI_SERVICE_URL=http://127.0.0.1:18001`, на этом порту ничего нет).

Цель: ветка `backend` с кодом `3e6a345` (выкладывать голову ветки: сверху только коммиты с документами, код тот же). Изменения относительно `bd65d9f`:

| Что | Где | Эффект |
|---|---|---|
| Налоговая справка `tax_note` в каждом плане | `backend/app/project_calc.py`, `contracts/templates/spheres.v1.json` | в плане блок «Налоги» (федеральные УСН и МРОТ, без региональных цифр) |
| Ноль сотрудников | `contracts/templates/spheres.v1.json` (`staff min 0`), `project_calc.py` | можно выбрать 0 сотрудников, зарплаты 0 |
| Причина подбора без названия банка | `backend/app/credit_rules.py` | «Продукт для действующего бизнеса: …» |
| Демо-продукт без упоминания банка | `contracts/products.demo.json` | |
| Сервис `ai` (правила, база знаний 100 городов, опыт, факты) | `ai/` | **отдельный шаг 2** |

Схема БД не меняется (миграций нет), `backend/requirements.txt` и `integrations-mock` не менялись. Контракты читаются из `/srv/xronix/contracts` при старте, поэтому **backend нужно перезапустить**.

Принятые проверки на `3e6a345`: 367 backend-тестов, 87 AI-тестов, `npm run check`, валидация датасета, экспорт OpenAPI совпадает.

## Шаг 1. Backend до 3e6a345 (как 22.10)

1. Проверить ветку `backend`, чистоту checkout, текущий SHA (`bd65d9f`), отсутствие активных чатов и генераций, свободное место. Сохранить SHA, unit и копию `backend/.env` в приватный каталог (0700/0600), например `/srv/xronix/backend/data/deploy-20261022-round4/`.
2. Штатно остановить backend, сделать `app.maintenance backup` и `verify`. БД и JWT-ключ не трогать.
3. Fast-forward `origin/backend` до головы ветки (код `3e6a345`). Зависимости, `.env`, Caddy и integrations-mock не менять.
4. Запустить backend, проверить: `NRestarts=0`, схема 5, `/health` 200.
5. Проверка сохранности: users, chats, messages, plans, applications (на 22.10: 18 / 33 / 140 / 29 / 8) не должны уменьшиться, `000001…000008` на месте.

## Шаг 2. Сервис ai на порту 18001 (отдельно, после успешного шага 1)

Без AI всё продолжает работать (запасной диалог). AI включается запуском сервиса, настройки backend менять не нужно: `AI_SERVICE_URL=http://127.0.0.1:18001`, `MOCK_AI=false`, `CONSULT_CHAT=true`.

Старый прототип AI на `127.0.0.1:8001` не трогать (решение по нему за Ильёй). Новый сервис ставится рядом, на 18001.

```sh
cd /srv/xronix/ai
python3 -m venv .venv-r4 && .venv-r4/bin/pip install -r requirements.txt   # fastapi, uvicorn; Python 3.12+
```
`/etc/systemd/system/xronix-ai-v2.service`:
```ini
[Unit]
Description=XRONIX ai (экспертная система, раунд 4)
After=network.target

[Service]
User=xronix
WorkingDirectory=/srv/xronix/ai
ExecStart=/srv/xronix/ai/.venv-r4/bin/uvicorn app.main:app --host 127.0.0.1 --port 18001
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```
```sh
sudo systemctl daemon-reload && sudo systemctl enable --now xronix-ai-v2
curl -s http://127.0.0.1:18001/ai/health      # {"status":"ok"}
```
Проверка сервиса:
```sh
curl -s http://127.0.0.1:18001/ai/consult -H 'Content-Type: application/json' \
  -d '{"history":[],"message":"Хочу пекарню в Самаре, своих 900 тысяч","state":{"sphere":null,"city":null,"own_funds_rub":null,"answers":{}}}'
```
Ожидание: `type: "questions"`, `state.city: "Самара"`, `state.own_funds_rub: 900000`, первым вопросом `experience` с тремя кнопками, фраза о числе пекарен «по данным OpenStreetMap».

## Проверки после выкладки (HTTPS, как 22.10)

1. `GET /health` 200; preflight с `Origin: https://xronix.ru` → 200, `ACAO`, `ACAC=true`.
2. Оба демо-входа в cookie-режиме: JSON только `user`, cookie `HttpOnly`, `Secure`, `SameSite=Strict`; `/api/me`; очередь: Вектор и Лебедев, заявки `000001…000008`.
3. Чат: пекарня в Самаре → свои 900 000 → вопрос об опыте → «Нет опыта» → план с `business.experience=none`, последним риском «Нет опыта в этой сфере» и блоком `tax_note`.
4. Расчёт с `staff=0` (`POST /api/plans/calculate`): зарплаты 0, пояснение «Наёмных сотрудников нет…», план проходит схему.
5. Фраза «Хочу салон красоты в Твери, денег пока нет» → `own_funds_rub = 0`, вопрос о деньгах не повторяется.
6. Остановить `xronix-ai-v2` на минуту: новый чат всё равно получает ответ (запасной диалог), затем запустить обратно.
7. Временные чаты и планы, созданные проверками, удалить штатным API. Новых заявок не создавать (множества UUID заявок и чатов до и после должны совпасть).

После проверок написать Саше: SHA, режим AI, результат проверок, время старта. Саша прогонит те же сценарии на живом `xronix.ru` в браузере.

## Откат

- Backend: остановить, вернуть checkout к `bd65d9f` (если схема совместима, а она не менялась), запустить. Резервную копию автоматически не восстанавливать.
- AI: `sudo systemctl disable --now xronix-ai-v2`. Backend вернётся к запасному диалогу сам.
- `docker compose down -v` и сброс БД не использовать.

## Что остаётся открытым (не закрывается этой выкладкой)

Независимая оценка чата на 30–50 фразах, человеческая вычитка фраз (человек прочитал 134 из 366), Windows-артефакты, чистый прогон 25 октября, калибровка аренды и зарплат (`docs/tasks/ROUND4_beta1.md`, пункты 2 и 3).


## Дополнение: калибровка зарплат и аренды (после первой выкладки раунда 4)

Отдельная небольшая выкладка backend, схема БД и зависимости не меняются:
- `contracts/templates/city_wages.v1.json` (новый файл, средняя зарплата региона по Росстату, 100 городов) и `monthly.salary_share` вместо `salary_per_staff` в `spheres.v1.json`; backend читает их при старте (`Conveyor.templates['city_wages']`), **нужен перезапуск**;
- зарплаты в плане теперь считаются от средней зарплаты региона города (Москва около 91 тыс. ₽ на сотрудника для кофейни, Южно-Сахалинск около 74 тыс., Казань около 46 тыс.), пояснение аренды показывает ставку города;
- числа плана меняются (особенно крупные города), старые сохранённые планы не пересчитываются;
- проверка после выкладки: `POST /api/plans/calculate` для `coffee`, Москва, `staff=1`: зарплаты около 118 тыс. ₽ с взносами (90 888 × 1,3), для Юрюзани около 42 тыс. ₽ и в пояснении «оценка по умолчанию».
