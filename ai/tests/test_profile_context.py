"""Manual profile tags are available; cross-chat ideas are not."""
import json
import unittest

from app.prompts import BUSINESS_SCOPE_RULES, decide_messages, plan_messages
from app.service import respond
from test_scope import MessageModel, request


class ProfileContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_manual_interests_survive_without_business_keyword(self):
        context = {'profile': {'name': 'QA', 'city': 'Казань', 'experience': 'Новичок', 'budget_rub': 300000},
                   'tags': ['хендмейд', 'IT', 'общепит'],
                   'memory': 'STALE_MEMORY: пользователь раньше обсуждал пекарню'}
        req = request('Какие теги есть у меня в профиле?', context=context)
        spy = MessageModel('В ваших тегах: хендмейд, IT, общепит.')
        result = await respond(spy, req)
        self.assertEqual(result['text'], spy.text)
        self.assertEqual(len(spy.calls), 1)
        outgoing = json.dumps(spy.calls, ensure_ascii=False)
        for tag in context['tags']:
            self.assertIn(tag, outgoing)
        self.assertNotIn('STALE_MEMORY', outgoing)
        self.assertEqual(req.user_context.memory, context['memory'])

    def test_every_prompt_builder_excludes_legacy_memory(self):
        context = {'profile': {'name': 'QA'}, 'tags': ['общепит'], 'memory': 'OLD_IDEA: кофейня у метро'}
        req = request('Хочу открыть бизнес', context=context)
        for messages in (decide_messages(req, 0), decide_messages(req, 2), plan_messages(req)):
            serialized = json.dumps(messages, ensure_ascii=False)
            self.assertNotIn('OLD_IDEA', serialized)
            self.assertNotIn('общепит', messages[-1][1])
            self.assertIn('tags_meta', messages[-1][1])
            self.assertIn('\"available\": true', messages[-1][1])
            self.assertIn('\"values_included\": false', messages[-1][1])
            self.assertIn('Текущую идею определяют только', messages[0][1])
            self.assertIn('Теги добавляет и удаляет только сам пользователь', messages[0][1])
            self.assertIn('не навязывай сферу из тегов', messages[0][1])

    async def test_profile_tags_do_not_get_replaced_by_plan_suggestions(self):
        req = request('Хочу открыть бизнес', context={'profile': {'name': 'QA'}, 'tags': ['IT'], 'memory': ''})
        spy = MessageModel('Какой бизнес вы хотите открыть?')
        await respond(spy, req)
        self.assertEqual(req.user_context.tags, ['IT'])


    async def test_new_chat_does_not_expose_tag_values_for_idea_selection(self):
        req = request('Хочу открыть бизнес, пока не выбрал сферу', context={
            'profile': {'name': 'QA'}, 'tags': ['общепит', 'кофейня'], 'memory': 'Хочу пекарню'})
        spy = MessageModel('Какой бизнес вы хотите открыть?')
        await respond(spy, req)
        outgoing = spy.calls[0][-1][1]
        self.assertNotIn('общепит', outgoing)
        self.assertNotIn('кофейня', outgoing)
        self.assertNotIn('пекарню', outgoing)
        self.assertIn('tags_meta', outgoing)
        self.assertIn('"count": 2', outgoing)
