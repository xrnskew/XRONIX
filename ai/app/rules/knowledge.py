"""База фактов о городах и банк фраз для /ai/consult (contracts/ai.md, раздел «База знаний и банк фраз»).

Файлы data/knowledge.cities.json и data/phrases.json собираются при разработке (ai/knowledge/) и лежат в образе.
Во время работы сервис в сеть не ходит. Нет файла, слота или факта — берётся запасной текст без цифр.

Вариант фразы выбирается детерминированно: хеш слота, ключа диалога (первое сообщение человека) и номера реплики.
Один и тот же диалог всегда получает те же формулировки. Id чата в запросе нет, поэтому чаты с одинаковым первым
сообщением звучат одинаково, а начатые по-разному — по-разному.
"""
import hashlib
import re
from functools import lru_cache
from pathlib import Path

DEFAULT_DATA = Path(__file__).resolve().parent / "data"
DATA = DEFAULT_DATA
SPHERE_NOMN = {"coffee": "кофейня", "bakery": "пекарня", "car_wash": "автомойка", "clothing_store": "магазин одежды",
               "beauty_salon": "салон красоты", "pickup_point": "пункт выдачи заказов"}
SPHERE_MANY = {"coffee": "кофеен", "bakery": "пекарен", "car_wash": "автомоек", "clothing_store": "магазинов одежды",
               "beauty_salon": "салонов красоты и парикмахерских", "pickup_point": "пунктов выдачи заказов"}
# {source} стоит после «по данным»: нужен родительный падеж названия источника.
SOURCE_GENT = {"Росстат": "Росстата", "справочник городов России": "справочника городов России"}
MIN_VENUES = 10  # меньше — в OSM почти наверняка не всё, число не называем
MAX_TEXT = 600
# Признак проходимости (поле footfall базы), который важен сфере, и порог, ниже которого число не называем.
# Новые факты идут через подстановки контракта: числа — {venues} («около 80»), суммы — {salary} («59 000 ₽»).
PLACE_FOR = {"clothing_store": "malls", "beauty_salon": "malls", "coffee": "universities", "bakery": "business_centers"}
PLACE_MIN = {"malls": 5, "universities": 5, "business_centers": 10}


def _load(name: str):
    import json
    path = DATA / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


@lru_cache(maxsize=1)
def cities() -> dict:
    kb = _load("knowledge.cities.json")
    if not kb:
        return {}
    sources = {s["id"]: s for s in kb["sources"]}
    return {c["name"]: (c, sources) for c in kb["cities"]}


@lru_cache(maxsize=1)
def bank() -> dict:
    ph = _load("phrases.json")
    return ph["slots"] if ph else {}


@lru_cache(maxsize=1)
def city_in() -> dict:
    import json
    rows = json.loads((DEFAULT_DATA / "cities.json").read_text(encoding="utf-8"))
    return {c["name"]: c.get("in") for c in rows}


def use(data_dir=None) -> None:
    """Для тестов: брать базу и банк фраз из другой папки (None — обычная data/)."""
    global DATA
    DATA = Path(data_dir) if data_dir else DEFAULT_DATA
    cities.cache_clear()
    bank.cache_clear()


def variants(slot: str) -> list:
    return list(bank().get(slot, {}).get("variants", []))


# ---------- значения подстановок ----------

def venues_text(n: int) -> str:
    step = 5 if n < 100 else 10 if n < 1000 else 100
    return f"около {max(step, round(n / step) * step)}"


def rub(n: int) -> str:
    return f"{n:,}".replace(",", " ") + " ₽"


def salary_value(fact: dict) -> int:
    """Зарплату называем с точностью до тысячи: «около 79 000 ₽». Это же число оценщик считает разрешённым."""
    return int(round(fact["value"], -3))


def values(state: dict) -> dict:
    """Подстановки, которые сейчас можно разрешить. Факта нет в базе — подстановки нет, фраза с ней не берётся."""
    out = {}
    sphere, city = state.get("sphere"), state.get("city")
    if city:
        out["city"] = city
        if city_in().get(city):
            out["in_city"] = city_in()[city]
    if sphere in SPHERE_NOMN:
        out["sphere"], out["sphere_many"] = SPHERE_NOMN[sphere], SPHERE_MANY[sphere]
    if state.get("own_funds_rub"):
        out["own_funds"] = rub(state["own_funds_rub"])
    return out


def fact_values(state: dict, fact: str) -> dict:
    """Значения для фразы с фактом: {venues} или {salary} и их {source}. Пусто, если факта нет."""
    city, sphere = state.get("city"), state.get("sphere")
    if city not in cities():
        return {}
    c, sources = cities()[city]
    if fact == "venues":
        f = (c.get("venues") or {}).get(sphere)
        if not f or f["value"] < MIN_VENUES:
            return {}
        return {"venues": venues_text(f["value"]), "source": _source(sources, f)}
    if fact == "salary" and c.get("avg_salary_rub"):
        f = c["avg_salary_rub"]
        return {"salary": rub(salary_value(f)), "source": _source(sources, f)}
    if fact == "registered":
        f = (c.get("registered_businesses") or {}).get(sphere)
        if not f or f["value"] < MIN_VENUES:
            return {}
        return {"venues": venues_text(f["value"]), "source": _source(sources, f)}
    if fact == "places":
        kind = PLACE_FOR.get(sphere)
        f = (c.get("footfall") or {}).get(kind) if kind else None
        if not f or f["value"] < PLACE_MIN[kind]:
            return {}
        return {"venues": venues_text(f["value"]), "source": _source(sources, f), "_kind": kind}
    if fact in ("income", "retail"):
        f = c.get({"income": "income_per_capita_rub", "retail": "retail_turnover_per_capita_rub"}[fact])
        return {"salary": rub(salary_value(f)), "source": _source(sources, f)} if f else {}
    return {}


def _source(sources: dict, fact: dict) -> str:
    title = sources[fact["source"]]["title"]
    return SOURCE_GENT.get(title, title)


def allowed_amounts(city) -> set:
    """Числа из базы, которые сервис может назвать для этого города (для оценщика «придуманных сумм»): зарплата
    с точностью до тысячи и округлённое число заведений — «около 2000 кофеен» оценщик тоже читает как сумму."""
    if city not in cities():
        return set()
    c, _ = cities()[city]
    money = [c.get(k) for k in ("avg_salary_rub", "income_per_capita_rub", "retail_turnover_per_capita_rub")]
    out = {salary_value(f) for f in money if f}
    counts = [*(c.get("venues") or {}).values(), *(c.get("registered_businesses") or {}).values(),
              *(c.get("footfall") or {}).values()]
    out |= {int(venues_text(f["value"]).split()[-1]) for f in counts if f["value"] >= min(MIN_VENUES, *PLACE_MIN.values())}
    return out


# ---------- выбор и подстановка ----------

PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


def choice(slot: str, key: str, turn: int, n: int) -> int:
    """Детерминированный выбор одного из n: одинаковый для одного диалога и реплики, разный для разных."""
    h = hashlib.sha256(f"{slot}|{key}|{turn}".encode("utf-8")).hexdigest()
    return int(h[:12], 16) % n


def phrase(slot: str, key: str, turn: int, vals: dict, fallback: str | None = None) -> str | None:
    """Вариант слота, у которого разрешаются все подстановки. Иначе — fallback (текст без цифр)."""
    usable = [v for v in variants(slot) if set(PLACEHOLDER.findall(v)) <= set(vals)]
    if not usable:
        return fallback
    return render(usable[choice(slot, key, turn, len(usable))], vals)


def render(text: str, vals: dict) -> str:
    out = PLACEHOLDER.sub(lambda m: str(vals[m.group(1)]), text)
    out = re.sub(r"\b(около|примерно)\s+около\b", "около", out)  # на случай «около {venues}» в старых фразах
    out = re.sub(r"\s+([,.!?:;])", r"\1", re.sub(r"\s+", " ", out)).strip()
    return capitalize(out)


def capitalize(text: str) -> str:
    """Заглавная буква в начале и после конца предложения: фраза может начинаться с «{in_city} …»."""
    return re.sub(r"(^|[.!?]\s+)([а-яёa-z])", lambda m: m.group(1) + m.group(2).upper(), text)


def join(parts: list, limit: int = MAX_TEXT) -> str:
    """Склеить куски ответа по порядку важности, пока влезает в limit символов."""
    out = ""
    for p in parts:
        if not p:
            continue
        cand = f"{out} {p}".strip()
        if len(cand) <= limit:
            out = cand
    return out


def dialog_key(history: list, message: str) -> str:
    first = next((h["content"] for h in history if h["role"] == "user"), message)
    return first.strip().lower()


def said_competition(history: list) -> bool:
    """Факт о конкуренции — один раз за диалог: он всегда со ссылкой на OpenStreetMap."""
    return any("OpenStreetMap" in h["content"] for h in history if h["role"] == "assistant")


def said_registered(history: list) -> bool:
    """Факт о зарегистрированных бизнесах — один раз за диалог: он всегда со ссылкой на ФНС."""
    return any("ФНС" in h["content"] for h in history if h["role"] == "assistant")
