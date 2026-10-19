"""Схема плана — копия contracts/schemas/plan.schema.json (ветка backend) на pydantic,
плюс правила checkPlan из contracts/ai.md, которые бэк проверяет перед сохранением.

strict=True — строки вместо чисел ("1 500 000") считаются ошибкой.
extra="forbid" — лишние поля тоже ошибка.
Optional[...] без значения по умолчанию — поле обязано быть, но может быть null.
"""
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.json_schema import SkipJsonSchema

Rub = Annotated[int, Field(ge=0)]
NonEmpty = Annotated[str, Field(min_length=1)]


class _Strict(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")


class Business(_Strict):
    sphere: NonEmpty
    format: NonEmpty
    city: NonEmpty


class Step(_Strict):
    order: Annotated[int, Field(ge=1)]
    title: NonEmpty
    description: str
    duration_days: Optional[Annotated[int, Field(ge=0)]]
    cost_rub: Optional[Rub]


class Opportunity(_Strict):
    title: NonEmpty
    description: str


class Risk(_Strict):
    title: NonEmpty
    level: Literal["low", "medium", "high"]
    mitigation: str


class ForecastPoint(_Strict):
    month: Annotated[int, Field(ge=1, le=12)]
    revenue_rub: Rub
    expenses_rub: Rub


class Finance(_Strict):
    startup_cost_rub: Rub
    own_funds_rub: Rub
    funding_gap_rub: Rub
    monthly_revenue_rub: Rub
    monthly_expenses_rub: Rub
    monthly_profit_rub: int  # может быть отрицательной
    payback_months: Optional[Annotated[int, Field(ge=0)]]  # null, если не окупается
    revenue_forecast: Annotated[List[ForecastPoint], Field(min_length=12, max_length=12)]


class Credit(_Strict):
    needed: bool
    amount_rub: Optional[Rub]
    purpose: Optional[str]
    recommended_term_months: Optional[Annotated[int, Field(ge=1, le=120)]]
    estimated_rate_percent: Optional[Annotated[float, Field(ge=0, le=100)]]
    monthly_payment_rub: Optional[Rub]
    debt_load_percent: Optional[Annotated[int, Field(ge=0)]]
    verdict: Optional[Literal["ok", "risky", "not_recommended"]]
    # Продукт Альфа-Банка ставит код (repair.pick_product), не модель: в схему для GigaChat не попадает.
    recommended_product_id: SkipJsonSchema[Optional[Literal["fast", "secured", "mortgage", "revolving"]]] = None
    comment: str


class Plan(_Strict):
    title: Annotated[str, Field(min_length=1, max_length=80)]
    summary: Annotated[str, Field(min_length=1, max_length=400)]
    business: Business
    steps: Annotated[List[Step], Field(min_length=3, max_length=10)]
    opportunities: Annotated[List[Opportunity], Field(min_length=1, max_length=6)]
    risks: Annotated[List[Risk], Field(min_length=1, max_length=8)]
    finance: Finance
    credit: Credit
    tags_update: Annotated[List[Annotated[str, Field(min_length=1, max_length=30)]], Field(max_length=12)]


CREDIT_NUMBERS = ("amount_rub", "recommended_term_months", "estimated_rate_percent",
                  "monthly_payment_rub", "debt_load_percent", "verdict")


def check_plan(p: Plan) -> List[str]:
    """Правила checkPlan из contracts/ai.md. Любая ошибка здесь = бэк отклонит план."""
    errors, f, c = [], p.finance, p.credit
    gap = max(0, f.startup_cost_rub - f.own_funds_rub)
    if f.funding_gap_rub != gap:
        errors.append(f"funding_gap_rub={f.funding_gap_rub}, а должно быть startup-own={gap}")
    if f.monthly_profit_rub != f.monthly_revenue_rub - f.monthly_expenses_rub:
        errors.append(f"monthly_profit_rub={f.monthly_profit_rub} ≠ revenue-expenses="
                      f"{f.monthly_revenue_rub - f.monthly_expenses_rub}")
    if [m.month for m in f.revenue_forecast] != list(range(1, 13)):
        errors.append("revenue_forecast: месяцы не 1..12 подряд")
    if [s.order for s in p.steps] != list(range(1, len(p.steps) + 1)):
        errors.append("steps.order не подряд с 1")
    bad = [k for k in CREDIT_NUMBERS if (getattr(c, k) is None) == c.needed]
    if bad:
        state = "null при needed=true" if c.needed else "не null при needed=false"
        errors.append(f"credit: {', '.join(bad)} — {state}")
    if c.needed and c.amount_rub is not None and c.amount_rub < f.funding_gap_rub * 0.5:
        errors.append(f"credit.amount_rub={c.amount_rub} меньше половины funding_gap={f.funding_gap_rub}")
    if not c.needed and not c.comment.strip():
        errors.append("credit.needed=false, но comment пустой")
    return errors
