"""/ai/consult без модели: правила contracts/ai.md поверх разбора текста (extract.py).

Порядок: атака или смена роли -> вопрос «одобрят ли» -> приветствие -> факты из сообщения -> не по теме ->
обновление state (поправки) -> ответ: ближайшая сфера / недостающее основное / один раунд анкеты / ready.
Сумм не называет и кредит не обещает. Условия «Старта» берутся из снимка правил (data/rules.json).
"""
import copy
import re

from . import extract as ex
from .text import norm

SPHERE_ACC = {"coffee": "кофейню", "bakery": "пекарню", "car_wash": "автомойку", "clothing_store": "магазин одежды",
              "beauty_salon": "салон красоты", "pickup_point": "пункт выдачи заказов"}
SPHERE_LIST_TEXT = "кофейня, пекарня, автомойка, магазин одежды, салон красоты, пункт выдачи заказов"

CORE_QUESTIONS = {
    "sphere": {"id": "sphere", "text": f"Какой бизнес хотите открыть? Сейчас считаю: {SPHERE_LIST_TEXT}.", "kind": "text"},
    "city": {"id": "city", "text": "В каком городе открываетесь?", "kind": "text"},
    "own_funds": {"id": "own_funds", "text": "Сколько своих денег готовы вложить в запуск? Если своих нет, напишите «нет».", "kind": "text"},
}
TEMPLATE_QUESTION_TEXT = {
    "format": "Какой формат?", "area_m2": "Какая площадь помещения, м²?", "avg_check_rub": "Какой средний чек, ₽?",
    "staff": "Сколько будет сотрудников?", "posts": "Сколько моечных постов?", "cars_per_day": "Сколько машин в день ожидаете?",
    "work_places": "Сколько рабочих мест?", "orders_per_day": "Сколько заказов в день ожидаете?",
    "fee_per_order_rub": "Какой доход с одного заказа, ₽?",
}
CUSTOMERS_TEXT = {"coffee": "Сколько гостей в день ожидаете?", "bakery": "Сколько покупателей в день ожидаете?",
                  "clothing_store": "Сколько покупателей в день ожидаете?", "beauty_salon": "Сколько клиентов в день ожидаете?"}


def _start_terms() -> str:
    rules = ex.data("rules")
    name = rules["start_product"]["name"].split(" — ")[0]
    share = round(rules["start"]["min_own_share"] * 100)
    return (f"Для демо-продукта «{name}» нужны расчёт проекта, не меньше {share} % своих денег "
            f"и залог или поручитель.")


TEXTS = {
    "core": "Уточню пару моментов, чтобы посчитать план.",
    "sums": "Цифры посчитаю в плане по шаблону сферы, сначала уточню несколько моментов.",
    "template": "Отличная идея. Уточню пару моментов, чтобы расчёт был ближе к вашей ситуации. Если не знаете — можно пропустить.",
    "nearest": "Такого шаблона у меня нет, но могу посчитать по похожему бизнесу.",
    "no_near": "Для такого бизнеса шаблона пока нет. Давайте выберем из того, что я умею считать.",
    "ready": "Данных хватает. Считаю план: вложения, расходы, прибыль и кредит на запуск.",
    "offtopic": "С этим не подскажу: я помогаю подобрать бизнес и посчитать план запуска. Расскажите, какой бизнес хотите открыть?",
    "greeting": "Здравствуйте! Я помогу подобрать бизнес и посчитать план. Что хотите открыть и в каком городе?",
    "role": "Я остаюсь консультантом по подбору бизнеса и не меняю роль. Давайте продолжим с вашим планом.",
}


def credit_text() -> str:
    return ("Решение по кредиту принимает банк после проверки заявки, заранее я его не знаю. " + _start_terms() +
            " Давайте посчитаем план — по нему будет видно нагрузку.")


def question_for(sphere: str, q: dict) -> dict:
    text = CUSTOMERS_TEXT.get(sphere) if q["id"] == "customers_per_day" else TEMPLATE_QUESTION_TEXT.get(q["id"])
    text = text or f"{q['text']}?"
    if q["kind"] == "choice":
        return {"id": q["id"], "text": text, "kind": "choice", "options": [o["label"] for o in q["options"]]}
    return {"id": q["id"], "text": text, "kind": "text"}


def complete(state: dict) -> bool:
    return state.get("sphere") in ex.templates() and state.get("city") is not None and state.get("own_funds_rub") is not None


# ---------- Что спрашивали в прошлый раз ----------

PROPOSAL_RX = re.compile(r"ближе всего по расчету — (.+?)\. считаем так")
CORE_STRIP = [norm(q["text"]) for q in CORE_QUESTIONS.values()]


def asked_context(prev: dict, history: list) -> dict:
    """По последней реплике консультанта: какие основные вопросы задавали, был ли раунд анкеты, какую сферу предлагали."""
    last = next((h["content"] for h in reversed(history) if h["role"] == "assistant"), None)
    ctx = {"core": set(), "template": False, "template_last": False, "proposal": None, "proposed": False}
    if last is None:
        return ctx
    a = norm(last)
    m = PROPOSAL_RX.search(a)
    if m:
        ctx["proposal"] = next((k for k, v in SPHERE_ACC.items() if norm(v) == m.group(1).strip()), None)
        ctx["proposed"] = True
    elif re.search(r"похожему бизнесу|ближайший вариант|ближе всего", a):
        prev_user = next((h["content"] for h in reversed(history) if h["role"] == "user"), "")
        ctx["proposal"] = ex.sphere_nearest(ex.fix_typos(prev_user))
        ctx["proposed"] = True  # даже если сферу не восстановили, «да/нет» — это ответ на предложение
    if "какой бизнес" in a:
        ctx["core"].add("sphere")
    if "каком городе" in a:
        ctx["core"].add("city")
    if "своих денег" in a:
        ctx["core"].add("own_funds")
    # Анкету уже спрашивали, если её вопросы есть в любой реплике ассистента. Полный state этого не доказывает.
    template_texts = [norm(t)[:-1] for t in list(TEMPLATE_QUESTION_TEXT.values()) + list(CUSTOMERS_TEXT.values())]
    ctx["template_last"] = any(t in a for t in template_texts)
    ctx["template"] = any(t in norm(h["content"]) for h in history if h["role"] == "assistant" for t in template_texts)
    if not ctx["core"] and not ctx["template_last"] and not ctx["proposed"] and not complete(prev):
        # В последней реплике нет наших вопросов (бэкенд передал только текст): недостающее основное и спрашивали.
        ctx["core"] = {k for k, f in (("sphere", "sphere"), ("city", "city"), ("own_funds", "own_funds_rub")) if prev.get(f) is None}
    return ctx


def strip_our_questions(message: str) -> str:
    """Убирает из сообщения тексты наших вопросов («Вопрос? Ответ»): в вопросе о сфере перечислены все сферы.
    Переводы строк сохраняются: по ним разбираются ответы построчно."""
    lines = []
    for line in message.split("\n"):
        t = norm(line)
        for q in CORE_STRIP:
            t = t.replace(q, " ")
        t = re.sub(r"ближе всего по расчету — .+?\?", " ", t)
        lines.append(re.sub(r"\s+", " ", t).strip())
    return "\n".join(lines)


# ---------- Ответ ----------

def _message(kind: str, prev: dict) -> dict:
    text = credit_text() if kind == "credit" else TEXTS[kind]
    return {"type": "message", "text": text, "state": copy.deepcopy(prev)}


def respond(request: dict) -> dict:
    prev = copy.deepcopy(request["state"])
    prev.setdefault("answers", {})
    history = request.get("history", [])
    message = ex.fix_typos(request["message"])  # «етсь 250 тыс» -> «есть 250 тыс»; переводы строк сохраняются
    raw = norm(message)
    ctx = asked_context(prev, history)
    # Человек отвечает строками «Какой формат? Кофе с собой» — значит, вопросы анкеты он видел (пример контракта
    # consult.request.answers.json), даже если бэкенд положил в history только вступительный текст.
    if any(norm(t) in raw for t in list(TEMPLATE_QUESTION_TEXT.values()) + list(CUSTOMERS_TEXT.values())):
        ctx["template"] = ctx["template_last"] = True

    if ex.ROLE_CHANGE.search(raw):
        return _message("role", prev)
    if ex.CREDIT_PROMISE.search(raw):
        return _message("credit", prev)

    body = strip_our_questions(message)
    correction = bool(ex.CORRECTION.search(body))
    first_turn = not history
    short = len(body.split()) <= 2  # «Печоры», «город Тверь»: название можно без предлога

    # --- факты ---
    confirm = None
    if ctx["proposed"]:
        b = body.strip(" .!,")
        if ex.YES.match(b):
            confirm = True
        elif ex.NO.search(b):
            confirm = False
    sphere, _ = ex.sphere_direct(body)
    proposal = None if sphere else ex.sphere_nearest(body)
    unknown = not sphere and not proposal and ex.unknown_business(body)
    if confirm is True:
        sphere = sphere or ctx["proposal"]
        unknown = unknown or sphere is None  # «да», но что предлагали — не восстановить: спросим сферу списком
    city, _ = ex.pick_city(body, bare_ok="city" in ctx["core"] or short)
    # «Нет, давайте лучше кофейню» — это начало поправки, а не «своих денег нет».
    leading_no = bool(re.match(r"\s*(нет|не)\b[ ,.!—-]+\S", body)) and bool(correction or sphere or proposal or unknown)
    funds = None if confirm is not None else ex.own_funds(body, asked="own_funds" in ctx["core"] and not leading_no)
    if funds is None and correction and prev.get("own_funds_rub") is not None and not ex.SUMS_QUESTION.search(body):
        funds = ex.correction_amount(body)
    target_sphere = sphere if sphere and (prev.get("sphere") is None or correction or "sphere" in ctx["core"]) else prev.get("sphere")
    answers = ex.template_answers(target_sphere, message) if target_sphere in ex.templates() else {}

    # Ответ «Вопрос? Ответ» на наш вопрос анкеты — тоже по делу, даже если ответ «затрудняюсь».
    # В раунде анкеты число с единицей («30 кв.м») — ответ, даже если вне min–max и не записан.
    answers_our_question = ctx["template_last"] and (
        any(norm(t)[:-1] in raw for t in list(TEMPLATE_QUESTION_TEXT.values()) + list(CUSTOMERS_TEXT.values()))
        or bool(re.search(r"\d|" + "|".join(a for a, _ in ex.ANSWER_CUES.values()), body)))
    informative = any([sphere, proposal, unknown, city, funds is not None, answers, confirm is not None, answers_our_question,
                       correction and history, ex.SKIP.search(body), ex.SUMS_QUESTION.search(body), ex.BUSINESS_WORDS.search(body)])
    if not informative:
        return _message("greeting" if ex.is_greeting(message) else "offtopic", prev)

    # --- обновление state: известное меняется только по явной поправке или как ответ на вопрос ---
    state = copy.deepcopy(prev)
    if sphere and sphere != state["sphere"] and (state["sphere"] is None or correction or "sphere" in ctx["core"]):
        state["sphere"] = sphere
        state["answers"] = {}
    if city and city != state["city"] and (state["city"] is None or correction or "city" in ctx["core"] or first_turn):
        state["city"] = city
    if funds is not None and funds != state["own_funds_rub"] and (state["own_funds_rub"] is None or correction or "own_funds" in ctx["core"]):
        state["own_funds_rub"] = funds
    if state["sphere"] == target_sphere:
        state["answers"].update(answers)

    # --- ответ ---
    if state["sphere"] is None and (proposal or unknown or confirm is False):
        questions = []
        if proposal:
            questions.append({"id": "sphere", "text": f"Ближе всего по расчёту — {SPHERE_ACC[proposal]}. Считаем так?",
                              "kind": "choice", "options": ["Да, подходит", "Нет, другой бизнес"]})
            text = TEXTS["nearest"]
        else:
            questions.append(CORE_QUESTIONS["sphere"])
            text = TEXTS["no_near"]
        if state["city"] is None:
            questions.append(CORE_QUESTIONS["city"])
        if state["own_funds_rub"] is None:
            questions.append(CORE_QUESTIONS["own_funds"])
        return {"type": "questions", "text": text, "questions": questions, "state": state}

    if not complete(state):
        missing = [k for k, f in (("sphere", "sphere"), ("city", "city"), ("own_funds", "own_funds_rub"))
                   if (state[f] is None if f != "sphere" else state["sphere"] not in ex.templates())]
        text = TEXTS["sums"] if ex.SUMS_QUESTION.search(body) else TEXTS["core"]
        return {"type": "questions", "text": text, "questions": [CORE_QUESTIONS[k] for k in missing], "state": state}

    if not ctx["template"]:
        # Анкету ещё не спрашивали (по истории): один раунд, если есть неотвеченные вопросы, иначе сразу ready.
        pending = [q for q in ex.templates()[state["sphere"]]["questions"] if q["id"] not in state["answers"]]
        if pending:
            return {"type": "questions", "text": TEXTS["template"],
                    "questions": [question_for(state["sphere"], q) for q in pending[:4]], "state": state}
    return {"type": "ready", "text": TEXTS["ready"], "state": state}
