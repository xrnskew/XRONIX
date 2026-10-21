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
