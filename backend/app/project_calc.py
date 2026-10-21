"""Template calculator; mirrors the formulas and example in contracts/templates.md."""
import copy
import json
import math
from pathlib import Path

from .validation import js_round, annuity, check_plan

DATA = Path(__file__).parent / 'catalog'
CITIES = {n.lower().replace('ё', 'е'): p for n, _, p in json.loads((DATA / 'cities.json').read_text())}


def normalize_city(city):
    city = city.strip()
    if not city:
        raise ValueError('Укажите город.')
    if len(city) > 60:
        raise ValueError('Название города должно быть не длиннее 60 символов.')
    return city


def city_k(city, cfg):
    pop = CITIES.get(city.strip().lower().replace('ё', 'е'))
    return cfg['unknown_city_k'] if pop is None else next(t['k'] for t in cfg['city_tiers'] if pop >= t['min_population'])


def groups(n):
    return f'{n:,}'.replace(',', ' ')


def short_rub(n):
    return (f'{js_round(n/100000)/10:g}'.replace('.', ',')+' млн ₽') if n >= 1000000 else groups(js_round(n/1000))+' тыс ₽'


def templates(cfg):
    return [dict(sphere=s, title=d['title'], questions=d['questions']) for s, d in cfg['spheres'].items()]


def calculate(req, cfg, products):
    req = {**req, 'city': normalize_city(req['city'])}
    if req['sphere'] not in cfg['spheres']:
        raise ValueError('Для этой сферы пока нет шаблона расчёта.')
    d, answers = cfg['spheres'][req['sphere']], {}
    if set(req['answers']) - {q['id'] for q in d['questions']}:
        raise ValueError('Передан неизвестный параметр анкеты.')
    for q in d['questions']:
        v = req['answers'].get(q['id'], q['default'])
        if q['kind'] == 'number':
            try:
                v = float(v)
            except (TypeError, ValueError, OverflowError):
                raise ValueError(f"{q['text']}: требуется число") from None
            if not math.isfinite(v) or v < q.get('min', -math.inf) or v > q.get('max', math.inf):
                raise ValueError(f"{q['text']}: от {q.get('min')} до {q.get('max')}")
            if v.is_integer():
                v = int(v)
        elif v not in [o['value'] for o in q['options']]:
            raise ValueError(f"{q['text']}: выберите вариант из списка")
        answers[q['id']] = v
    a, m, tax = answers, d['monthly'], cfg['tax_percent']
    k, area, staff = city_k(req['city'], cfg), a['area_m2'], a['staff']
    rent = js_round(m['rent_per_m2']*area*k)
    startup_items = []
    for s in d['startup']:
        kind = s['kind']
        amount = s['rub'] if kind == 'fixed' else s['rub']*area if kind == 'per_m2' else s['rub']*a[s['answer']] if kind == 'per_answer' else rent*s['months']
        startup_items.append(dict(title=s['title'], amount_rub=js_round(amount), assumption=s['assumption'].replace('{rub}', groups(s.get('rub', 0)))))
    startup = sum(s['amount_rub'] for s in startup_items)
    revenue = js_round(a[d['revenue']['qty']]*a[d['revenue']['price']]*d['revenue']['days_per_month'])
    salaries = js_round(staff*m['salary_per_staff']*(0.6+0.4*k)*(1+cfg['payroll_tax_percent']/100))
    monthly_items = [dict(title='Аренда', amount_rub=rent, assumption=f"{groups(m['rent_per_m2'])} ₽ за м² в Москве × {area:g} м² × коэффициент города {k:g}"),
                     dict(title='Зарплаты', amount_rub=salaries, assumption=f"{staff:g} чел., с учётом уровня зарплат в городе и страховых взносов {cfg['payroll_tax_percent']}%")]
    if m['cogs_percent'] > 0:
        monthly_items.append(dict(title=m['cogs_title'], amount_rub=js_round(revenue*m['cogs_percent']/100), assumption=f"{m['cogs_percent']}% выручки"))
    monthly_items.extend([dict(title=f'Налог УСН {tax}%', amount_rub=js_round(revenue*tax/100), assumption='УСН «доходы»'),
                          dict(title='Прочие расходы', amount_rub=m['other_rub'], assumption='Коммунальные услуги, связь, эквайринг, бухгалтерия')])
    expenses = sum(s['amount_rub'] for s in monthly_items)
    profit, gap = revenue-expenses, max(0, startup-req['own_funds_rub'])
    payback = math.ceil(startup/profit) if profit > 0 else None
    forecast = []
    for j, r in enumerate(d['ramp']):
        rev = js_round(revenue*r)
        forecast.append(dict(month=j+1, revenue_rub=rev, expenses_rub=rent+salaries+m['other_rub']+js_round(rev*m['cogs_percent']/100)+js_round(rev*tax/100)))
    if gap > 0:
        c = cfg['credit']
        raw = math.ceil(gap/c['round_to_rub'])*c['round_to_rub']
        product = products[c['product_id']]
        if raw > product['amountMax']:
            product = products[c['fallback_product_id']]
        amount = max(raw, product['amountMin'] or 0)
        term = min(product['termMax'], max(product['termMin'] or 1, c['term_months']))
        rate = product['rateFrom'] or 0
        pay = annuity(amount, rate, term)
        load = js_round(pay/profit*100) if profit > 0 else 100
        verdict = 'ok' if load <= 35 else 'risky' if load <= 50 else 'not_recommended'
        top = ', '.join(s['title'].lower() for s in sorted(startup_items, key=lambda s: -s['amount_rub'])[:2])
        comment = f'Платёж — около {load}% плановой прибыли: нагрузка умеренная.' if verdict == 'ok' else f'Платёж — {load}% плановой прибыли: запас небольшой, лучше увеличить свои средства или срок.' if verdict == 'risky' else f'Платёж — {load}% плановой прибыли: бизнес вряд ли потянет такой кредит. Уменьшите масштаб или добавьте свои средства.'
        credit = dict(needed=True, amount_rub=amount, purpose='Запуск: '+top, recommended_term_months=term, estimated_rate_percent=rate, monthly_payment_rub=pay, debt_load_percent=load, verdict=verdict, recommended_product_id=product['id'], comment=comment)
    else:
        credit = dict.fromkeys(['amount_rub', 'purpose', 'recommended_term_months', 'estimated_rate_percent', 'monthly_payment_rub', 'debt_load_percent', 'verdict', 'recommended_product_id'])
        credit.update(needed=False, comment='Стартовые расходы покрываются собственными средствами.')
    fmt = next((o['label'] for q in d['questions'] if q['id'] == 'format' for o in q.get('options', []) if o['value'] == a.get('format')), d['title'])
    payback_text = f'окупаемость — около {payback} мес' if payback else 'при таких параметрах бизнес не окупается'
    plan = dict(title=f"{d['title']}, {req['city']}"[:80], summary=f'{fmt}: запуск — {short_rub(startup)}, на плановом уровне прибыль {short_rub(profit)} в месяц, {payback_text}. Расчёт по шаблону, цены — оценка.',
                business=dict(sphere=d['sphere_label'], format=fmt, city=req['city']),
                steps=[dict(order=j+1, title=s['title'], description=startup_items[j]['assumption'], duration_days=s['days'], cost_rub=startup_items[j]['amount_rub']) for j, s in enumerate(d['startup'])],
                opportunities=copy.deepcopy(d['opportunities']), risks=copy.deepcopy(d['risks']),
                finance=dict(startup_cost_rub=startup, own_funds_rub=req['own_funds_rub'], funding_gap_rub=gap, monthly_revenue_rub=revenue, monthly_expenses_rub=expenses, monthly_profit_rub=profit, payback_months=payback, revenue_forecast=forecast, startup_items=startup_items, monthly_items=monthly_items),
                credit=credit, tags_update=[d['sphere_label'].lower()[:30], req['city'][:30]])
    check_plan(plan)
    return plan
