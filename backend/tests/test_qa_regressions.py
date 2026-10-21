import json
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.planning import apply_preferences, check_location, credit_refused, location_clarification, with_answers
from app.validation import recalculate
from test_backend import CONTRACTS, chat, error, live_client, register, send, settings


def payload(city='Южно-Сахалинск', answer='Нет'):
    return {'mode': 'chat', 'user_context': {'profile': {'name': 'QA', 'city': city, 'experience': None, 'budget_rub': 300000}, 'tags': [], 'memory': ''},
            'history': [{'role': 'assistant', 'content': json.dumps({'type': 'questions', 'questions': [{'id': 'credit', 'text': 'Готовы взять кредит?'}]})}],
            'message': 'Готовы взять кредит? ' + answer}


@pytest.mark.parametrize('costs,total,expected', [([5000, 30000, 150000, 100000, 50000], 330000, 335000), ([5000, 30000, 1500000, 5000, 50000, 5000], 1500000, 1595000)])
def test_startup_covers_launch_costs_and_recalculates_gap_and_credit(costs, total, expected):
    plan = CONTRACTS.example('plan.coffee.json')
    plan['steps'] = [{**plan['steps'][0], 'order': i + 1, 'cost_rub': cost} for i, cost in enumerate(costs)]
    plan['finance'].update(startup_cost_rub=total, own_funds_rub=300000)
    result = recalculate(plan)
    assert result['finance']['startup_cost_rub'] == expected
    assert result['finance']['funding_gap_rub'] == expected - 300000
    assert result['credit']['amount_rub'] >= expected - 300000
    assert plan['finance']['startup_cost_rub'] == total


def test_refusal_is_bound_to_credit_question_and_last_answer_wins():
    p = payload()
    assert credit_refused(p)
    plan = apply_preferences(recalculate(CONTRACTS.example('plan.coffee.json')), p)
    assert not plan['credit']['needed']
    assert plan['credit']['amount_rub'] is None
    assert 'отказались' in plan['credit']['comment']
    p['history'].append({'role': 'user', 'content': p['message']})
    p['message'] = 'Готов взять кредит'
    assert not credit_refused(p)
    assert not credit_refused(payload(answer='Да'))
    structured = payload(); structured['message'] = 'Ответы анкеты'
    structured['history'][0]['content'] = json.dumps({'type': 'questions', 'questions': [{'id': 'credit', 'text': 'Готовы взять кредит?'}]})
    assert credit_refused(with_answers(structured, [{'question_id': 'credit', 'answer': 'Нет'}]))
    assert not credit_refused(with_answers(structured, [{'question_id': 'place', 'answer': 'Нет'}]))
    p = payload(); p['history'][0]['content'] = json.dumps({'questions': [{'text': 'Есть помещение?'}]}); p['message'] = 'Есть помещение? Нет'
    assert not credit_refused(p)


def test_unconfirmed_metro_requests_are_clarified_and_model_claims_rejected():
    p = payload(); p['message'] = 'Хочу кофейню у метро'
    assert location_clarification(p)['type'] == 'message'
    m = payload('Москва'); m['message'] = p['message']
    assert location_clarification(m) is None
    with pytest.raises(ValueError, match='metro'):
        check_location(CONTRACTS.example('plan.coffee.json'), p)
    p['message'] = 'Магазин МЕТРО'
    assert location_clarification(p) is None


def test_credit_refusal_is_saved_and_reread_with_no_loan(settings):
    question = {'type': 'questions', 'text': 'Уточним', 'questions': [
        {'id': 'credit', 'text': 'Готовы взять кредит?', 'kind': 'choice', 'options': ['Да', 'Нет']},
        {'id': 'place', 'text': 'Есть помещение?', 'kind': 'choice', 'options': ['Да', 'Нет']},
        {'id': 'time', 'text': 'Когда?', 'kind': 'choice', 'options': ['Сейчас', 'Потом']}]}
    def handler(request):
        if request.url.path.endswith('summarize'): return httpx.Response(200, json=CONTRACTS.example('response.summarize.json'))
        data = json.loads(request.content)
        return httpx.Response(200, json=question if not data['history'] else CONTRACTS.example('reply.plan.ai.json'))
    with live_client(settings, handler) as c:
        h = register(c); cid = chat(c, h)
        assert send(c, h, cid, 'Пекарня').json()['type'] == 'questions'
        response = send(c, h, cid, 'Готовы взять кредит? Нет\nЕсть помещение? Нет\nКогда? Потом')
        assert response.status_code == 200, response.text
        plan = response.json()['plan']
        assert not plan['credit']['needed']
        saved = c.get('/api/plans/' + response.json()['plan_id'], headers=h).json()
        assert saved['plan'] == plan


def test_secure_cookie_auth_csrf_logout_and_revocation(settings):
    with TestClient(create_app(settings), base_url='https://api.xronix.ru') as c:
        origin = {'Origin': 'https://xronix.ru', 'X-Session-Mode': 'cookie'}
        response = c.post('/api/auth/register', headers=origin, json={'email': 'cookie@example.com', 'name': 'QA', 'password': 'password123'})
        assert response.status_code == 201, response.text
        cookie = response.headers['set-cookie']
        assert '__Host-xronix_session=' in cookie
        assert 'Secure' in cookie and 'HttpOnly' in cookie and 'SameSite=strict' in cookie and 'Path=/' in cookie
        assert 'Domain=' not in cookie
        assert response.headers['access-control-allow-credentials'] == 'true'
        assert set(response.json()) == {'user'}
        token = c.cookies.get('__Host-xronix_session')
        assert token
        assert c.get('/api/me', headers=origin).status_code == 200
        assert c.get('/api/me', headers=origin).headers['cache-control'] == 'no-store'
        error(c.patch('/api/me', json={'name': 'CSRF'}), 'UNAUTHORIZED')
        error(c.patch('/api/me', headers={'Origin': 'https://evil.example'}, json={'name': 'CSRF'}), 'VALIDATION_ERROR')
        assert c.patch('/api/me', headers=origin, json={'name': 'Allowed'}).status_code == 200
        preflight = c.options('/api/me', headers={'Origin': 'https://xronix.ru', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'x-session-mode'})
        assert preflight.status_code == 200
        assert c.post('/api/auth/logout', headers=origin).status_code == 204
        error(c.get('/api/me', headers=origin), 'UNAUTHORIZED')
        error(c.get('/api/me', headers={'Authorization': 'Bearer ' + token}), 'UNAUTHORIZED')
        assert c.post('/api/auth/logout', headers=origin).status_code == 204
        login = c.post('/api/auth/login', headers=origin, json={'email': 'cookie@example.com', 'password': 'password123'})
        assert login.status_code == 200
        assert set(login.json()) == {'user'}
        assert c.cookies.get('__Host-xronix_session') != token
        assert c.get('/api/me', headers=origin).status_code == 200


def test_legacy_plan_and_chat_views_use_the_same_repaired_budget(settings):
    from sqlalchemy import select
    from app.db import Message, Plan
    with TestClient(create_app(settings)) as c:
        h = register(c); cid = chat(c, h)
        send(c, h, cid, 'Кофейня')
        response = send(c, h, cid, 'Москва').json()
        pid = response['plan_id']
        # Simulate the inconsistent historical figures discovered in production.
        with c.app.app.state.sessions() as session:
            record = session.get(Plan, pid)
            legacy = json.loads(json.dumps(record.body))
            legacy['finance']['startup_cost_rub'] = 330000
            legacy['finance']['own_funds_rub'] = 300000
            costs = [5000, 30000, 150000, 100000, 50000]
            for step, cost in zip(legacy['steps'], costs): step['cost_rub'] = cost
            record.body = legacy
            message = session.scalar(select(Message).where(Message.chat_id == cid, Message.role == 'assistant').order_by(Message.seq.desc()))
            message.reply = {**message.reply, 'plan': legacy}
            session.commit()
        plan = c.get('/api/plans/' + pid, headers=h).json()['plan']
        messages = c.get('/api/chats/' + cid, headers=h).json()['messages']
        assert plan['finance']['startup_cost_rub'] == 335000
        assert messages[-1]['reply']['plan'] == plan
        with c.app.app.state.sessions() as session:
            assert session.get(Plan, pid).body['finance']['startup_cost_rub'] == 330000
