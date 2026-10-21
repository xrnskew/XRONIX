"""Снимок данных из контрактов для правиловой системы: python -m app.rules.build_data (из папки ai).

Образ ai собирается без contracts/ и frontend/, поэтому нужные справочники копируются в app/rules/data/.
Падежные формы городов считаются здесь один раз (pymorphy3 — только для сборки, в рантайме не нужен).
Тест tests/test_rules_data.py сверяет снимок с контрактами: если контракт поменялся — пересобрать.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CONTRACTS = ROOT / "contracts"
OUT = Path(__file__).resolve().parent / "data"


def _load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def contract_sources() -> dict:
    """То, что берём из контрактов как есть (тест сравнивает с этим)."""
    d = _load(CONTRACTS / "dictionaries.json")
    t = _load(CONTRACTS / "templates" / "spheres.v1.json")
    rules = _load(CONTRACTS / "rules" / "credit_rules.v1.json")
    demo = _load(CONTRACTS / "products.demo.json")
    return {
        "dictionaries": {"version": d["version"], "purposes": d["purposes"], "spheres": d["spheres"]},
        "templates": {"version": t["version"], "spheres": {k: {"title": v["title"], "questions": v["questions"]} for k, v in t["spheres"].items()}},
        "rules": {"version": rules["version"], "start": rules["start"],
                  "start_product": next(p for p in demo["products"] if p["id"] == "start")},
    }


def city_index() -> list:
    import pymorphy3
    morph = pymorphy3.MorphAnalyzer()
    cities = _load(ROOT / "frontend" / "src" / "data" / "cities.json")

    def inflect(word, case):
        for p in morph.parse(word):
            if "Geox" in p.tag.grammemes or p.tag.POS in ("NOUN", "ADJF"):
                inf = p.inflect({case})
                if inf:
                    return inf.word
        return None

    def word_forms(word, case):
        """Слово с дефисами: пробуем склонять последнюю часть («Южно-Сахалинске»), первую («Ростове-на-Дону»)
        и обе («Петропавловске-Камчатском»). Лишняя форма безвредна: она есть только у этого города."""
        if "-" not in word:
            f = inflect(word, case)
            return {f} if f else set()
        parts = word.split("-")
        out = set()
        last = inflect(parts[-1], case)
        if last:
            out.add("-".join(parts[:-1] + [last]))
        first = inflect(parts[0], case)
        if first:
            out.add("-".join([first] + parts[1:]))
            if last:
                out.add("-".join([first] + parts[1:-1] + [last]))
        return out

    def cased(src, word):
        """Регистр букв как в названии: «нижнем» -> «Нижнем»."""
        return word[:1].upper() + word[1:] if src[:1].isupper() else word

    def loct(word):
        """Предложный падеж слова в названии. Название стоит в именительном, поэтому берём разбор с nomn:
        «Воды» — множественное, «Водах», а не «Воде». Нет в словаре: «Ола» -> «Оле», «Мар» -> «Маре»."""
        low = word.lower()
        plural = low.endswith(("ы", "и", "ые", "ие"))  # «Набережные Челны», «Химки»; «Мар» — единственное
        parses = sorted((p for p in morph.parse(low) if ("plur" in p.tag.grammemes) == plural),
                        key=lambda p: "nomn" not in p.tag.grammemes)
        for p in parses:
            if "Geox" in p.tag.grammemes or p.tag.POS in ("NOUN", "ADJF"):
                inf = p.inflect({"loct"} | ({"plur"} if "plur" in p.tag.grammemes else set()))
                if inf:
                    return cased(word, inf.word)
        if low.endswith("а"):
            return cased(word, low[:-1] + "е")
        return cased(word, low + "е" if low[-1:] in "бвгджзклмнпрстфхцчшщ" else low)

    def loct_word(word):
        """Предложный падеж одного слова названия. Через дефис: «Ростов-на-Дону» — первая часть,
        «Петропавловск-Камчатский» — обе, остальное — последняя («Йошкар-Оле», «Южно-Сахалинске»)."""
        if "-" not in word:
            return loct(word)
        parts = word.split("-")
        if len(parts) > 2 and parts[1].lower() in ("на", "над", "под"):
            idx = [0]
        elif morph.parse(parts[-1].lower())[0].tag.POS == "ADJF":
            idx = [0, len(parts) - 1]
        else:
            idx = [len(parts) - 1]
        return "-".join(loct(p) if i in idx else p for i, p in enumerate(parts))

    def in_city(name):
        """«в Самаре», «во Владимире», «во Пскове», «в Нижнем Новгороде» — для подстановки {in_city}."""
        loc = " ".join(loct_word(w) for w in name.split())
        low = loc.lower()
        vo = (low[:1] in "вф" and len(low) > 1 and low[1] not in "аеёиоуыэюя") or low.startswith("пск")
        return ("во " if vo else "в ") + loc

    out = []
    for name, region, population in cities:
        low = name.lower().replace("ё", "е")
        forms = {low}
        for case in ("loct", "gent", "datv", "ablt"):
            variants = [word_forms(w.lower(), case) for w in name.split()]
            if all(variants):
                combos = [""]
                for v in variants:
                    combos = [f"{c} {x}".strip() for c in combos for x in sorted(v)]
                forms |= {c.replace("ё", "е") for c in combos[:6]}
        # Однословный небольшой город, совпадающий с обычным словом («Остров», «Бор», «Белый»),
        # принимаем только после «в/из/город» или как прямой ответ на вопрос о городе.
        # «Короча» -> «короче»: проверяем каждую форму, а не только именительный падеж.
        single = len(name.split()) == 1 and "-" not in name
        # Обычное слово из словаря («короче», «остров») или фамилия/имя («Пугачевой»). Незнакомое словарю слово
        # («Альметьевск») — точно название, предлог не нужен.
        def common(f):
            g = set(morph.parse(f)[0].tag.grammemes)
            return (morph.word_is_known(f) and "Geox" not in g) or bool({"Surn", "Name"} & g)
        common_word = any(common(f) for f in forms)
        needs_cue = single and population < 250_000 and (common_word or len(low) <= 4)
        out.append({"name": name, "population": population, "forms": sorted(forms), "needs_cue": needs_cue,
                    "in": in_city(name)})
    return out


def main():
    OUT.mkdir(exist_ok=True)
    src = contract_sources()
    for key, value in src.items():
        (OUT / f"{key}.json").write_text(json.dumps(value, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    cities = city_index()
    (OUT / "cities.json").write_text(json.dumps(cities, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Снимок: {OUT} — сфер {len(src['templates']['spheres'])}, целей {len(src['dictionaries']['purposes'])}, "
          f"городов {len(cities)} (с обязательным предлогом {sum(c['needs_cue'] for c in cities)})")


if __name__ == "__main__":
    main()
