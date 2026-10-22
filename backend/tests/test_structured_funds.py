"""Assistant hints must not become user-provided funds in the AI request."""
import json

import httpx
import pytest

from test_round2 import settings, client, register, chat, send, CONTRACTS


@pytest.mark.parametrize('question', [
    'Для открытия бизнеса собственными средствами располагаете какой суммой? Если своих нет, напишите «нет».',
    'Какой объём личных финансов готов потратить на запуск проекта? Если своих нет, напишите «нет».',
    'Сколько своих денег готовы вложить в запуск? Если нет — напишите «нет».',
])
@pytest.mark.parametrize('answer,expected', [('900000', 900000), ('0', 0), ('нет', 0)])
def test_structured_funds_uses_user_answer_without_assistant_hint(settings, question, answer, expected):
    settings.seed_demo = False
    seen = []

    def service(request):
        payload = json.loads(request.content)
        seen.append(payload)
        CONTRACTS.validate('consult', payload, 'request')
        state = dict(sphere='bakery', city='Самара', own_funds_rub=None, answers={})
        if len(seen) == 1:
            reply = dict(type='questions', text='Уточните свои средства.', state=state,
                         questions=[dict(id='own_funds', text=question, kind='text')])
        else:
            reply = dict(type='ready', text='План готов.', state={**state, 'own_funds_rub': expected})
        return httpx.Response(200, json=reply)

    with client(settings, service) as c:
        h = register(c)
        cid = chat(c, h)
        first = send(c, h, cid, 'Хочу открыть пекарню в Самаре')
        assert first.status_code == 200
        assert first.json()['questions'][0]['text'] == question
        reply = send(c, h, cid, 'Ответы на вопросы',
                     answers=[dict(question_id='own_funds', answer=answer)])
        assert reply.status_code == 200, reply.text
        assert reply.json()['plan']['finance']['own_funds_rub'] == expected
        # The UI keeps the original wording, but the stateless service receives
        # a stable meaning plus the user's answer, without conditional examples.
        assert seen[1]['message'] == 'Ответы на вопросы\nСколько своих денег готовы вложить? ' + answer
        assert question in seen[1]['history'][-1]['content']
        history = c.get('/api/chats/' + cid, headers=h).json()['messages']
        assert history[-2]['answers'] == [dict(question_id='own_funds', answer=answer)]
