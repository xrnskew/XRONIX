"""Починка плана кодом до проверки.

Бэк сначала прогоняет checkPlan и только потом пересчитывает цифры, поэтому
ошибку, которую он сам бы исправил (не та сумма, 14 месяцев вместо 12), он всё
равно отклонит. Чиним здесь то, что однозначно чинится, а не переспрашиваем модель.

Плюс приводим к ориентирам капитана: ставка 18–25 %, окупаемость по формуле,
маржа не выше разумной, продукт Альфа-Банка, теги в одном стиле.
"""
import copy
import math
import re

CREDIT_NUMBERS = ("amount_rub", "recommended_term_months", "estimated_rate_percent",
                  "monthly_payment_rub", "debt_load_percent", "verdict")

# Ставка для малого бизнеса без кредитной истории.
RATE_MIN, RATE_MAX, RATE_DEFAULT = 18, 25, 21
TERM_MIN, TERM_MAX, TERM_DEFAULT = 12, 120, 36
# Чистая прибыль выше 30 % выручки у малого бизнеса почти не бывает. Если модель
# насчитала больше, поднимаем расходы до маржи 25 %: иначе нагрузка по кредиту
# выходит 4–7 % и кредит «подходит» всегда.
MARGIN_MAX, MARGIN_TARGET = 0.30, 0.25

# Продукты из frontend/src/data/alfaProducts.ts: (id, сумма от, сумма до, срок от, срок до).
PRODUCTS = {
    "fast": (300_000, 50_000_000, 12, 120),
    "secured": (300_000, 150_000_000, 12, 120),
    "mortgage": (300_000, 150_000_000, 12, 120),
    "revolving": (500_000, 50_000_000, 12, 18),
}
REAL_ESTATE = re.compile(r"(покупк|приобрет|выкуп)\w*\s+(\w+\s+)?(помещени|недвижимост|здани)", re.I)
WORKING_CAPITAL = re.compile(r"оборот|пополнени\w* запас|закупк\w* товар", re.I)


def _whole_floats_to_int(value, key=None):
    """1500000.0 -> 1500000. Ставку не трогаем: там дробь законна."""
    if isinstance(value, dict):
        return {k: _whole_floats_to_int(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [_whole_floats_to_int(v, key) for v in value]
    if isinstance(value, float) and value.is_integer() and key != "estimated_rate_percent":
        return int(value)
    return value


def _is_int(*values) -> bool:
    return all(isinstance(v, int) and not isinstance(v, bool) for v in values)


def annuity(amount: int, rate_percent: float, months: int) -> int:
    """Как annuity в contracts/check.mjs."""
    r = rate_percent / 100 / 12
    return math.floor((amount / months if r == 0 else amount * r / (1 - (1 + r) ** -months)) + 0.5)


def verdict_for(load: int) -> str:
    return "ok" if load <= 35 else "risky" if load <= 50 else "not_recommended"


def rub(n: int) -> str:
    """1234567 -> «1 234 567 ₽»."""
    return f"{n:,}".replace(",", " ") + " ₽"


def credit_comment(payment: int, load: int, verdict: str) -> str:
    """Комментарий под наш вердикт, когда модель насчитала другой и её текст ему противоречит."""
    head = f"Платёж около {rub(payment)} в месяц, это {load} % от прибыли."
    return head + {
        "ok": " Нагрузка комфортная, бизнес должен её выдержать.",
        "risky": " Нагрузка заметная: заложите запас на первые месяцы или возьмите кредит на больший срок.",
        "not_recommended": " Это больше половины прибыли, так брать кредит рискованно: уменьшите сумму, "
                           "добавьте своих денег или увеличьте срок.",
    }[verdict]


def city_name(city: str) -> str:
    """«казань» -> «Казань», «ростов-на-дону» -> «Ростов-на-Дону». Уже с заглавной — не трогаем."""
    if not city or city != city.lower():
        return city
    return " ".join("-".join(part if part in ("на", "де") else part[:1].upper() + part[1:]
                             for part in word.split("-")) for word in city.split())


def _fits(pid: str, amount: int, term: int) -> bool:
    lo, hi, tlo, thi = PRODUCTS[pid]
    return lo <= amount <= hi and tlo <= term <= thi


def pick_product(amount: int, term: int, purpose: str) -> str:
    """Как matchProducts на фронте (подходящие, беззалоговые первыми), плюс назначение кредита."""
    purpose = purpose or ""
    if REAL_ESTATE.search(purpose) and _fits("mortgage", amount, term):
        return "mortgage"
    if WORKING_CAPITAL.search(purpose) and _fits("revolving", amount, term):
        return "revolving"
    if not _fits("fast", amount, term) and _fits("secured", amount, term):
        return "secured"
    return "fast"


def clean_tags(tags, city=None) -> list:
    """Короткие теги в одном стиле: строчные, без дефисов, город — с заглавной, как в business.city."""
    out, seen = [], set()
    city_words = {w.lower(): w for w in re.findall(r"[А-ЯЁA-Z][\w-]+", city or "")}
    if city:
        city_words[city.strip().lower()] = city.strip()
    for tag in tags if isinstance(tags, list) else []:
        if not isinstance(tag, str):
            continue
        t = re.sub(r"[-–—_/]+", " ", tag)
        t = re.sub(r"[«»\"'#.!]", "", t)
        t = re.sub(r"\s+", " ", t).strip().lower()[:30].strip()
        if not t:
            continue
        t = city_words.get(t, t)
        if t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out[:6]


def repair_plan(data: dict) -> tuple:
    """Возвращает (починенный план, список того, что починили)."""
    p = _whole_floats_to_int(copy.deepcopy(data))
    fixed = []
    p.pop("plan_id", None)

    f = p.get("finance")
    if isinstance(f, dict):
        s, o = f.get("startup_cost_rub"), f.get("own_funds_rub")
        if _is_int(s, o) and f.get("funding_gap_rub") != max(0, s - o):
            f["funding_gap_rub"] = max(0, s - o)
            fixed.append("funding_gap_rub")

        rev, exp = f.get("monthly_revenue_rub"), f.get("monthly_expenses_rub")
        if _is_int(rev, exp) and rev > 0 and (rev - exp) / rev > MARGIN_MAX:
            new_exp = rev - round(rev * MARGIN_TARGET)
            fc = f.get("revenue_forecast")
            if isinstance(fc, list) and exp > 0:
                k = new_exp / exp
                for m in fc:
                    if isinstance(m, dict) and _is_int(m.get("expenses_rub")):
                        m["expenses_rub"] = round(m["expenses_rub"] * k)
            f["monthly_expenses_rub"] = exp = new_exp
            fixed.append(f"маржа {MARGIN_TARGET:.0%}")
        if _is_int(rev, exp) and f.get("monthly_profit_rub") != rev - exp:
            f["monthly_profit_rub"] = rev - exp
            fixed.append("monthly_profit_rub")

        profit = f.get("monthly_profit_rub")
        if _is_int(s, profit):
            payback = math.ceil(s / profit) if profit > 0 else None
            if f.get("payback_months") != payback:
                f["payback_months"] = payback
                fixed.append("payback_months")

        fc = f.get("revenue_forecast")
        if isinstance(fc, list):
            if len(fc) > 12:
                f["revenue_forecast"] = fc = fc[:12]
                fixed.append("revenue_forecast обрезан до 12")
            for i, m in enumerate(fc, 1):
                if isinstance(m, dict) and m.get("month") != i:
                    m["month"] = i
                    fixed.append("revenue_forecast.month")

    steps = p.get("steps")
    if isinstance(steps, list):
        for i, s in enumerate(steps, 1):
            if isinstance(s, dict) and s.get("order") != i:
                s["order"] = i
                fixed.append("steps.order")

    c = p.get("credit")
    if isinstance(c, dict):
        gap = f.get("funding_gap_rub") if isinstance(f, dict) else None
        profit = f.get("monthly_profit_rub") if isinstance(f, dict) else None
        # Есть дефицит денег — кредит нужен, даже если модель решила иначе: это кредитный кабинет.
        # Нет дефицита — не нужен. Комментарий модели тогда противоречит решению, заменяем.
        if c.get("needed") is False and _is_int(gap) and gap > 0:
            c["needed"] = True
            c["comment"] = f"На запуск не хватает {rub(gap)}: эту сумму можно закрыть кредитом."
            fixed.append("credit.needed -> true")
        elif c.get("needed") is True and gap == 0:
            c["needed"] = False
            c["comment"] = "Своих денег хватает на запуск, кредит не нужен."
            fixed.append("credit.needed -> false")
        if c.get("needed") is False:
            for k in CREDIT_NUMBERS:
                if c.get(k) is not None:
                    c[k] = None
                    fixed.append(f"credit.{k} -> null")
            c["recommended_product_id"] = None
        elif c.get("needed") is True:
            if not _is_int(c.get("amount_rub")) and _is_int(gap):
                c["amount_rub"] = gap
                fixed.append("credit.amount_rub")
            rate = c.get("estimated_rate_percent")
            if not isinstance(rate, (int, float)) or isinstance(rate, bool) or not RATE_MIN <= rate <= RATE_MAX:
                c["estimated_rate_percent"] = min(max(rate, RATE_MIN), RATE_MAX) if isinstance(rate, (int, float)) and not isinstance(rate, bool) else RATE_DEFAULT
                fixed.append("ставка 18–25 %")
            term = c.get("recommended_term_months")
            if not _is_int(term) or not TERM_MIN <= term <= TERM_MAX:
                c["recommended_term_months"] = min(max(term, TERM_MIN), TERM_MAX) if _is_int(term) else TERM_DEFAULT
                fixed.append("срок кредита")
            amount = c.get("amount_rub")
            if _is_int(amount) and amount > 0:
                # Бэк всё равно пересчитает, но считаем сами, чтобы план сходился и до него.
                payment = annuity(amount, c["estimated_rate_percent"], c["recommended_term_months"])
                load = math.floor(payment / profit * 100 + 0.5) if _is_int(profit) and profit > 0 else 100
                verdict = verdict_for(load)
                if c.get("verdict") != verdict or not isinstance(c.get("comment"), str) or not c["comment"].strip():
                    c["comment"] = credit_comment(payment, load, verdict)
                    fixed.append("credit.comment")
                c["monthly_payment_rub"], c["debt_load_percent"], c["verdict"] = payment, load, verdict
                c["recommended_product_id"] = pick_product(amount, c["recommended_term_months"], c.get("purpose"))

    b = p.get("business")
    if isinstance(b, dict) and isinstance(b.get("city"), str) and city_name(b["city"]) != b["city"]:
        b["city"] = city_name(b["city"])
        fixed.append("business.city")

    if "tags_update" in p:
        city = b.get("city") if isinstance(b, dict) else None
        tags = clean_tags(p["tags_update"], city)
        if tags != p["tags_update"]:
            p["tags_update"] = tags
            fixed.append("теги")

    return p, sorted(set(fixed))
