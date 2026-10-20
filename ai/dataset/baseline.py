"""Простое базовое решение без модели: регулярные выражения.

consult(request)    — как sendMessage во фронтовом моке (frontend/src/api/mock.ts): сфера, город, свои деньги
                      по очереди, ответы анкеты не разбирает, посторонние сообщения не распознаёт.
parse_need(request) — ключевые слова для цели и сферы, поиск города по cities.json, суммы и сроки.
С ними сравниваем дообученную модель: она должна быть заметно лучше.
"""
import copy
import re
from functools import lru_cache

from .common import CITY_NAMES

SPHERE_RE = [("coffee", r"кофе"), ("bakery", r"пекар|хлеб"), ("car_wash", r"мойк"), ("clothing_store", r"одежд|бутик"),
             ("beauty_salon", r"салон красот|барбер|парикмах|ногт"), ("pickup_point", r"\bпвз\b|пункт выдачи")]
OTHER_RE = r"стоматолог|автосервис|фитнес"
PURPOSE_RE = [("refinance", r"рефинанс|перекредит|объедин\w* кредит"), ("real_estate", r"(куп|выкуп)\w* (своё |сво[её] )?помещени"),
              ("equipment", r"оборудован|кофемашин|\bпеч[ьи]\b|станк|техник|стеллаж"), ("working_capital", r"оборот|закуп|зарплат|сырь"),
              ("new_direction", r"направлени|доставк|услуг|онлайн"), ("new_location", r"открыть|точк|втор\w+ |ещё од")]

WORD_NUM = {"один": 1, "одна": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6, "семь": 7, "восемь": 8,
            "девять": 9, "десять": 10}


@lru_cache(maxsize=1)
def _city_patterns():
    pats = []
    for name in CITY_NAMES:
        low = name.lower().replace("ё", "е")
        stem = low[:-1] if len(low) > 4 and low[-1] in "аеиоуыэюяьй" else low
        pats.append((len(stem), name, re.compile(r"(?<![а-я])" + re.escape(stem) + r"[а-я]{0,3}(?![а-я])")))
    return sorted(pats, key=lambda p: -p[0])


def find_city(text: str):
    low = text.lower().replace("ё", "е")
    for _, name, pat in _city_patterns():
        if pat.search(low):
            return name
    return None


def parse_amount(text: str):
    t = text.lower().replace("ё", "е")
    if re.search(r"полтора\s+(миллиона|ляма)", t):
        return 1_500_000
    if re.search(r"полмиллиона|пол-ляма|пол ляма", t):
        return 500_000
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*(млн|миллион\w*|лям\w*)", t)
    if m:
        return int(round(float(m.group(1).replace(",", ".")) * 1_000_000))
    m = re.search(r"(\d+)\s*(к\b|тыс\w*)", t)
    if m:
        return int(m.group(1)) * 1000
    m = re.search(r"\b(" + "|".join(WORD_NUM) + r")\s+(миллион\w*|лям\w*)", t)
    if m:
        return WORD_NUM[m.group(1)] * 1_000_000
    if re.search(r"(?<![а-я])(миллион|лям)(?![а-я])", t):
        return 1_000_000
    for m in re.finditer(r"(\d[\d ]{2,}\d)(?!\s*(мес|год|лет|м²|кв|человек|машин|заказ|сотрудник|пост|руб\w* сред))", t):
        n = int(m.group(1).replace(" ", ""))
        if n >= 1000:
            return n
    return None


def parse_term(text: str):
    t = text.lower().replace("ё", "е")
    m = re.search(r"(\d+)\s*(мес)", t)
    if m:
        return int(m.group(1))
    m = re.search(r"(\d+)\s*(год|года|лет)", t)
    if m:
        return int(m.group(1)) * 12
    words = {"полгода": 6, "полтора года": 18, "два года": 24, "три года": 36, "четыре года": 48, "пять лет": 60,
             "семь лет": 84, "десять лет": 120, "лет на три": 36, "один год": 12, "на год": 12, "шесть месяцев": 6}
    for w, n in words.items():
        if w in t:
            return n
    return None


def parse_collateral(text: str):
    t = text.lower()
    if re.search(r"без залога|залога нет|залог дать не могу|для залога нет", t):
        return False
    if re.search(r"залог|заложить", t):
        return True
    return None


def first_match(table, text):
    low = text.lower().replace("ё", "е")
    return next((code for code, rx in table if re.search(rx, low)), None)


def parse_need(request: dict) -> dict:
    text = request["text"]
    out = {"purpose": first_match(PURPOSE_RE, text), "sphere": first_match(SPHERE_RE, text),
           "city": find_city(text), "amount_rub": parse_amount(text), "term_months": parse_term(text),
           "has_collateral": parse_collateral(text)}
    if out["sphere"] is None and re.search(OTHER_RE, text.lower()):
        out["sphere"] = "other"
    if out["amount_rub"] is not None and not 1000 <= out["amount_rub"] <= 1_000_000_000:
        out["amount_rub"] = None
    if out["term_months"] is not None and not 1 <= out["term_months"] <= 360:
        out["term_months"] = None
    out["confidence"] = {k: 0.8 for k, v in out.items() if v is not None}
    return out


Q_SPHERE = {"id": "sphere", "text": "Какой бизнес хотите открыть?", "kind": "text"}
Q_CITY = {"id": "city", "text": "В каком городе открываетесь?", "kind": "text"}
Q_FUNDS = {"id": "own_funds", "text": "Сколько своих денег готовы вложить в запуск? Если нет — напишите «нет».", "kind": "text"}


def consult(request: dict) -> dict:
    """Порт sendMessage из frontend/src/api/mock.ts."""
    text = request["message"]
    st = copy.deepcopy(request["state"])
    sphere = first_match(SPHERE_RE, text)
    if sphere:
        st["sphere"] = sphere
    st["city"] = find_city(text) or st["city"]
    amount = parse_amount(text)
    last_assistant = next((h["content"] for h in reversed(request["history"]) if h["role"] == "assistant"), "")
    if "своих денег" in last_assistant and st["own_funds_rub"] is None:
        last_line = text.split("\n")[-1]
        st["own_funds_rub"] = amount if amount is not None else (0 if re.search(r"нет|ноль|без своих|^0", last_line, re.I) else None)
    elif amount is not None and re.search(r"есть|свои|своих|накоп|отлож|вложить|бюджет", text, re.I):
        st["own_funds_rub"] = amount
    if not st["sphere"]:
        return {"type": "questions", "text": "Какой бизнес хотите открыть?", "questions": [Q_SPHERE], "state": st}
    if not st["city"]:
        return {"type": "questions", "text": "Где будет бизнес?", "questions": [Q_CITY], "state": st}
    if st["own_funds_rub"] is None:
        return {"type": "questions", "text": "Последний вопрос перед расчётом.", "questions": [Q_FUNDS], "state": st}
    return {"type": "ready", "text": "Считаю план по шаблону сферы.", "state": st}
