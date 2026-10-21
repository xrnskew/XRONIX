"""Round 3 contract regressions through the public backend API."""
import json
import httpx
import pytest
from jsonschema import Draft7Validator
from app.validation import schema_error_ru
from test_round2 import settings, client, login, manual, view, register, chat, send, CONTRACTS


@pytest.mark.parametrize('endpoint,status', [('login', 200), ('register', 201)])
def test_cookie_auth_omits_token_and_authenticates(settings, endpoint, status):
    headers={'Origin': settings.cors_origins[0], 'X-Session-Mode': 'cookie'}
    data=dict(email='client@xronix.demo', password='demo12345') if endpoint=='login' else dict(email='cookie@example.com', password='password123', name='Илья')
    with client(settings) as c:
        response=c.post('/api/auth/'+endpoint, headers=headers, json=data)
        assert response.status_code==status, response.text
        assert set(response.json())=={'user'}
        assert response.headers['cache-control']=='no-store'
        assert 'HttpOnly' in response.headers['set-cookie']
        assert 'SameSite=strict' in response.headers['set-cookie']
        assert c.get('/api/me', headers={'Origin': settings.cors_origins[0]}).json()==response.json()['user']
        assert c.post('/api/auth/logout', headers=headers).status_code==204
        assert c.get('/api/me').status_code==401


def test_russian_errors_for_bank_and_conveyor(settings):
    with client(settings) as c:
        bank=login(c,'analyst@xronix.demo'); user=login(c,'client@xronix.demo')
        a=view(c,bank,manual(c,bank)['id'])['application']
        endpoint='/api/bank/applications/'+a['id']+'/decision'
        r=c.post(endpoint,headers=bank,json=dict(kind='approve',version=a['version']))
        assert r.status_code==400
        assert r.json()['error']==dict(code='VALIDATION_ERROR',message='Не заполнено поле comment.')
        r=c.post(endpoint,headers=bank,json=dict(kind='approve',version=a['version'],comment='',extra='SECRET'))
        assert r.status_code==400 and 'лишние поля' in r.json()['error']['message']
        assert 'SECRET' not in r.text
        r=c.post('/api/products/match',headers=user,json=dict(purpose='equipment',amount_rub=100000,term_months=24,has_collateral='yes'))
        assert r.status_code==400 and 'неверный тип' in r.json()['error']['message']
        assert view(c,bank,a['id'])['application']==a


@pytest.mark.parametrize('rule,limit,value', [
    ('minLength',3,'a'),('maxLength',2,'abc'),('type','integer','a'),
    ('enum',['a','b'],'c'),('minimum',1,0),('maximum',1,2),
    ('pattern','^a$','b'),('minItems',2,[]),('maxItems',1,[1,2]),
    ('uniqueItems',True,[1,1]),('anyOf',[{'type':'integer'},{'type':'null'}],'secret'),
])
def test_schema_errors_do_not_expose_english_or_values(rule,limit,value):
    error=next(Draft7Validator({rule:limit}).iter_errors(value))
    text=schema_error_ru(error)
    assert text.startswith('Поле запрос: ') and text.endswith('.')
    assert 'secret' not in text and 'is not' not in text


@pytest.mark.parametrize('kind',['questions','ready'])
@pytest.mark.parametrize('length',[599,600,601])
def test_consult_text_boundary_reaches_client_and_history(settings,kind,length):
    settings.seed_demo=False
    text='Ф'*length; calls=[]
    def handler(request):
        calls.append(json.loads(request.content))
        result=dict(type=kind,text=text,state=dict(sphere='bakery',city='Самара',own_funds_rub=900000,answers={}))
        if kind=='questions':result['questions']=[dict(id='format',text='Какой формат?',kind='choice',options=['Мини','Полный'])]
        return httpx.Response(200,json=result)
    with client(settings,handler) as c:
        h=register(c); cid=chat(c,h)
        response=send(c,h,cid,'Хочу пекарню в Самаре, своих 900 тысяч')
        assert response.status_code==200,response.text
        reply=response.json();CONTRACTS.validate('reply',reply)
        if length<=600:
            assert reply['text']==text
            assert reply['type']==('plan' if kind=='ready' else 'questions')
        else:assert reply['text']!=text
        assert len(calls)==1
        assert c.get('/api/chats/'+cid,headers=h).json()['messages'][-1]['reply']==reply


@pytest.mark.parametrize('text,expected',[
    ('Хочу открыть пекарню в Самаре. Площадь 50 м², своих 900 тысяч.',900000),
    ('Есть 900 тысяч, помещение 50 м2 и 3 чел.',900000),
    ('Накопил 1,5 млн. Средний чек 500 ₽.',1500000),
    ('Бюджет 500 ₽ чек, своих 900 тысяч.',900000),
    ('Своих 900 тысяч или 1 млн, пока не решил.',None),
    ('Есть помещение 50 м², 3 чел., 500 ₽ чек.',None),
])
def test_fallback_funds_context_and_ambiguity(settings,text,expected):
    from app.db import Chat
    with client(settings) as c:
        h=login(c,'client@xronix.demo');cid=chat(c,h)
        r=send(c,h,cid,text if text.startswith('Хочу') else 'Хочу пекарню. '+text)
        assert r.status_code==200,r.text
        with c.app.app.state.sessions() as s:assert s.get(Chat,cid).consult_state['own_funds_rub']==expected
        if expected is None:
            assert r.json()['type']=='questions' and r.json()['questions'][0]['id']=='own_funds'
        else:assert r.json()['plan']['finance']['own_funds_rub']==expected


@pytest.mark.parametrize('mode,status',[('json',400),('size',413),('rate',429)])
def test_cross_origin_cookie_early_errors(settings,mode,status):
    from fastapi.testclient import TestClient
    from app.main import create_app
    settings.seed_demo=False;settings.cors_origins=['https://xronix.ru']
    settings.api_requests_per_minute=2 if mode=='rate' else 1000
    with TestClient(create_app(settings),base_url='https://api.xronix.ru') as c:
        headers={'Origin':'https://xronix.ru','X-Session-Mode':'cookie'}
        r=c.post('/api/auth/register',headers=headers,json=dict(email='cors@example.com',name='QA',password='password123'))
        assert r.status_code==201,r.text
        if mode=='rate':
            assert c.get('/api/me',headers=headers).status_code==200
            r=c.get('/api/me',headers=headers)
        else:r=c.post('/api/chats',headers={**headers,'Content-Type':'application/json'},content='{' if mode=='json' else 'x'*(settings.max_body_bytes+1))
        assert r.status_code==status,r.text
        assert r.headers['access-control-allow-origin']=='https://xronix.ru'
        assert r.headers['access-control-allow-credentials']=='true'
        assert 'Origin' in r.headers['vary'] and r.headers['cache-control']=='no-store'
        assert r.json()['error']['code']==('RATE_LIMITED' if mode=='rate' else 'VALIDATION_ERROR')
        if mode=='rate':assert r.headers['retry-after']=='60'
        r=c.get('/api/me',headers={'Origin':'https://foreign.example'})
        assert r.status_code==400
        assert 'access-control-allow-credentials' not in r.headers and 'access-control-allow-origin' not in r.headers


@pytest.mark.parametrize('changes,fragment',[
    (dict(city='   '),'город'),(dict(city='а'*61),'60'),
    (dict(answers={'area_m2':100000}),'от'),(dict(answers={'area_m2':'не число'}),'число'),
    (dict(answers={'format':'неизвестный формат'}),'вариант'),(dict(answers={'unknown':1}),'неизвестный'),
])
def test_calculator_invalid_input_is_russian_400(settings,changes,fragment):
    settings.seed_demo=False
    with client(settings) as c:
        h=register(c)
        r=c.post('/api/plans/calculate',headers=h,json={**dict(sphere='coffee',city='Казань',own_funds_rub=500000,answers={}),**changes})
        assert r.status_code==400,r.text
        assert r.json()['error']['code']=='VALIDATION_ERROR' and fragment in r.json()['error']['message'].lower()
        assert c.get('/api/chats',headers=h).json()==[]


@pytest.mark.parametrize('sphere',['coffee','bakery','car_wash','clothing_store','beauty_salon','pickup_point'])
def test_calculator_fractional_area_and_city_limits(settings,sphere):
    from test_conveyor import TEMPLATES
    from app.validation import check_plan
    settings.seed_demo=False
    q=next(x for x in TEMPLATES['spheres'][sphere]['questions'] if x['id']=='area_m2')
    with client(settings) as c:
        h=register(c)
        body=dict(sphere=sphere,city='  '+'а'*60+'  ',own_funds_rub=500000,answers={'area_m2':q['min']+0.00001})
        r=c.post('/api/plans/calculate',headers=h,json=body)
        assert r.status_code==201,r.text
        plan=r.json()['plan'];CONTRACTS.validate('plan',plan);check_plan(plan)
        assert plan['business']['city']=='а'*60
        assert len(plan['title'])<=80 and all(len(t)<=30 for t in plan['tags_update'])
        assert all(type(row['amount_rub']) is int for row in plan['finance']['startup_items'])
        assert c.get('/api/plans/'+r.json()['plan_id'],headers=h).json()['plan']==plan
        body['city']='  Казань  '
        r=c.post('/api/plans/calculate',headers=h,json=body)
        assert r.status_code==201 and r.json()['plan']['business']['city']=='Казань'


@pytest.mark.parametrize('registered,expected',[('2026-05-31','03.03.2027'),(None,None)])
def test_manual_young_business_decline_has_date_or_safe_advice(settings,registered,expected):
    from sqlalchemy import select
    from app.conveyor_models import Company
    with client(settings) as c:
        h=login(c,'analyst@xronix.demo');row=manual(c,h)
        with c.app.app.state.sessions() as s:
            co=s.scalar(select(Company).where(Company.inn==row['inn']))
            co.registry={**co.registry,'registered_at':registered};s.commit()
        a=view(c,h,row['id'])['application']
        r=c.post('/api/bank/applications/'+a['id']+'/decision',headers=h,json=dict(kind='decline',version=a['version'],comment='Недостаточный стаж.',decline_reasons=['business_too_young']))
        assert r.status_code==200,r.text
        advice=r.json()['application']['decline']['reasons'][0]['advice']
        assert 'после .' not in advice and '{' not in advice
        assert expected in advice if expected else 'минимального стажа' in advice


def test_consult_credit_preference_survives_restart_and_can_be_changed(settings):
    settings.seed_demo=False
    with client(settings) as c:
        h=register(c);cid=chat(c,h)
        assert send(c,h,cid,'Хочу кофейню без кредита').json()['questions'][0]['id']=='city'
    with client(settings) as c:
        assert send(c,h,cid,'Казань').json()['questions'][0]['id']=='own_funds'
        r=send(c,h,cid,'500 тысяч');assert r.status_code==200,r.text
        p=r.json();assert p['type']=='plan' and p['plan']['credit']['needed'] is False
        assert 'отказались' in p['plan']['credit']['comment'];CONTRACTS.validate('reply',p)
        assert c.get('/api/plans/'+p['plan_id'],headers=h).json()['plan']==p['plan']
        r=send(c,h,cid,'Хочу взять кредит, своих 500 тысяч')
        assert r.status_code==200 and r.json()['plan']['credit']['needed'] is True
        assert c.get('/api/plans/'+p['plan_id'],headers=h).json()['plan']['credit']['needed'] is False


def test_consult_service_never_receives_backend_preference(settings):
    settings.seed_demo=False;seen=[]
    def handler(request):
        body=json.loads(request.content);seen.append(body);CONTRACTS.validate('consult',body,'request')
        return httpx.Response(200,json=dict(type='ready',text='План готов.',state=dict(sphere='coffee',city='Казань',own_funds_rub=500000,answers={})))
    with client(settings,handler) as c:
        h=register(c);cid=chat(c,h)
        for text,needed in [('Хочу кофейню без кредита',False),('Пересчитай',False),('Хочу взять кредит',True)]:
            r=send(c,h,cid,text);assert r.status_code==200,r.text
            assert r.json()['plan']['credit']['needed'] is needed
        assert len(seen)==3 and all('credit_refused' not in b['state'] for b in seen)
