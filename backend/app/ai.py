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
                return self.contracts.example('response.summarize.json')
            if stage == 0:
                return self.contracts.example('reply.questions.json')
            if stage == 1:
                return self.contracts.example('reply.plan.ai.json')
            return self.contracts.example('reply.message.json')
        try:
            response = await self.client.post(f'{self.settings.ai_service_url}/ai/{endpoint}', json=payload, timeout=30)
        except httpx.RequestError as exc:
            raise ApiError('AI_UNAVAILABLE') from exc
        if response.is_error:
            try:
                bad = response.json().get('error', {}).get('code') == 'AI_BAD_RESPONSE'
            except (ValueError, AttributeError):
                bad = False
            raise ApiError('AI_BAD_RESPONSE' if bad else 'AI_UNAVAILABLE')
        try:
            return response.json()
        except ValueError as exc:
            raise ApiError('AI_BAD_RESPONSE') from exc

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
            # Total deadline includes retries; compatible with frontend's 35s timeout.
            async with asyncio.timeout(30):
                return await self.validated('respond', payload, stage)
        except TimeoutError as exc:
            raise ApiError('AI_UNAVAILABLE') from exc

    async def summarize(self, payload):
        try:
            async with asyncio.timeout(30):
                return await self.validated('summarize', payload)
        except TimeoutError as exc:
            raise ApiError('AI_UNAVAILABLE') from exc


def history(messages):
    return [{'role': m.role, 'content': m.reply['text'] if m.role == 'user' else json.dumps(m.reply, ensure_ascii=False)} for m in messages]
