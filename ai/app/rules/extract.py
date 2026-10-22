"""Извлечение фактов из реплики: сфера, город, свои деньги, ответы анкеты, намерения.

Только словари, правила и разбор чисел. Данные — снимок контрактов в app/rules/data (build_data.py).
"""
import json
import re
from functools import lru_cache
from pathlib import Path

from .text import amounts, edit_distance_le1, norm, numbers_in

DATA = Path(__file__).resolve().parent / "data"


@lru_cache(maxsize=None)
def data(name: str):
    return json.loads((DATA / f"{name}.json").read_text(encoding="utf-8"))


def templates() -> dict:
    return data("templates")["spheres"]


# ---------- Опечатки в ключевых словах ----------

from .text import HUNDREDS, MULT, TENS, UNITS  # noqa: E402

KEYWORDS = set(UNITS) | set(TENS) | set(HUNDREDS) | set(MULT) | set("""
есть свои своих своими накопил накопила накопили накопления накоплений отложено отложил бюджет вложить вложу вложений
готов готова готовы примерно около денег деньги деньгами нет ноль только кредит кредита кредиту кредиты
одобрят одобрит одобрение дадут точно гарантируете гарантия откажут отказ шанс получу банк
город городе города извините поправлю ошибся передумал неправильно лучше всё-таки все-таки другой исправлю
буду будут будет открываться открывать открыть открою запустить мечтаю планирую собираюсь хочу хотим думаю
штате штат сотрудник сотрудника сотрудников продавца продавцов работать человек человека гостей клиентов покупателей
площадь метров метра квадратов помещение средний чек рублей машин машины заказов заказа поста постов кресла кресел
мест места рабочих формат посадкой собой навынос
кофейню кофейня кофейни кофейне пекарню пекарня пекарни пекарне автомойку автомойка автомойки мойку мойка мойки
одежды магазин магазина бутик салон салона красоты парикмахерскую барбершоп ногтевую студию студия пункт пункта
выдачи заказов хлебная хлебную лавку лавка лавки островок самообслуживания
оборудование оборудования оборотные оборотку средства средств закупку товара рефинансировать перекредитоваться
помещение помещения купить выкупить залог залога заложить квартиру машину недвижимость срок месяцев месяца года
лет полгода полтора полутора вернуть отдавать нужно нужен сумма взять затрудняюсь пропущу посчитайте считайте
день дней давайте деталей детали детальнее сколько стоит стоимость запуск запуска зарабатывать окупится знаю можно
свое своя свою свой своей своего своему своим твое твой этот этого этой если есть естественно ещё еще
опыт опыта опытом наёмным наемным найму бизнес
""".split())


@lru_cache(maxsize=1)
def _city_forms():
    return {f for c in data("cities") for f in c["forms"]}


@lru_cache(maxsize=1)
def _keywords_by_first():
    by_first = {}
    for k in KEYWORDS:
        if len(k) >= 4:
            by_first.setdefault(k[0], []).append(k)
    return by_first


def fix_typos(text: str) -> str:
    """«етсь 250 тыс» -> «есть 250 тыс». Слово меняем, только если ровно одно ключевое слово отличается на 1 букву,
    первая буква совпадает, а само слово не форма города. Перевод строк сохраняется."""
    by_first, cities = _keywords_by_first(), _city_forms()

    def fix(m):
        w = m.group()
        if len(w) < 4 or w in KEYWORDS or w in cities:
            return w
        cands = {k for k in by_first.get(w[0], []) if edit_distance_le1(w, k)}
        return cands.pop() if len(cands) == 1 else w

    return "\n".join(re.sub(r"[а-я]+", fix, norm(line)) for line in text.split("\n"))


# ---------- Города ----------

CITY_CUES = {"в", "во", "из", "город", "г", "городе", "города", "городу", "гор", "под"}
# Разговорные и короткие названия: форма -> (город, нужен ли предлог). «в Нижнем», «в Челнах», «Питер», «в Новгороде».
CITY_ALIASES = {
    **{f: ("Санкт-Петербург", False) for f in ("питер", "питера", "питере", "питеру", "питером", "спб")},
    **{f: ("Нижний Новгород", True) for f in ("нижнем", "нижний", "нижнего", "нижнему")},
    **{f: ("Набережные Челны", True) for f in ("челны", "челнах", "челнов", "челнам")},
    **{f: ("Великий Новгород", True) for f in ("новгород", "новгороде", "новгорода", "новгороду")},
    **{f: ("Екатеринбург", False) for f in ("екб", "ебург", "екатеринбурге")},
    **{f: ("Москва", False) for f in ("мск",)},
}


@lru_cache(maxsize=1)
def _city_index():
    exact, by_prefix, max_words = {}, {}, 1
    by_name = {}
    for c in data("cities"):
        by_name[c["name"]] = c
        for f in c["forms"]:
            exact.setdefault(f, []).append(c)
            max_words = max(max_words, len(f.split()))
            if " " not in f and len(f) >= 5:
                by_prefix.setdefault(f[:2], []).append((f, c))
    for f, (name, cue) in CITY_ALIASES.items():
        if f not in exact and name in by_name:
            exact[f] = [{**by_name[name], "needs_cue": cue, "alias": True}]
    return exact, by_prefix, max_words


def find_cities(text: str, bare_ok: bool = False) -> list:
    """Города в тексте: [{"name", "start", "cued", "fuzzy", "negated"}] по порядку появления.
    bare_ok — текст сам ответ на вопрос «В каком городе?»: предлог не обязателен."""
    exact, by_prefix, max_words = _city_index()
    t = norm(text)
    toks = [(m.group(), m.start(), m.end()) for m in re.finditer(r"[a-zа-я0-9]+(?:-[a-zа-я0-9]+)*|г\.", t)]
    found, used = [], set()
    for n in range(max_words, 0, -1):
        for i in range(len(toks) - n + 1):
            if any(j in used for j in range(i, i + n)):
                continue
            phrase = " ".join(w for w, _, _ in toks[i:i + n])
            cands, fuzzy = exact.get(phrase), False
            if not cands and n == 1 and len(phrase) >= 5:
                # Опечатка: от 6 букв — любой город, в 5 букв — только крупный («Перьм», «Кзани»).
                cands = [c for f, c in by_prefix.get(phrase[:2], []) + by_prefix.get(phrase[:1] + phrase[2:3], [])
                         if edit_distance_le1(phrase, f) and (len(phrase) >= 6 or c["population"] >= 300_000)]
                fuzzy = bool(cands)
            if not cands:
                continue
            prev = toks[i - 1][0].rstrip(".") if i else ""
            cued = prev in CITY_CUES
            nominative = [c for c in cands if norm(c["name"]) == phrase or c.get("alias")]
            best = max(nominative or cands, key=lambda c: c["population"])
            if best["needs_cue"] and not (cued or bare_ok):
                continue
            if fuzzy and not cued and best["population"] < 100_000:
                continue  # «почему» -> «Почеп»: нечёткое совпадение с малым городом только после «в/из/город»
            negated = prev == "не" or (i >= 2 and toks[i - 2][0] == "не" and cued)
            found.append({"name": best["name"], "start": toks[i][1], "cued": cued, "fuzzy": fuzzy, "negated": negated})
            used.update(range(i, i + n))
    return sorted(found, key=lambda x: x["start"])


def pick_city(text: str, bare_ok: bool = False):
    """Один город: последний упомянутый без «не» («не Казань, а Самара» -> Самара). (название, нечёткий?)."""
    cities = [c for c in find_cities(text, bare_ok) if not c["negated"]]
    if not cities:
        return None, False
    c = cities[-1]
    return c["name"], c["fuzzy"]


# ---------- Сферы ----------

SPHERE_DIRECT = {
    "coffee": [r"кофе(?!ин)", r"кофейн", r"кафе-кофейн"],
    "bakery": [r"пекарн", r"хлебн\w* лавк", r"хлебопекарн"],
    "car_wash": [r"(?<![а-я])мойк", r"автомойк", r"мойку самообслуж", r"моечн"],
    "clothing_store": [r"одежд", r"бутик", r"шоурум"],
    "beauty_salon": [r"салон\w* красоты", r"бьюти", r"парикмахер", r"барбер", r"ногтев", r"маникюр", r"бьюти-салон"],
    "pickup_point": [r"(?<![а-я])пвз(?![а-я])", r"пункт\w* выдачи", r"выдачи заказов", r"wildberries|ozon|вайлдберриз|озон", r"маркетплейс"],
}
# Слова, по которым ловим опечатки в названии сферы («кофейии», «пекраню»).
SPHERE_WORDS = {
    "coffee": ["кофейня", "кофейню", "кофейни", "кофейне", "кофейней", "кофейный", "кофейного", "кофейном"],
    "bakery": ["пекарня", "пекарню", "пекарни", "пекарне", "пекарней", "мини-пекарня", "мини-пекарню", "мини-пекарни", "мини-пекарне"],
    "car_wash": ["автомойка", "автомойку", "автомойки", "автомойке", "автомойкой"],
    "clothing_store": ["одежды", "одежда"],
    "beauty_salon": ["парикмахерская", "парикмахерскую", "парикмахерской", "барбершоп", "барбершопа", "барбершопе", "красоты"],
    "pickup_point": ["выдачи"],
}
# Бизнес не из шаблонов -> ближайший шаблон (правило 2 /ai/consult) и other для /ai/parse-need.
SPHERE_NEAREST = [
    (r"кальян", "coffee"), (r"шаурм", "coffee"), (r"суши", "coffee"), (r"столов(ая|ую|ой)", "coffee"), (r"(?<![а-я])кафе(?![а-я-])", "coffee"),
    (r"ресторан", "coffee"), (r"бургер", "coffee"), (r"пиццер", "coffee"), (r"чайн(ая|ую)", "coffee"),
    (r"кондитерск", "bakery"), (r"выпечк", "bakery"), (r"шиномонтаж", "car_wash"), (r"автосервис", "car_wash"), (r"детейлинг", "car_wash"),
    (r"автомастерск", "car_wash"), (r"(?<![а-я])сто(?![а-я])", "car_wash"), (r"обувн", "clothing_store"), (r"сумок|сумки", "clothing_store"),
    (r"секонд", "clothing_store"), (r"аксессуар", "clothing_store"), (r"массаж", "beauty_salon"), (r"тату", "beauty_salon"),
    (r"загар|солярий", "beauty_salon"), (r"косметолог", "beauty_salon"), (r"(?<![а-я])спа(?![а-я])", "beauty_salon"),
    (r"склад", "pickup_point"), (r"постамат", "pickup_point"), (r"курьер", "pickup_point"),
]
# Бизнес явно назван, но ни на один шаблон не похож.
OTHER_BUSINESS = r"стоматолог|клиник|ферм|автошкол|юридическ|фитнес|ветклиник|ветеринар|строител|бригад|мебел|производств|" \
                 r"it-|айти|онлайн-школ|онлайн школ|школ|агентств|студи[юяи]|цвет|аптек|гостиниц|хостел|типограф|ателье|" \
                 r"автосервис|шиномонтаж"


NEGATED_BEFORE = re.compile(r"(?<![а-я])(не|нет,? не)(\s+(хочу|надо|нужн\w*|буду|будет|планирую))?\s*$")


def sphere_mentions(text: str) -> list:
    """[(позиция, сфера, с отрицанием?)] по порядку: «не кофейня, а пекарня» -> кофейня с отрицанием, пекарня без."""
    t = norm(text)
    out = []
    for code, rxs in SPHERE_DIRECT.items():
        for rx in rxs:
            for m in re.finditer(rx, t):
                before = re.sub(r".*[,.;!?\n]", "", t[max(0, m.start() - 25):m.start()])
                out.append((m.start(), code, bool(NEGATED_BEFORE.search(before))))
    return sorted(out)


def sphere_negated(text: str) -> bool:
    """Есть сфера с отрицанием и другая без него: это поправка сферы («нет, не кофейню, пекарню»)."""
    m = sphere_mentions(text)
    neg = {c for _, c, n in m if n}
    return bool(neg) and any(not n and c not in neg for _, c, n in m)


def sphere_direct(text: str):
    t = norm(text)
    mentions = sphere_mentions(t)
    if mentions:
        positive = [c for _, c, n in mentions if not n]
        return (positive[-1] if positive else None), False
    for w in re.findall(r"[а-я-]{6,}", t):
        for code, words in SPHERE_WORDS.items():
            if any(edit_distance_le1(w, x) for x in words if len(x) >= 6):
                return code, True
    return None, False


def sphere_nearest(text: str):
    t = norm(text)
    return next((code for rx, code in SPHERE_NEAREST if re.search(rx, t)), None)


OPEN_INTENT = re.compile(r"(открыть|открою|открытие|запустить|запуск|завести|начать|создать|организовать|мечтаю о|думаю про|"
                         r"подумываю про|идея[ :—-]+)\s+([а-яa-z0-9-]+(?:\s+[а-яa-z0-9-]+){0,2})")
GENERIC_OBJECT = {"свой", "свое", "своё", "бизнес", "дело", "что-то", "что-нибудь", "чтото", "точку", "компанию", "ип", "ооо",
                  "новое", "новый", "его", "это", "собственный", "собственное", "с", "чего", "в", "что", "какой", "какое", "себе"}


def unknown_business(text: str) -> bool:
    """Человек назвал конкретный бизнес, но он не из шаблонов и не похож на них."""
    t = norm(text)
    if re.search(OTHER_BUSINESS, t):
        return True
    for m in OPEN_INTENT.finditer(t):
        first = m.group(2).split()[0]
        if first not in GENERIC_OBJECT and not first.isdigit():
            return True
    return False


# ---------- Ответы анкеты ----------

# id вопроса -> (что стоит после числа, что стоит перед числом)
ANSWER_CUES = {
    "area_m2": (r"(м²|м2|кв\.?\s?м|квадрат\w*|метр\w*|кв(?![а-я]))", r"(площад\w*|метров|помещени\w* на)"),
    "customers_per_day": (r"(человек\w*|гост\w*|клиент\w*|покупател\w*|посетител\w*)", r"(поток\w*|гостей|клиентов|покупателей)"),
    "cars_per_day": (r"(машин\w*|автомобил\w*)", r"(машин\w*)"),
    "orders_per_day": (r"(заказ\w*)\s+(в|за)\s+день", r"(заказов)"),
    "avg_check_rub": (r"(руб\w*|₽|р\.)?\s*средн\w* чек", r"(чек\w*)"),
    "fee_per_order_rub": (r"(руб\w*|₽)?\s*(с|за) (одного )?заказ", r"(с|за) (одного )?заказа|доход\w*"),
    "staff": (r"(сотрудник\w*|продавц\w*|работник\w*|мастер\w*|человек в штате)", r"(штате|сотрудник\w*|продавц\w*|работать будут)"),
    "posts": (r"(пост\w*)", r"(постов)"),
    "work_places": (r"(рабоч\w* мест\w*|кресл\w*|мест(?![а-я]))", r"(рабочих мест|кресел)"),
}
QA_KEYS = {"format": r"формат", "area_m2": r"площад", "avg_check_rub": r"чек", "staff": r"сотрудник|продавц|штат",
           "posts": r"пост", "cars_per_day": r"машин", "work_places": r"рабоч\w* мест|кресл", "orders_per_day": r"заказ\w* в день|заказов",
           "fee_per_order_rub": r"доход|с одного заказа|с заказа", "customers_per_day": r"гост|покупател|клиент|человек"}
FORMAT_CUES = {"to_go": r"с собой|навынос|на вынос|без посадки|островок|окно",
               "cafe": r"посадк|с залом|зал(?![а-я])|столик|мест\w* для гостей|кафе с|кафе-кофейн"}
DONT_KNOW = re.compile(r"не знаю|не решил|затрудня|пока нет|посчитайте сами|по умолчанию|хз|без понятия|пропущ|не важно")


def _question(sphere: str, qid: str):
    return next((q for q in templates()[sphere]["questions"] if q["id"] == qid), None)


def _in_range(q, value):
    return q["min"] <= value <= q["max"]


def _choice(sphere: str, text: str):
    q = _question(sphere, "format")
    if not q:
        return None
    t = norm(text)
    for o in q["options"]:
        if norm(o["label"]) in t:
            return o["value"]
    hits = [v for v, rx in FORMAT_CUES.items() if re.search(rx, t)]
    return hits[0] if len(hits) == 1 else None


def _number(text: str):
    nums = numbers_in(text)
    return int(nums[0][0]) if nums else None


def template_answers(sphere: str, text: str, asked=()) -> dict:
    """Ответы анкеты шаблона sphere из текста. Чего нет или вне min–max — не заполняем (правило 3)."""
    if sphere not in templates():
        return {}
    qs = {q["id"]: q for q in templates()[sphere]["questions"]}
    out = {}
    # 1) «Вопрос? Ответ» построчно, как шлёт фронт.
    free_lines = []
    for line in text.split("\n"):
        if "?" in line:
            head, ans = line.split("?", 1)
            h = norm(head)
            qid = next((k for k, rx in QA_KEYS.items() if k in qs and re.search(rx, h)), None)
            if qid and ans.strip():
                if DONT_KNOW.search(norm(ans)):
                    continue
                q = qs[qid]
                if q["kind"] == "choice":
                    v = _choice(sphere, ans)
                else:
                    v = _number(ans)
                    v = v if v is not None and _in_range(q, v) else None
                if v is not None:
                    out[qid] = v
                continue
        free_lines.append(line)
    # 2) Свободный текст: число и подсказка рядом с ним.
    free = norm(" ".join(free_lines))
    if "format" in qs and "format" not in out:
        v = _choice(sphere, free)
        if v:
            out["format"] = v
    money_spans = [(s, e) for v, s, e, k in amounts(free) if v >= 1000]
    per_day = [k for k in ("customers_per_day", "cars_per_day", "orders_per_day") if k in qs]
    for value, start, end in numbers_in(free):
        right, left = free[end:end + 28], free[max(0, start - 28):start]
        before = re.sub(r".*[,.;:!?]", "", left)  # только своё предложение
        qid = "staff" if "staff" in qs and re.search(r"(работать будут|в штате|штат)\s*$", before) else None
        for k, (after_rx, before_rx) in ANSWER_CUES.items():
            if qid:
                break
            if k in qs and re.match(r"\s*" + after_rx, right):
                qid = k
                break
        if qid is None:
            for k, (after_rx, before_rx) in ANSWER_CUES.items():
                if k in qs and re.search(before_rx + r"[^,.;\d]{0,14}$", before):
                    qid = k
                    break
        if qid is None and re.match(r"\s*(в|за) день", right) and len(per_day) == 1:
            qid = per_day[0]
        if qid is None or qid in out:
            continue
        if any(s <= start < e for s, e in money_spans) and qid not in ("avg_check_rub", "fee_per_order_rub"):
            continue
        q = qs[qid]
        if _in_range(q, int(value)):
            out[qid] = int(value)
    return out


# ---------- Деньги ----------

FUNDS_CUE = re.compile(r"(есть|свои\w*|своих|накоп\w*|отлож\w*|вложить|вложу|бюджет\w*|готов\w*|имеется|капитал\w*|собрал\w*|"
                       r"сбережен\w*|деньг\w*|на руках)")
_MONEY = r"(своих\s+|собственных\s+|личных\s+)?(денег|средств|накоплений|сбережений|вложений)"
_NO = r"(нет|нету|ноль|0(?![\d,.]))"  # не «своих 0,5 млн»
# Отрицание рядом со словом про деньги: «денег пока нет», «пока нет денег», «своих средств нет», «без денег», «нет своих».
ZERO_FUNDS = re.compile(rf"(?<![а-я0-9]){_NO}\s+(у меня\s+|пока\s+|совсем\s+|сейчас\s+|ещё\s+|еще\s+)*{_MONEY}(?![а-я])|"
                        rf"(?<![а-я]){_MONEY}(\s+(у меня|пока|совсем|сейчас|ещё|еще|своих|никаких))*\s+{_NO}(?![а-я])|"
                        r"(?<![а-я])(нет|нету)\s+[а-я]+\s+и\s+(своих\s+)?(денег|средств|накоплений)(?![а-я])|"  # «нет опыта и денег»
                        r"(?<![а-я])без\s+(своих\s+|собственных\s+|личных\s+)?(денег|средств|накоплений|сбережений)(?![а-я])|"
                        rf"своих (денег |вложений |средств )?(пока |совсем )?{_NO}|без своих|"
                        r"(?<![а-я])(нет|нету)\s+(у меня\s+|пока\s+)*своих(?![а-я])(?!\s+[а-я]{3,})|"  # не «нет своих сотрудников»
                        r"только кредит|ни копейки|ни рубля|вс[её] в кредит|полностью в кредит|целиком в кредит|денег своих нет")
# «Ничего нет», «ноль» — ноль своих денег, только если в сообщении есть слова про деньги или это ответ на вопрос о них:
# «опыта ноль» — не про деньги.
ZERO_IF_MONEY = re.compile(r"ничего нет|(?<![а-я0-9])ноль(?![а-я])|нисколько")
MONEY_CONTEXT = re.compile(r"деньг|денег|средств|накоплен|сбережен|(?<![а-я])сво(и|их)(?![а-я])|сумм|бюджет|капитал")


def zero_funds(text: str, asked: bool = False) -> bool:
    """«Своих денег нет» в любой из форм. «Ничего нет» и «ноль» — только в одной части фразы со словом про деньги
    или в ответ на вопрос о своих деньгах, и не про опыт. Просто «нет» здесь не ноль: его понимает own_funds,
    только если спрашивали про деньги."""
    if ZERO_FUNDS.search(text):
        return True
    for clause in re.split(r"[,.;!?\n]", text):
        if ZERO_IF_MONEY.search(clause) and (MONEY_CONTEXT.search(clause) or asked) and "опыт" not in clause:
            return True
    return False
FUNDS_AFTER = re.compile(r"[а-я]*\.?\s*(свои(?!ми)|своих|собственн\w*|личн\w*)(?![а-я])")  # «300 тыс|яч своих»
NOT_FUNDS_CUE = re.compile(r"чек|с заказа|доход|выручк|аренд|стоит|зарплат|кредит на|нужно|нужен|надо|сумма кредита")


def own_funds(text: str, asked: bool = False):
    """Свои деньги из текста. asked — консультант только что спросил про свои деньги."""
    t = norm(text)
    lines = t.split("\n")
    for line in lines:  # ответ в строке «Сколько своих денег...? ответ»
        if "?" in line and re.search(r"своих денег|свои деньги|вложить", line.split("?")[0]):
            ans = line.split("?", 1)[1]
            got = [a for a in amounts(ans) if a[0] >= 1000]
            if got:
                return got[0][0]
            if zero_funds(ans, asked=True) or re.fullmatch(r"\s*(нет|0|ноль)[ .!,]*(только кредит)?\s*", ans):
                return 0
    if zero_funds(t, asked):
        return 0
    for value, start, end, kind in amounts(t):
        if value < 1000 or re.search(r"(?<![а-я])не\s*$", t[max(0, start - 4):start]):
            continue  # «своих не миллион, а 800 тысяч»: сумма с «не» — это то, что поправляют
        if FUNDS_AFTER.match(t[end:end + 15]) and not NOT_FUNDS_CUE.search(re.sub(r".*[,.;!?\n]", "", t[max(0, start - 30):start])):
            return value  # «300 тысяч свои», «3 млн своих»
        before = t[max(0, start - 30):start]
        before = re.sub(r".*[.;!?\n]", "", before)
        clause = re.sub(r".*,", "", before)  # запрет — только в своей части фразы («чек 1010 ₽, своих 3 млн»)
        if NOT_FUNDS_CUE.search(clause):
            continue
        if FUNDS_CUE.search(before) or asked:
            return value
    if asked and any(re.fullmatch(r"(нет|нету|0|ноль|нисколько|ничего)( только кредит)?", seg.strip(" .!»«")) for seg in re.split(r"[,\n;]", t)):
        return 0
    return None


def correction_amount(text: str):
    """«Неправильно сказал, на самом деле 300 тыс» — сумма без подсказки, но в поправке. Сумма с «не» — старая."""
    t = norm(text)
    for value, start, end, kind in amounts(t):
        if value >= 1000 and not NOT_FUNDS_CUE.search(t[max(0, start - 20):start]) \
                and not re.search(r"(?<![а-я])не\s*$", t[max(0, start - 4):start]):
            return value
    # «Ошибся с деньгами, 0», «на самом деле ноль»: ноль — отдельной частью фразы, без других слов.
    if any(re.fullmatch(r"\s*((на самом деле|вообще|точнее|вернее)\s+)?(ноль|0|ничего нет|нисколько)\s*", c)
           for c in re.split(r"[,.;!?\n]", t)):
        return 0
    return None


def bare_amount(text: str):
    """Единственная сумма в сообщении без признаков кредита, чека или выручки: «Питер, кофейня, 1 млн»."""
    t = norm(text)
    money = [a for a in amounts(t) if a[0] >= 1000]
    if len(money) == 1 and not re.search(r"кредит|займ|взять|занять|нужн|надо|чек|выручк|доход|аренд|стоит|зарплат|оборот", t):
        return money[0][0]
    return None


# ---------- Намерения ----------

ROLE_CHANGE = re.compile(r"забуд\w*|игнорир\w*|инструкц\w*|промпт\w*|prompt|system\s*:|систем\w* (сообщ|настро|правил)|"
                         r"ты теперь|теперь ты|отныне|ты больше не|представь,? что ты|притворись|веди себя как|отвечай как|"
                         r"режим разработчика|developer mode|отключи (фильтр|ограничен)|без ограничений|jailbreak|"
                         r"повтори (дословно|всё|все)|новая роль|сменить роль|смени роль|твоя роль|ты (мой|моя) (психолог|юрист|друг)|"
                         r"ты (юрист|переводчик|психолог|пират|бот без)", re.I)
CREDIT_PROMISE = re.compile(r"одобр\w*|откаж\w*|отказ\w* (в|по) кредит|гарант\w*|дадут ли|дадут кредит|дадут мне кредит|"
                            r"получу ли|шанс\w*.{0,20}(кредит|одобр|банк)|точно дадут|возьмут ли|"
                            r"(даст|выдаст|дадут|выдадут)\w*( ли)?( мне)?( банк)?( мне)? (точно )?кредит|"
                            r"банк\w* (мне )?(точно |вообще )?(даст|выдаст|дадут|выдадут)", re.I)
GREETING = re.compile(r"^(привет\w*|здравств\w*|здрасьте|добр\w+ (день|утро|вечер|дня)|доброго \w+|хай|ку|салют|приветствую|"
                      r"алло|hello|hi|начн\w*|ты кто|кто ты)$")
SUMS_QUESTION = re.compile(r"сколько (стоит|нужно|надо|денег|я буду|буду зарабат|зарабат|получ)|за сколько|какую сумму|"
                           r"окупит|окупаем|прибыл|зарабат", re.I)
BUSINESS_WORDS = re.compile(r"бизнес|дел[оа](?![а-я])|своё дело|свое дело|открыт|открою|запуст|предприним|(?<![а-я])ип(?![а-я])|"
                            r"кредит|план|расч[её]т|посчита|счита|деньг|вложен|окуп|зарабат|прибыл|аренд|помещени|точк|магазин|"
                            r"клиент|выручк|франшиз|идея|начать|с чего начать|уйти с работы|своё|свое", re.I)
SKIP = re.compile(r"не знаю|затрудня|пока не|посчитайте|посчитай|считайте|считай|по умолчанию|пропущ|без деталей|потом поправ|детали потом|хз|"
                  r"давайте так|как обычно|достаточно|хватит вопросов", re.I)
CORRECTION = re.compile(r"(?<![а-я])не\s+[а-я-]+(\s+[а-я-]+)?,?\s+а\s|поправ\w*|ошиб\w*|передумал\w*|на самом деле|неправильн\w*|"
                        r"точнее|вернее|извините|другой|лучше|вс[её]-таки|исправ\w*|не так|не то", re.I)
YES = re.compile(r"^(да|ага|ок|окей|хорошо|подходит|давайте|считайте|согласен|согласна|верно|конечно|норм|пойд[её]т|можно)\b")
NO = re.compile(r"^(нет|не|неа|не подходит|другой|это не то)\b|не то|не подходит|другой бизнес")


GREETING_START = re.compile(r"^(привет\w*|здравств\w*|здрасьте|добр\w+|доброго|хай|ку|салют|приветствую|алло|hello|hi|начн\w*)(?![а-я])")


def is_greeting(text: str) -> bool:
    """Короткое приветствие без дела: «Привет», «Добрый день!», «Привет, ты кто?», «Начнём?»."""
    t = re.sub(r"\s+", " ", re.sub(r"[^а-яa-z ]", " ", norm(text))).strip()
    return bool(t) and len(t.split()) <= 4 and bool(GREETING.match(t) or GREETING_START.match(t))
