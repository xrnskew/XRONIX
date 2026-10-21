"""Government guarantee: contract parity and the real backend conveyor."""
import copy
import json
from datetime import date
from pathlib import Path
import pytest
from sqlalchemy import select
from app import credit_rules as cr
from app.conveyor_models import ApplicationEvent
from test_conveyor import (settings,client,register,company,draft,submit,step,
    CONTRACTS,PRODUCTS,RULES,SCENARIOS,DEMO)

GOV=json.loads((Path(__file__).resolve().parents[2]/'contracts/products.gov.json').read_text())['products'][0]
PRODUCTS={**PRODUCTS,GOV['id']:GOV}
TODAY=date(2026,10,21)


def input_body(**extra):
    result={**copy.deepcopy(SCENARIOS['7715881399']),**copy.deepcopy(DEMO['7715881399'])}
    result.update(product_id='gov_guarantee',collateral=None)
    result.update(extra)
    return result


def test_match_40m_only_gov_and_future_person_excluded():
    request=dict(purpose='equipment',amount_rub=40000000,term_months=36,has_collateral=False)
    rows=cr.match_products(request,80,PRODUCTS,RULES,today=TODAY)
    assert [x['product_id'] for x in rows if x['eligible'] and x['can_apply']]==['gov_guarantee']
    gov=rows[0];assert gov['gov'] is True and gov['valid_until']=='2026-11-15'
    for row in rows:CONTRACTS.validate('conveyor',row,'match_item')
    rows=cr.match_products(request,None,PRODUCTS,RULES,person=True,today=TODAY)
    assert not next(x for x in rows if x['product_id']=='gov_guarantee')['eligible']


@pytest.mark.parametrize('today,expired',[(date(2026,11,15),False),(date(2026,11,16),True)])
def test_expiry_inclusive_in_match_and_stop_factors(today,expired):
    rows=cr.match_products(dict(purpose='equipment',amount_rub=40000000,term_months=36,has_collateral=False),80,PRODUCTS,RULES,today=today)
    gov=next(x for x in rows if x['product_id']=='gov_guarantee')
    assert gov['eligible'] is not expired
    assert ('Акция закончилась 15.11.2026.' in gov['reasons']) is expired
    reasons=cr.stop_factors(input_body(),GOV,RULES,today)
    assert reasons==([dict(code='offer_expired',params=dict(valid_until='15.11.2026'))] if expired else [])


@pytest.mark.parametrize('revenue,stop',[(2000000000,False),(2000000001,True)])
def test_msp_revenue_boundary(revenue,stop):
    i=input_body();i['financials']['revenue_12m_rub']=revenue
    reasons=cr.stop_factors(i,GOV,RULES,TODAY)
    assert [r['code'] for r in reasons]==(['not_msp'] if stop else [])
    if stop:
        assert ''.join(reasons[0]['params']['limit_rub'].split())=='2000000000'
        assert '2\u00a0000\u00a0000\u00a0000' in cr.decline_text(reasons[0],json.loads((CONTRACTS.root/'dictionaries.json').read_text()))['text']


@pytest.mark.parametrize('amount,term,kind',[(1500000,24,'approve'),(2000000,12,'counter')])
def test_guarantee_scoring_and_automatic_offers(amount,term,kind):
    i=input_body(amount_rub=amount,term_months=term)
    sc=cr.score(i,GOV,RULES,TODAY)
    factors={f['code']:f for f in sc['factors']}
    assert 'collateral' not in factors
    assert factors['state_guarantee']==dict(code='state_guarantee',name='Поручительство Корпорации МСП',value_text=RULES['gov_guarantee']['scoring_label'],points=8)
    fast=cr.score({**i,'product_id':'fast'},PRODUCTS['fast'],RULES,TODAY)
    assert sc['score']==min(100,fast['score']+8)
    decision=cr.decide(i,sc,GOV,RULES)
    assert decision['kind']==kind and cr.GOV_TEXT in decision['explanation']
    assert decision['rate_percent']==cr.rate_for(GOV,sc['grade'],RULES)


def start_application(c,h,**extra):
    co=company(c,h)
    a=draft(c,h,co,product_id='gov_guarantee',amount_rub=40000000,term_months=36,collateral=None,**extra)
    a=submit(c,h,a)
    return a


def finish(c):
    for _ in range(3):step(c)


def analyst(c):
    # Only the test fixture assigns roles; there is no public role-elevation API.
    from app.db import User
    headers=register(c,'analyst-test@example.com')
    with c.app.app.state.sessions() as s:
        u=s.scalar(select(User).where(User.email=='analyst-test@example.com'));u.role='analyst';s.commit()
    return headers


@pytest.mark.parametrize('decision,expected',[('approve','approved'),('counter','counter_offer')])
def test_40m_backend_pipeline_and_analyst_offer(settings,decision,expected):
    with client(settings) as c:
        h=register(c);bank=analyst(c);a=start_application(c,h);finish(c)
        card=c.get('/api/bank/applications/'+a['id'],headers=bank)
        assert card.status_code==200,card.text
        card=card.json();CONTRACTS.validate('bank',card,'bank_application')
        assert card['application']['status']=='manual_review'
        assert next(f for f in card['scoring']['factors'] if f['code']=='state_guarantee')['points']==8
        body=dict(kind=decision,version=card['application']['version'],comment='Проверено поручительство МСП.')
        if decision=='counter':body.update(amount_rub=3000000,term_months=60)
        r=c.post('/api/bank/applications/'+a['id']+'/decision',headers=bank,json=body)
        assert r.status_code==200,r.text
        offer=r.json()['application']['offer']
        assert r.json()['application']['status']==expected
        assert cr.GOV_TEXT in offer['explanation'] and offer['rate_percent']>=24
        public=c.get('/api/applications/'+a['id'],headers=h).json()
        assert public['offer']==offer


@pytest.mark.parametrize('bad',[dict(amount_rub=299999),dict(amount_rub=50000001),dict(term_months=11),dict(term_months=61),dict(rate_percent=23.99)])
def test_analyst_product_bounds_are_atomic(settings,bad):
    with client(settings) as c:
        h=register(c);bank=analyst(c);a=start_application(c,h);finish(c)
        path='/api/bank/applications/'+a['id'];before=c.get(path,headers=bank).json()
        r=c.post(path+'/decision',headers=bank,json=dict(kind='approve',version=before['application']['version'],comment='',**bad))
        assert r.status_code==400 and r.json()['error']['code']=='VALIDATION_ERROR'
        assert c.get(path,headers=bank).json()==before


@pytest.mark.parametrize('submitted_on,status,reason',[
    ('2026-11-15','manual_review',None),('2026-11-16','declined','offer_expired')])
def test_pipeline_expiry_uses_submission_day(settings,submitted_on,status,reason):
    with client(settings) as c:
        h=register(c);a=start_application(c,h)
        with c.app.app.state.sessions() as s:
            event=s.scalar(select(ApplicationEvent).where(ApplicationEvent.application_id==a['id'],ApplicationEvent.to_status=='submitted'))
            event.at=submitted_on+'T23:59:59Z';s.commit()
        finish(c)
        r=c.get('/api/applications/'+a['id'],headers=h)
        assert r.status_code==200,r.text
        assert r.json()['status']==status
        if reason:
            decline=r.json()['decline']['reasons'][0]
            assert decline['code']==reason and '15.11.2026' in decline['text']


def test_pipeline_rejects_non_msp_and_future_person(settings):
    with client(settings) as c:
        h=register(c)
        financials=dict(revenue_12m_rub=2000000001,expenses_12m_rub=100000000,loan_payments_monthly_rub=0)
        a=start_application(c,h,financials=financials);finish(c)
        public=c.get('/api/applications/'+a['id'],headers=h).json()
        assert public['status']=='declined' and public['decline']['reasons'][0]['code']=='not_msp'
        future=company(c,h,'772519083310',future=True)
        r=c.post('/api/applications',headers=h,json=dict(company_id=future['id'],product_id='gov_guarantee',amount_rub=1000000,term_months=36))
        assert r.status_code==400


@pytest.mark.parametrize('reason,fragment',[('not_msp','2\u00a0000\u00a0000\u00a0000'),('offer_expired','15.11.2026')])
def test_manual_gov_decline_parameters(settings,reason,fragment):
    with client(settings) as c:
        h=register(c);bank=analyst(c);a=start_application(c,h);finish(c)
        path='/api/bank/applications/'+a['id'];card=c.get(path,headers=bank).json()
        r=c.post(path+'/decision',headers=bank,json=dict(kind='decline',version=card['application']['version'],comment='Проверено аналитиком.',decline_reasons=[reason]))
        assert r.status_code==200,r.text
        assert fragment in r.json()['application']['decline']['reasons'][0]['text']
