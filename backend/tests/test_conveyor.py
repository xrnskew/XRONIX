import asyncio
import copy
import importlib.util
import json
import sys
from datetime import date
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update
from app.config import Settings
from app.conveyor import CATALOG
from app.conveyor_models import Application, ApplicationEvent, CheckResult
from app.errors import ApiError
from app.main import create_app
from app.validation import Contracts, check_plan, recalculate
from app import credit_rules as cr, project_calc

ROOT=Path(__file__).resolve().parents[2]
CONTRACTS=Contracts(ROOT/'contracts')
def load(p):return json.loads(p.read_text(encoding='utf-8'))
RULES=load(ROOT/'contracts/rules/credit_rules.v1.json')
PRODUCTS={p['id']:p for p in load(CATALOG/'products.json')['products']+load(ROOT/'contracts/products.demo.json')['products']}
SCENARIOS=load(ROOT/'integrations-mock/data/companies.json')
DEMO=load(CATALOG/'demo_applications.json')
TEMPLATES=load(ROOT/'contracts/templates/spheres.v1.json')
TODAY=date(2026,10,20)
spec=importlib.util.spec_from_file_location('external_mock',ROOT/'integrations-mock/app/__init__.py',submodule_search_locations=[str(ROOT/'integrations-mock/app')])
module=importlib.util.module_from_spec(spec)
sys.modules['external_mock']=module
spec.loader.exec_module(module)
from external_mock.main import app as mock_app, generated


def run(inn,**extra):
    i=dict(**SCENARIOS[inn],**DEMO[inn]);i.update(extra)
    p=PRODUCTS[i['product_id']]
    stops=cr.stop_factors(i,p,RULES,TODAY)
    if stops:return dict(kind='decline',reasons=stops)
    sc=cr.score(i,p,RULES,TODAY)
    return dict(**cr.decide(i,sc,p,RULES),sc=sc)


def test_contract_payment_schedule_and_factors():
    o=CONTRACTS.example('application.approved.json')['offer']
    assert cr.payment(o['amount_rub'],o['rate_percent'],o['term_months'])==78933
    assert cr.schedule(o['amount_rub'],o['rate_percent'],o['term_months'])==o['schedule']
    assert cr.payment(120000,0,12)==10000
    assert [(x['code'],x['points']) for x in run('7715881399')['sc']['factors']]==[(x['code'],x['points']) for x in CONTRACTS.example('bank.application.json')['scoring']['factors']]


@pytest.mark.parametrize('inn,expected', [('7715881399','approve'),('777309114120','counter'),('7768151886','manual'),('7755761690','decline'),('776846978815','decline'),('7772731777','approve')])
def test_scenarios(inn,expected):
    r=run(inn);assert r['kind']==expected
    if inn=='7715881399':assert r['sc']['score']==100 and r['sc']['debt_load_percent']==29.7
    if inn=='777309114120':assert r['sc']['grade']=='B' and r['term_months']==60
    if inn=='7755761690':assert r['reasons']==[dict(code='overdue_90',params={})]
    if inn=='776846978815':assert r['reasons'][0]['params']['eligible_date']=='12.02.2027'


def test_reduced_counter_offer_and_no_affordable_amount():
    r=run('777309114120',financials=dict(revenue_12m_rub=9600000,expenses_12m_rub=6240000,loan_payments_monthly_rub=85000))
    assert r['kind']=='counter' and r['amount_rub']<2000000 and r['amount_rub']%10000==0
    i=dict(**SCENARIOS['777309114120'],**DEMO['777309114120'])
    i['financials']=dict(revenue_12m_rub=9600000,expenses_12m_rub=9000000,loan_payments_monthly_rub=85000)
    assert cr.decide(i,dict(grade='B'),PRODUCTS['fast'],RULES)['kind']=='manual'


@pytest.mark.parametrize('value,expected', [(30,15),(30.1,5),(50,5),(50.1,-10),(70,-10),(70.1,-25),(None,-25)])
def test_debt_bands(value,expected,monkeypatch):
    monkeypatch.setattr(cr,'debt_load',lambda *a,**kw:value)
    i=dict(**SCENARIOS['7715881399'],**DEMO['7715881399'])
    assert next(f['points'] for f in cr.score(i,PRODUCTS['fast'],RULES,TODAY)['factors'] if f['code']=='debt_load')==expected


@pytest.mark.parametrize('months,points', [(9,0),(11,0),(12,8),(35,8),(36,15)])
def test_age_bands(months,points,monkeypatch):
    monkeypatch.setattr(cr,'business_months',lambda *a:months)
    i=dict(**SCENARIOS['7715881399'],**DEMO['7715881399'])
    assert cr.score(i,PRODUCTS['fast'],RULES,TODAY)['factors'][0]['points']==points


@pytest.mark.parametrize('grade,expected', [('A','approve'),('B','manual'),('C','manual'),('D','decline')])
def test_decision_classes(grade,expected):
    i=dict(**SCENARIOS['7715881399'],**DEMO['7715881399'])
    assert cr.decide(i,dict(grade=grade),PRODUCTS['fast'],RULES)['kind']==expected


def test_stop_factors_and_rule_boundaries():
    i=copy.deepcopy(dict(**SCENARIOS['7715881399'],**DEMO['7715881399']))
    i['registry']['status']='bankrupt';i['fns'].update(tax_debt_rub=100001,head_disqualified=True)
    assert [r['code'] for r in cr.stop_factors(i,PRODUCTS['fast'],RULES,TODAY)]==['company_inactive','tax_debt','head_disqualified']
    i['fns']['tax_debt_rub']=100000
    assert 'tax_debt' not in [r['code'] for r in cr.stop_factors(i,PRODUCTS['fast'],RULES,TODAY)]
    assert cr.rate_for(PRODUCTS['fast'],'B',RULES)==25
    assert cr.rate_for(PRODUCTS['fast'],'C',RULES)==26.5


def test_calc_exact_example_and_all_spheres():
    req=CONTRACTS.example('plan.calc.request.json')
    assert project_calc.calculate(req,TEMPLATES,PRODUCTS)==CONTRACTS.example('plan.calc.response.json')['plan']
    for t in project_calc.templates(TEMPLATES):
        for city in ('Москва','Казань','Абаза','Несуществующий'):
            for own in (0,500000,50000000):
                p=project_calc.calculate(dict(sphere=t['sphere'],city=city,own_funds_rub=own,answers={}),TEMPLATES,PRODUCTS)
                CONTRACTS.validate('plan',p);check_plan(p);assert recalculate(p)==p
    assert project_calc.city_k('мОсКвА',TEMPLATES)==1
    for answers in ({'area_m2':1},{'format':'yacht'}):
        with pytest.raises(ValueError):project_calc.calculate(dict(sphere='coffee',city='Москва',own_funds_rub=0,answers=answers),TEMPLATES,PRODUCTS)


def test_match():
    items=cr.match_products(dict(purpose='equipment',amount_rub=1500000,term_months=24,has_collateral=False),55,PRODUCTS,RULES)
    assert items[0]['product_id']=='fast' and items[0]['monthly_payment_rub']==78933
    assert not next(i for i in items if i['product_id']=='secured')['eligible']
    for i in items:CONTRACTS.validate('conveyor',i,'match_item')


def test_mock_schema_determinism_fail_inn(monkeypatch):
    with TestClient(mock_app) as c:
        for inn in SCENARIOS:
            for path,schema in ((f'/egrul/{inn}','egrul'),(f'/fns/{inn}','fns')):
                r=c.get(path);assert r.status_code==200;CONTRACTS.validate('integrations',r.json(),schema)
            CONTRACTS.validate('integrations',c.post('/bki/report',json=dict(inn=inn,consent=True)).json(),'bki_report')
        assert generated('7707083893')==generated('7707083893')
        r=generated('7707083893')['registry'];assert int(r['ogrn'][:-1])%(13 if len(r['ogrn'])==15 else 11)%10==int(r['ogrn'][-1])
        assert c.get('/egrul/7715881398').status_code==400
        assert c.post('/bki/report',json=dict(inn='7715881399',consent=False)).status_code==400
        monkeypatch.setenv('FAIL_INN','7715881399')
        assert c.get('/egrul/7715881399').status_code==503
        assert c.post('/bki/report',json=dict(inn='7715881399',consent=True)).status_code==503


@pytest.fixture
def settings(tmp_path):
    return Settings(database_url=f'sqlite:///{tmp_path}/db.sqlite',jwt_secret='conveyor-test-'*4,api_requests_per_minute=100000,auth_requests_per_minute=1000)


def client(settings):
    app=create_app(settings,integrations_transport=httpx.ASGITransport(app=mock_app))
    app.app.state.conveyor.rules=copy.deepcopy(RULES)
    async def idle(app):await asyncio.Event().wait()
    app.app.state.conveyor.worker=idle
    return TestClient(app)


def register(c,email='client@example.com'):
    r=c.post('/api/auth/register',json=dict(email=email,name='Илья',password='password123'))
    assert r.status_code==201,r.text
    assert r.json()['user']['role']=='client'
    return dict(Authorization='Bearer '+r.json()['token'])


def company(c,h,inn='7715881399',role='owner',future=False):
    r=c.post('/api/companies',headers=h,json=dict(inn=inn,member_role=role,future=future))
    assert r.status_code in (200,201),r.text
    CONTRACTS.validate('conveyor',r.json(),'company');return r.json()


def draft(c,h,co,inn='7715881399',**extra):
    body=dict(company_id=co['id'],**copy.deepcopy(DEMO[inn]),consent_bki=True);body.update(extra)
    r=c.post('/api/applications',headers=h,json=body)
    assert r.status_code==201,r.text
    CONTRACTS.validate('conveyor',r.json(),'application');return r.json()


def step(c):
    with c.app.app.state.sessions() as s:s.execute(update(Application).values(due_at=0));s.commit()
    return c.portal.call(c.app.app.state.conveyor.step,c.app.app.state.integrations)


def submit(c,h,a):
    r=c.post(f"/api/applications/{a['id']}/submit",headers=h,json=dict(version=a['version']))
    assert r.status_code==200,r.text
    return r.json()


@pytest.mark.parametrize('inn,status',[('7715881399','approved'),('777309114120','counter_offer'),('7768151886','manual_review'),('7755761690','declined'),('776846978815','declined'),('7772731777','info_requested')])
def test_api_six_scenarios(settings,inn,status):
    with client(settings) as c:
        h=register(c);co=company(c,h,inn,'accountant' if inn=='7772731777' else 'owner')
        a=submit(c,h,draft(c,h,co,inn))
        for _ in range(3):step(c)
        a=c.get('/api/applications/'+a['id'],headers=h).json()
        CONTRACTS.validate('conveyor',a,'application');assert a['status']==status,a
        if status=='approved':
            assert a['offer']['monthly_payment_rub']==78933
            assert [x['status'] for x in a['timeline']]==['draft','submitted','checking','scoring','approved']
        if status=='info_requested':
            r=c.post('/api/companies/'+co['id']+'/authority',headers=h,files={'file':('authority.txt',b'authority')})
            assert r.status_code==200,r.text
            a=submit(c,h,a);step(c);step(c)
            assert c.get('/api/applications/'+a['id'],headers=h).json()['status']=='approved'


def test_permissions_version_completeness_upload_sign(settings):
    with client(settings) as c:
        h,other=register(c),register(c,'other@example.com');co=company(c,h)
        assert company(c,h)['id']==co['id'];assert c.get('/api/companies',headers=other).json()==[]
        a=draft(c,h,co,financials=dict(revenue_12m_rub=None,expenses_12m_rub=None,loan_payments_monthly_rub=0));path='/api/applications/'+a['id']
        assert c.get(path,headers=other).status_code==404
        assert c.post(path+'/withdraw',headers=other,json=dict(version=1)).status_code==404
        r=c.post(path+'/submit',headers=h,json=dict(version=1));assert r.status_code==422 and 'financials.revenue' in r.json()['error']['message']
        r=c.patch(path,headers=h,json=dict(version=1,financials=DEMO['7715881399']['financials']));assert r.status_code==200,r.text
        a=r.json()
        assert c.patch(path,headers=h,json=dict(version=1,amount_rub=1000000)).json()['error']['code']=='VERSION_CONFLICT'
        r=c.post(path+'/documents',headers=h,files={'file':('../../x.txt',b'test')},data={'kind':'financials'});assert r.status_code==201,r.text
        assert r.json()['filename']=='x.txt';a=submit(c,h,a)
        for _ in range(3):step(c)
        a=c.get(path,headers=h).json()
        for action,status in [('accept','signing'),('sign','funded')]:
            r=c.post(path+'/'+action,headers=h,json=dict(version=a['version']));assert r.status_code==200,r.text
            a=r.json();assert a['status']==status
        assert c.post(path+'/withdraw',headers=h,json=dict(version=a['version'])).json()['error']['code']=='INVALID_TRANSITION'
        feed=c.get('/api/feed',headers=h).json();assert len(feed)==6
        for item in feed:CONTRACTS.validate('conveyor',item,'feed_item')


def test_person_api_plan_and_low_own_funds(settings):
    with client(settings) as c:
        h=register(c);co=company(c,h,'772519083310',future=True)
        req=dict(sphere='coffee',city='Казань',own_funds_rub=500000,answers={})
        r=c.post('/api/plans/calculate',headers=h,json=req);assert r.status_code==201,r.text
        plan=r.json();assert c.get('/api/plans/'+plan['plan_id'],headers=h).json()['plan']==plan['plan']
        req=dict(purpose='new_location',amount_rub=plan['plan']['credit']['amount_rub'],term_months=36,has_collateral=True,company_id=co['id'],plan_id=plan['plan_id'])
        items=c.post('/api/products/match',headers=h,json=req).json()['items']
        assert items[0]['product_id']=='start' and items[0]['eligible']
        assert all(not x['eligible'] for x in items if x['product_id']!='start')
        base=dict(product_id='start',plan_id=plan['plan_id'],amount_rub=plan['plan']['finance']['funding_gap_rub'],term_months=36,financials=dict(revenue_12m_rub=None,expenses_12m_rub=None,loan_payments_monthly_rub=0),collateral=dict(kind='guarantor',description='Поручитель',value_rub=1000000))
        a=submit(c,h,draft(c,h,co,**base))
        for _ in range(3):step(c)
        a=c.get('/api/applications/'+a['id'],headers=h).json();assert a['status']=='approved',a
        assert 'зарегистрировать ИП' in a['offer']['explanation'][-1]
        with c.app.app.state.sessions() as s:assert s.scalar(select(CheckResult).where(CheckResult.application_id==a['id'],CheckResult.kind=='egrul')) is None
        plan=c.post('/api/plans/calculate',headers=h,json=dict(sphere='coffee',city='Казань',own_funds_rub=10000,answers={})).json()
        base.update(plan_id=plan['plan_id'],amount_rub=1000000)
        a=submit(c,h,draft(c,h,co,**base))
        for _ in range(3):step(c)
        a=c.get('/api/applications/'+a['id'],headers=h).json();assert a['decline']['reasons'][0]['code']=='own_funds_low'


def test_restart_and_integration_failure(settings,monkeypatch):
    with client(settings) as c:
        h=register(c);a=submit(c,h,draft(c,h,company(c,h)));id=a['id'];step(c)
    with client(settings) as c:
        step(c);step(c)
        assert c.get('/api/applications/'+id,headers=h).json()['status']=='approved'
        a=submit(c,h,draft(c,h,company(c,h)));monkeypatch.setenv('FAIL_INN','7715881399');step(c);step(c)
        assert c.get('/api/applications/'+a['id'],headers=h).json()['status']=='manual_review'
        with c.app.app.state.sessions() as s:assert len(s.scalars(select(CheckResult).where(CheckResult.application_id==a['id'],CheckResult.result=='error')).all())==3


def test_optimistic_lock(settings):
    with client(settings) as c:
        h=register(c);a=draft(c,h,company(c,h));sessions=c.app.app.state.sessions;cv=c.app.app.state.conveyor
        with sessions() as s1,sessions() as s2:
            first=s1.scalar(select(Application).where(Application.id==a['id']));second=s2.scalar(select(Application).where(Application.id==a['id']))
            cv.move(s1,first,'submitted','client');cv.commit(s1);cv.move(s2,second,'withdrawn','client')
            with pytest.raises(ApiError) as error:cv.commit(s2)
            assert error.value.code=='VERSION_CONFLICT'
        with sessions() as s:
            a=s.scalar(select(Application).where(Application.id==a['id']))
            with pytest.raises(ApiError):cv.move(s,a,'approved','client')
            assert len(s.scalars(select(ApplicationEvent).where(ApplicationEvent.application_id==a.id)).all())==2


@pytest.mark.parametrize('history,expected',[(dict(has_history=False),0),(dict(history_months=6),0),(dict(history_months=12),15),(dict(overdue_30_24m=1),-15)])
def test_history_bands(history,expected):
    i=copy.deepcopy(dict(**SCENARIOS['7715881399'],**DEMO['7715881399']));i['bki'].update(history)
    assert next(f['points'] for f in cr.score(i,PRODUCTS['fast'],RULES,TODAY)['factors'] if f['code']=='credit_history')==expected


@pytest.mark.parametrize('ratio,expected',[(0.25,5),(0.26,0),(0.5,0),(0.51,-5),(1,-5),(1.01,-15)])
def test_revenue_bands(ratio,expected):
    i=copy.deepcopy(dict(**SCENARIOS['7715881399'],**DEMO['7715881399']));i['amount_rub']=int(i['financials']['revenue_12m_rub']*ratio)
    assert next(f['points'] for f in cr.score(i,PRODUCTS['fast'],RULES,TODAY)['factors'] if f['code']=='amount_to_revenue')==expected


@pytest.mark.parametrize('value,expected',[(0,0),(1000000,5),(1500000,10)])
def test_collateral_bands(value,expected):
    i=copy.deepcopy(dict(**SCENARIOS['7715881399'],**DEMO['7715881399']));i['collateral']=dict(value_rub=value)
    assert next(f['points'] for f in cr.score(i,PRODUCTS['fast'],RULES,TODAY)['factors'] if f['code']=='collateral')==expected


@pytest.mark.parametrize('code,expected',[('56.10',-5),('49.41',0),('62.01',5),('99.99',0)])
def test_industry_and_fns(code,expected):
    i=copy.deepcopy(dict(**SCENARIOS['7715881399'],**DEMO['7715881399']))
    i['registry']['okved']['code']=code;i['fns'].update(mass_address=True,tax_debt_rub=100)
    factors={f['code']:f['points'] for f in cr.score(i,PRODUCTS['fast'],RULES,TODAY)['factors']}
    assert factors['industry']==expected and factors['mass_address']==-10 and factors['tax_debt']==-10


@pytest.mark.parametrize('value,grade',[(0,'D'),(44,'D'),(45,'C'),(59,'C'),(60,'B'),(74,'B'),(75,'A'),(100,'A')])
def test_grade_boundaries(value,grade):
    i=copy.deepcopy(dict(**SCENARIOS['7715881399'],**DEMO['7715881399']))
    rules=copy.deepcopy(RULES);s=cr.score(i,PRODUCTS['fast'],rules,TODAY)
    rules['scoring']['base']=value-sum(f['points'] for f in s['factors'])
    assert cr.score(i,PRODUCTS['fast'],rules,TODAY)['grade']==grade


def test_transition_roles_all_edges():
    from types import SimpleNamespace
    from app.conveyor_state import TRANSITIONS,transition
    dictionaries=load(ROOT/'contracts/dictionaries.json')
    for role in ('client','system','analyst'):
        for old in dictionaries['statuses']:
            for new in dictionaries['statuses']:
                events=[];s=SimpleNamespace(add=events.append)
                a=SimpleNamespace(id='a',user_id='u',status=old)
                if new in TRANSITIONS[role].get(old,set()):
                    transition(s,a,new,role,dictionaries,RULES)
                    assert len(events)==2 and events[0].from_status==old and a.status==new
                else:
                    with pytest.raises(ApiError) as error:transition(s,a,new,role,dictionaries,RULES)
                    assert error.value.code=='INVALID_TRANSITION' and not events


def test_two_live_workers_and_expired_lease(settings):
    import time
    def live():
        app=create_app(settings,integrations_transport=httpx.ASGITransport(app=mock_app))
        app.app.state.conveyor.rules=copy.deepcopy(RULES)
        app.app.state.conveyor.rules['checks']['stage_delay_seconds']['min']=0.02
        return TestClient(app)
    with live() as first,live() as second:
        h=register(first);a=submit(first,h,draft(first,h,company(first,h)))
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            r=second.get('/api/applications/'+a['id'],headers=h)
            assert r.status_code==200,r.text
            view=r.json()
            if view['status']=='approved':break
            time.sleep(0.05)
        assert view['status']=='approved',view
        assert [x['status'] for x in view['timeline']]==['draft','submitted','checking','scoring','approved']
        assert view['version']==5


def test_expired_job_lease_recovers(settings):
    with client(settings) as c:
        h=register(c);a=submit(c,h,draft(c,h,company(c,h)))
        with c.app.app.state.sessions() as s:
            s.execute(update(Application).where(Application.id==a['id']).values(lease_until=1));s.commit()
        for _ in range(3):step(c)
        assert c.get('/api/applications/'+a['id'],headers=h).json()['status']=='approved'


def test_upload_size_limit_and_owner_boundary(settings):
    with client(settings) as c:
        h,other=register(c),register(c,'other@example.com');co=company(c,h)
        url='/api/companies/'+co['id']+'/authority'
        assert c.post(url,headers=other,files={'file':('authority',b'x')}).status_code==404
        r=c.post(url,headers=h,files={'file':('authority',b'x'*(5*1024*1024))})
        assert r.status_code==200,r.text
        r=c.post(url,headers=h,files={'file':('authority',b'x'*(5*1024*1024+1))})
        assert r.status_code==400,r.text


def test_swagger_auth_and_plan_retention(settings):
    with client(settings) as c:
        spec=c.get('/openapi.json').json()
        assert spec['components']['securitySchemes']['HTTPBearer']['scheme']=='bearer'
        assert spec['paths']['/api/applications']['post']['security']==[{'HTTPBearer':[]}]
        h=register(c);co=company(c,h,'772519083310',future=True)
        p=c.post('/api/plans/calculate',headers=h,json=dict(sphere='coffee',city='Казань',own_funds_rub=500000,answers={})).json()
        record=c.get('/api/plans/'+p['plan_id'],headers=h).json()
        draft(c,h,co,product_id='start',plan_id=p['plan_id'],amount_rub=1000000,term_months=36)
        r=c.delete('/api/chats/'+record['chat_id'],headers=h)
        assert r.status_code==409 and r.json()['error']['code']=='INVALID_TRANSITION'
        assert c.get('/api/plans/'+p['plan_id'],headers=h).status_code==200


@pytest.mark.parametrize('share,points',[(0.2,0),(0.299,0),(0.3,8),(0.399,8),(0.4,15)])
def test_start_share_bands(share,points):
    i=copy.deepcopy(dict(**SCENARIOS['7715881399'],**DEMO['7715881399']))
    i.update(product_id='start',person=True,plan=dict(startup_cost_rub=1000000,own_funds_rub=int(1000000*share),monthly_profit_rub=100000,monthly_revenue_rub=800000))
    assert cr.score(i,PRODUCTS['start'],RULES,TODAY)['factors'][0]['points']==points


def test_missing_start_plan_is_stop_and_alpha_not_for_person(settings):
    with client(settings) as c:
        h=register(c);co=company(c,h,'772519083310',future=True)
        r=c.post('/api/applications',headers=h,json=dict(company_id=co['id'],product_id='fast'))
        assert r.status_code==400
        a=draft(c,h,co,product_id='start',term_months=36,amount_rub=1000000,collateral=dict(kind='guarantor',description='Поручитель',value_rub=1000000))
        a=submit(c,h,a)
        for _ in range(3):step(c)
        a=c.get('/api/applications/'+a['id'],headers=h).json()
        assert a['decline']['reasons'][0]['code']=='plan_required'


def test_product_and_city_snapshots_match_reference():
    assert load(CATALOG/'products.json')==load(ROOT/'frontend/src/data/alfaProducts.snapshot.json')
    assert load(CATALOG/'cities.json')==load(ROOT/'frontend/src/data/cities.json')
