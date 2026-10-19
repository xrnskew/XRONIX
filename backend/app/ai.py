import asyncio
import json
import logging

import httpx
from jsonschema import ValidationError

from .errors import ApiError
from .validation import check_plan, recalculate

logger = logging.getLogger(__name__)


class AI:
    def __init__(self, settings, contracts, client):
        self.settings, self.contracts, self.client = settings, contracts, client

    async def call(self, endpoint, payload, stage=0):
        if self.settings.mock_ai:
            if endpoint == 'summarize':
                # Summarize only this user's statements, never the example person's facts.
                statements = [m['content'] for m in payload['history'] if m['role'] == 'user']
                old = payload['memory']
                if old == self.contracts.example('response.summarize.json')['memory']:
                    old = ''  # Repair the exact legacy mock fixture, not arbitrary user facts.
                return {'memory': '\n'.join(dict.fromkeys([old, *statements])).strip()[-800:], 'tags': []}
            if stage == 0:
                return self.contracts.example('reply.questions.json')
            if stage == 1:
                reply = self.contracts.example('reply.plan.ai.json')
                reply['plan']['tags_update'] = list(payload['user_context']['tags'])
                return reply
            return self.contracts.example('reply.message.json')
        try:
            async with self.client.stream('POST', f'{self.settings.ai_service_url}/ai/{endpoint}', json=payload, timeout=45) as response:
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 1024 * 1024:
                        raise ApiError('AI_BAD_RESPONSE')
                def reject_constant(value):
                    raise ValueError('Non-finite JSON number')
                try:
                    result = json.loads(body, parse_constant=reject_constant)
                except (ValueError, RecursionError) as exc:
                    raise ApiError('AI_BAD_RESPONSE' if response.status_code == 200 else 'AI_UNAVAILABLE') from exc
                if response.status_code != 200:
                    bad = isinstance(result, dict) and isinstance(result.get('error'), dict) and result['error'].get('code') == 'AI_BAD_RESPONSE'
                    raise ApiError('AI_BAD_RESPONSE' if bad else 'AI_UNAVAILABLE')
                return result
        except httpx.RequestError as exc:
            raise ApiError('AI_UNAVAILABLE') from exc

    async def validated(self, endpoint, payload, stage=0):
        self.contracts.validate('ai-request' if endpoint == 'respond' else 'summarize', payload, None if endpoint == 'respond' else 'request')
        for attempt in range(3):
            try:
                result = await self.call(endpoint, payload, stage)
                self.contracts.validate('ai-reply' if endpoint == 'respond' else 'summarize', result, None if endpoint == 'respond' else 'response')
                if endpoint == 'respond' and result['type'] == 'questions':
                    rounds = 0
                    for item in reversed(payload['history']):
                        if item['role'] != 'assistant':
                            continue
                        try:
                            previous = json.loads(item['content'])
                        except ValueError:
                            break
                        if not isinstance(previous, dict) or previous.get('type') != 'questions':
                            break
                        rounds += 1
                    if len(result['questions']) < 3 or rounds >= 2:
                        raise ValueError('question rounds or count')
                if endpoint == 'respond' and result['type'] == 'plan':
                    check_plan(result['plan'])
                    result['plan'] = recalculate(result['plan'])
                    self.contracts.validate('plan', result['plan'])
                    check_plan(result['plan'])
                return result
            except ApiError as exc:
                if exc.code != 'AI_BAD_RESPONSE':
                    raise
            except (ValidationError, ValueError, OverflowError):
                pass
            logger.warning('Invalid AI %s response, attempt %d/3', endpoint, attempt + 1)
        raise ApiError('AI_BAD_RESPONSE')

    async def respond(self, payload, stage):
        try:
            # Total deadline includes retries; frontend should wait 50 seconds.
            async with asyncio.timeout(45):
                return await self.validated('respond', payload, stage)
        except TimeoutError as exc:
            raise ApiError('AI_UNAVAILABLE') from exc

    async def summarize(self, payload):
        try:
            async with asyncio.timeout(45):
                return await self.validated('summarize', payload)
        except TimeoutError as exc:
            raise ApiError('AI_UNAVAILABLE') from exc


def history(messages):
    return [{'role': m.role, 'content': m.reply['text'] if m.role == 'user' else json.dumps(m.reply, ensure_ascii=False)} for m in messages]
