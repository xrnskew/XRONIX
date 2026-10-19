"""Починка плана кодом до проверки.

Бэк сначала прогоняет checkPlan и только потом пересчитывает цифры, поэтому
ошибку, которую он сам бы исправил (не та сумма, 14 месяцев вместо 12), он всё
равно отклонит. Чиним здесь то, что однозначно чинится, а не переспрашиваем модель.
"""
import copy

CREDIT_NUMBERS = ("amount_rub", "recommended_term_months", "estimated_rate_percent",
                  "monthly_payment_rub", "debt_load_percent", "verdict")


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
        if _is_int(rev, exp) and f.get("monthly_profit_rub") != rev - exp:
            f["monthly_profit_rub"] = rev - exp
            fixed.append("monthly_profit_rub")
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
        c.pop("recommended_product_id", None)  # ставит только бэк
        gap = f.get("funding_gap_rub") if isinstance(f, dict) else None
        if c.get("needed") is False:
            for k in CREDIT_NUMBERS:
                if c.get(k) is not None:
                    c[k] = None
                    fixed.append(f"credit.{k} -> null")
        elif c.get("needed") is True and c.get("amount_rub") is None and _is_int(gap):
            c["amount_rub"] = gap
            fixed.append("credit.amount_rub")

    return p, sorted(set(fixed))
