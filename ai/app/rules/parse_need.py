"""/ai/parse-need без модели: цель, сфера, город, сумма, срок, залог (contracts/ai.md, правила /ai/parse-need).

Чего нет в тексте — null. confidence ставится только для найденных полей и тем ниже, чем слабее признак:
нечёткое совпадение (опечатка), сумма словами, неоднозначная цель. Поля ниже 0,7 фронт подсвечивает.
"""
import re

from . import extract as ex
from .text import amounts, norm, term_months

# Порядок важен: более конкретные цели раньше («купить помещение» — недвижимость, а не открытие точки).
PURPOSES = [
    ("refinance", r"рефинанс|перекредит|объедин\w* кредит|закрыть (дорог\w* )?кредит|погасить (другие |старые )?кредит", 0.93),
    ("real_estate", r"(куп|выкуп|приобре)\w*\s+(св\w* |собственн\w* |коммерческ\w* )?(помещени|недвижим|здани|офис)", 0.93),
    ("new_location", r"открыть|открытие|ещ[её] (одну|один|одно) точк|втор\w+ (точк|кофейн|пекарн|магазин|салон|пвз|пункт|автомойк)|"
                     r"нов\w* точк|филиал|ещ[её] (одн|один)", 0.88),
    ("equipment", r"оборудован|кофемашин|(?<![а-я])печ[ьи](?![а-я])|тестомес|станк|техник|стеллаж|кресл\w* и|аппарат|холодильн|"
                  r"автомобил\w* для|транспорт для|фургон|грузовик", 0.9),
    ("working_capital", r"оборот|закуп|зарплат|сырь[её]|налог|аренд\w* и|товар(?![а-я])|на товар", 0.88),
    ("new_direction", r"направлени|доставк|нов\w* услуг|онлайн|расшир\w* ассортимент|нов\w* продукт", 0.86),
]
COLLATERAL_NO = re.compile(r"без залога|залога нет|нет залога|залог дать не могу|залог не могу|имуществ\w* для залога нет|не готов\w* (ничего )?заложить")
COLLATERAL_YES = re.compile(r"залог|заложить|под обеспечение|поручител")


def _purpose(t: str):
    for code, rx, conf in PURPOSES:
        if re.search(rx, t):
            return code, conf
    return None, None


def parse(request: dict) -> dict:
    text = ex.fix_typos(request["text"])  # опечатки в ключевых словах; города не трогаются
    t = norm(text)
    out = {"purpose": None, "sphere": None, "city": None, "amount_rub": None, "term_months": None, "has_collateral": None}
    conf = {}

    purpose, pc = _purpose(t)
    sphere, fuzzy_sphere = ex.sphere_direct(t)
    if sphere is None and (ex.sphere_nearest(t) or re.search(ex.OTHER_BUSINESS, t) or ex.unknown_business(t)):
        sphere, fuzzy_sphere = "other", False
    city, fuzzy_city = ex.pick_city(text)
    money = [a for a in amounts(t) if 1000 <= a[0] <= 1_000_000_000]
    term = term_months(t)

    # Бизнес-смысл нужен, чтобы не «находить» цель или город в болтовне («Как приготовить плов?»).
    about_business = bool(purpose or sphere or money or term or ex.BUSINESS_WORDS.search(t))
    if not about_business:
        return {**out, "confidence": {}}

    if purpose:
        out["purpose"], conf["purpose"] = purpose, pc
    if sphere:
        out["sphere"] = sphere
        conf["sphere"] = 0.75 if fuzzy_sphere else 0.9 if sphere == "other" else 0.95
    if city:
        out["city"], conf["city"] = city, 0.75 if fuzzy_city else 0.95
    if money:
        value, _, _, kind = money[0]
        out["amount_rub"] = value
        conf["amount_rub"] = {"digits": 0.95, "short": 0.93, "words": 0.85, "slang": 0.82}[kind]
        if len({m[0] for m in money}) > 1:
            conf["amount_rub"] = 0.6  # несколько разных сумм — пусть человек проверит
    if term is not None and 1 <= term <= 360:
        out["term_months"], conf["term_months"] = term, 0.9
    if COLLATERAL_NO.search(t):
        out["has_collateral"], conf["has_collateral"] = False, 0.9
    elif COLLATERAL_YES.search(t):
        out["has_collateral"], conf["has_collateral"] = True, 0.85
    out["confidence"] = conf
    return out
