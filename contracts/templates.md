# Расчёт проекта без ИИ

`POST /api/plans/calculate` строит план по шаблону сферы из [`templates/spheres.v1.json`](templates/spheres.v1.json) и формулам ниже. Ответ — [`conveyor.schema.json#/definitions/plan_calc_response`](schemas/conveyor.schema.json): `plan_id` и план по [`plan.schema.json`](schemas/plan.schema.json) **со сметами** `startup_items` и `monthly_items`. План проходит `check_plan` бэкенда без исправлений.

`GET /api/templates` отдаёт для каждой сферы только `sphere`, `title` и `questions` (`conveyor#/template`).

Эталонная реализация — `frontend/src/lib/projectCalc.ts`. Её результат для [`plan.calc.request.json`](examples/plan.calc.request.json) лежит в [`plan.calc.response.json`](examples/plan.calc.response.json). Бэкенд обязан выдавать для этого запроса те же числа.

## Входные данные
`sphere`, `city`, `own_funds_rub`, `answers`. Ответа нет → берём `default` вопроса. Число вне `min`–`max` → `VALIDATION_ERROR`. Значение `choice` не из `options` → `VALIDATION_ERROR`.

## Формулы
Все деньги — целые рубли. Округление `round` — к ближайшему целому, половина вверх (`Math.round`, на бэкенде `js_round`).

1. **Коэффициент города `k`.** Население города из `frontend/src/data/cities.json` (поиск без учёта регистра и «ё»). Первый уровень `city_tiers`, у которого `population ≥ min_population`. Города нет в списке → `unknown_city_k`.
2. **Аренда в месяц** `rent = round(monthly.rent_per_m2 × area_m2 × k)`.
3. **Статьи запуска** `startup_items`, по порядку шаблона:
   - `fixed`: `rub`;
   - `per_m2`: `rub × area_m2`;
   - `per_answer`: `rub × answers[answer]`;
   - `rent_months`: `rent × months`.

   В `assumption` подстрока `{rub}` заменяется на `rub` в формате `150 000`. `startup_cost_rub` = сумма статей.
4. **Выручка на плановом уровне** `revenue = round(answers[revenue.qty] × answers[revenue.price] × revenue.days_per_month)`.
5. **Зарплаты** со страховыми взносами `salaries = round(staff × monthly.salary_per_staff × (0.6 + 0.4 × k) × (1 + payroll_tax_percent / 100))`.
6. **Месячные статьи** `monthly_items` на плановом уровне, без платежа по кредиту, в таком порядке:
   - «Аренда» — `rent`;
   - «Зарплаты» — `salaries`;
   - `monthly.cogs_title` — `round(revenue × cogs_percent / 100)`. Строка есть, только если `cogs_percent > 0`;
   - «Налог УСН 6%» — `round(revenue × tax_percent / 100)`;
   - «Прочие расходы» — `other_rub`.

   `monthly_expenses_rub` = сумма статей, `monthly_revenue_rub = revenue`, `monthly_profit_rub` = разница.
7. **Прогноз на 12 месяцев** — для месяца `m`:
   - `revenue_m = round(revenue × ramp[m−1])`;
   - `expenses_m = rent + salaries + other_rub + round(revenue_m × cogs_percent / 100) + round(revenue_m × tax_percent / 100)`.
8. **Окупаемость** `payback_months = ceil(startup_cost_rub / monthly_profit_rub)`, если прибыль больше 0, иначе `null`. Совпадает с `recalculate` бэкенда.
9. **Финансирование** `funding_gap_rub = max(0, startup_cost_rub − own_funds_rub)`.
10. **Кредит** при `funding_gap_rub > 0`:
    - сумма `amount = max(ceil(funding_gap_rub / 10 000) × 10 000, amountMin продукта)`;
    - продукт `credit.product_id`, если сумма в его диапазоне, иначе `fallback_product_id`;
    - срок `credit.term_months` в рамках продукта, ставка `rateFrom` продукта, платёж — аннуитет;
    - нагрузка `debt_load_percent = round(платёж / monthly_profit_rub × 100)`, при прибыли ≤ 0 — 100;
    - вердикт: ≤35 `ok`, ≤50 `risky`, иначе `not_recommended`;
    - `purpose`: «Запуск: » и названия двух самых крупных статей запуска строчными буквами;
    - `comment`: текст по вердикту (свободный).

    При `funding_gap_rub = 0`: `needed = false`, остальные числовые поля `null`, `comment` = «Стартовые расходы покрываются собственными средствами.».
11. **Шаги** `steps` = статьи запуска по порядку: `title`, `description = assumption`, `duration_days = days`, `cost_rub = amount_rub`. К итогу не прибавляются.
12. **Тексты:**
    - `title` = `«<название сферы>, <город>»`, например «Кофейня, Казань» (без склонения города);
    - `summary` собирается из чисел расчёта, поэтому всегда совпадает с ними;
    - `business` = `{ sphere: sphere_label, format: подпись выбранного format или title сферы, city }`, плюс `experience`, если он пришёл в запросе (`plan_calc_request.experience`);
    - `opportunities` и `risks` — из шаблона; если `experience = none`, последним в `risks` добавляется `experience_risk` из `spheres.v1.json` (при `employee`, `owner` и без поля риски не меняются). Формулы и числа плана от опыта не зависят;
    - `tags_update` = `[sphere_label строчными, city]`.

## Где используется
- Путь «Открыть новую точку или направление»: `plan_id` передаётся в `POST /api/applications`, сумма заявки по умолчанию = `credit.amount_rub` плана. В скоринге к прибыли компании прибавляется 50% `monthly_profit_rub` плана (`rules.scoring.new_project_profit_share`).
- Путь «Пока нет бизнеса»: план сохраняется, заявка не создаётся. Кредиты Альфы требуют от 9 месяцев работы бизнеса.
