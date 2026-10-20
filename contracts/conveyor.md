# Конвейер v2: Frontend ↔ Backend

Дополняет [api.md](api.md): авторизация, профиль, формат ошибок и правило «чужое = `NOT_FOUND`» остаются оттуда. Сессия — cookie, как сейчас.
Схемы: [`common`](schemas/common.schema.json), [`conveyor`](schemas/conveyor.schema.json), [`bank`](schemas/bank.schema.json). Тексты статусов, причин отказа и справочников: [`dictionaries.json`](dictionaries.json). Правила скоринга и решения: [`rules/credit_rules.v1.json`](rules/credit_rules.v1.json). Логика целиком: [`docs/CONVEYOR.md`](../docs/CONVEYOR.md).

Ниже `conveyor#/x` означает `conveyor.schema.json#/definitions/x`, `bank#/x` — то же для `bank.schema.json`.

## Пользователь

`User` из [profile.schema.json](schemas/profile.schema.json) получает новое поле `role`: `"client"` или `"analyst"`. Регистрация всегда создаёт `client`. Аналитиков создаёт сид. Фронт после входа отправляет `analyst` на `/bank`, `client` — на `/app`.

## Новые ошибки

| code | HTTP | Когда |
|---|---|---|
| `INVALID_INN` | 400 | ИНН не прошёл контрольную сумму |
| `INVALID_TRANSITION` | 409 | Действие недоступно в текущем статусе заявки или для этой роли |
| `VERSION_CONFLICT` | 409 | `version` в запросе устарел: заявку уже изменили. Фронт перечитывает заявку и показывает актуальное |
| `INCOMPLETE_APPLICATION` | 422 | Подача с незаполненными полями. `message` перечисляет, чего не хватает; список полей в `GET` → `missing_fields` |
| `INTEGRATION_UNAVAILABLE` | 503 | Мок реестра не ответил при `GET /api/registry/{inn}` |

## Компании

### `GET /api/registry/{inn}` → `conveyor#/registry_company`
Предпросмотр компании из мока ЕГРЮЛ/ЕГРИП до привязки. Любой ИНН с верной контрольной суммой находится.

### `POST /api/companies` → `conveyor#/company` (201)
Тело `conveyor#/company_create`. Привязать компанию к пользователю. Повторная привязка того же ИНН возвращает существующую (200).

### `GET /api/companies` → `[conveyor#/company]`

### `POST /api/companies/{id}/authority` → `conveyor#/company` (multipart, поле `file`)
Загрузить доверенность. Ставит `authority_confirmed = true`. В демо подходит любой файл до 5 МБ.

## Расчёт проекта

### `GET /api/templates` → `[conveyor#/template]`
### `POST /api/plans/calculate` → `conveyor#/plan_calc_response` (201)
Тело `conveyor#/plan_calc_request`. Считает план по шаблону сферы и формулам из [templates.md](templates.md), сохраняет, возвращает `plan_id` и план в формате [plan.schema.json](schemas/plan.schema.json). Старый `GET /api/plans/{id}` работает и для таких планов. Ответ вне диапазона вопроса или неизвестный вариант — `VALIDATION_ERROR` с понятным `message`.

## Разбор текста

### `POST /api/needs/parse` → `parse-need.schema.json#/definitions/response`
Тело `{ "text": string }` (1–2000 символов). Проксирует `/ai/parse-need` модели Дани ([ai.md](ai.md)). Если модель недоступна, отвечает 200 со всеми полями `null` и пустым `confidence`: фронт просто оставляет мастер пустым. Поля с `confidence < 0.7` фронт подсвечивает и просит подтвердить.

## Подбор продукта

### `POST /api/products/match` → `conveyor#/match_response`
Тело `conveyor#/match_request`. Все четыре продукта Альфы, сначала подходящие (по ставке), потом остальные с `reasons`. `monthly_payment_rub` считается по ставке `rateFrom` без надбавки, это предварительная оценка. Для кредитной линии платёж `null`.

## Заявки клиента

### `POST /api/applications` → `conveyor#/application` (201)
Тело `conveyor#/application_draft`, обязательны `company_id` и `product_id`. Остальное бэкенд берёт из тела и, если передан `plan_id`, из плана (сумма = `funding_gap_rub`). Статус `draft`.

### `PATCH /api/applications/{id}` → `conveyor#/application`
Тело `conveyor#/application_draft` с обязательным `version`.
- в `draft` можно менять все поля, кроме `company_id`;
- в `info_requested` можно менять `financials`, `collateral` и `info_response`;
- в остальных статусах — `INVALID_TRANSITION`.

### `POST /api/applications/{id}/submit` → `conveyor#/application`
Тело `{ "version": int }`. Из `draft`: проверка полноты (иначе `INCOMPLETE_APPLICATION`), затем `submitted`, дальше конвейер идёт сам. Из `info_requested`: возвращает заявку в `checking`.

### `POST /api/applications/{id}/documents` → `conveyor#/document` (201, multipart: `file`, `kind`)

### `GET /api/applications` → `[conveyor#/application_list_item]`
Новые сверху.

### `GET /api/applications/{id}` → `conveyor#/application`
Пока статус `submitted`, `checking` или `scoring`, фронт опрашивает этот метод раз в 2 секунды. В остальных статусах опрос не нужен.

### Действия клиента
Все принимают тело `{ "version": int }` и возвращают `conveyor#/application`.

| Метод | Из статуса | В статус |
|---|---|---|
| `POST /api/applications/{id}/accept` | `approved`, `counter_offer` | `signing` |
| `POST /api/applications/{id}/reject-offer` | `approved`, `counter_offer` | `cancelled` |
| `POST /api/applications/{id}/sign` | `signing` | `funded` (сразу, симуляция выдачи) |
| `POST /api/applications/{id}/withdraw` | `draft`, `info_requested` | `withdrawn` |

`sign` — это подписание внутри продукта: клиент подтверждает галочкой «С условиями договора ознакомлен» и нажимает «Подписать». Никаких SMS.

## Лента

### `GET /api/feed` → `[conveyor#/feed_item]`
Новые сверху, до 50. События по заявкам создаёт машина состояний. `tip` создаются правилами: например, `business_months` компании дошёл до 9 и стал доступен продукт.

### `POST /api/feed/read` → 204
Тело `{ "ids": [string] }`.

## Рабочее место аналитика

Все пути `/api/bank/*` доступны только роли `analyst`. Для `client` — `NOT_FOUND`.

### `GET /api/bank/applications?status=manual_review` → `[bank#/queue_item]`
`status` можно не передавать или перечислить через запятую. Черновики аналитику не видны. Сортировка: дольше всех ждущие сверху.

### `GET /api/bank/applications/{id}` → `bank#/bank_application`

### `POST /api/bank/applications/{id}/decision` → `bank#/bank_application`
Тело `bank#/decision_request`. Только из `manual_review`.

| `kind` | Новый статус | Обязательно |
|---|---|---|
| `approve` | `approved` | — (по умолчанию сумма и срок из заявки, ставка = rateFrom + надбавка класса) |
| `counter` | `counter_offer` | `amount_rub` или `term_months` отличаются от заявки; непустой `comment` |
| `request_info` | `info_requested` | непустой `info_items` |
| `decline` | `declined` | непустой `decline_reasons`, непустой `comment` |

Сумма и срок должны укладываться в диапазон продукта, ставка — не ниже `rateFrom`. Иначе `VALIDATION_ERROR`.

### `GET /api/bank/stats` → `bank#/stats`

## Машина состояний

Полная диаграмма — в `docs/CONVEYOR.md`, раздел 4. Каждый переход пишется в журнал (`bank#/event`). Клиенту журнал виден как `timeline` с текстами для клиента. Внутренние причины (баллы, комментарии аналитика) клиенту не показываются, кроме текста отказа и объяснения условий.

| Переход | Кто | Когда |
|---|---|---|
| `draft → submitted` | клиент | `submit`, все поля заполнены |
| `submitted → checking` | система | сразу |
| `checking → info_requested` | система | нужна доверенность (`authority_confirmed = false`) или полнота не пройдена |
| `checking → declined` | система | стоп-фактор |
| `checking → scoring` | система | проверки пройдены |
| `checking → manual_review` | система | мок не ответил (`result = error`) |
| `scoring → approved / counter_offer / manual_review / declined` | система | по `rules.decision` |
| `manual_review → …` | аналитик | `decision` |
| `info_requested → checking` | клиент | `submit` |
| остальные | клиент | действия из таблицы выше |

Между автоматическими этапами бэкенд делает паузу `rules.checks.stage_delay_seconds`, чтобы на демо было видно, как меняется статус.
