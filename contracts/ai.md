# Backend ↔ AI-сервис

AI-сервис работает как чистая функция: получил контекст, вернул ответ, **ничего не хранит**. Токен GigaChat только в `.env` этого сервиса.
Базовый адрес `AI_SERVICE_URL` (по умолчанию `http://localhost:8001`), JSON, UTF-8, без авторизации (внутренняя сеть).
Схемы: [`schemas/`](schemas), примеры: [`examples/`](examples).

## `POST /ai/respond`
Вход: [`ai-request.schema.json`](schemas/ai-request.schema.json), пример [request.respond.json](examples/request.respond.json). Собирает бэкенд:
- `user_context.profile`, `tags`, `memory` (до 800 символов, пустая строка если памяти нет);
- `history`: последние 10 сообщений (без текущего), `role` и `content`;
- `message`: текущее сообщение пользователя.

Выход 200: [`ai-reply.schema.json`](schemas/ai-reply.schema.json), строго один из трёх типов:

| `type` | Когда ИИ его возвращает |
|---|---|
| `questions` | Не хватает данных для плана. 3–6 вопросов, не больше двух раундов подряд. Для `choice` обязательны `options` (2–5), для `text` их быть не должно. `id` вопроса: `snake_case` латиницей |
| `message` | Вопрос не про план или нужна короткая реплика без вопросов |
| `plan` | Данных достаточно. Содержит `plan` по [`plan.schema.json`](schemas/plan.schema.json), **без** `plan_id` |

Гарантия AI-сервиса: **всегда** валидный JSON одного из трёх типов. Свой ответ он проверяет сам (ретраи внутри) и при провале отдаёт 502:
```json
{ "error": { "code": "AI_BAD_RESPONSE", "message": "…" } }
```
Если GigaChat недоступен: 503 и `AI_UNAVAILABLE`. Формат ошибки тот же, что в [error.schema.json](schemas/error.schema.json).

## `POST /ai/summarize`
Вход: `{ "memory": string, "history": [...до 30 сообщений] }`, выход: `{ "memory": string (до 800 символов), "tags": string[] (до 12, каждый до 30 символов) }`.
Схема: [`summarize.schema.json`](schemas/summarize.schema.json) (`#/definitions/request` и `#/definitions/response`).
Новая память должна сохранять факты из старой, которые не устарели, и дополнять их новыми. Теги: сфера, город, стадия, бюджет.

## `GET /ai/health` → `{ "status": "ok" }`

## Правила плана
Схема проверяет типы и размеры, а эти правила проверяет бэкенд функцией `checkPlan` из [`check.mjs`](check.mjs) до сохранения. AI-сервис должен их соблюдать.

1. Все суммы: **целые рубли**, числа, не строки, без пробелов.
2. Данных нет: `null` там, где схема это разрешает. Выдумывать цифры нельзя.
3. `funding_gap_rub` = `startup_cost_rub` − `own_funds_rub` (не меньше 0).
4. `monthly_profit_rub` = `monthly_revenue_rub` − `monthly_expenses_rub`.
5. `revenue_forecast`: ровно 12 месяцев, `month` от 1 до 12 подряд.
6. `steps[].order` идёт подряд с 1.
7. `credit.needed = true`: заполнены `amount_rub`, `recommended_term_months`, `estimated_rate_percent`, `monthly_payment_rub`, `debt_load_percent`, `verdict`. `needed = false`: все они `null`, `comment` объясняет почему.
8. `tags_update`: короткие факты о пользователе (сфера, город, стадия, бюджет), до 12.

## Что бэкенд пересчитывает сам
Цифры ИИ это оценка. После проверки бэкенд **перезаписывает** поверх ответа ИИ:

| Поле | Как считается |
|---|---|
| `credit.monthly_payment_rub` | Аннуитет: `r = rate/100/12`, платёж `amount·r / (1 − (1+r)^−term)`, округление до рубля |
| `credit.debt_load_percent` | `monthly_payment_rub / monthly_profit_rub · 100`, округление до целого. Прибыль ≤ 0: 100 |
| `credit.verdict` | нагрузка ≤ 35: `ok`; 36–50: `risky`; больше 50: `not_recommended` |
| `finance.funding_gap_rub` | по правилу 3 |
| `finance.monthly_profit_rub` | по правилу 4 |
| `credit.recommended_product_id` | По сумме и сроку среди продуктов банка (`fast`, `secured`, `mortgage`, `revolving`), беззалоговые первыми. Ставит только бэкенд |

Функции `annuity` и `verdictFor` в [`check.mjs`](check.mjs) образец, пример [plan.coffee.json](examples/plan.coffee.json) проходит по ним без расхождений (1 000 000 ₽, 22%, 24 мес. дают 51 878 ₽).
Порог 35% и 50% совпадает с цветами нагрузки в кабинете.

## Ретраи бэкенда
Ответ не прошёл схему или `checkPlan`: повторный запрос в AI-сервис, до 2 раз. После этого фронту уходит `AI_BAD_RESPONSE`.
Таймаут запроса к AI-сервису 30 секунд. Бэкенд добавляет `plan_id` и сохраняет план только после проверки.

## Память
После готового плана (или каждые N сообщений) бэкенд зовёт `/ai/summarize` и записывает `memory`, а `tags` сливает с тегами пользователя без дублей (не больше 12).
