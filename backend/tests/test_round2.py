import asyncio
import copy
import json
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
from app.conveyor_models import Application,ApplicationEvent,CheckResult,Offer
from app.db import Chat,Message,User
from app.validation import Contracts,check_plan
from test_conveyor import mock_app

CONTRACTS=Contracts(Path(__file__).resolve().parents[2]/'contracts')


@pytest.fixture
def settings(tmp_path):
    return Settings(database_url=f'sqlite:///{tmp_path}/round2.sqlite',jwt_secret='round-two-tests-'*3,seed_demo=True,consult_chat=True,api_requests_per_minute=10000,auth_requests_per_minute=1000,ai_requests_per_minute=1000)


def login(c,email):
    r=c.post('/api/auth/login',json=dict(email=email,password='demo12345'))
    assert r.status_code==200,r.text
    return dict(Authorization='Bearer '+r.json()['token'])


def unavailable(request):return httpx.Response(503)


def client(settings,handler=unavailable):
    return TestClient(create_app(settings,ai_transport=httpx.MockTransport(handler),integrations_transport=httpx.ASGITransport(app=mock_app)))


def queue(c,h):
    r=c.get('/api/bank/applications',headers=h);assert r.status_code==200,r.text
    for row in r.json():CONTRACTS.validate('bank',row,'queue_item')
    return r.json()


def manual(c,h):return next(x for x in queue(c,h) if x['inn']=='7768151886')


def view(c,h,id):
    r=c.get('/api/bank/applications/'+id,headers=h);assert r.status_code==200,r.text
    CONTRACTS.validate('bank',r.json(),'bank_application');return r.json()


def decision(c,h,a,**extra):
    b=dict(kind='approve',comment='',version=a['application']['version']);b.update(extra)
    return c.post('/api/bank/applications/'+a['application']['id']+'/decision',headers=h,json=b)


def test_seed_real_pipeline_idempotent_and_bank_cards(settings):
    with client(settings) as c:
        h=login(c,'client@xronix.demo');bank=login(c,'analyst@xronix.demo')
        rows=queue(c,bank);assert len(rows)==7
        assert rows[0]['waiting_minutes']>=rows[-1]['waiting_minutes']
        assert {x['status'] for x in rows}>={'funded','declined','counter_offer','info_requested','manual_review'}
        assert any(x['inn']=='777309114120' and x['grade']=='C' and x['status']=='manual_review' for x in rows)
        for row in rows:
            card=view(c,bank,row['id'])
            assert len(card['checks'])==4
            assert [e['to_status'] for e in card['events']][:3]==['draft','submitted','checking']
            if card['application']['status']!='info_requested':
                assert card['recommendation'] is not None
        a=view(c,bank,manual(c,bank)['id'])
        assert a['scoring']['rules_version']=='credit_rules.v1'
        assert a['recommendation']['kind']=='approve'
        assert c.get('/api/bank/applications',headers=h).status_code==404
        assert c.get('/api/bank/stats',headers=h).status_code==404
        assert c.get('/api/bank/applications/'+a['application']['id'],headers=h).status_code==404
        stats=c.get('/api/bank/stats',headers=bank).json();CONTRACTS.validate('bank',stats,'stats')
        assert sum(stats['by_status'].values())==7 and stats['auto_decision_share']==1
        assert stats['avg_minutes_to_decision']>=0
        ids={x['id'] for x in rows}
        r=decision(c,bank,a);assert r.status_code==200,r.text
    with client(settings) as c:
        bank=login(c,'analyst@xronix.demo');assert {x['id'] for x in queue(c,bank)}==ids
        assert view(c,bank,a['application']['id'])['application']['status']=='approved'
        with c.app.app.state.sessions() as s:assert len(s.scalars(select(User)).all())==2


@pytest.mark.parametrize('kind,target,extra',[
 ('approve','approved',{}),
 ('counter','counter_offer',dict(amount_rub=11000000,comment='Уменьшена сумма')),
 ('request_info','info_requested',dict(info_items=[dict(kind='financials',text='')],comment='Нужны документы')),
 ('decline','declined',dict(decline_reasons=['analyst_decision'],comment='Недостаточно подтверждённых доходов')),
])
def test_all_decisions_visible_to_client(settings,kind,target,extra):
    with client(settings) as c:
        bank=login(c,'analyst@xronix.demo');h=login(c,'client@xronix.demo')
        a=view(c,bank,manual(c,bank)['id']);r=decision(c,bank,a,kind=kind,**extra)
        assert r.status_code==200,r.text
        card=r.json();CONTRACTS.validate('bank',card,'bank_application')
        assert card['application']['status']==target
        assert card['events'][-1]['actor']=='analyst' and card['events'][-1]['actor_name']=='Ольга Смирнова'
        user_card=c.get('/api/applications/'+a['application']['id'],headers=h).json()
        assert user_card==card['application']
        assert c.get('/api/feed',headers=h).json()[0]['application_id']==a['application']['id']
        assert decision(c,bank,card).json()['error']['code']=='INVALID_TRANSITION'
        if kind=='request_info':
            # Resubmission runs the real checks again and produces a fresh manual recommendation.
            r=c.post('/api/applications/'+user_card['id']+'/submit',headers=h,json=dict(version=user_card['version']))
            assert r.status_code==200,r.text


@pytest.mark.parametrize('extra,message',[
 (dict(amount_rub=100000),'Сумма'),
 (dict(term_months=999),'Срок'),
 (dict(rate_percent=1),'Ставка'),
 (dict(kind='counter',comment='test'),'измените'),
 (dict(kind='counter',amount_rub=11000000),'Объясните'),
 (dict(kind='decline',comment='test'),'причину'),
 (dict(kind='decline',decline_reasons=['low_score']),'Комментарий'),
 (dict(kind='request_info'),'данные'),
])
def test_decision_validation_and_no_partial_mutation(settings,extra,message):
    with client(settings) as c:
        bank=login(c,'analyst@xronix.demo');a=view(c,bank,manual(c,bank)['id'])
        r=decision(c,bank,a,**extra);assert r.status_code==400,r.text
        assert message in r.json()['error']['message']
        assert view(c,bank,a['application']['id'])==a


def test_version_roles_draft_and_plan_access(settings):
    with client(settings) as c:
        h=login(c,'client@xronix.demo');bank=login(c,'analyst@xronix.demo');a=view(c,bank,manual(c,bank)['id'])
        r=decision(c,bank,a,version=1);assert r.status_code==409 and r.json()['error']['code']=='VERSION_CONFLICT'
        co=next(x for x in c.get('/api/companies',headers=h).json() if x['registry']['inn']=='7715881399')
        draft_response=c.post('/api/applications',headers=h,json=dict(company_id=co['id'],product_id='fast'))
        assert draft_response.status_code==201,draft_response.text
        d=draft_response.json()
        assert c.get('/api/bank/applications/'+d['id'],headers=bank).status_code==404
        assert d['id'] not in {x['id'] for x in queue(c,bank)}
        founder=next(x for x in queue(c,bank) if x['inn']=='772519083310')
        card=view(c,bank,founder['id']);pid=card['application']['plan_id']
        assert c.get('/api/plans/'+pid,headers=bank).status_code==200
        unlinked=c.post('/api/plans/calculate',headers=h,json=dict(sphere='coffee',city='Казань',own_funds_rub=500000,answers={})).json()
        assert c.get('/api/plans/'+unlinked['plan_id'],headers=bank).status_code==404
        assert c.get('/api/bank/applications?status=manual_review,counter_offer',headers=bank).status_code==200
        assert c.get('/api/bank/applications?status=invalid',headers=bank).status_code==400


def register(c):
    r=c.post('/api/auth/register',json=dict(email='new@example.com',password='password123',name='Илья'))
    assert r.status_code==201,r.text
    return dict(Authorization='Bearer '+r.json()['token'])


def chat(c,h):return c.post('/api/chats',headers=h).json()['chat_id']
def send(c,h,id,text,**extra):return c.post('/api/chats/'+id+'/messages',headers=h,json=dict(text=text,**extra))


def test_fallback_chat_restart_state_and_template_plan(settings):
    settings.seed_demo=False
    with client(settings) as c:
        h=register(c);id=chat(c,h)
        r=send(c,h,id,'Хочу открыть кофейню');assert r.status_code==200,r.text
        assert r.json()['questions'][0]['id']=='city'
        r=send(c,h,id,'Казань');assert r.status_code==200,r.text
        assert r.json()['questions'][0]['id']=='own_funds'
    with client(settings) as c:
        r=send(c,h,id,'500 тыс');assert r.status_code==200,r.text
        assert r.json()['type']=='plan';CONTRACTS.validate('reply',r.json());check_plan(r.json()['plan'])
        p=r.json();assert p['plan']['finance']['own_funds_rub']==500000
        assert c.get('/api/plans/'+p['plan_id'],headers=h).json()['plan']==p['plan']
        assert c.get('/api/chats/'+id,headers=h).json()['messages'][-1]['reply']==p
        with c.app.app.state.sessions() as s:assert s.get(Chat,id).consult_state['sphere']=='coffee'


def test_service_questions_history_and_ready(settings):
    settings.seed_demo=False;seen=[]
    def handler(request):
        p=json.loads(request.content);seen.append(p)
        if len(seen)==1:
            return httpx.Response(200,json=dict(type='questions',text='Выберите формат.',questions=[dict(id='format',text='Какой формат?',kind='choice',options=['Кофе с собой','Кафе с посадкой'])],state=dict(sphere='coffee',city='Казань',own_funds_rub=500000,answers={})))
        return httpx.Response(200,json=dict(type='ready',text='Готово.',state=dict(sphere='coffee',city='Казань',own_funds_rub=500000,answers=dict(format='to_go'))))
    with client(settings,handler) as c:
        h=register(c);c.patch('/api/me',headers=h,json=dict(city='Казань'));id=chat(c,h)
        r=send(c,h,id,'Хочу кофейню, своих 500 тысяч');assert r.status_code==200,r.text
        assert seen[0]['state']['city']=='Казань'
        r=send(c,h,id,'Выбрал',answers=[dict(question_id='format',answer='Кофе с собой')]);assert r.status_code==200,r.text
        assert r.json()['type']=='plan'
        assert 'Какой формат?' in seen[1]['history'][-1]['content']
        assert 'Кафе с посадкой' in seen[1]['history'][-1]['content']
        assert 'Какой формат? Кофе с собой' in seen[1]['message']


@pytest.mark.parametrize('mode',['503','invalid','bad_state','timeout'])
def test_parse_fallback_and_consult_bad_response(settings,mode):
    settings.seed_demo=False
    def handler(request):
        if mode=='timeout':raise httpx.ReadTimeout('test')
        if mode=='503':return httpx.Response(503)
        if mode=='invalid':return httpx.Response(200,text='no json')
        return httpx.Response(200,json=dict(type='ready',text='ready',state=dict(sphere='other',city=None,own_funds_rub=None,answers={})))
    with client(settings,handler) as c:
        h=register(c);id=chat(c,h)
        r=send(c,h,id,'Хочу кофейню');assert r.status_code==200,r.text
        assert r.json()['questions'][0]['id']=='city'
        r=c.post('/api/needs/parse',headers=h,json=dict(text='Нужно 1,5 млн'));assert r.status_code==200
        assert r.json()==CONTRACTS.example('need.empty.json')
        assert c.post('/api/needs/parse',headers=h,json=dict(text='')).status_code==400


def test_parse_service_and_generations(settings):
    settings.seed_demo=False
    def handler(request):
        if request.url.path.endswith('/parse-need'):return httpx.Response(200,json=CONTRACTS.example('need.response.json'))
        return httpx.Response(503)
    with client(settings,handler) as c:
        h=register(c);id=chat(c,h)
        r=c.post('/api/needs/parse',headers=h,json=dict(text='нужно оборудование'));assert r.json()==CONTRACTS.example('need.response.json')
        b=dict(text='Хочу кофейню',request_id='round-two-request-0001')
        r=c.post('/api/chats/'+id+'/generations',headers=h,json=b);assert r.status_code==202,r.text
        job=r.json()['id'];deadline=time.monotonic()+5
        while time.monotonic()<deadline:
            r=c.get('/api/generations/'+job,headers=h).json()
            if r['status'] not in ('queued','running'):break
            time.sleep(.05)
        assert r['status']=='succeeded',r
        assert r['reply']['questions'][0]['id']=='city'
        assert c.post('/api/chats/'+id+'/generations',headers=h,json=b).json()['id']==job


def test_queue_order_uses_last_transition_not_autosave(settings):
    with client(settings) as c:
        h=login(c,'client@xronix.demo');bank=login(c,'analyst@xronix.demo')
        waiting=next(x for x in queue(c,bank) if x['inn']=='7772731777')
        a=c.get('/api/applications/'+waiting['id'],headers=h).json()
        r=c.patch('/api/applications/'+a['id'],headers=h,json=dict(version=a['version'],info_response='Документ подготовлен.'))
        assert r.status_code==200,r.text
        rows=queue(c,bank)
        positions={x['id']:i for i,x in enumerate(rows)}
        vector=next(x for x in rows if x['inn']=='7768151886')
        assert positions[a['id']]<positions[vector['id']]
        assert next(x for x in rows if x['id']==a['id'])['waiting_minutes']>=119
