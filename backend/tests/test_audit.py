"""Regressions reproduced during the backend audit."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import sqlite3
import time

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, select, text

from app.config import Settings
from app.db import Chat, Message, Plan, User
from app.main import create_app
from app.validation import annuity, check_plan, recalculate
from test_backend import CONTRACTS, chat, error, live_client, register, send


@pytest.fixture
def settings(tmp_path):
    return Settings(database_url=f'sqlite:///{tmp_path}/audit.db', jwt_secret='audit-test-only-' * 4,
                    cors_origins=['https://xronix.ru','https://www.xronix.ru','http://localhost:5173'],
                    ai_requests_per_minute=100, ai_global_per_minute=1000)


def test_mock_memory_and_tags_are_personal(settings):
    with TestClient(create_app(settings)) as c:
        for address, city in [('one@example.com','Казань'),('two@example.com','Омск')]:
            h=register(c,address)
            c.patch('/api/me',headers=h,json={'city':city,'tags':[city]})
            cid=chat(c,h)
            send(c,h,cid,'Моя идея')
            assert send(c,h,cid,f'Город {city}').status_code==200
            with c.app.app.state.sessions() as s:
                user=s.scalar(select(User).where(User.email==address))
                assert city in user.memory
                assert 'Александр' not in user.memory
                assert 'Москва' not in user.memory
                assert user.tags==[city]
        with c.app.app.state.sessions() as s:
            users=s.scalars(select(User)).all()
            assert 'Омск' not in users[0].memory
            assert 'Казань' not in users[1].memory


def test_replayed_plan_does_not_duplicate_and_survives_restart(settings):
    with TestClient(create_app(settings)) as c:
        h=register(c); cid=chat(c,h)
        send(c,h,cid,'идея')
        first=send(c,h,cid,'Москва',answers=[{'question_id':'location','answer':'Москва'}]).json()
        replay=send(c,h,cid,'Москва',answers=[{'question_id':'location','answer':'Москва'}])
        assert replay.json()==first
        assert len(c.get('/api/plans',headers=h).json())==1
        assert len(c.get(f'/api/chats/{cid}',headers=h).json()['messages'])==4
    with TestClient(create_app(settings)) as c:
        assert send(c,h,cid,'Москва',answers=[{'question_id':'location','answer':'Москва'}]).json()==first
        assert len(c.get('/api/plans',headers=h).json())==1


def test_ai_limits_shared_across_chats_and_restart(settings):
    settings.ai_requests_per_minute=1
    with TestClient(create_app(settings)) as c:
        h=register(c); cid=chat(c,h); other_chat=chat(c,h)
        assert send(c,h,cid).status_code==200
        error(send(c,h,other_chat),'RATE_LIMITED')
        other=register(c,'other@example.com')
        assert send(c,other,chat(c,other)).status_code==200
    with TestClient(create_app(settings)) as c:
        error(send(c,h,other_chat),'RATE_LIMITED')


def test_global_ai_limit(settings):
    settings.ai_global_per_minute=1
    with TestClient(create_app(settings)) as c:
        h=register(c); other=register(c,'other@example.com')
        assert send(c,h,chat(c,h)).status_code==200
        error(send(c,other,chat(c,other)),'RATE_LIMITED')


def test_auth_limit_shared_across_workers_and_forwarded_ip_not_trusted(settings):
    settings.auth_requests_per_minute=1
    a,b=create_app(settings),create_app(settings)
    with TestClient(a) as c, TestClient(b) as d:
        register(c)
        error(d.post('/api/auth/login',json={'email':'ilya@example.com','password':'password123'},headers={'X-Forwarded-For':'1.2.3.4'}),'RATE_LIMITED')


def test_general_rate_limit_and_expiry(settings):
    settings.api_requests_per_minute=1
    with TestClient(create_app(settings)) as c:
        h=register(c)
        error(c.get('/api/me',headers=h),'RATE_LIMITED')
        with c.app.app.state.sessions() as s:
            s.execute(text('UPDATE rate_buckets SET expires_at=0')); s.commit()
        assert c.get('/api/me',headers=h).status_code==200
        assert c.get('/health').status_code==200


def test_origin_rejected_before_mutation_and_preflight_json(settings):
    with TestClient(create_app(settings)) as c:
        bad=c.post('/api/auth/register',json={'email':'bad@example.com','name':'Bad','password':'password123'},headers={'Origin':'https://evil.example'})
        error(bad,'VALIDATION_ERROR')
        assert 'access-control-allow-origin' not in bad.headers
        with c.app.app.state.sessions() as s:
            assert s.scalar(select(User)) is None
        for origin in settings.cors_origins:
            r=c.options('/api/me',headers={'Origin':origin,'Access-Control-Request-Method':'PATCH','Access-Control-Request-Headers':'authorization,content-type'})
            assert r.status_code==200
            assert r.headers['access-control-allow-origin']==origin
            error(c.get('/api/me',headers={'Origin':origin}),'UNAUTHORIZED')
        for headers in [{'Origin':'https://evil.example','Access-Control-Request-Method':'GET'},
                        {'Origin':'https://xronix.ru','Access-Control-Request-Method':'DELETE'},
                        {'Origin':'https://xronix.ru','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'X-Unknown'}]:
            error(c.options('/api/me',headers=headers),'VALIDATION_ERROR')


@pytest.mark.parametrize('raw',[b'{"text":"'+b'a'*65536+b'"}', b'{"text":NaN}', b'{"text":"\\ud800"}', b'['*1500])
def test_oversized_or_invalid_body(settings,raw):
    with TestClient(create_app(settings),raise_server_exceptions=False) as c:
        h=register(c); cid=chat(c,h)
        error(c.post(f'/api/chats/{cid}/messages',headers={**h,'Content-Type':'application/json'},content=raw),'VALIDATION_ERROR')


def test_sqlite_lock_returns_safe_error_and_recovers(settings):
    with TestClient(create_app(settings),raise_server_exceptions=False) as c:
        h=register(c)
        path=settings.database_url.removeprefix('sqlite:///')
        with sqlite3.connect(path) as locked:
            locked.execute('BEGIN IMMEDIATE')
            r=c.post('/api/chats',headers={**h,'Origin':'https://xronix.ru'})
            error(r,'RATE_LIMITED')
            assert 'database' not in r.text and 'locked' not in r.text
            assert r.headers['access-control-allow-origin']=='https://xronix.ru'
            locked.rollback()
        assert c.post('/api/chats',headers=h).status_code==201


def test_failed_plan_save_rolls_back_everything_except_user_message(settings):
    def handler(request):
        return httpx.Response(200,json=CONTRACTS.example('reply.plan.ai.json'))
    def fail(*args):
        raise RuntimeError('private SQL details')
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        event.listen(Plan,'before_insert',fail)
        try:
            error(send(c,h,cid),'INTERNAL')
        finally:
            event.remove(Plan,'before_insert',fail)
        assert c.get('/api/plans',headers=h).json()==[]
        assert len(c.get(f'/api/chats/{cid}',headers=h).json()['messages'])==1
        assert c.get('/api/chats',headers=h).json()[0]['plan_id'] is None


def test_foreign_keys_enforced(settings):
    with TestClient(create_app(settings)) as c:
        with c.app.app.state.sessions() as s:
            assert s.execute(text('PRAGMA foreign_keys')).scalar()==1
            assert s.execute(text('PRAGMA foreign_key_check')).all()==[]
            with pytest.raises(Exception):
                s.execute(text("INSERT INTO plans (id,user_id,chat_id,created_at,body) VALUES ('p','absent','absent','today','{}')"))
                s.commit()
            s.rollback()


def test_concurrent_users_and_per_user_cross_chat_limit(settings):
    from threading import Event
    entered=Event()
    async def handler(request):
        entered.set()
        await asyncio.sleep(0.2)
        return httpx.Response(200,json=CONTRACTS.example('reply.message.json'))
    with live_client(settings,handler) as c:
        h=register(c); other=register(c,'other@example.com')
        first,second,third=chat(c,h),chat(c,h),chat(c,other)
        with ThreadPoolExecutor(2) as pool:
            pending=pool.submit(send,c,h,first)
            assert entered.wait(5)
            error(send(c,h,second),'RATE_LIMITED')
            independent=pool.submit(send,c,other,third)
            assert pending.result().status_code==200
            assert independent.result().status_code==200
        assert c.get('/api/plans',headers=h).json()==[]


@pytest.mark.parametrize('body',[b'{"type":"message","text":NaN}', b'{'*1500, b'x'*(1024*1024+1)])
def test_nonfinite_deep_or_oversized_ai_response(settings,body):
    calls=[]
    def handler(request):
        calls.append(request)
        return httpx.Response(200,content=body)
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        error(send(c,h,cid),'AI_BAD_RESPONSE')
        assert len(calls)==3
        assert c.get('/api/plans',headers=h).json()==[]


def test_concurrent_signing_key_and_corrupt_key(tmp_path, monkeypatch):
    import app.config
    monkeypatch.setattr(app.config,'ROOT',tmp_path)
    settings=Settings(jwt_secret='')
    with ThreadPoolExecutor(4) as pool:
        values=list(pool.map(lambda _: settings.signing_key(),range(8)))
    assert len(set(values))==1
    (tmp_path/'data/jwt.key').write_text('short')
    with pytest.raises(ValueError): settings.signing_key()


@pytest.mark.parametrize('profit',[0,-1])
def test_nonpositive_profit(profit):
    p=CONTRACTS.example('plan.coffee.json')
    p['finance']['monthly_revenue_rub']=450000+profit
    p['finance']['monthly_profit_rub']=profit
    c=recalculate(p)['credit']
    assert c['debt_load_percent']==100 and c['verdict']=='not_recommended'


@pytest.mark.parametrize('field',['amount_rub','recommended_term_months','estimated_rate_percent','monthly_payment_rub','debt_load_percent','verdict'])
def test_no_credit_semantic_null_rules(field):
    p=CONTRACTS.example('plan.no-credit.json')
    p['credit'][field]=1
    with pytest.raises(ValueError): check_plan(p)


def test_annuity_half_ruble_rounding():
    assert annuity(1,0,2)==1


def test_production_cors_on_401_404_429_500_502(settings):
    settings.ai_requests_per_minute=1
    def handler(request):
        raise httpx.ConnectError('private AI host detail')
    settings.mock_ai=False
    app=create_app(settings,httpx.MockTransport(handler))
    @app.app.get('/api/failure')
    def fail():
        raise RuntimeError('private error detail')
    with TestClient(app,raise_server_exceptions=False) as c:
        h={**register(c),'Origin':'https://xronix.ru'}; cid=chat(c,h)
        responses=[(c.get('/api/me',headers={'Origin':'https://xronix.ru'}),'UNAUTHORIZED'),
                   (c.get('/api/missing',headers=h),'NOT_FOUND'),
                   (c.get('/api/failure',headers=h),'INTERNAL'),
                   (send(c,h,cid),'AI_UNAVAILABLE'),(send(c,h,cid),'RATE_LIMITED')]
        for response,code in responses:
            error(response,code)
            assert response.headers['access-control-allow-origin']=='https://xronix.ru'
            assert 'private' not in response.text


def test_stale_summary_cannot_overwrite_memory_or_tags(settings):
    from threading import Event
    entered,release=Event(),Event()
    async def handler(request):
        if request.url.path.endswith('summarize'):
            entered.set()
            while not release.is_set(): await asyncio.sleep(0.01)
            return httpx.Response(200,json={'memory':'Устаревшая сводка','tags':['старое']})
        return httpx.Response(200,json=CONTRACTS.example('reply.plan.ai.json'))
    with live_client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        with ThreadPoolExecutor(1) as pool:
            pending=pool.submit(send,c,h,cid)
            try:
                assert entered.wait(5)
                with c.app.app.state.sessions() as s:
                    user=s.scalar(select(User)); user.memory='Более новая память';user.tags=['новое'];s.commit()
            finally:
                release.set()
            assert pending.result().status_code==200
        with c.app.app.state.sessions() as s:
            user=s.scalar(select(User))
            assert user.memory=='Более новая память' and user.tags==['новое']


def test_global_concurrency_cap(settings):
    from threading import Event
    settings.ai_max_concurrent=1
    entered=Event()
    async def handler(request):
        entered.set();await asyncio.sleep(0.3)
        return httpx.Response(200,json=CONTRACTS.example('reply.message.json'))
    with live_client(settings,handler) as c:
        h=register(c);other=register(c,'other@example.com')
        cid,other_cid=chat(c,h),chat(c,other)
        with ThreadPoolExecutor(1) as pool:
            pending=pool.submit(send,c,h,cid)
            assert entered.wait(5)
            error(send(c,other,other_cid),'RATE_LIMITED')
            assert pending.result().status_code==200


def test_respond_total_deadline_including_retries(settings,monkeypatch):
    import app.ai
    original_timeout=asyncio.timeout
    monkeypatch.setattr(app.ai.asyncio,'timeout',lambda seconds: original_timeout(0.02))
    async def handler(request):
        await asyncio.sleep(0.5)
        return httpx.Response(200,json=CONTRACTS.example('reply.message.json'))
    with live_client(settings,handler) as c:
        h=register(c);cid=chat(c,h)
        error(send(c,h,cid),'AI_UNAVAILABLE')
        assert c.get('/api/plans',headers=h).json()==[]


def test_completed_plan_replay_even_with_crashed_worker_lease(settings):
    with TestClient(create_app(settings)) as c:
        h=register(c);cid=chat(c,h)
        send(c,h,cid,'идея')
        plan=send(c,h,cid,'ответы').json()
        with c.app.app.state.sessions() as s:
            s.get(Chat,cid).busy_until=time.time()+120;s.commit()
        assert send(c,h,cid,'ответы').json()==plan
        assert len(c.get('/api/plans',headers=h).json())==1


def test_exact_legacy_mock_memory_is_not_propagated(settings):
    with TestClient(create_app(settings)) as c:
        h=register(c);cid=chat(c,h)
        with c.app.app.state.sessions() as s:
            s.scalar(select(User)).memory=CONTRACTS.example('response.summarize.json')['memory'];s.commit()
        send(c,h,cid,'Мой проект в Казани')
        send(c,h,cid,'Казань, опыта нет')
        with c.app.app.state.sessions() as s:
            memory=s.scalar(select(User)).memory
            assert 'Казань' in memory and 'Александр' not in memory
