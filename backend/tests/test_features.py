import asyncio
import copy
import json
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.account_security import digest
from app.db import Chat, Generation, Message, ResetToken, User
from app.main import create_app
from test_backend import CONTRACTS, chat, error, live_client, register, send, settings


def poll(c, h, job_id):
    deadline=time.monotonic()+8
    while time.monotonic()<deadline:
        value=c.get('/api/generations/'+job_id,headers=h).json()
        if value['status'] in ('succeeded','failed'): return value
        time.sleep(.05)
    pytest.fail('generation did not finish')


def test_context_is_per_chat_and_has_explicit_sources(settings):
    seen=[]
    def handler(req):
        data=json.loads(req.content);seen.append(data)
        if data['message'].startswith('Хочу'):
            reply=copy.deepcopy(CONTRACTS.example('reply.questions.json'))
            reply['questions']=[{'id':'location','text':'Город?', 'kind':'text'},
                                {'id':'budget','text':'Бюджет?', 'kind':'text'},
                                {'id':'premises','text':'Помещение?', 'kind':'text'}]
        else: reply=CONTRACTS.example('reply.message.json')
        return httpx.Response(200,json=reply)
    with live_client(settings,handler) as c:
        h=register(c)
        c.patch('/api/me',headers=h,json={'city':'Казань','budget_rub':100000,'tags':['общепит']})
        first=chat(c,h);send(c,h,first,'Хочу открыть автомойку')
        answers=[{'question_id':'location','answer':'Омск'}, {'question_id':'budget','answer':'250 тысяч'},
                 {'question_id':'premises','answer':'Гараж 30 м²'}]
        assert send(c,h,first,'Мои ответы',answers=answers).status_code==200
        data=seen[-1]
        assert data['user_context']['profile']['city']=='Омск'
        assert data['user_context']['profile']['budget_rub']==250000
        assert data['chat_context']['facts']['city']['source']=='answer'
        assert data['chat_context']['answers'][0]['question']=='Город?'
        detail=c.get('/api/chats/'+first,headers=h).json()
        assert detail['messages'][-2]['answers']==answers
        assert detail['facts']['idea']['value']=='автомойку'
        assert detail['facts']['idea']['source']=='user_message'
        second=chat(c,h);send(c,h,second,'Хочу открыть ателье')
        assert seen[-1]['user_context']['profile']['city']=='Казань'
        assert 'Гараж' not in json.dumps(seen[-1],ensure_ascii=False)
        c.patch('/api/me',headers=h,json={'city':'Москва'})
        send(c,h,first,'Вопрос по плану')
        assert seen[-1]['user_context']['profile']['city']=='Омск'
        assert c.get('/api/me',headers=h).json()['tags']==['общепит']


@pytest.mark.parametrize('answers', [[{'question_id':'invented','answer':'x'}],
    [{'question_id':'budget','answer':'не вариант'}],
    [{'question_id':'location','answer':'Казань'},{'question_id':'location','answer':'Омск'}]])
def test_unknown_duplicate_and_wrong_choice_answers_rejected(settings,answers):
    with TestClient(create_app(settings)) as c:
        h=register(c);cid=chat(c,h);send(c,h,cid)
        error(send(c,h,cid,'Ответ',answers=answers),'VALIDATION_ERROR')
        assert len(c.get('/api/chats/'+cid,headers=h).json()['messages'])==2


def test_generation_is_durable_idempotent_and_owned(settings):
    entered,release=Event(),Event();calls=[]
    async def handler(req):
        calls.append(req);entered.set()
        while not release.is_set():await asyncio.sleep(.01)
        return httpx.Response(200,json=CONTRACTS.example('reply.message.json'))
    with live_client(settings,handler) as c:
        h=register(c);other=register(c,'other@example.com');cid=chat(c,h)
        body={'text':'Хочу открыть автомойку','request_id':'req-'+'a'*32}
        response=c.post('/api/chats/'+cid+'/generations',headers=h,json=body)
        assert response.status_code==202,response.text
        jid=response.json()['id'];assert entered.wait(5)
        repeat=c.post('/api/chats/'+cid+'/generations',headers=h,json=body)
        assert repeat.json()['id']==jid
        detail=c.get('/api/chats/'+cid,headers=h).json()
        assert detail['generation']['status']=='running'
        assert detail['generation']['request_id']==body['request_id']
        error(c.get('/api/generations/'+jid,headers=other),'NOT_FOUND')
        error(c.post('/api/chats/'+cid+'/generations',headers=h,json={**body,'text':'Подмена'}),'VALIDATION_ERROR')
        error(c.delete('/api/chats/'+cid,headers=h),'RATE_LIMITED')
        release.set();result=poll(c,h,jid)
        assert result['status']=='succeeded'
        assert len(calls)==1
        # All reply kinds, not just plans, replay without another model call.
        assert c.post('/api/chats/'+cid+'/generations',headers=h,json=body).json()['id']==jid
        assert len(calls)==1
        assert len(c.get('/api/chats/'+cid,headers=h).json()['messages'])==2
    with TestClient(create_app(settings)) as c:
        assert c.get('/api/generations/'+jid,headers=h).json()['status']=='succeeded'


def test_queued_work_survives_restart_and_expired_running_does_not_retry(settings):
    with TestClient(create_app(settings)) as c:
        h=register(c);cid=chat(c,h)
    # No worker is running while durable records are seeded.
    wrapper=create_app(settings)
    with wrapper.app.state.sessions() as s:
        user=s.scalar(select(User))
        job=Generation(user_id=user.id,chat_id=cid,request_id='pending-'+'x'*30,payload={'text':'Бизнес','answers':[]})
        expired=Generation(user_id=user.id,chat_id=cid,request_id='expired-'+'x'*30,payload={'text':'Не повторять','answers':[]},status='running',lease_until=time.time()-10)
        s.add_all([job,expired]);s.commit();jid=job.id;expired_id=expired.id
    with TestClient(wrapper) as c:
        assert poll(c,h,jid)['status']=='succeeded'
        assert poll(c,h,expired_id)['status']=='failed'
        with c.app.app.state.sessions() as s:
            assert len(s.scalars(select(Message).where(Message.chat_id==cid)).all())==2


def test_logout_all_revokes_tokens_across_restart(settings):
    with TestClient(create_app(settings)) as c:
        h=register(c);second=c.post('/api/auth/login',json={'email':'ilya@example.com','password':'password123'}).json()['token']
        assert c.post('/api/auth/logout-all',headers=h).status_code==204
        error(c.get('/api/me',headers=h),'UNAUTHORIZED')
        error(c.get('/api/me',headers={'Authorization':'Bearer '+second}),'UNAUTHORIZED')
    with TestClient(create_app(settings)) as c:
        error(c.get('/api/me',headers=h),'UNAUTHORIZED')
        assert c.post('/api/auth/login',json={'email':'ilya@example.com','password':'password123'}).status_code==200


def test_password_change_requires_current_password_and_revokes_all(settings):
    with TestClient(create_app(settings)) as c:
        h=register(c)
        error(c.post('/api/auth/change-password',headers=h,json={'current_password':'wrong','new_password':'newpassword123'}),'INVALID_CREDENTIALS')
        assert c.post('/api/auth/change-password',headers=h,json={'current_password':'password123','new_password':'newpassword123'}).status_code==204
        error(c.get('/api/me',headers=h),'UNAUTHORIZED')
        error(c.post('/api/auth/login',json={'email':'ilya@example.com','password':'password123'}),'INVALID_CREDENTIALS')
        assert c.post('/api/auth/login',json={'email':'ilya@example.com','password':'newpassword123'}).status_code==200


def test_recovery_is_generic_hashed_expiring_and_single_use(settings,monkeypatch):
    deliveries=[]
    settings.smtp_host='smtp.example.test';settings.smtp_user='user';settings.smtp_password='private';settings.mail_from='XRONIX <noreply@example.test>'
    monkeypatch.setattr('app.account_security.send_reset',lambda settings,email,token:deliveries.append((email,token)))
    with TestClient(create_app(settings)) as c:
        h=register(c)
        known=c.post('/api/auth/forgot-password',json={'email':'ilya@example.com'})
        unknown=c.post('/api/auth/forgot-password',json={'email':'missing@example.com'})
        assert known.status_code==unknown.status_code==202 and known.json()==unknown.json()
        assert len(deliveries)==1
        token=deliveries[0][1]
        with c.app.app.state.sessions() as s:
            stored=s.scalar(select(ResetToken));assert stored.digest==digest(token) and stored.digest!=token
        body={'token':token,'new_password':'replacement123'}
        with ThreadPoolExecutor(2) as pool:
            responses=list(pool.map(lambda _:c.post('/api/auth/reset-password',json=body),range(2)))
        assert sorted(r.status_code for r in responses)==[204,400]
        error(c.get('/api/me',headers=h),'UNAUTHORIZED')
        error(c.post('/api/auth/reset-password',json=body),'RESET_TOKEN_INVALID')
        assert c.post('/api/auth/login',json={'email':'ilya@example.com','password':'replacement123'}).status_code==200
        assert c.post('/api/auth/forgot-password',json={'email':'ilya@example.com'}).status_code==202
        with c.app.app.state.sessions() as s:
            s.scalar(select(ResetToken)).expires_at=time.time()-1;s.commit()
        error(c.post('/api/auth/reset-password',json={'token':deliveries[-1][1],'new_password':'otherpass123'}),'RESET_TOKEN_INVALID')


def test_failed_answer_can_retry_without_duplicating_user_message(settings):
    calls=[]
    def handler(req):
        data=json.loads(req.content);calls.append(data)
        if len(calls)==1:return httpx.Response(200,json=CONTRACTS.example('reply.questions.json'))
        if len(calls)==2:return httpx.Response(503,json={'error':{'code':'AI_UNAVAILABLE'}})
        return httpx.Response(200,json=CONTRACTS.example('reply.message.json'))
    with live_client(settings,handler) as c:
        h=register(c);cid=chat(c,h);assert send(c,h,cid).json()['type']=='questions'
        body={'text':'Москва','answers':[{'question_id':'location','answer':'Москва'}], 'request_id':'attempt-'+'a'*24}
        job=c.post('/api/chats/'+cid+'/generations',headers=h,json=body).json()
        assert poll(c,h,job['id'])['status']=='failed'
        body['request_id']='attempt-'+'b'*24
        response=c.post('/api/chats/'+cid+'/generations',headers=h,json=body)
        assert response.status_code==202,response.text
        assert poll(c,h,response.json()['id'])['status']=='succeeded'
        messages=c.get('/api/chats/'+cid,headers=h).json()['messages']
        assert len(messages)==4
        assert len([m for m in messages if m['role']=='user' and m['reply']['text']=='Москва'])==1
        assert len(calls)==3


def test_recovery_rate_limits_do_not_reveal_account_existence(settings,monkeypatch):
    settings.smtp_host='test';settings.smtp_user='test';settings.smtp_password='test';settings.mail_from='test@example.test'
    monkeypatch.setattr('app.account_security.send_reset',lambda *args:None)
    with TestClient(create_app(settings)) as c:
        register(c)
        for email in ('ilya@example.com','missing@example.com'):
            for _ in range(3):assert c.post('/api/auth/forgot-password',json={'email':email}).status_code==202
            error(c.post('/api/auth/forgot-password',json={'email':email}),'RATE_LIMITED')
