"""Прогон бизнес-идей через GigaChat: приходит ли план, который примет бэкенд.

Проверка в три слоя, как у Ильи в бэке:
  1. это вообще JSON;
  2. он проходит схему плана (contracts/schemas/plan.schema.json);
  3. он проходит правила checkPlan (contracts/ai.md): суммы сходятся, 12 месяцев и т.д.

Запускать из папки ai (там лежат .env и certs):
  .\\.venv\\Scripts\\python json_test.py                       # все идеи, режим prompt
  .\\.venv\\Scripts\\python json_test.py --mode schema         # + JSON-схема в response_format (beta)
  .\\.venv\\Scripts\\python json_test.py --model GigaChat-2-Pro --only 1 3

Сырые ответы сохраняются в test_outputs/ — смотри их, если что-то не прошло.
"""
import argparse
import json
import os
import re
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from gigachat import GigaChat
from gigachat.models import Chat, JsonSchemaResponseFormat, Messages, MessagesRole
from pydantic import ValidationError

from plan_schema import Plan, check_plan

load_dotenv(Path.cwd() / ".env")

# Шаблон, а не готовый пример: с реальными цифрами модель просто копирует пример.
PLAN_TEMPLATE = """{
  "title": "<название, до 80 символов>",
  "summary": "<суть в 2–3 предложениях, до 400 символов>",
  "business": {"sphere": "<сфера>", "format": "<формат>", "city": "<город>"},
  "steps": [
    {"order": 1, "title": "<шаг>", "description": "<что сделать>", "duration_days": <целое или null>, "cost_rub": <целое или null>}
  ],
  "opportunities": [{"title": "<возможность>", "description": "<почему>"}],
  "risks": [{"title": "<риск>", "level": "low|medium|high", "mitigation": "<как снизить>"}],
  "finance": {
    "startup_cost_rub": <целое>,
    "own_funds_rub": <целое>,
    "funding_gap_rub": <целое>,
    "monthly_revenue_rub": <целое>,
    "monthly_expenses_rub": <целое>,
    "monthly_profit_rub": <целое, может быть < 0>,
    "payback_months": <целое или null, если не окупается>,
    "revenue_forecast": [{"month": 1, "revenue_rub": <целое>, "expenses_rub": <целое>}]
  },
  "credit": {
    "needed": true|false,
    "amount_rub": <целое или null>,
    "purpose": "<на что>" или null,
    "recommended_term_months": <целое 1–120 или null>,
    "estimated_rate_percent": <число или null>,
    "monthly_payment_rub": <целое или null>,
    "debt_load_percent": <целое или null>,
    "verdict": "ok|risky|not_recommended" или null,
    "comment": "<почему так>"
  },
  "tags_update": ["<тег до 30 символов>"]
}"""

SYSTEM_PROMPT = f"""Ты — опытный бизнес-консультант для начинающих предпринимателей в России.
По описанию бизнес-идеи составь персональный бизнес-план с кредитной частью.
Все цифры считай под конкретную идею, город и бюджет пользователя.

Ответь ТОЛЬКО одним JSON-объектом. Без markdown, без ```, без пояснений до или после.

Формат (в <...> — что подставить):
{PLAN_TEMPLATE}

Правила:
- Все суммы — целые числа в рублях: 1500000, а не "1 500 000" и не 1.5.
- Все поля обязательны, новых не добавляй. null — только там, где в формате сказано «или null».
- finance заполняй всегда: если пользователь не назвал цифры, дай реалистичную оценку по рынку.
- funding_gap_rub = startup_cost_rub - own_funds_rub, но не меньше 0.
- monthly_profit_rub = monthly_revenue_rub - monthly_expenses_rub.
- revenue_forecast — ровно 12 элементов, month от 1 до 12 подряд.
- steps — 5–8 шагов, order подряд с 1. opportunities — 3–5, risks — 3–5.
- Если funding_gap_rub > 0: credit.needed = true, amount_rub = funding_gap_rub, и заполнены
  amount_rub, recommended_term_months, estimated_rate_percent, monthly_payment_rub, debt_load_percent, verdict.
- Если funding_gap_rub = 0: credit.needed = false, эти шесть полей = null, comment объясняет почему.
- monthly_payment_rub — аннуитетный платёж. debt_load_percent = платёж / monthly_profit_rub * 100.
  verdict: нагрузка до 35 — "ok", 36–50 — "risky", больше 50 — "not_recommended".
- tags_update — 3–6 коротких тегов: сфера, город, стадия, бюджет.
"""

IDEAS = [
    "Хочу открыть кофейню с собой у метро в Москве. Своих денег 500 тыс. Два года работал бариста.",
    "Барбершоп на 3 кресла в Казани. Есть 800 тыс своих, опыта в бизнесе нет.",
    "Онлайн-школа английского для детей, работаю из дома, Новосибирск. Я преподаватель с опытом 5 лет, бюджет 150 тыс.",
    "Пекарня-кондитерская в Екатеринбурге. Своих 1 млн, на печи и оборудование нужен кредит.",
    "Автомойка самообслуживания на 4 поста в Краснодаре. Своих 2 млн, 10 лет работал в автосервисе.",
    # Мало данных. В настоящем диалоге тут будут уточняющие вопросы, а здесь проверяем,
    # что модель не ломает схему и не оставляет finance пустым.
    "Хочу шиномонтаж в Самаре.",
]


def extract_json(text: str) -> str:
    """Убирает ```json-обёртку и текст вокруг объекта."""
    text = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start != -1 and end > start else text


def annuity(amount: int, rate_percent: float, months: int) -> int:
    r = rate_percent / 12 / 100
    return round(amount * r / (1 - (1 + r) ** -months)) if r else round(amount / months)


def info_notes(p: Plan) -> list:
    """Не ошибки (бэк пересчитает сам), но полезно видеть, насколько модель считает."""
    notes, c = [], p.credit
    if c.needed and None not in (c.amount_rub, c.estimated_rate_percent, c.recommended_term_months, c.monthly_payment_rub):
        real = annuity(c.amount_rub, c.estimated_rate_percent, c.recommended_term_months)
        if real and abs(real - c.monthly_payment_rub) / real > 0.05:
            notes.append(f"инфо: платёж {c.monthly_payment_rub}, по аннуитету {real} — бэк пересчитает")
    if len(p.steps) < 5:
        notes.append(f"инфо: шагов всего {len(p.steps)} (просили 5–8)")
    if len(p.risks) < 3:
        notes.append(f"инфо: рисков всего {len(p.risks)} (просили 3–5)")
    return notes


def run_one(giga: GigaChat, model: str, mode: str, idea: str, out_file: Path) -> dict:
    chat = Chat(
        model=model,
        messages=[
            Messages(role=MessagesRole.SYSTEM, content=SYSTEM_PROMPT),
            Messages(role=MessagesRole.USER, content=idea),
        ],
        temperature=0.3,
        max_tokens=4000,
    )
    if mode == "schema":
        chat.response_format = JsonSchemaResponseFormat(schema=Plan, strict=True)

    t = time.time()
    try:
        resp = giga.chat(chat)
    except Exception as e:
        return {"status": "API_ERROR", "sec": time.time() - t, "tokens": 0, "notes": [f"{type(e).__name__}: {str(e)[:200]}"]}
    sec = time.time() - t
    tokens = resp.usage.total_tokens

    raw = resp.choices[0].message.content
    out_file.write_text(raw, encoding="utf-8")
    notes = []
    if resp.choices[0].finish_reason == "length":
        notes.append("ответ обрезан по max_tokens")
    if raw.strip().startswith("```"):
        notes.append("обёрнут в ``` (извлёк JSON сам)")

    try:
        data = json.loads(extract_json(raw))
    except json.JSONDecodeError as e:
        return {"status": "BAD_JSON", "sec": sec, "tokens": tokens, "notes": notes + [str(e)]}

    try:
        plan = Plan.model_validate(data)
    except ValidationError as e:
        errs = [f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()]
        return {"status": "BAD_SCHEMA", "sec": sec, "tokens": tokens, "notes": notes + errs}

    rule_errors = check_plan(plan)
    if rule_errors:
        return {"status": "BAD_RULES", "sec": sec, "tokens": tokens, "notes": notes + rule_errors}
    return {"status": "OK", "sec": sec, "tokens": tokens, "notes": notes + info_notes(plan)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=os.environ.get("GIGACHAT_MODEL", "GigaChat-2"))
    ap.add_argument("--mode", choices=["prompt", "schema"], default="prompt")
    ap.add_argument("--only", type=int, nargs="+", help="номера идей с 1, например --only 1 6")
    ap.add_argument("--out", default="test_outputs")
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%H%M%S")
    picked = [(i, IDEAS[i - 1]) for i in (args.only or range(1, len(IDEAS) + 1))]

    print(f"Модель: {args.model}, режим: {args.mode}, идей: {len(picked)}\n")
    results = []
    with GigaChat(
        credentials=os.environ["GIGACHAT_AUTH_KEY"],
        scope=os.environ["GIGACHAT_SCOPE"],
        ca_bundle_file=str(Path.cwd() / os.environ["GIGACHAT_CA_BUNDLE_FILE"]),
        timeout=120,
        max_retries=3,
    ) as giga:
        for i, idea in picked:
            out_file = out_dir / f"{stamp}_{args.model}_{args.mode}_{i}.json"
            r = run_one(giga, args.model, args.mode, idea, out_file)
            results.append(r)
            print(f"[{i}] {r['status']:<10} {r['sec']:5.1f}s {r['tokens']:5} ток.  {idea[:50]}")
            for n in r["notes"][:8]:
                print(f"      - {n}")

    ok = sum(r["status"] == "OK" for r in results)
    slow = sum(r["sec"] > 15 for r in results)
    print(f"\nИтого: {ok}/{len(results)} прошли бы проверку бэка, токенов: {sum(r['tokens'] for r in results)}")
    if slow:
        print(f"Внимание: {slow} ответ(ов) дольше 15 с — у бэка общий таймаут 30 с вместе с ретраями")
    print(f"Сырые ответы: {out_dir.resolve()}")


if __name__ == "__main__":
    main()
