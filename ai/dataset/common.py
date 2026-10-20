"""Общее для генераторов, проверки и оценки: контракты, схемы, города, суммы и опечатки.

Всё читается из контрактов репозитория (только чтение): справочники, шаблоны сфер, JSON Schema
и города фронта. Генерация детерминирована по seed.
"""
import hashlib
import json
import random
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
DATA_DIR = Path(__file__).resolve().parent / "data"
RESULTS_DIR = Path(__file__).resolve().parent / "results"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


DICTIONARIES = load_json(CONTRACTS / "dictionaries.json")
TEMPLATES = load_json(CONTRACTS / "templates" / "spheres.v1.json")["spheres"]
# [название, регион, население] — только чтение, файл фронта.
CITIES = load_json(ROOT / "frontend" / "src" / "data" / "cities.json")
CITY_NAMES = [c[0] for c in CITIES]

PURPOSES = list(DICTIONARIES["purposes"])           # 6 кодов
SPHERES_ALL = list(DICTIONARIES["spheres"])        # 6 шаблонных + other
TEMPLATE_SPHERES = list(TEMPLATES)                 # для /ai/consult: только шаблонные


# ---------- JSON Schema ----------

@lru_cache(maxsize=None)
def _registry():
    from referencing import Registry, Resource
    resources = []
    for f in sorted((CONTRACTS / "schemas").glob("*.schema.json")):
        schema = load_json(f)
        resources.append((schema["$id"], Resource.from_contents(schema)))
    return Registry().with_resources(resources)


@lru_cache(maxsize=None)
def validator(schema_file: str, definition: str):
    """validator("consult", "response") -> Draft7Validator для consult.schema.json#/definitions/response."""
    from jsonschema import Draft7Validator
    ref = f"https://xronix/schemas/{schema_file}.schema.json#/definitions/{definition}"
    return Draft7Validator({"$ref": ref}, registry=_registry())


def schema_errors(schema_file: str, definition: str, obj) -> list:
    return [f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message}"
            for e in validator(schema_file, definition).iter_errors(obj)]


# ---------- Разбиение train / holdout ----------

def stable_hash(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest()[:12], 16)


def split_cities(holdout_share: float = 0.15, shared_top: int = 20):
    """Крупнейшие города общие (без них диалоги неправдоподобны), остальные делятся по хешу названия.
    Города из holdout-части в train не попадают никогда."""
    by_pop = sorted(CITIES, key=lambda c: -c[2])
    shared = [c[0] for c in by_pop[:shared_top]]
    rest = [c[0] for c in by_pop[shared_top:]]
    hold = [n for n in rest if stable_hash("city:" + n) % 1000 < holdout_share * 1000]
    train = [n for n in rest if n not in set(hold)]
    return {"shared": shared, "train": train, "holdout": hold}


def pick_city(rng: random.Random, part: list, shared: list) -> str:
    """Половина — крупные города, половина — любые из своей части."""
    return rng.choice(shared) if rng.random() < 0.5 else rng.choice(part)


def bank_split(items) -> tuple:
    """Каждый пятый вариант банка формулировок — только для holdout: так видно, обобщает ли модель,
    а не запоминает фразы. Разбиение по хешу текста, не зависит от seed."""
    items = list(items)
    hold = [x for x in items if stable_hash("bank:" + json.dumps(x, ensure_ascii=False, sort_keys=True)) % 5 == 0]
    if not hold or len(hold) == len(items):
        hold = items[-1:]
    train = [x for x in items if x not in hold]
    return train, hold


class Picker:
    """Выбор из банка формулировок с учётом части. В holdout половина выборов — из незнакомых модели фраз."""

    def __init__(self, part: str):
        self.part, self.unseen = part, False

    def pick(self, rng: random.Random, items):
        train, hold = bank_split(items)
        if self.part == "holdout" and rng.random() < 0.5:
            self.unseen = True
            return rng.choice(hold)
        return rng.choice(train)


# ---------- Падежи городов ----------

@lru_cache(maxsize=1)
def _morph():
    import pymorphy3
    return pymorphy3.MorphAnalyzer()


def _inflect_word(word: str, case: str):
    parsed = _morph().parse(word)
    for p in parsed:
        if {"Geox"} & set(p.tag.grammemes) or p.tag.POS in ("NOUN", "ADJF"):
            inf = p.inflect({case})
            if inf:
                return inf.word
    return None


def _keep_case(src: str, dst: str) -> str:
    return dst[:1].upper() + dst[1:] if src[:1].isupper() else dst


@lru_cache(maxsize=None)
def city_case(name: str, case: str):
    """«Казань» + loct -> «Казани». Названия через дефис и всё, что не склоняется надёжно, -> None."""
    if "-" in name:
        return None
    out = []
    for w in name.split():
        inf = _inflect_word(w, case)
        if not inf:
            return None
        out.append(_keep_case(w, inf))
    return " ".join(out)


def city_phrase(name: str, rng: random.Random, kind: str = "in") -> str:
    """Как человек называет город в тексте. kind: in (в Казани), from (из Казани), plain (Казань)."""
    if kind == "plain":
        return rng.choice([name, f"город {name}", f"г. {name}"])
    case = "loct" if kind == "in" else "gent"
    prep = "в" if kind == "in" else "из"
    form = city_case(name, case)
    if form and rng.random() < 0.85:
        if prep == "в" and form[:1].lower() in "вф" and form[1:2].lower() not in "аеёиоуыэюя":
            prep = "во"
        return f"{prep} {form}"
    return f"{prep} городе {name}" if kind == "in" else f"{prep} города {name}"


# ---------- Суммы и сроки ----------

def _n2w(n: int) -> str:
    from num2words import num2words
    return num2words(n, lang="ru")


def _tys(k: int) -> str:
    return "тысяч" if 11 <= k % 100 <= 14 else {1: "тысяча", 2: "тысячи", 3: "тысячи", 4: "тысячи"}.get(k % 10, "тысяч")


def _thousands_words(k: int) -> str:
    """350 -> «триста пятьдесят тысяч» (с правильной формой «тысяча/тысячи»)."""
    words = _n2w(k)
    words = re.sub(r"(^|\s)один$", r"\1одна", words)
    words = re.sub(r"(^|\s)два$", r"\1две", words)
    return f"{words} {_tys(k)}"


def amount_text(n: int, rng: random.Random):
    """Человеческая запись суммы. Возвращает (текст, вид): digits | short | words | slang."""
    variants = [("digits", f"{n}"), ("digits", f"{n:,}".replace(",", " ")), ("digits", f"{n:,}".replace(",", " ") + " ₽"),
                ("digits", f"{n} рублей")]
    if n % 1000 == 0 and n < 1_000_000:
        k = n // 1000
        variants += [("short", f"{k}к"), ("short", f"{k} тыс"), ("short", f"{k} тыс."), ("short", f"{k} {_tys(k)}"),
                     ("words", _thousands_words(k))]
        if k == 500:
            variants += [("slang", "полмиллиона"), ("slang", "пол-ляма"), ("slang", "пол ляма")]
    if n >= 1_000_000 and n % 100_000 == 0:
        m = n / 1_000_000
        ms = f"{m:g}"
        mil = "миллион" if m == 1 else "миллиона" if m != int(m) or 2 <= m <= 4 else "миллионов"
        variants += [("short", f"{ms} млн"), ("short", f"{ms.replace('.', ',')} млн"), ("short", f"{ms.replace('.', ',')} {mil}")]
        if m == 1:
            variants += [("words", "миллион"), ("slang", "лям"), ("slang", "один лям")]
        elif m == 1.5:
            variants += [("words", "полтора миллиона"), ("slang", "полтора ляма")]
        elif m == int(m) and m <= 10:
            mw = {2: "два миллиона", 3: "три миллиона", 4: "четыре миллиона", 5: "пять миллионов", 6: "шесть миллионов",
                  7: "семь миллионов", 8: "восемь миллионов", 9: "девять миллионов", 10: "десять миллионов"}[int(m)]
            variants += [("words", mw), ("slang", mw.split()[0] + " ляма" if m < 5 else mw.split()[0] + " лямов")]
        elif m < 10 and n % 1_000_000 != 0:
            whole, rest_k = int(m), (n % 1_000_000) // 1000
            head = {1: "миллион", 2: "два миллиона", 3: "три миллиона", 4: "четыре миллиона", 5: "пять миллионов",
                    6: "шесть миллионов", 7: "семь миллионов", 8: "восемь миллионов", 9: "девять миллионов"}[whole]
            variants += [("words", f"{head} {_thousands_words(rest_k)}")]
    kind, text = rng.choice(variants)
    return text, kind


def term_text(months: int, rng: random.Random) -> str:
    years = {12: ["год", "один год", "12 месяцев"], 18: ["полтора года", "18 месяцев"], 24: ["два года", "2 года", "24 месяца"],
             36: ["три года", "3 года", "36 месяцев"], 48: ["четыре года", "4 года"], 60: ["пять лет", "5 лет", "60 месяцев"],
             6: ["полгода", "6 месяцев", "шесть месяцев"], 84: ["семь лет", "7 лет"], 120: ["десять лет", "10 лет"]}
    if months in years:
        return rng.choice(years[months])
    return rng.choice([f"{months} месяцев" if months % 10 not in (1, 2, 3, 4) or 11 <= months % 100 <= 14 else
                       (f"{months} месяц" if months % 10 == 1 else f"{months} месяца"), f"{months} мес"])


def small_number_text(n: int, rng: random.Random) -> str:
    return _n2w(n) if n <= 100 and rng.random() < 0.3 else str(n)


# ---------- Опечатки и разговорный стиль ----------

_RU = "абвгдежзийклмнопрстуфхцчшщъыьэюя"


def typo_word(word: str, rng: random.Random) -> str:
    if len(word) < 4 or not re.fullmatch(r"[А-Яа-яЁё]+", word):
        return word
    i = rng.randrange(1, len(word) - 1)
    op = rng.choice(["swap", "drop", "double", "replace"])
    if op == "swap":
        return word[:i] + word[i + 1] + word[i] + word[i + 2:]
    if op == "drop":
        return word[:i] + word[i + 1:]
    if op == "double":
        return word[:i] + word[i] + word[i:]
    return word[:i] + rng.choice(_RU) + word[i + 1:]


def add_typos(text: str, rng: random.Random, n: int, protect: tuple = ()) -> str:
    """n опечаток в случайных словах. Слова из protect (суммы, сроки) не трогаем: иначе меняется смысл."""
    words = text.split(" ")
    idx = [i for i, w in enumerate(words) if len(w) >= 4 and re.fullmatch(r"[А-Яа-яЁё]+[,.!?]?", w)
           and not any(p and p in w for p in protect)]
    for i in rng.sample(idx, min(n, len(idx))):
        w = words[i]
        tail = w[-1] if w[-1] in ",.!?" else ""
        words[i] = typo_word(w.rstrip(",.!?"), rng) + tail
    return " ".join(words)


def casual(text: str, rng: random.Random) -> str:
    """Разговорный вид: без заглавных, без точки в конце, иногда «ё» -> «е»."""
    r = rng.random()
    if r < 0.35:
        text = text[:1].lower() + text[1:]
    if rng.random() < 0.4:
        text = text.rstrip(".")
    if rng.random() < 0.5:
        text = text.replace("ё", "е")
    return text
