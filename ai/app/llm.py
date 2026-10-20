"""Тонкая обёртка над GigaChat: запрос с JSON-схемой, разбор ответа, понятные ошибки."""
import asyncio
import json
import logging
import re
import time

import httpx
from gigachat import GigaChat
from gigachat.exceptions import GigaChatException
from gigachat.models import Chat, JsonSchemaResponseFormat, Messages, MessagesRole
from pydantic import BaseModel

from . import config

logger = logging.getLogger(__name__)

ROLES = {"system": MessagesRole.SYSTEM, "user": MessagesRole.USER, "assistant": MessagesRole.ASSISTANT}


class LLMUnavailable(Exception):
    """GigaChat не ответил: сеть, таймаут, 5xx, лимиты, ключ."""


class LLMBadOutput(Exception):
    """GigaChat ответил, но это не JSON."""


def extract_json(text: str) -> str:
    """Убирает ```json-обёртку и текст вокруг объекта."""
    text = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    return text[start:end + 1] if start != -1 and end > start else text


class LLM:
    def __init__(self):
        self.giga = GigaChat(
            credentials=config.AUTH_KEY,
            scope=config.SCOPE,
            model=config.MODEL,
            ca_bundle_file=config.CA_BUNDLE,
            timeout=config.REQUEST_TIMEOUT_SEC,
            max_retries=2,
        )
        # TLS-handshake с серверами Сбера иногда виснет. Библиотека даёт задать только один
        # таймаут на всё, поэтому соединению отдельно ставим 5 с: подвисание быстро обрывается,
        # и библиотека успевает повторить запрос в рамках нашего бюджета. Приватные поля
        # gigachat==0.2.3 — при обновлении библиотеки проверить.
        for client in (self.giga._aclient, self.giga._auth_aclient):
            client.timeout = httpx.Timeout(config.REQUEST_TIMEOUT_SEC, connect=5)

    async def json_chat(self, messages: list, schema: type[BaseModel], max_tokens: int = 4000,
                        use_schema: bool = True) -> dict:
        """messages: [(role, content)].

        use_schema=True — сервер ограничивает ответ JSON-схемой (response_format, бета).
        На плане это даёт 6/6 валидных против 5/6, но на некоторых схемах (Decision) сервер
        отдаёт пустой ответ — там формат задаём только промптом и проверяем кодом.
        """
        chat = Chat(
            model=config.MODEL,
            messages=[Messages(role=ROLES[r], content=c) for r, c in messages],
            temperature=0.3,
            max_tokens=max_tokens,
        )
        if use_schema:
            chat.response_format = JsonSchemaResponseFormat(schema=schema, strict=True)
        t = time.monotonic()
        try:
            resp = await self.giga.achat(chat)
        except (httpx.TransportError, GigaChatException) as e:
            raise LLMUnavailable(f"{type(e).__name__}: {e}") from e

        choice = resp.choices[0]
        logger.info("GigaChat %s: %.1fs, %d tokens, finish=%s",
                    schema.__name__, time.monotonic() - t, resp.usage.total_tokens, choice.finish_reason)
        try:
            return json.loads(extract_json(choice.message.content))
        except json.JSONDecodeError as e:
            raise LLMBadOutput(f"не JSON (finish={choice.finish_reason}): {e}") from e

    async def warmup(self):
        """Заранее получить токен и открыть соединение, чтобы первый пользователь не ждал.
        Не критично: если GigaChat сейчас недоступен, сервис всё равно стартует."""
        t = time.monotonic()
        try:
            async with asyncio.timeout(15):
                await self.giga.aget_token()
                await self.giga.aget_models()
            logger.info("GigaChat warmup: %.1fs", time.monotonic() - t)
        except Exception as e:
            logger.warning("GigaChat warmup не удался (%r), продолжаем без него", e)

    async def aclose(self):
        await self.giga.aclose()
