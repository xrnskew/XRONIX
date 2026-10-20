"""Логика /ai/respond и /ai/summarize.

/ai/respond в два шага:
  1. decide — короткий запрос к GigaChat: задать вопросы, ответить сообщением или делать план;
  2. generate_plan — сам план (если на шаге 1 выбран план или вопросов было уже 2 раунда).
Если шаг 1 сломался, не роняем диалог: в начале отдаём запасные вопросы, дальше идём в план.

summarize — пока мок.
"""
import asyncio
import json
import logging
import re

from pydantic import ValidationError

from . import config
from .llm import LLM, LLMBadOutput, LLMUnavailable
from .models import (Decision, MessageReply, PlanReply, Question, QuestionsReply,
                     RespondRequest, SummarizeRequest, SummarizeResponse)
from .plan import Plan, check_plan
from .prompts import decide_messages, plan_messages
from .repair import repair_plan
from .scope import (BUSINESS_REDIRECT, needs_redirect, questionnaire_context,
                    sanitize_request, scope_reason)

logger = logging.getLogger(__name__)

# Больше двух раундов вопросов подряд бэк не принимает (contracts/ai.md).
MAX_QUESTION_ROUNDS = 2


class AiError(Exception):
    MESSAGES = {
        "AI_UNAVAILABLE": "Консультант сейчас недоступен. Попробуйте ещё раз через минуту.",
        "AI_BAD_RESPONSE": "Не получилось составить ответ. Попробуйте ещё раз или переформулируйте.",
    }
    STATUS = {"AI_UNAVAILABLE": 503, "AI_BAD_RESPONSE": 502}

    def __init__(self, code: str):
        super().__init__(code)
        self.code, self.status, self.message = code, self.STATUS[code], self.MESSAGES[code]


# Запасные вопросы, если GigaChat не смог их придумать на первом сообщении.
FALLBACK_QUESTIONS = QuestionsReply(
    text="Уточню пару моментов, чтобы план был точным",
    questions=[
        {"id": "budget", "text": "Сколько своих денег готовы вложить?", "kind": "choice",
         "options": ["до 500 тыс", "500 тыс – 2 млн", "больше 2 млн"]},
        {"id": "experience", "text": "Есть опыт в этой сфере?", "kind": "choice",
         "options": ["Нет", "Работал наёмным", "Был свой бизнес"]},
        {"id": "location", "text": "В каком городе и где именно планируете открыться?", "kind": "text"},
    ],
)


BUDGET_QUESTION = Question(**FALLBACK_QUESTIONS.questions[0].model_dump())

# «Привет» в новом чате: отвечаем сразу, без модели, чтобы она не вспоминала прошлые идеи из памяти.
GREETING = re.compile(r"^\s*(привет\w*|здравствуй\w*|добр\w+\s+(утро|день|вечер)|доброго\s+\w+|хай|салют|"
                      r"hello|hi)\s*[!.)]*\s*$", re.I)
GREETING_REPLY = ("Здравствуйте! Расскажите, какой бизнес хотите открыть или развить и в каком городе. "
                  "Задам пару вопросов и соберу план с расчётом кредита.")

# Пользователь назвал свои деньги: «500 тыс», «2 млн», «300000 руб», вариант ответа «до 500 тыс».
MONEY = re.compile(r"\d[\d\s.,]*\s*(тыс|т\.\s?р|млн|миллион|руб|₽|k\b|к\b)|\d{5,}|"
                   r"без\s+(своих\s+)?(денег|вложений)|своих\s+(денег\s+)?нет|нет\s+своих", re.I)
BUDGET_TEXT = re.compile(r"бюджет|сколько\s+(своих\s+)?(денег|средств)|сво\w*\s+(денег|средств)|готов\w*\s+вложить|"
                         r"стартов\w+\s+капитал|собственн\w+\s+средств", re.I)
BUDGET_IDS = {"budget", "own_funds", "money", "investment", "investments", "capital", "funds", "start_budget"}


def money_known(req: RespondRequest) -> bool:
    """Свои деньги известны из профиля или из того, что пользователь написал в этом диалоге."""
    if req.user_context.profile.budget_rub is not None:
        return True
    said = [req.message] + [h.content for h in req.history if h.role == "user"]
    return any(MONEY.search(t) for t in said)


def is_budget_question(q: Question) -> bool:
    return (q.id in BUDGET_IDS or bool(BUDGET_TEXT.search(q.text))) and "кредит" not in q.text.lower()


# Про готовность брать кредит не спрашиваем: если своих денег не хватает, план всё равно
# считает кредит (repair), и ответ «нет» пользователь бы видел проигнорированным.
CREDIT_QUESTION = re.compile(r"кредит|за[её]м|в долг|заимств", re.I)


# Модель часто задаёт 2 вопроса вместо 3+. Добиваем этими: они полезны для любой идеи
# и не пересекаются с обязательными (идея, город, деньги, опыт).
EXTRA_QUESTIONS = [
    Question(id="clients", text="Как планируете привлекать клиентов?", kind="choice",
             options=["Проходимое место", "Соцсети и карты", "Знакомые и рекомендации"]),
    Question(id="premises", text="Есть ли уже помещение или точка?", kind="choice",
             options=["Да, есть", "Ищу", "Не нужно, работаю онлайн"]),
    Question(id="launch", text="Когда хотите запуститься?", kind="choice",
             options=["В течение месяца", "Через 2–3 месяца", "Через полгода и позже"]),
]


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


def clean_questions(drafts) -> list:
    """Подгоняет вопросы модели под контракт: id, длины, options только у choice."""
    out, seen = [], set()
    for draft in drafts[:6]:
        text = draft.text.strip()[:200]
        if not text:
            continue
        qid = re.sub(r"[^a-z0-9_]+", "_", draft.id.lower()).strip("_")[:31]
        if not re.match(r"^[a-z]", qid) or qid in seen:
            qid = f"q{len(out) + 1}"
        while qid in seen:
            qid += "_"
        seen.add(qid)
        options = list(dict.fromkeys(o.strip()[:40] for o in draft.options if o.strip()))[:5]
        if draft.kind == "choice" and len(options) >= 2:
            out.append(Question(id=qid, text=text, kind="choice", options=options))
        else:
            out.append(Question(id=qid, text=text, kind="text"))
    return out


def fit_questions(questions: list, req: RespondRequest, rounds: int) -> list:
    """Вопросы под ситуацию: не спрашиваем деньги, если их назвали; спрашиваем, если нет; от 3 до 6."""
    questions = [q for q in questions if not CREDIT_QUESTION.search(q.text) and q.id != "loan_ready"]
    if money_known(req):
        questions = [q for q in questions if not is_budget_question(q)]
    elif rounds == 0 and not any(is_budget_question(q) for q in questions):
        questions = [BUDGET_QUESTION] + [q for q in questions if q.id != BUDGET_QUESTION.id]
    p = req.user_context.profile
    if p.city:
        questions = [q for q in questions if q.id not in ("city", "location")]
    if p.experience:
        questions = [q for q in questions if q.id != "experience"]
    questions = questions[:6]
    if len(questions) < 3:
        ids = {q.id for q in questions}
        extra = [q for q in EXTRA_QUESTIONS if q.id not in ids][:3 - len(questions)]
        logger.info("decide: вопросов %d, добавили %s", len(questions), [q.id for q in extra])
        questions += extra
    return questions


def questions_reply(questions: list, req: RespondRequest, rounds: int) -> dict:
    # Текст модели над вопросами часто пересказывает сами вопросы, поэтому фраза своя.
    text = FALLBACK_QUESTIONS.text if rounds == 0 else "Ещё пара деталей, и план будет готов"
    return QuestionsReply(text=text, questions=fit_questions(questions, req, rounds)).model_dump(exclude_none=True)


async def respond(llm: LLM, req: RespondRequest) -> dict:
    if GREETING.match(req.message):
        return MessageReply(text=GREETING_REPLY).model_dump()
    followup, options = questionnaire_context(req)
    if req.chat_context.answers:
        followup = True
        options = [*options, *(item.answer for item in req.chat_context.answers)]
    reason = scope_reason(req.message, followup=followup, options=options)
    if reason:
        # Log a bounded rule identifier only; no private user text or secrets.
        logger.info("scope_guard: blocked reason=%s model_calls=0", reason)
        return MessageReply(text=BUSINESS_REDIRECT).model_dump()
    req = sanitize_request(req)

    loop = asyncio.get_running_loop()
    deadline = loop.time() + config.DEADLINE_SEC
    rounds = question_rounds(req.history)

    # Classification also runs after the last questionnaire: an off-topic turn
    # must not accidentally trigger a full plan from the previous business idea.
    reply = await decide(llm, req, rounds, deadline)
    if reply is not None:
        return reply
    return await generate_plan(llm, req, deadline)


async def decide(llm: LLM, req: RespondRequest, rounds: int, deadline: float):
    """Готовый ответ (вопросы или сообщение) или None, если пора делать план."""
    loop = asyncio.get_running_loop()
    fallback = (questions_reply(list(FALLBACK_QUESTIONS.questions), req, rounds)
                if rounds == 0 else None)
    try:
        async with asyncio.timeout(min(config.DECIDE_TIMEOUT_SEC, deadline - loop.time())):
            # Со схемой Decision response_format у GigaChat отдаёт пустой ответ — только промпт.
            raw = await llm.json_chat(decide_messages(req, rounds), Decision, max_tokens=1500, use_schema=False)
        decision = Decision.model_validate(raw)
    except (LLMUnavailable, LLMBadOutput, TimeoutError, ValidationError) as e:
        logger.warning("decide: не получилось (%r), %s", e, "запасные вопросы" if fallback else "делаем план")
        return fallback

    logger.info("decide: rounds=%d -> %s", rounds, decision.action)

    if decision.action == "message":
        text = decision.text.strip()[:2000] or "Расскажите, какой бизнес вы хотите открыть и в каком городе."
        return MessageReply(text=text).model_dump()

    if decision.action == "plan" and rounds == 0:
        # Капитан: сначала уточняющие вопросы, потом план — даже если профиль заполнен.
        logger.info("decide: план на первом ходу, сначала задаём вопросы")
        return fallback

    if decision.action == "questions" and rounds >= MAX_QUESTION_ROUNDS:
        return None

    if decision.action == "questions":
        questions = clean_questions(decision.questions)
        if not questions:
            logger.warning("decide: модель выбрала вопросы, но не дала ни одного")
            return fallback
        return questions_reply(questions, req, rounds)

    return None


async def generate_plan(llm: LLM, req: RespondRequest, deadline: float) -> dict:
    loop = asyncio.get_running_loop()
    messages = plan_messages(req)
    last_error = "AI_BAD_RESPONSE"

    for attempt in (1, 2):
        left = deadline - loop.time()
        if attempt > 1 and left < config.MIN_RETRY_SEC:
            logger.warning("plan: на повтор осталось %.1fs, не успеем", left)
            break
        try:
            async with asyncio.timeout(left):
                data = await llm.json_chat(messages, Plan, max_tokens=10000)
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
            role, instructions = messages[0]
            messages[0] = (role, instructions + "\nПредыдущая смета не прошла финансовые проверки. Сформируй план заново: "
                "суммы статей должны совпадать с итогами; прибыль не выше 30% выручки. "
                "Перепроверь реалистичность выручки и полноту конкретных статей затрат. "
                "Не добавляй фиктивные расходы ради нужной маржи и не дублируй статьи. "
                "Сохрани исходные факты пользователя.")
            last_error = "AI_BAD_RESPONSE"
            continue

        return PlanReply(text="План готов", plan=plan).model_dump(mode="json")

    raise AiError(last_error)


# TODO(этап 3): настоящая выжимка через GigaChat (contracts/ai.md, раздел «Память»).
async def summarize(req: SummarizeRequest) -> dict:
    said = " ".join(h.content for h in req.history if h.role == "user" and not needs_redirect(h.content))
    old = req.memory if not needs_redirect(req.memory) else ""
    memory = f"{old} {said}".strip()[:800]
    return SummarizeResponse(memory=memory, tags=[]).model_dump()
