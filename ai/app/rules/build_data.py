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
        out.append({"name": name, "population": population, "forms": sorted(forms), "needs_cue": needs_cue})
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
