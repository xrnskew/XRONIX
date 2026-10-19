import asyncio
import copy
import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.db import Chat, Message, User
from app.errors import MESSAGES
from app.main import create_app
from app.security import verify_password
from app.validation import Contracts, annuity, check_plan, recalculate, verdict_for

CONTRACTS = Contracts(Path(__file__).resolve().parents[2] / 'contracts')


@pytest.fixture
def settings(tmp_path):
    return Settings(database_url=f'sqlite:///{tmp_path}/db.sqlite', jwt_secret='test-secret-' * 5, ai_requests_per_minute=100, ai_global_per_minute=1000)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings), raise_server_exceptions=False) as c:
        yield c


def register(c, email='ilya@example.com'):
    r = c.post('/api/auth/register', json={'email': email, 'password': 'password123', 'name': 'Илья'})
    assert r.status_code == 201, r.text
    CONTRACTS.validate('profile', r.json()['user'])
    return {'Authorization': f'Bearer {r.json()["token"]}'}


def chat(c, headers):
    r = c.post('/api/chats', headers=headers)
    assert r.status_code == 201
    return r.json()['chat_id']


def send(c, h, cid, text='Кофейня в Москве', **kwargs):
    return c.post(f'/api/chats/{cid}/messages', headers=h, json={'text': text, **kwargs})


def error(response, code):
    assert response.status_code == MESSAGES[code][0], response.text
    assert response.json()['error']['code'] == code, response.text
    CONTRACTS.validate('error', response.json())


def test_registration_login_profile_and_hash(client):
    h = register(client, ' ILYA@example.com ')
    error(client.post('/api/auth/register', json={'email': 'ilya@example.com', 'name': 'Илья', 'password': 'password123'}), 'EMAIL_TAKEN')
    r = client.post('/api/auth/login', json={'email': 'ilya@example.com', 'password': 'password123'})
    assert r.status_code == 200
    assert r.json()['user'] == client.get('/api/me', headers=h).json()
    for email, password in [('ilya@example.com', 'incorrect'), ('unknown@example.com', 'password123')]:
        error(client.post('/api/auth/login', json={'email': email, 'password': password}), 'INVALID_CREDENTIALS')
    patch = {'name': 'Илья Backend', 'city': 'Москва', 'experience': 'Новичок', 'budget_rub': 500000, 'tags': ['общепит', 'Москва']}
    r = client.patch('/api/me', headers=h, json=patch)
    assert r.status_code == 200
    CONTRACTS.validate('profile', r.json())
    assert all(r.json()[k] == v for k, v in patch.items())
    assert client.patch('/api/me', headers=h, json={'tags': []}).json()['city'] == 'Москва'
    assert client.patch('/api/me', headers=h, json={'city': None}).json()['city'] is None
    with client.app.app.state.sessions() as s:
        user = s.scalar(select(User))
        assert user.password_hash != 'password123'
        assert verify_password('password123', user.password_hash)


@pytest.mark.parametrize('patch', [{'id':'x'}, {'email':'x@y.ru'}, {'name':None}, {'tags':None}, {'name':''}, {'name':' '}, {'tags':['x'*31]}, {'tags':['x']*13}, {'budget_rub':-1}, {'budget_rub':True}, {'budget_rub':'100'}, {'budget_rub':2**64}, {'city':'x'*61}])
def test_invalid_profile(client, patch):
    error(client.patch('/api/me', headers=register(client), json=patch), 'VALIDATION_ERROR')


@pytest.mark.parametrize('body', [{}, {'email':'bad','password':'12345678','name':'Илья'}, {'email':'x@y.ru','password':'short','name':'Илья'}, {'email':'x@y.ru','password':'12345678','name':''}, {'email':'x@y.ru','password':'12345678','name':'a'*61}])
def test_invalid_registration(client, body):
    error(client.post('/api/auth/register', json=body), 'VALIDATION_ERROR')


def test_jwt_and_protected_routes(client, settings):
    paths = [('/api/me','get'),('/api/me','patch'),('/api/chats','get'),('/api/chats','post'),('/api/chats/x','get'),('/api/chats/x/messages','post'),('/api/plans','get'),('/api/plans/x','get')]
    for path, method in paths:
        error(getattr(client, method)(path), 'UNAUTHORIZED')
    h = register(client)
    token = h['Authorization'].split()[1]
    claims = jwt.decode(token, settings.jwt_secret, algorithms=['HS256'], audience='xronix-api')
    assert claims['exp'] > claims['iat']
    for t in ['invalid', jwt.encode({**claims, 'exp': datetime.now(timezone.utc)-timedelta(seconds=1)}, settings.jwt_secret, algorithm='HS256'), jwt.encode(claims, 'another-secret'*4, algorithm='HS256'), jwt.encode({**claims, 'sub':'missing'}, settings.jwt_secret, algorithm='HS256')]:
        error(client.get('/api/me', headers={'Authorization':f'Bearer {t}'}), 'UNAUTHORIZED')


def test_full_flow_and_isolation(client):
    h, other = register(client), register(client, 'sasha@example.com')
    cid = chat(client, h)
    q = send(client, h, cid)
    assert q.status_code == 200
    assert q.json()['type'] == 'questions'
    CONTRACTS.validate('reply', q.json())
    p = send(client, h, cid, text='500 тысяч, опыта нет, Москва', answers=[{'question_id':'budget','answer':'500 тысяч'}])
    assert p.status_code == 200, p.text
    CONTRACTS.validate('reply', p.json())
    assert p.json()['type'] == 'plan'
    check_plan(p.json()['plan'])
    assert p.json()['plan']['credit']['monthly_payment_rub'] == 51878
    pid = p.json()['plan_id']
    record = client.get(f'/api/plans/{pid}', headers=h).json()
    assert record['plan'] == p.json()['plan']
    assert record['chat_id'] == cid
    assert client.get('/api/plans', headers=h).json()[0]['plan_id'] == pid
    chats = client.get('/api/chats', headers=h).json()
    assert chats[0]['plan_id'] == pid
    assert chats[0]['title'] == record['plan']['title']
    messages = client.get(f'/api/chats/{cid}', headers=h).json()['messages']
    assert [m['role'] for m in messages] == ['user','assistant','user','assistant']
    assert messages[-1]['reply'] == p.json()
    assert messages[0]['created_at'].endswith('Z')
    with client.app.app.state.sessions() as s:
        assert s.scalar(select(User).where(User.email=='ilya@example.com')).memory
        stored = s.scalars(select(Message).where(Message.chat_id==cid).order_by(Message.seq)).all()
        assert stored[2].answers == [{'question_id':'budget','answer':'500 тысяч'}]
    for path in [f'/api/chats/{cid}', f'/api/plans/{pid}']:
        error(client.get(path, headers=other), 'NOT_FOUND')
    error(send(client, other, cid), 'NOT_FOUND')
    assert client.get('/api/plans', headers=other).json() == []
    assert client.get('/api/chats', headers=other).json() == []
    error(client.get('/api/chats/missing', headers=h), 'NOT_FOUND')
    error(client.get('/api/plans/missing', headers=h), 'NOT_FOUND')


def test_restart_persists_everything_and_chat_stages(settings):
    with TestClient(create_app(settings)) as c:
        h = register(c)
        cid, second = chat(c,h), chat(c,h)
        assert send(c,h,cid).json()['type'] == 'questions'
        assert send(c,h,second).json()['type'] == 'questions'
        p = send(c,h,cid).json()
        pid = p['plan_id']
    with TestClient(create_app(settings)) as c:
        assert c.get('/api/me',headers=h).status_code == 200
        assert c.get(f'/api/plans/{pid}',headers=h).json()['plan'] == p['plan']
        assert len(c.get(f'/api/chats/{cid}',headers=h).json()['messages']) == 4
        assert send(c,h,second).json()['type'] == 'plan'
        assert send(c,h,cid,'Спасибо').json()['type'] == 'message'
        assert len(c.get('/api/plans',headers=h).json()) == 2


@pytest.mark.parametrize('body', [{}, {'text':''}, {'text':'x'*4001}, {'text':42}, {'text':'ok','answers':None}, {'text':'ok','answers':[{'question_id':'q'}]}])
def test_invalid_messages(client, body):
    h=register(client); cid=chat(client,h)
    error(client.post(f'/api/chats/{cid}/messages',headers=h,json=body), 'VALIDATION_ERROR')
    assert client.get(f'/api/chats/{cid}',headers=h).json()['messages'] == []


@pytest.mark.parametrize('load,expected', [(0,'ok'),(35,'ok'),(36,'risky'),(50,'risky'),(51,'not_recommended'),(100,'not_recommended')])
def test_verdict(load, expected):
    assert verdict_for(load)==expected


def test_finance():
    assert annuity(1000000,22,24)==51878
    assert annuity(120000,0,12)==10000
    assert annuity(120000,1e-12,12)==10000
    for name in ['plan.coffee.json','plan.no-credit.json']:
        plan=CONTRACTS.example(name)
        check_plan(plan)
        calculated=recalculate(plan)
        CONTRACTS.validate('plan',calculated)
        check_plan(calculated)
    plan=CONTRACTS.example('plan.coffee.json')
    plan['finance']['monthly_expenses_rub']=700000
    plan['finance']['own_funds_rub']=2000000
    calculated=recalculate(plan)
    assert calculated['finance']['monthly_profit_rub']==-100000
    assert calculated['finance']['funding_gap_rub']==0
    assert calculated['credit']['debt_load_percent']==100
    assert calculated['credit']['verdict']=='not_recommended'


def live_client(settings, handler):
    settings.mock_ai=False
    return TestClient(create_app(settings, httpx.MockTransport(handler)), raise_server_exceptions=False)


@pytest.mark.parametrize('mode', ['json','schema','step','forecast','gap','profit','null','small_amount','upstream_bad'])
def test_bad_ai_retries_and_never_saves_plan(settings, mode):
    calls=[]
    def handler(request):
        calls.append(request)
        if mode=='json': return httpx.Response(200,text='{bad')
        if mode=='schema': return httpx.Response(200,json={'type':'plan'})
        if mode=='upstream_bad': return httpx.Response(502,json={'error':{'code':'AI_BAD_RESPONSE'}})
        reply=CONTRACTS.example('reply.plan.ai.json')
        p=reply['plan']
        if mode=='step': p['steps'][0]['order']=2
        if mode=='forecast': p['finance']['revenue_forecast'][1]['month']=1
        if mode=='gap': p['finance']['funding_gap_rub']=1
        if mode=='profit': p['finance']['monthly_profit_rub']=1
        if mode=='null': p['credit']['amount_rub']=None
        if mode=='small_amount': p['credit']['amount_rub']=1
        return httpx.Response(200,json=reply)
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        error(send(c,h,cid),'AI_BAD_RESPONSE')
        assert len(calls)==3
        assert c.get('/api/plans',headers=h).json()==[]
        assert len(c.get(f'/api/chats/{cid}',headers=h).json()['messages'])==1
        error(send(c,h,cid),'AI_BAD_RESPONSE')  # Lease released even on failure.
        assert len(calls)==6


@pytest.mark.parametrize('mode', ['timeout','connection','503','500'])
def test_unavailable_ai(settings, mode):
    calls=[]
    def handler(request):
        calls.append(request)
        if mode=='timeout': raise httpx.ReadTimeout('timeout')
        if mode=='connection': raise httpx.ConnectError('connection')
        return httpx.Response(int(mode),text='unavailable')
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        error(send(c,h,cid),'AI_UNAVAILABLE')
        assert len(calls)==1
        assert c.get('/api/plans',headers=h).json()==[]


def test_retry_recovers_and_server_recalculates(settings):
    calls=[]
    def handler(request):
        calls.append(request)
        if len(calls)<3: return httpx.Response(200,json={'bad':True})
        if request.url.path.endswith('summarize'):
            return httpx.Response(200,json=CONTRACTS.example('response.summarize.json'))
        r=CONTRACTS.example('reply.plan.ai.json')
        r['plan']['credit'].update(monthly_payment_rub=1,debt_load_percent=1,verdict='not_recommended',recommended_product_id='mortgage')
        return httpx.Response(200,json=r)
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        r=send(c,h,cid)
        assert r.status_code==200,r.text
        credit=r.json()['plan']['credit']
        assert credit['monthly_payment_rub']==51878
        assert credit['debt_load_percent']==35
        assert credit['verdict']=='ok'
        assert credit['recommended_product_id'] is None
        assert len(calls)==4


def test_context_history_answers_and_summary(settings):
    requests=[]
    def handler(request):
        data=json.loads(request.content); requests.append((request.url.path,data))
        if request.url.path.endswith('summarize'):
            CONTRACTS.validate('summarize',data,'request')
            return httpx.Response(200,json={'memory':'Факт из диалога','tags':['новый','пользователь']})
        CONTRACTS.validate('ai-request',data)
        if data['message']=='план':
            return httpx.Response(200,json=CONTRACTS.example('reply.plan.ai.json'))
        return httpx.Response(200,json=CONTRACTS.example('reply.message.json'))
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        c.patch('/api/me',headers=h,json={'city':'Казань','budget_rub':123,'tags':['пользователь']})
        for i in range(7):
            assert send(c,h,cid,str(i),answers=[{'question_id':'budget','answer':'NEVER_PASS_THIS'}]).status_code==200
        last=requests[-1][1]
        assert len(last['history'])==10
        assert last['history'][0]['content']=='1'
        assert last['message']=='6'
        assert 'answers' not in last
        assert 'NEVER_PASS_THIS' not in json.dumps(last)
        assert last['user_context']['profile']['city']=='Казань'
        assert last['user_context']['tags']==['пользователь']
        assert send(c,h,cid,'план').json()['type']=='plan'
        assert send(c,h,cid,'дальше').status_code==200
        assert requests[-1][1]['user_context']['memory']=='Факт из диалога'
        tags=requests[-1][1]['user_context']['tags']
        assert len(tags)==len(set(tags)) and len(tags)<=12
        assert 'пользователь' in tags and 'новый' in tags


def test_no_credit_and_failed_summary_preserves_plan(settings):
    def handler(request):
        if request.url.path.endswith('summarize'):
            return httpx.Response(200,json={'memory':'x'*801,'tags':[]})
        return httpx.Response(200,json={'type':'plan','text':'План готов','plan':CONTRACTS.example('plan.no-credit.json')})
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        reply=send(c,h,cid).json()
        credit=reply['plan']['credit']
        assert credit['needed'] is False
        assert all(credit[k] is None for k in ['amount_rub','monthly_payment_rub','debt_load_percent','verdict'])
        assert c.get(f'/api/plans/{reply["plan_id"]}',headers=h).status_code==200


def test_rate_limited_and_internal_error(settings):
    app=create_app(settings)
    @app.app.get('/fail')
    def fail():
        raise RuntimeError('secret database connection information')
    with TestClient(app,raise_server_exceptions=False) as c:
        h=register(c); cid=chat(c,h)
        with app.app.state.sessions() as s:
            s.get(Chat,cid).busy_until=time.time()+60; s.commit()
        r=send(c,h,cid)
        error(r,'RATE_LIMITED')
        assert r.headers['retry-after']=='2'
        r=c.get('/fail',headers={'Origin':'http://localhost:5173'})
        error(r,'INTERNAL')
        assert 'secret' not in r.text
        assert r.headers['access-control-allow-origin']=='http://localhost:5173'
        error(c.get('/nonexistent'),'NOT_FOUND')
        error(c.post('/api/auth/register',content='{broken',headers={'Content-Type':'application/json'}),'VALIDATION_ERROR')


def test_health_cors_and_long_user_message(client):
    assert client.get('/health').json()=={'status':'ok'}
    r=client.options('/api/me',headers={'Origin':'http://localhost:5173','Access-Control-Request-Method':'PATCH','Access-Control-Request-Headers':'Authorization,Content-Type'})
    assert r.status_code==200
    assert r.headers['access-control-allow-origin']=='http://localhost:5173'
    assert 'access-control-allow-origin' not in client.get('/health',headers={'Origin':'https://foreign.example'}).headers
    h=register(client); cid=chat(client,h)
    assert send(client,h,cid,'x'*4000).status_code==200
    assert client.get(f'/api/chats/{cid}',headers=h).json()['messages'][0]['reply']['text']=='x'*4000


def test_local_signing_key_survives_restart(tmp_path, monkeypatch):
    import app.config
    monkeypatch.setattr(app.config,'ROOT',tmp_path)
    s=Settings(jwt_secret='')
    first=s.signing_key()
    assert len(first)>=32
    assert Settings(jwt_secret='').signing_key()==first
    if os.name != 'nt':
        assert (tmp_path/'data/jwt.key').stat().st_mode & 0o777 == 0o600


def test_question_round_limit(settings):
    def handler(request):
        return httpx.Response(200,json=CONTRACTS.example('reply.questions.json'))
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        assert send(c,h,cid).json()['type']=='questions'
        assert send(c,h,cid).json()['type']=='questions'
        error(send(c,h,cid),'AI_BAD_RESPONSE')


def test_simultaneous_messages_are_serialized(settings):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    entered=Event()
    async def handler(request):
        entered.set()
        await asyncio.sleep(0.3)
        return httpx.Response(200,json=CONTRACTS.example('reply.message.json'))
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        with ThreadPoolExecutor(max_workers=1) as pool:
            first=pool.submit(send,c,h,cid)
            assert entered.wait(5)
            error(send(c,h,cid),'RATE_LIMITED')
            assert first.result().status_code==200
        assert len(c.get(f'/api/chats/{cid}',headers=h).json()['messages'])==2
