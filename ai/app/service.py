"""Логика /ai/respond и /ai/summarize.

Сейчас (этап 0):
  - уточняющие вопросы — мок (MOCK_QUESTIONS);
  - план — настоящий, через GigaChat;
  - summarize — мок.
"""
import asyncio
import json
import logging

from pydantic import ValidationError

from . import config
from .llm import LLM, LLMBadOutput, LLMUnavailable
from .models import (PlanReply, QuestionsReply, RespondRequest, SummarizeRequest,
                     SummarizeResponse)
from .plan import Plan, check_plan
from .prompts import plan_messages
from .repair import repair_plan

logger = logging.getLogger(__name__)


class AiError(Exception):
    MESSAGES = {
        "AI_UNAVAILABLE": "Консультант сейчас недоступен. Попробуйте ещё раз через минуту.",
        "AI_BAD_RESPONSE": "Не получилось составить ответ. Попробуйте ещё раз или переформулируйте.",
    }
    STATUS = {"AI_UNAVAILABLE": 503, "AI_BAD_RESPONSE": 502}

    def __init__(self, code: str):
        super().__init__(code)
        self.code, self.status, self.message = code, self.STATUS[code], self.MESSAGES[code]


# TODO(этап 1): генерировать вопросы через GigaChat под конкретную идею.
MOCK_QUESTIONS = QuestionsReply(
    text="Уточню пару моментов, чтобы план был точным",
    questions=[
        {"id": "budget", "text": "Сколько своих денег готовы вложить?", "kind": "choice",
         "options": ["до 500 тыс", "500 тыс – 2 млн", "больше 2 млн"]},
        {"id": "experience", "text": "Есть опыт в этой сфере?", "kind": "choice",
         "options": ["Нет", "Работал наёмным", "Был свой бизнес"]},
        {"id": "location", "text": "В каком городе и где именно планируете открыться?", "kind": "text"},
    ],
)


def question_rounds(history) -> int:
    """Сколько раундов вопросов подряд было в конце истории. Логика как у бэка (backend/app/ai.py)."""
    rounds = 0
    for item in reversed(history):
        if item.role != "assistant":
            continue
        try:
            previous = json.loads(item.content)
        except ValueError:
            break
        if not isinstance(previous, dict) or previous.get("type") != "questions":
            break
        rounds += 1
    return rounds


async def respond(llm: LLM, req: RespondRequest) -> dict:
    if question_rounds(req.history) == 0:
        return MOCK_QUESTIONS.model_dump(exclude_none=True)
    return await generate_plan(llm, req)


async def generate_plan(llm: LLM, req: RespondRequest) -> dict:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + config.DEADLINE_SEC
    messages = plan_messages(req)
    last_error = "AI_BAD_RESPONSE"

    for attempt in (1, 2):
        left = deadline - loop.time()
        if attempt > 1 and left < config.MIN_RETRY_SEC:
            logger.warning("plan: на повтор осталось %.1fs, не успеем", left)
            break
        try:
            async with asyncio.timeout(left):
                data = await llm.json_chat(messages, Plan)
        except (LLMUnavailable, TimeoutError) as e:
            logger.warning("plan attempt %d: GigaChat недоступен: %r", attempt, e)
            last_error = "AI_UNAVAILABLE"
            continue
        except LLMBadOutput as e:
            logger.warning("plan attempt %d: %s", attempt, e)
            last_error = "AI_BAD_RESPONSE"
            continue

        data, fixed = repair_plan(data)
        if fixed:
            logger.info("plan attempt %d: починили %s", attempt, ", ".join(fixed))
        try:
            plan = Plan.model_validate(data)
        except ValidationError as e:
            logger.warning("plan attempt %d: не прошёл схему: %s", attempt, e.errors()[:5])
            last_error = "AI_BAD_RESPONSE"
            continue
        errors = check_plan(plan)
        if errors:
            logger.warning("plan attempt %d: не прошёл checkPlan: %s", attempt, errors)
            last_error = "AI_BAD_RESPONSE"
            continue

        return PlanReply(text="План готов", plan=plan).model_dump(mode="json")

    raise AiError(last_error)


# TODO(этап 3): настоящая выжимка через GigaChat (contracts/ai.md, раздел «Память»).
async def summarize(req: SummarizeRequest) -> dict:
    said = " ".join(h.content for h in req.history if h.role == "user")
    memory = f"{req.memory} {said}".strip()[:800]
    return SummarizeResponse(memory=memory, tags=[]).model_dump()
