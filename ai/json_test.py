"""Прогон бизнес-идей через GigaChat: приходит ли план, который примет бэкенд.

Промпт, схема и починка — те же, что в сервисе (app/prompts.py, app/plan.py, app/repair.py).
Проверка в три слоя, как у Ильи в бэке:
  1. это вообще JSON;
  2. он проходит схему плана (contracts/schemas/plan.schema.json);
  3. он проходит правила checkPlan (contracts/ai.md): суммы сходятся, 12 месяцев и т.д.

Запускать из папки ai:
  .\\.venv\\Scripts\\python json_test.py                       # все идеи, режим schema (как в сервисе)
  .\\.venv\\Scripts\\python json_test.py --mode prompt         # без response_format
  .\\.venv\\Scripts\\python json_test.py --model GigaChat-2-Pro --only 1 3
  .\\.venv\\Scripts\\python json_test.py --no-repair           # посмотреть, что модель делает без починки

Сырые ответы сохраняются в test_outputs/ — смотри их, если что-то не прошло.
"""
import argparse
import json
import time
from datetime import datetime
from pathlib import Path

from gigachat import GigaChat
from gigachat.models import Chat, JsonSchemaResponseFormat, Messages, MessagesRole
from pydantic import ValidationError

from app import config
from app.llm import extract_json
from app.plan import Plan, check_plan
from app.prompts import PLAN_SYSTEM_PROMPT
from app.repair import repair_plan

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


def annuity(amount: int, rate_percent: float, months: int) -> int:
    r = rate_percent / 12 / 100
    return round(amount * r / (1 - (1 + r) ** -months)) if r else round(amount / months)


def info_notes(p: Plan) -> list:
    """Не ошибки (бэк пересчитает сам), но полезно видеть, насколько модель считает."""
    notes, c, f = [], p.credit, p.finance
    if c.needed and None not in (c.amount_rub, c.estimated_rate_percent, c.recommended_term_months, c.monthly_payment_rub):
        real = annuity(c.amount_rub, c.estimated_rate_percent, c.recommended_term_months)
        if real and abs(real - c.monthly_payment_rub) / real > 0.05:
            notes.append(f"инфо: платёж {c.monthly_payment_rub}, по аннуитету {real} — бэк пересчитает")
    if f.monthly_profit_rub > 0 and f.payback_months:
        real = -(-f.startup_cost_rub // f.monthly_profit_rub)
        if abs(real - f.payback_months) > max(2, real * 0.3):
            notes.append(f"инфо: окупаемость {f.payback_months} мес., по цифрам плана ~{real}")
    if len(p.steps) < 5:
        notes.append(f"инфо: шагов всего {len(p.steps)} (просили 5–8)")
    if len(p.risks) < 3:
        notes.append(f"инфо: рисков всего {len(p.risks)} (просили 3–5)")
    return notes


def run_one(giga: GigaChat, args, idea: str, out_file: Path) -> dict:
    chat = Chat(
        model=args.model,
        messages=[
            Messages(role=MessagesRole.SYSTEM, content=PLAN_SYSTEM_PROMPT),
            Messages(role=MessagesRole.USER, content=idea),
        ],
        temperature=0.3,
        max_tokens=4000,
    )
    if args.mode == "schema":
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

    if not args.no_repair:
        data, fixed = repair_plan(data)
        if fixed:
            notes.append(f"починено: {', '.join(fixed)}")

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
    ap.add_argument("--model", default=config.MODEL)
    ap.add_argument("--mode", choices=["prompt", "schema"], default="schema")
    ap.add_argument("--only", type=int, nargs="+", help="номера идей с 1, например --only 1 6")
    ap.add_argument("--no-repair", action="store_true", help="не чинить план кодом")
    ap.add_argument("--out", default=str(config.AI_DIR / "test_outputs"))
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%H%M%S")
    picked = [(i, IDEAS[i - 1]) for i in (args.only or range(1, len(IDEAS) + 1))]

    print(f"Модель: {args.model}, режим: {args.mode}, починка: {'нет' if args.no_repair else 'да'}, идей: {len(picked)}\n")
    results = []
    with GigaChat(
        credentials=config.AUTH_KEY,
        scope=config.SCOPE,
        ca_bundle_file=config.CA_BUNDLE,
        timeout=120,
        max_retries=3,
    ) as giga:
        for i, idea in picked:
            out_file = out_dir / f"{stamp}_{args.model}_{args.mode}_{i}.json"
            r = run_one(giga, args, idea, out_file)
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
