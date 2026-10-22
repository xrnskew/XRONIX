"""Business-specific experience, with real routes and unavailable/stateless AI."""
import copy
import json

import httpx
import pytest

from app import project_calc
from app.chat_context import context_payload
from test_round2 import settings, client, register, chat, send, CONTRACTS

OPTIONS=['Нет опыта','Работал наёмным','Был свой бизнес']


def setup(settings):
    settings.seed_demo=False
    return client(settings)


def funds(c,h,cid):
    first=send(c,h,cid,'Хочу открыть пекарню, город Самара')
    assert first.json()['questions'][0]['id']=='own_funds'
    reply=send(c,h,cid,'Ответы на вопросы',answers=[dict(question_id='own_funds',answer='900000')])
    assert reply.status_code==200,reply.text
    q=reply.json()['questions'][0]
    assert q==dict(id='experience',text='Есть ли у вас опыт в этом бизнесе?',kind='choice',options=OPTIONS)


@pytest.mark.parametrize('answer,expected',list(zip(OPTIONS,['none','employee','owner']))+[
    ('нет','none'),('работал','employee'),('работал бариста','employee'),('был','owner'),('Раньше был свой бизнес, кофейня','owner'),('Не знаю','unknown'),('Есть небольшой опыт','unknown'),('Посчитайте по умолчанию','unknown')])
def test_fallback_experience_once_and_funds_unchanged(settings,answer,expected):
    with setup(settings) as c:
        h=register(c);cid=chat(c,h);funds(c,h,cid)
        kwargs={'answers':[dict(question_id='experience',answer=answer)]} if answer in OPTIONS else {}
        reply=send(c,h,cid,'Ответы на вопросы' if kwargs else answer,**kwargs)
        assert reply.status_code==200,reply.text
        result=reply.json();assert result['type']=='plan',result
        plan=result['plan'];CONTRACTS.validate('plan',plan)
        assert plan['business'].get('experience')==(None if expected=='unknown' else expected)
        assert plan['finance']['own_funds_rub']==900000
        title='Нет опыта в этой сфере'
        assert sum(r['title']==title for r in plan['risks'])==(expected=='none')
        repeated=send(c,h,cid,'Пересчитайте план')
        assert repeated.json()['type']=='plan'
        assert repeated.json()['plan']['business'].get('experience')==plan['business'].get('experience')
        second=chat(c,h);funds(c,h,second)


@pytest.mark.parametrize('experience',[None,'none','employee','owner'])
def test_calculator_experience_only_changes_metadata_and_risk(settings,experience):
    with setup(settings) as c:
        h=register(c)
        body=dict(sphere='bakery',city='Самара',own_funds_rub=900000,answers={})
        base=c.post('/api/plans/calculate',headers=h,json=body)
        assert base.status_code==201,base.text
        if experience is not None:body['experience']=experience
        response=c.post('/api/plans/calculate',headers=h,json=body)
        assert response.status_code==201,response.text
        plan=response.json()['plan'];expected=base.json()['plan']
        assert plan['business'].get('experience')==experience
        assert len(plan['risks'])<=8
        if experience=='none':
            risk=c.app.app.state.conveyor.templates['experience_risk']
            assert plan['risks'][-1]=={k:risk[k] for k in ('title','level','mitigation')}
            plan['risks'].pop()
        plan['business'].pop('experience',None)
        assert plan==expected


def test_calculator_caps_risks_without_mutating_template(settings):
    with setup(settings) as c:
        cfg=copy.deepcopy(c.app.app.state.conveyor.templates)
        cfg['spheres']['bakery']['risks']*=4
        before=copy.deepcopy(cfg)
        plan=project_calc.calculate(dict(sphere='bakery',city='Самара',own_funds_rub=900000,answers={},experience='none'),cfg,c.app.app.state.conveyor.products)
        assert len(plan['risks'])==8
        assert plan['risks'][-1]['title']==cfg['experience_risk']['title']
        assert cfg==before
        CONTRACTS.validate('plan',plan)


@pytest.mark.parametrize('experience',['wrong',0,None])
def test_calculate_rejects_invalid_experience_with_russian_400(settings,experience):
    with setup(settings) as c:
        h=register(c)
        r=c.post('/api/plans/calculate',headers=h,json=dict(sphere='bakery',city='Самара',own_funds_rub=0,answers={},experience=experience))
        assert r.status_code==400
        assert r.json()['error']['code']=='VALIDATION_ERROR'
        assert 'experience' in r.json()['error']['message']


@pytest.mark.parametrize('experience',['none','employee','owner',None])
def test_consult_passes_optional_experience_to_ai_and_plan(settings,experience):
    seen=[]
    def handler(request):
        payload=json.loads(request.content);seen.append(payload)
        CONTRACTS.validate('consult',payload,'request')
        state=dict(sphere='bakery',city='Самара',own_funds_rub=900000,answers={},experience=experience)
        if len(seen)==1:
            result=dict(type='questions',text='Уточним опыт.',questions=[dict(id='experience',text='Есть ли у вас опыт в этом бизнесе?',kind='choice',options=OPTIONS)],state=state)
        else:
            assert payload['state']['experience']==experience
            assert 'experience_asked' not in payload['state']
            result=dict(type='ready',text='План готов.',state=state)
        return httpx.Response(200,json=result)
    settings.seed_demo=False
    with client(settings,handler) as c:
        h=register(c);cid=chat(c,h)
        assert send(c,h,cid,'Пекарня в Самаре, своих 900 тысяч').status_code==200
        r=send(c,h,cid,'Посчитайте по умолчанию')
        assert r.status_code==200,r.text
        assert r.json()['plan']['business'].get('experience')==experience


def test_profile_tags_clear_and_old_profile_fields_are_not_chat_inputs(settings):
    with setup(settings) as c:
        h=register(c)
        r=c.patch('/api/me',headers=h,json=dict(tags=['старое'],experience='owner',budget_rub=99999999))
        assert r.status_code==200
        assert c.patch('/api/me',headers=h,json={'tags':[]}).json()['tags']==[]
        assert c.get('/api/me',headers=h).json()['tags']==[]
        cid=chat(c,h);detail=c.get('/api/chats/'+cid,headers=h).json()
        assert 'experience' not in detail['facts'] and 'budget_rub' not in detail['facts']
        funds(c,h,cid)
        # Existing chats can still hold historical profile snapshots: never forward them.
        from types import SimpleNamespace
        ctx=context_payload(SimpleNamespace(name='QA',tags=[]),{
            'experience':dict(value='owner',source='profile'),
            'budget_rub':dict(value=99999999,source='profile')})
        assert ctx['profile']['experience'] is None and ctx['profile']['budget_rub'] is None
