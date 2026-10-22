"""Tax note: copied from templates into every plan; numbers never depend on it."""
import json

import pytest

from app import project_calc
from test_round2 import settings, client, register, CONTRACTS
from test_experience import setup, funds, chat, send

SPHERES = ['coffee', 'bakery', 'car_wash', 'clothing_store', 'beauty_salon', 'pickup_point']


@pytest.mark.parametrize('sphere', SPHERES)
def test_calculator_adds_tax_note_to_every_sphere(settings, sphere):
    with setup(settings) as c:
        h = register(c)
        response = c.post('/api/plans/calculate', headers=h, json=dict(sphere=sphere, city='Самара', own_funds_rub=900000, answers={}))
        assert response.status_code == 201, response.text
        plan = response.json()['plan']
        CONTRACTS.validate('plan', plan)
        note = plan['tax_note']
        assert set(note) == {'text', 'sources', 'checked_at'}
        assert '27 093' in note['text'] and '346.20' in note['text']
        assert all(source['url'].startswith('https://') for source in note['sources'])


def test_tax_note_matches_template_and_does_not_change_numbers(settings):
    with setup(settings) as c:
        h = register(c)
        plan = c.post('/api/plans/calculate', headers=h, json=dict(sphere='bakery', city='Самара', own_funds_rub=900000, answers={})).json()['plan']
        without = {k: v for k, v in plan.items() if k != 'tax_note'}
        CONTRACTS.validate('plan', without)
        note = plan['tax_note']
        cfg = json.loads((settings.contracts_dir / 'templates' / 'spheres.v1.json').read_text(encoding='utf-8'))['tax_note']
        assert note == {k: cfg[k] for k in ('text', 'sources', 'checked_at')}
        assert 'comment' not in note


def test_chat_plan_carries_tax_note(settings):
    with setup(settings) as c:
        h = register(c); cid = chat(c, h); funds(c, h, cid)
        reply = send(c, h, cid, 'Нет опыта')
        assert reply.status_code == 200, reply.text
        result = reply.json()
        assert result['type'] == 'plan', result
        CONTRACTS.validate('plan', result['plan'])
        assert result['plan']['tax_note']['checked_at']


@pytest.mark.parametrize('sphere', SPHERES)
def test_zero_staff_has_no_salaries_and_valid_plan(settings, sphere):
    with setup(settings) as c:
        h = register(c)
        body = dict(sphere=sphere, city='Самара', own_funds_rub=900000, answers={'staff': 0})
        response = c.post('/api/plans/calculate', headers=h, json=body)
        assert response.status_code == 201, response.text
        plan = response.json()['plan']
        CONTRACTS.validate('plan', plan)
        salaries = next(i for i in plan['finance']['monthly_items'] if i['title'] == 'Зарплаты')
        assert salaries['amount_rub'] == 0 and 'сам предприниматель' in salaries['assumption']
        base = c.post('/api/plans/calculate', headers=h, json=dict(body, answers={})).json()['plan']
        assert plan['finance']['monthly_expenses_rub'] < base['finance']['monthly_expenses_rub']


def test_product_reasons_do_not_name_the_bank(settings):
    text = (settings.contracts_dir.parent / 'backend' / 'app' / 'credit_rules.py').read_text(encoding='utf-8')
    assert 'Альфа' not in text
