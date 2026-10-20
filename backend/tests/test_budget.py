import pytest
from app.validation import check_plan, recalculate
from test_backend import CONTRACTS


def test_itemized_costs_are_authoritative_and_steps_are_not_added_twice():
    p = CONTRACTS.example('plan.coffee.json')
    p['finance']['startup_items'] = [dict(title='Оборудование', amount_rub=700000, assumption='Комплект'), dict(title='Аренда и залог', amount_rub=100000, assumption='Два платежа по 50000')]
    p['finance']['monthly_items'] = [dict(title='Аренда', amount_rub=50000, assumption='За месяц'), dict(title='Другие расходы', amount_rub=200000, assumption='Оценка')]
    result = recalculate(p)
    assert result['finance']['startup_cost_rub'] == 800000
    assert result['finance']['monthly_expenses_rub'] == 250000
    assert result['finance']['monthly_profit_rub'] == result['finance']['monthly_revenue_rub'] - 250000
    CONTRACTS.validate('plan', result)
    check_plan(result)
    result['finance']['startup_items'][0]['amount_rub'] += 1
    with pytest.raises(ValueError, match='total mismatch'):
        check_plan(result)


def test_old_saved_plans_remain_valid_without_invented_breakdown():
    result = recalculate(CONTRACTS.example('plan.coffee.json'))
    CONTRACTS.validate('plan', result)
    check_plan(result)
    assert 'startup_items' not in result['finance']
