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

    def test_optimistic_margin_is_rejected_without_fictitious_expenses(self):
        from types import SimpleNamespace as NS
        from app.plan import check_plan
        f=NS(startup_items=[NS(amount_rub=100)],startup_cost_rub=100,
             monthly_items=[NS(amount_rub=50)],monthly_expenses_rub=50,
             monthly_revenue_rub=100,monthly_profit_rub=50,own_funds_rub=100,
             funding_gap_rub=0,revenue_forecast=[NS(month=i) for i in range(1,13)])
        c=NS(needed=False,amount_rub=None,recommended_term_months=None,estimated_rate_percent=None,
             monthly_payment_rub=None,debt_load_percent=None,verdict=None,comment='Без кредита')
        p=NS(finance=f,credit=c,steps=[NS(order=1)])
        self.assertTrue(any('30%' in error for error in check_plan(p)))
        f.monthly_revenue_rub=70;f.monthly_profit_rub=20
        self.assertEqual(check_plan(p),[])


class BudgetRetryTests(unittest.IsolatedAsyncioTestCase):
    async def test_retry_keeps_single_system_message_at_start(self):
        import asyncio
        from app.service import generate_plan
        from test_scope import request
        class Model:
            def __init__(self): self.calls=[]
            async def json_chat(self,messages,schema,**kwargs):
                self.calls.append(copy.deepcopy(messages))
                assert [r for r,_ in messages].count('system')==1
                assert messages[0][0]=='system'
                exp=50 if len(self.calls)==1 else 75
                return {'title':'Кофейня','summary':'Предварительная оценка',
                    'business':{'sphere':'Общепит','format':'Кофе с собой','city':'Казань'},
                    'steps':[{'order':i,'title':'Подготовка','description':'Оценка','duration_days':1,'cost_rub':0} for i in range(1,4)],
                    'opportunities':[{'title':'Спрос','description':'Проверить'}],
                    'risks':[{'title':'Аренда','level':'high','mitigation':'Уточнить'}],
                    'finance':{'startup_items':[{'title':'Комплект','amount_rub':1000,'assumption':'Оценка'}],
                        'monthly_items':[{'title':'Расходы','amount_rub':exp,'assumption':'Оценка'}],
                        'startup_cost_rub':1000,'own_funds_rub':1000,'funding_gap_rub':0,
                        'monthly_revenue_rub':100,'monthly_expenses_rub':exp,'monthly_profit_rub':100-exp,
                        'payback_months':40,'revenue_forecast':[{'month':i,'revenue_rub':100,'expenses_rub':exp} for i in range(1,13)]},
                    'credit':dict(needed=False,amount_rub=None,purpose=None,recommended_term_months=None,
                        estimated_rate_percent=None,monthly_payment_rub=None,debt_load_percent=None,verdict=None,comment='Без кредита'),
                    'tags_update':[]}
        model=Model()
        result=await generate_plan(model,request('Хочу открыть кофейню'),asyncio.get_running_loop().time()+120)
        self.assertEqual(len(model.calls),2)
        self.assertIn('Предыдущая смета',model.calls[1][0][1])
        self.assertEqual(result['plan']['finance']['monthly_expenses_rub'],75)
