"""/ai/consult без модели: правила contracts/ai.md поверх разбора текста (extract.py).

Порядок: атака или смена роли -> вопрос «одобрят ли» -> приветствие -> факты из сообщения -> не по теме ->
обновление state (поправки) -> ответ: ближайшая сфера / недостающее основное / один раунд анкеты / ready.
Сумм не называет и кредит не обещает. Условия «Старта» берутся из снимка правил (data/rules.json).
Формулировки — из банка фраз (data/phrases.json), факты о городе — из базы (data/knowledge.cities.json), см. knowledge.py.
Запасные тексты ниже — без цифр: ими сервис отвечает, если слота или факта нет.
"""
import copy
import re

from ..scope import OFF_TOPIC
from . import extract as ex
from . import knowledge as kn
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
# Не хватает только своих денег: вводная говорит, зачем они, а не «важные детали» (замечание Саши к core_intro).
FUNDS_INTRO = "Без суммы своих денег план не посчитать: от неё зависит, сколько понадобится в кредит."
# Вопросов в ответе — не больше maxItems consult.schema.json (опыт + до 3 вопросов анкеты).
MAX_QUESTIONS = 4


CREDIT_FALLBACK = "Решение по кредиту принимает банк после проверки заявки, заранее я его не знаю."
CREDIT_TAIL = "Давайте посчитаем план — по нему будет видно нагрузку."
# Слоты банка фраз для текстов TEXTS и основных вопросов.
TEXT_SLOTS = {"core": "core_intro", "sums": "sums_intro", "template": "template_intro", "nearest": "nearest_intro",
              "no_near": "no_near_intro", "ready": "ready_intro", "offtopic": "offtopic", "greeting": "greeting",
              "role": "role_change"}
ASK_SLOTS = {"sphere": "ask_sphere", "city": "ask_city", "own_funds": "ask_own_funds"}

# ---------- Опыт в этом бизнесе (contracts/ai.md, правило 9) ----------

EXPERIENCE_TEXT = "Есть ли у вас опыт в этом бизнесе?"
EXPERIENCE_WORDS = [("owner", r"был\w* сво|сво\w* бизнес|владел|собственник|предпринимател|свое дело|своё дело"),
                    ("employee", r"наём|наем|работал|по найму"),  # не «сотрудник»: «сотрудников 3» — ответ анкеты
                    ("none", r"нет опыта|без опыта|опыта нет|не было|никакого|^(нет|нету)$|новичок")]
# «нет» — ответ про опыт, только если это весь ответ: «Нет, давайте лучше магазин одежды» — поправка, а не опыт.
# Не «^не»: «не знаю» — не ответ.


def experience_options() -> list:
    return [v["title"] for v in ex.data("dictionaries")["experiences"].values()]


def experience_question(turn: "Turn") -> dict:
    text = kn.phrase("ask_experience", turn.key, turn.n, {}) or EXPERIENCE_TEXT
    return {"id": "experience", "text": text, "kind": "choice", "options": experience_options()}


def experience_texts() -> list:
    return [norm(t).rstrip("?").strip() for t in [EXPERIENCE_TEXT] + kn.variants("ask_experience")]


def experience_asked(history: list) -> bool:
    """Спрашивали ли об опыте — по history, как анкету: текст вопроса или строка его вариантов."""
    options = norm(" / ".join(experience_options()))
    return any(any(t in norm(h["content"]) for t in experience_texts()) or options in norm(h["content"])
               for h in history if h["role"] == "assistant")


def experience_answer(message: str):
    """Ответ на вопрос об опыте: подпись кнопки, строка «Вопрос? Ответ» или слова. Иначе None."""
    for value, info in ex.data("dictionaries")["experiences"].items():
        if norm(info["title"]) in norm(message):
            return value
    lines = [ln.split("?", 1)[1] for ln in message.split("\n") if "?" in ln and "опыт" in norm(ln.split("?", 1)[0])]
    for text in lines or [message]:
        t = norm(text).strip(" .!,")
        for value, rx in EXPERIENCE_WORDS:
            if re.search(rx, t):
                return value
    return None


class Turn:
    """Ключ диалога и номер реплики: от них зависит выбор варианта фразы (knowledge.phrase)."""

    def __init__(self, history: list, message: str):
        self.key = kn.dialog_key(history, message)
        self.n = sum(1 for h in history if h["role"] == "user")

    def text(self, kind: str, vals: dict | None = None) -> str:
        return kn.phrase(TEXT_SLOTS[kind], self.key, self.n, vals or {}, TEXTS[kind])

    def core_question(self, k: str) -> dict:
        q = dict(CORE_QUESTIONS[k])
        text = kn.phrase(ASK_SLOTS[k], self.key, self.n, {})
        if text:
            if k == "sphere":
                text = f"{text} Сейчас считаю: {SPHERE_LIST_TEXT}."
            elif k == "own_funds" and "«нет»" not in text:
                text = f"{text} Если своих нет, напишите «нет»."  # ответ «нет» понимается как ноль своих денег
            if len(text) <= 200:  # предел текста вопроса в consult.schema.json
                q["text"] = text
        return q


def credit_text(turn: "Turn | None" = None) -> str:
    first = kn.phrase("credit_promise", turn.key, turn.n, {}, CREDIT_FALLBACK) if turn else CREDIT_FALLBACK
    return kn.join([first, _start_terms(), CREDIT_TAIL])


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
CORE_KEYWORDS = {"sphere": "какой бизнес", "city": "каком городе", "own_funds": "своих денег"}


def ask_texts(k: str) -> list:
    """Как мог звучать наш вопрос: запасной текст и все варианты из банка фраз (без «?» на конце)."""
    out = [norm(CORE_QUESTIONS[k]["text"])] + [norm(v) for v in kn.variants(ASK_SLOTS[k])]
    return [t.rstrip("?").strip() for t in out]


def core_strip() -> list:
    return [norm(q["text"]) for q in CORE_QUESTIONS.values()] + [norm(v) for k in ASK_SLOTS for v in kn.variants(ASK_SLOTS[k])]


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
    for k, word in CORE_KEYWORDS.items():
        if word in a or any(t in a for t in ask_texts(k)):
            ctx["core"].add(k)
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
        for q in core_strip():
            t = t.replace(q, " ")
        t = re.sub(r"ближе всего по расчету — .+?\?", " ", t)
        lines.append(re.sub(r"\s+", " ", t).strip())
    return "\n".join(lines)


# ---------- Ответ ----------

def _message(kind: str, prev: dict, turn: Turn) -> dict:
    text = credit_text(turn) if kind == "credit" else turn.text(kind)
    return {"type": "message", "text": text, "state": copy.deepcopy(prev)}


def competition(state: dict, history: list, turn: Turn) -> str | None:
    """Факт о конкуренции из базы — один раз за диалог, когда известны сфера и город."""
    if kn.said_competition(history):
        return None
    facts = kn.fact_values(state, "venues")
    return kn.phrase("city_competition", turn.key, turn.n, {**kn.values(state), **facts}) if facts else None


def registered(state: dict, history: list, turn: Turn) -> str | None:
    """Число зарегистрированных бизнесов сферы по реестру МСП ФНС — один раз за диалог."""
    if kn.said_registered(history):
        return None
    facts = kn.fact_values(state, "registered")
    return kn.phrase("registered_fact", turn.key, turn.n, {**kn.values(state), **facts}) if facts else None


def fact_phrase(slot: str, state: dict, fact: str, turn: Turn) -> str | None:
    facts = kn.fact_values(state, fact)
    return kn.phrase(slot, turn.key, turn.n, {**kn.values(state), **facts}) if facts else None


def ready_text(state: dict, history: list, turn: Turn) -> str:
    """Вступление к плану, затем по важности, пока помещается в 600 символов: конкуренция и регистрации (если ещё не
    звучали), зарплата по региону, совет или риск сферы и один новый факт (ROUND4_knowledge.md: не больше одного
    нового факта на блок) — доход, розница или проходимость для сферы, выбор по хешу диалога."""
    vals = kn.values(state)
    advice = f"{state['sphere']}_{('tip', 'risk')[kn.choice('advice', turn.key, turn.n, 2)]}"
    place = kn.fact_values(state, "places").get("_kind")
    extra = [fact_phrase("income_fact", state, "income", turn), fact_phrase("retail_fact", state, "retail", turn),
             fact_phrase(f"places_{place}", state, "places", turn) if place else None]
    extra = [x for x in extra if x]
    new_fact = extra[kn.choice("new_fact", turn.key, turn.n, len(extra))] if extra else None
    return kn.join([turn.text("ready", vals), competition(state, history, turn), registered(state, history, turn),
                    fact_phrase("salary_fact", state, "salary", turn), kn.phrase(advice, turn.key, turn.n, vals), new_fact])


def respond(request: dict) -> dict:
    prev = copy.deepcopy(request["state"])
    prev.setdefault("answers", {})
    history = request.get("history", [])
    message = ex.fix_typos(request["message"])  # «етсь 250 тыс» -> «есть 250 тыс»; переводы строк сохраняются
    raw = norm(message)
    ctx = asked_context(prev, history)
    turn = Turn(history, request["message"])
    # Человек отвечает строками «Какой формат? Кофе с собой» — значит, вопросы анкеты он видел (пример контракта
    # consult.request.answers.json), даже если бэкенд положил в history только вступительный текст.
    if any(norm(t) in raw for t in list(TEMPLATE_QUESTION_TEXT.values()) + list(CUSTOMERS_TEXT.values())):
        ctx["template"] = ctx["template_last"] = True

    if ex.ROLE_CHANGE.search(raw):
        return _message("role", prev, turn)
    if ex.CREDIT_PROMISE.search(raw):
        return _message("credit", prev, turn)

    body = strip_our_questions(message)
    correction = bool(ex.CORRECTION.search(body)) or ex.sphere_negated(body)  # «нет, не кофейню, пекарню»
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
    if funds is None and first_turn and (sphere or proposal or city) and not leading_no:
        funds = ex.bare_amount(body)  # «Питер, кофейня, 1 млн»: единственная сумма без признаков кредита
    target_sphere = sphere if sphere and (prev.get("sphere") is None or correction or "sphere" in ctx["core"]) else prev.get("sphere")
    answers = ex.template_answers(target_sphere, message) if target_sphere in ex.templates() else {}

    # Ответ «Вопрос? Ответ» на наш вопрос анкеты — тоже по делу, даже если ответ «затрудняюсь».
    # В раунде анкеты число с единицей («30 кв.м») — ответ, даже если вне min–max и не записан.
    answers_our_question = ctx["template_last"] and (
        any(norm(t)[:-1] in raw for t in list(TEMPLATE_QUESTION_TEXT.values()) + list(CUSTOMERS_TEXT.values()))
        or bool(re.search(r"\d|" + "|".join(a for a, _ in ex.ANSWER_CUES.values()), body)))
    # «Какая погода завтра в Самаре?» — не про бизнес, даже если назван город. Текст до исправления опечаток:
    # «погода» иначе становится «полгода».
    if OFF_TOPIC.search(norm(request["message"])) and not (sphere or proposal or funds is not None or answers):
        return _message("offtopic", prev, turn)
    # Ответ на вопрос об опыте — только если его задали в последней реплике (правило 9).
    last_assistant = [h for h in history if h["role"] == "assistant"][-1:]
    experience = experience_answer(message) if experience_asked(last_assistant) else None  # после исправления опечаток
    # Голое «нет» на наш основной вопрос (не про деньги) — отказ ответить, а не «не по теме»: спросим снова.
    bare_no = bool(ctx["core"]) and bool(re.fullmatch(r"(нет|нету|неа)", body.strip(" .!,")))
    informative = any([sphere, proposal, unknown, city, funds is not None, answers, confirm is not None, answers_our_question,
                       experience is not None, bare_no,
                       correction and history, ex.SKIP.search(body), ex.SUMS_QUESTION.search(body), ex.BUSINESS_WORDS.search(body)])
    if not informative:
        return _message("greeting" if ex.is_greeting(message) else "offtopic", prev, turn)

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
    if experience is not None:
        state["experience"] = experience

    # --- ответ ---
    if state["sphere"] is None and (proposal or unknown or confirm is False):
        questions = []
        if proposal:
            questions.append({"id": "sphere", "text": f"Ближе всего по расчёту — {SPHERE_ACC[proposal]}. Считаем так?",
                              "kind": "choice", "options": ["Да, подходит", "Нет, другой бизнес"]})
            text = turn.text("nearest")
        else:
            questions.append(turn.core_question("sphere"))
            text = turn.text("no_near")
        if state["city"] is None:
            questions.append(turn.core_question("city"))
        if state["own_funds_rub"] is None:
            questions.append(turn.core_question("own_funds"))
        return {"type": "questions", "text": text, "questions": questions, "state": state}

    if not complete(state):
        missing = [k for k, f in (("sphere", "sphere"), ("city", "city"), ("own_funds", "own_funds_rub"))
                   if (state[f] is None if f != "sphere" else state["sphere"] not in ex.templates())]
        if ex.SUMS_QUESTION.search(body):
            text = turn.text("sums")
        else:
            text = FUNDS_INTRO if missing == ["own_funds"] else turn.text("core")
        return {"type": "questions", "text": text, "questions": [turn.core_question(k) for k in missing], "state": state}

    # Опыт (правило 9): один раз за диалог, первым в раунде анкеты. Если анкета не нужна (всё уже сказано) — один
    # вопрос об опыте вместо неё. Если анкету уже спрашивали без него, отдельно не спрашиваем: сразу ready
    # (как в примере контракта consult.request.answers.json -> consult.response.ready.json).
    ask_exp = not experience_asked(history) and state.get("experience") is None
    if not ctx["template"]:
        # Анкету ещё не спрашивали (по истории): один раунд, если есть неотвеченные вопросы.
        pending = [q for q in ex.templates()[state["sphere"]]["questions"] if q["id"] not in state["answers"]]
        questions = ([experience_question(turn)] if ask_exp else []) + \
            [question_for(state["sphere"], q) for q in pending[:MAX_QUESTIONS - ask_exp]]
        if questions:
            text = kn.join([turn.text("template", kn.values(state)), competition(state, history, turn),
                            registered(state, history, turn)])
            return {"type": "questions", "text": text, "questions": questions, "state": state}
    return {"type": "ready", "text": ready_text(state, history, turn), "state": state}
