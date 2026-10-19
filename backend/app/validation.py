import copy
import json
import math

from jsonschema import Draft7Validator, FormatChecker
from referencing import Registry, Resource


class Contracts:
    def __init__(self, root):
        self.root = root
        schemas = [json.loads(p.read_text()) for p in (root / 'schemas').glob('*.json')]
        if not schemas:
            raise RuntimeError('Contract schemas missing; use repository root as Docker context')
        self.schemas = {s['$id']: s for s in schemas}
        self.registry = Registry().with_resources((s['$id'], Resource.from_contents(s)) for s in schemas)

    def validate(self, name, data, definition=None):
        schema = self.schemas[f'https://xronix/schemas/{name}.schema.json']
        if definition:
            schema = {'$ref': f'{schema["$id"]}#/definitions/{definition}'}
        Draft7Validator(schema, registry=self.registry, format_checker=FormatChecker()).validate(data)

    def example(self, name):
        return json.loads((self.root / 'examples' / name).read_text())


def check_plan(plan):
    f, c = plan['finance'], plan['credit']
    if f['funding_gap_rub'] != max(0, f['startup_cost_rub'] - f['own_funds_rub']):
        raise ValueError('funding_gap_rub')
    if f['monthly_profit_rub'] != f['monthly_revenue_rub'] - f['monthly_expenses_rub']:
        raise ValueError('monthly_profit_rub')
    if [m['month'] for m in f['revenue_forecast']] != list(range(1, 13)):
        raise ValueError('revenue_forecast order')
    if [s['order'] for s in plan['steps']] != list(range(1, len(plan['steps']) + 1)):
        raise ValueError('steps order')
    fields = ('amount_rub', 'recommended_term_months', 'estimated_rate_percent', 'monthly_payment_rub', 'debt_load_percent', 'verdict')
    if any((c[k] is None) == c['needed'] for k in fields):
        raise ValueError('credit nullability')
    if c['needed'] and c['amount_rub'] < f['funding_gap_rub'] * 0.5:
        raise ValueError('credit amount too small')
    if not c['needed'] and not c['comment'].strip():
        raise ValueError('credit comment required')


def js_round(value):
    return math.floor(value + 0.5)


def annuity(amount, rate, months):
    r = rate / 1200
    # expm1/log1p avoid cancellation for very small nonzero rates.
    return js_round(amount / months if r == 0 else amount * r / -math.expm1(-months * math.log1p(r)))


def verdict_for(load):
    return 'ok' if load <= 35 else 'risky' if load <= 50 else 'not_recommended'


def recalculate(plan):
    plan = copy.deepcopy(plan)
    f, c = plan['finance'], plan['credit']
    f['funding_gap_rub'] = max(0, f['startup_cost_rub'] - f['own_funds_rub'])
    f['monthly_profit_rub'] = f['monthly_revenue_rub'] - f['monthly_expenses_rub']
    if c['needed']:
        c['monthly_payment_rub'] = annuity(c['amount_rub'], c['estimated_rate_percent'], c['recommended_term_months'])
        c['debt_load_percent'] = js_round(c['monthly_payment_rub'] / f['monthly_profit_rub'] * 100) if f['monthly_profit_rub'] > 0 else 100
        c['verdict'] = verdict_for(c['debt_load_percent'])
    c['recommended_product_id'] = None
    return plan
