"""Промпты и сборка сообщений для GigaChat."""
from .models import RespondRequest

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

PLAN_SYSTEM_PROMPT = f"""Ты — опытный бизнес-консультант для начинающих предпринимателей в России.
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
- payback_months = startup_cost_rub / monthly_profit_rub, округлить вверх; null, если прибыль ≤ 0.
- revenue_forecast — ровно 12 элементов, month от 1 до 12 подряд.
- steps — 5–8 шагов, order подряд с 1. opportunities — 3–5, risks — 3–5.
- Если funding_gap_rub > 0: credit.needed = true, amount_rub = funding_gap_rub, и заполнены
  amount_rub, recommended_term_months, estimated_rate_percent, monthly_payment_rub, debt_load_percent, verdict.
- Если funding_gap_rub = 0: credit.needed = false, эти шесть полей = null, comment объясняет почему.
- monthly_payment_rub — аннуитетный платёж. debt_load_percent = платёж / monthly_profit_rub * 100.
  verdict: нагрузка до 35 — "ok", 36–50 — "risky", больше 50 — "not_recommended".
- tags_update — 3–6 коротких тегов: сфера, город, стадия, бюджет.

В истории диалога твои прошлые ответы записаны как JSON (например, уточняющие вопросы).
Ответы пользователя на них — обычный текст. Учитывай всё, что пользователь уже сообщил.
"""


DECIDE_SYSTEM_PROMPT = """Ты — бизнес-консультант в кабинете предпринимателя. Помогаешь открыть бизнес и понять, какой кредит нужен.
Сейчас реши, что ответить на последнее сообщение пользователя, и верни ТОЛЬКО JSON:
{"action": "questions" | "plan" | "message", "text": "...", "questions": [...]}

Для бизнес-плана обязательно знать:
1) идею и формат бизнеса; 2) город; 3) сколько своих денег готов вложить; 4) опыт в этой сфере или в бизнесе.

action = "plan" — все четыре пункта известны из профиля, памяти или диалога (хотя бы примерно).
  text — короткая фраза, например "Составляю план". questions — пустой список.

action = "questions" — чего-то из обязательного не хватает.
  Задай МИНИМУМ 3 и максимум 6 вопросов: о недостающем и о важных деталях именно этой идеи
  (помещение, площадь, формат, каналы продаж, готовность взять кредит). То, что уже известно, НЕ спрашивай.
  Даже если не хватает одного пункта — всё равно 3 вопроса: добавь вопросы о деталях идеи.
  text — одна дружелюбная фраза до 300 символов.
  Каждый вопрос: {"id": "...", "text": "...", "kind": "choice" | "text", "options": [...]}
  - id — короткий snake_case латиницей: budget, city, experience, premises...
  - text — вопрос до 200 символов;
  - kind "choice" — 2–5 коротких вариантов ответа (до 40 символов) в options. Для денег и опыта — лучше choice;
  - kind "text" — свободный ответ, options = [].

action = "message" — сообщение не про открытие или развитие бизнеса, приветствие без идеи
  или вопрос по уже готовому плану. text — ответ по существу, до 1500 символов, обычный текст
  без JSON и markdown. Если идеи ещё нет — попроси рассказать, какой бизнес хочет открыть. questions — пустой.

Если пользователь не знает ответа («не знаю», «пока не решил») — не переспрашивай, в плане будет оценка.
В истории твои прошлые ответы записаны как JSON, ответы пользователя — обычный текст.
"""

ROUND_RULES = {
    0: "Это начало диалога или вопросы ещё не задавались.",
    1: "Ты уже задавал уточняющие вопросы, и пользователь на них ответил. Выбирай plan, если обязательное "
       "известно хотя бы примерно. Второй раунд вопросов — только если совсем непонятна идея или нет "
       "никакого представления о деньгах.",
}


def decide_messages(req: RespondRequest, rounds: int) -> list:
    system = DECIDE_SYSTEM_PROMPT + "\n" + ROUND_RULES[rounds] + "\n\n" + user_context_text(req)
    msgs = [("system", system)]
    msgs += [(h.role, h.content) for h in req.history]
    msgs.append(("user", req.message))
    return msgs


def user_context_text(req: RespondRequest) -> str:
    p, ctx = req.user_context.profile, req.user_context
    lines = [
        f"Имя: {p.name}",
        f"Город: {p.city or 'не указан'}",
        f"Опыт: {p.experience or 'не указан'}",
        f"Бюджет: {f'{p.budget_rub} руб.' if p.budget_rub is not None else 'не указан'}",
    ]
    if ctx.tags:
        lines.append(f"Теги: {', '.join(ctx.tags)}")
    if ctx.memory:
        lines.append(f"Что известно из прошлых диалогов: {ctx.memory}")
    return "Профиль пользователя:\n" + "\n".join(lines)


def plan_messages(req: RespondRequest) -> list:
    """[(role, content)] — system, история, текущее сообщение."""
    msgs = [("system", PLAN_SYSTEM_PROMPT + "\n" + user_context_text(req))]
    msgs += [(h.role, h.content) for h in req.history]
    msgs.append(("user", req.message))
    return msgs
