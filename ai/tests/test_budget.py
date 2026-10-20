import copy
import unittest
from app.repair import repair_plan
from app.plan import Finance
from pydantic import ValidationError

class BudgetTests(unittest.TestCase):
    def test_totals_come_from_rows_without_inventing_margin_costs(self):
        data={'finance':{'startup_cost_rub':1500000,'own_funds_rub':300000,
            'monthly_revenue_rub':500000,'monthly_expenses_rub':1,
            'startup_items':[{'title':'Комплект','amount_rub':800000,'assumption':'Оценка'}],
            'monthly_items':[{'title':'Аренда','amount_rub':50000,'assumption':'Оценка'}]},
            'steps':[{'order':1,'cost_rub':0}]}
        original=copy.deepcopy(data)
        fixed,_=repair_plan(data)
        self.assertEqual(fixed['finance']['startup_cost_rub'],800000)
        self.assertEqual(fixed['finance']['funding_gap_rub'],500000)
        self.assertEqual(fixed['finance']['monthly_expenses_rub'],50000)
        self.assertEqual(fixed['finance']['monthly_profit_rub'],450000)
        self.assertEqual(fixed['steps'][0]['cost_rub'],0)
        self.assertEqual(data,original)

    def test_schema_requires_new_estimates_and_rejects_negative_rows(self):
        with self.assertRaises(ValidationError): Finance.model_validate({})
        from app.plan import BudgetItem
        with self.assertRaises(ValidationError):
            BudgetItem(title='Аренда',amount_rub=-1,assumption='Оценка')
