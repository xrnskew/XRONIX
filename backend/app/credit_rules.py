"""Pure credit calculations. Thresholds are supplied by the versioned contract."""
import math
import re
from datetime import date, datetime, timezone

from .validation import annuity as payment, js_round


GOV_TEXT = 'Половину риска по кредиту берёт Корпорация МСП: поэтому залог не нужен.'


def expired(p, today=None):
    return bool(p.get('validUntil') and (today or datetime.now(timezone.utc).date()).isoformat() > p['validUntil'])


def rub(n):
    return f'{n:,}'.replace(',', '\u00a0') + ' ₽'


def business_months(registered, today=None):
    if not registered:
        return 0
    d, t = date.fromisoformat(registered), today or datetime.now(timezone.utc).date()
    return max(0, (t.year-d.year)*12+t.month-d.month-(t.day < d.day))


def age_text(m):
    y, m = divmod(m, 12)
    return ' '.join(x for x in [f'{y} ' + ('год' if y == 1 else 'года' if y < 5 else 'лет') if y else '', f'{m} мес.' if m else ''] if x) or 'меньше месяца'


def eligible_date(registered, months):
    """Calendar-month addition with the same overflow rule as the conveyor contract."""
    from datetime import timedelta
    d = date.fromisoformat(registered)
    y, m = divmod(d.year*12+d.month-1+months, 12)
    return (date(y, m+1, 1)+timedelta(days=d.day-1)).strftime('%d.%m.%Y')


def schedule(amount, rate, months):
    balance, pay, rows = amount, payment(amount, rate, months), []
    for m in range(1, months+1):
        interest = js_round(balance*rate/1200)
        principal = pay-interest if m < months else balance
        balance -= principal
        rows.append(dict(month=m, payment_rub=principal+interest, principal_rub=principal, interest_rub=interest, balance_rub=balance))
    return rows


def match_products(req, months, products, rules, person=False, plan=None, today=None):
    out = []
    for p in products.values():
        reasons = []
        if req['amount_rub'] < (p['amountMin'] or 0) or req['amount_rub'] > p['amountMax']:
            reasons.append(f"Сумма должна быть {'от '+rub(p['amountMin'])+' ' if p['amountMin'] else ''}до {rub(p['amountMax'])}.")
        if req['term_months'] < (p['termMin'] or 1) or req['term_months'] > p['termMax']:
            reasons.append(f"Срок должен быть {'от '+str(p['termMin'])+' ' if p['termMin'] else ''}до {p['termMax']} мес.")
        if p['collateral'] and not req['has_collateral']:
            reasons.append('Нужен залог или поручитель.' if p['id'] == 'start' else 'Нужен залог: недвижимость, оборудование или транспорт.')
        if p['id'] == 'mortgage' and req['purpose'] != 'real_estate':
            reasons.append('Подходит только для покупки недвижимости.')
        if p['id'] == 'revolving' and req['purpose'] != 'working_capital':
            reasons.append('Линия для пополнения оборота.')
        if expired(p,today):
            reasons.append('Акция закончилась '+date.fromisoformat(p['validUntil']).strftime('%d.%m.%Y')+'.')
        if p['id'] == 'start':
            if not plan:
                reasons.append('Нужен расчёт проекта: посчитайте его в чате или в мастере.')
            elif plan['own_funds_rub'] < plan['startup_cost_rub']*rules['start']['min_own_share']:
                share = rules['start']['min_own_share']
                reasons.append(f"Своих денег должно быть не меньше {share*100:g}% стоимости запуска: {rub(math.ceil(plan['startup_cost_rub']*share))}, у вас {rub(plan['own_funds_rub'])}.")
        elif person:
            reasons.append('Продукт Альфа-Банка для действующего бизнеса: нужны зарегистрированные ИП или компания.')
        elif months is not None and p['minBusinessMonths'] and months < p['minBusinessMonths']:
            reasons.append(f"Бизнес должен работать не меньше {p['minBusinessMonths']} месяцев, у вас {age_text(months).rstrip('.')}.")
        can = p['id'] in rules['applicable_products']
        if not can:
            reasons.append('Заявку на этот продукт в демо оформляет менеджер банка.')
        out.append(dict(product_id=p['id'], name=p['name'], demo=p.get('demo', False), eligible=len(reasons) == (0 if can else 1), can_apply=can,
                        **(dict(gov=True,valid_until=p.get('validUntil')) if p.get('gov') else {}),
                        reasons=reasons, rate_from_percent=p['rateFrom'], url=p['url'],
                        monthly_payment_rub=payment(req['amount_rub'], p['rateFrom'], min(p['termMax'], max(p['termMin'] or 1, req['term_months']))) if p['rateFrom'] is not None and p['id'] != 'revolving' else None))
    return sorted(out, key=lambda x: (not (x['eligible'] and x['can_apply']), x['rate_from_percent'] if x['rate_from_percent'] is not None else 99))


def stop_factors(i, p, rules, today=None):
    s, out = rules['stop_factors'], []
    def add(code, **params):
        out.append(dict(code=code, params=params))
    if i['registry']['status'] in s['inactive_statuses']:
        add('company_inactive')
    if not i.get('person') and p['minBusinessMonths'] and business_months(i['registry']['registered_at'], today) < p['minBusinessMonths']:
        add('business_too_young', min_months=str(p['minBusinessMonths']), eligible_date=eligible_date(i['registry']['registered_at'], p['minBusinessMonths']))
    if i['bki']['overdue_90_12m'] > s['overdue_90_12m_max']:
        add('overdue_90')
    if i['fns']['tax_debt_rub'] > s['tax_debt_max_rub']:
        add('tax_debt', limit_rub=rub(s['tax_debt_max_rub'])[:-2])
    if s['head_disqualified'] and i['fns']['head_disqualified']:
        add('head_disqualified')
    if p['id'] == 'gov_guarantee':
        limit=rules['gov_guarantee']['msp_max_revenue_rub']
        if (i['financials']['revenue_12m_rub'] or 0)>limit:
            add('not_msp',limit_rub=rub(limit)[:-2])
        if expired(p,date.fromisoformat(i['submitted_on']) if i.get('submitted_on') else today):
            add('offer_expired',valid_until=date.fromisoformat(p['validUntil']).strftime('%d.%m.%Y'))
    if p['id'] == 'start':
        if not i.get('plan') and rules['start']['plan_required']:
            add('plan_required')
        elif i.get('plan') and i['plan']['own_funds_rub'] < i['plan']['startup_cost_rub']*rules['start']['min_own_share']:
            add('own_funds_low', min_share=f"{rules['start']['min_own_share']*100:g}")
    return out


def monthly_profit(i, rules):
    f = i['financials']
    current = (f['revenue_12m_rub']-f['expenses_12m_rub'])/12 if f['revenue_12m_rub'] is not None and f['expenses_12m_rub'] is not None else None
    plan = (i.get('plan') or {}).get('monthly_profit_rub', i.get('plan_profit_rub'))
    if current is None and plan is None:
        return None
    share = rules['start']['plan_profit_share'] if i['product_id'] == 'start' else rules['scoring']['new_project_profit_share']
    return (current or 0)+(plan or 0)*share


def existing_payments(i):
    return max(i['financials']['loan_payments_monthly_rub'] or 0, sum(l['monthly_payment_rub'] for l in i['bki']['loans']))


def debt_load(i, p, rules, amount=None, months=None, rate=None):
    profit = monthly_profit(i, rules)
    if profit is None or profit <= 0:
        return None
    pay = payment(i['amount_rub'] if amount is None else amount, (p['rateFrom'] or 0) if rate is None else rate, i['term_months'] if months is None else months)
    return js_round((existing_payments(i)+pay)/profit*1000)/10


def score(i, p, rules, today=None):
    sc, factors = rules['scoring'], []
    def add(code, name, value, points):
        factors.append(dict(code=code, name=name, value_text=value, points=points))
    def band(rows, key, value):
        return next(b['points'] for b in rows if b[key] is None or value <= b[key])
    if p['id'] == 'start' and i.get('plan'):
        plan = i['plan']
        share = plan['own_funds_rub']/plan['startup_cost_rub'] if plan['startup_cost_rub'] else math.inf
        points = next((b['points'] for b in rules['start']['own_share'] if share >= b['min_share']), 0)
        add('own_share', 'Свои деньги в проекте', f'{js_round(share*100)}% стоимости запуска', points)
    else:
        m = business_months(i['registry']['registered_at'], today)
        add('business_age', 'Стаж бизнеса', age_text(m), band(sc['business_age'], 'max_months', m))
    load = debt_load(i, p, rules)
    add('debt_load', 'Долговая нагрузка', 'нет прибыли' if load is None else f'{load:g}'.replace('.', ',')+'% прибыли', sc['debt_load_no_profit_points'] if load is None else band(sc['debt_load'], 'max_percent', load))
    h, b = sc['credit_history'], i['bki']
    hp, ht = (h['no_history'], 'нет истории') if not b['has_history'] else (h['overdue_30'], f"просрочки 30+: {b['overdue_30_24m']}") if b['overdue_30_24m'] else (h['clean'] if b['history_months'] >= h['clean_min_months'] else h['short_clean'], f"чистая, {b['history_months']} мес.")
    add('credit_history', 'Кредитная история', ht, hp)
    rev = i['plan']['monthly_revenue_rub']*12 if p['id'] == 'start' and i.get('plan') else i['financials']['revenue_12m_rub'] or 0
    ratio = i['amount_rub']/rev if rev else math.inf
    add('amount_to_revenue', 'Сумма к годовой выручке', f'{js_round(ratio*100)}%' if rev else 'выручки нет', band(sc['amount_to_revenue'], 'max_ratio', ratio))
    cv = (i.get('collateral') or {}).get('value_rub', 0)
    if p['id'] == 'gov_guarantee':
        g=rules['gov_guarantee']
        add('state_guarantee','Поручительство Корпорации МСП',g['scoring_label'],g['scoring_points'])
    else:
        add('collateral', 'Залог', rub(cv) if cv else 'нет', sc['collateral']['full_coverage' if cv >= i['amount_rub'] else 'partial' if cv else 'none'])
    if i['fns']['mass_address']:
        add('mass_address', 'Массовый адрес', 'да', sc['mass_address'])
    if i['fns']['tax_debt_rub']:
        add('tax_debt', 'Недоимка по налогам', rub(i['fns']['tax_debt_rub']), sc['small_tax_debt'])
    if i['registry']['okved']:
        code = i['registry']['okved']['code']
        add('industry', 'Отрасль', f'ОКВЭД {code}', sc['industry']['by_okved_prefix'].get(code[:2], sc['industry']['default']))
    value = min(sc['max'], max(sc['min'], sc['base']+sum(f['points'] for f in factors)))
    grade = next(g['grade'] for g in sc['grades'] if value >= g['min_score'])
    return dict(score=value, grade=grade, factors=factors, debt_load_percent=load)


def rate_for(p, grade, rules):
    return (p['rateFrom'] or 0)+(rules['decision']['rate_premium_by_grade'][grade] or 0)


def decide(i, s, p, rules):
    d, grade = rules['decision'], s['grade']
    rate = rate_for(p, grade, rules)
    def offer(kind, amount, months, explanation):
        if i.get('person'):
            explanation.append(rules['start']['condition_text'])
        if p['id'] == 'gov_guarantee':
            explanation.append(GOV_TEXT)
        return dict(kind=kind, amount_rub=amount, term_months=months, rate_percent=rate, explanation=explanation)
    def manual(text):
        return dict(kind='manual', recommendation=text)
    if grade == 'D':
        return dict(kind='decline', reasons=[dict(code='low_score', params={})])
    load = debt_load(i, p, rules, rate=rate)
    if load is None:
        return manual('Нет данных о прибыли: нужна оценка специалиста.')
    if load > d['max_debt_load_percent']:
        if grade not in d['counter_offer_grades']:
            return manual(f'Класс {grade}, нагрузка {load:g}%: встречное предложение или залог.')
        longer = debt_load(i, p, rules, months=p['termMax'], rate=rate)
        reason = f"На {i['term_months']} мес. платёж занял бы {load:g}% прибыли, банк допускает до {d['max_debt_load_percent']}%.".replace(f'{load:g}', f'{load:g}'.replace('.', ','))
        if longer is not None and longer <= d['max_debt_load_percent']:
            return offer('counter', i['amount_rub'], p['termMax'], [reason, f"Увеличили срок до {p['termMax']} мес.: сумма та же, платёж меньше."])
        max_pay = monthly_profit(i, rules)*d['max_debt_load_percent']/100-existing_payments(i)
        r, n = rate/1200, p['termMax']
        raw = max_pay*((1-(1+r)**-n)/r if r else n)
        amount = math.floor(raw/d['amount_round_to_rub'])*d['amount_round_to_rub']
        if max_pay <= 0 or amount < (p['amountMin'] or 0):
            return manual(f'Нагрузка {load:g}% даже на максимальный срок: нужен залог или меньшая сумма.')
        return offer('counter', amount, n, [reason, f'Предлагаем {rub(amount)} на {n} мес.'])
    if grade == 'A' and i['amount_rub'] <= d['auto_approve_max_amount_rub']:
        return offer('approve', i['amount_rub'], i['term_months'], ['Заявка одобрена на запрошенных условиях.', 'Ставка — базовая для продукта: кредитная оценка высокая.'])
    return manual(f"Сумма больше {rub(d['auto_approve_max_amount_rub'])}: решение принимает специалист. Система рекомендует одобрить." if grade == 'A' else f'Класс {grade}: решение принимает специалист.')


def decline_text(reason, dictionaries):
    params, code = reason['params'], reason['code']
    def fill(s):
        return re.sub(r'\{(\w+)\}', lambda m: str(params.get(m[1], '')), s)
    result = dict(code=code, **{k: fill(v) for k, v in dictionaries['decline_reasons'][code].items()})
    if code == 'business_too_young' and not params.get('eligible_date'):
        result['advice'] = 'Подайте заявку после достижения минимального стажа бизнеса. Пока рассмотрите собственные средства или программы поддержки МСП.'
    return result
