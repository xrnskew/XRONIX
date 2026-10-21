"""Сборка базы фактов о городах одной командой (раунд 3, A1).

    python -m knowledge.build              # из папки ai: Росстат + OSM (дособирает, чего нет в кеше) -> файл базы
    python -m knowledge.build --offline    # только из knowledge/raw, без сети: тот же файл байт в байт

Результат — app/rules/data/knowledge.cities.json по contracts/schemas/knowledge.schema.json#/definitions/cities_file.
Факты только из источников: население — справочник городов (arbaev/russia-cities), зарплата — Росстат,
число заведений — OpenStreetMap. Языковая модель здесь не участвует.
"""
import argparse
import sys

from . import collect_osm, collect_rosstat
from .common import DATA_DIR, FRONT_CITIES, RAW_DIR, load_json, save_json, target_cities

OUT = DATA_DIR / "knowledge.cities.json"
POPULATION_YEAR = 2023
POPULATION_RETRIEVED = "2026-10-19"  # когда справочник городов взят в frontend/src/data/cities.json
# Сферы из тегов OSM (collect_osm.TAGS). Постаматы считаются отдельно и в «пункты выдачи» не входят.
SPHERES = {
    "coffee": ["cafe_coffee_shop", "shop_coffee"],
    "bakery": ["shop_bakery"],
    "car_wash": ["amenity_car_wash"],
    "clothing_store": ["shop_clothes"],
    "beauty_salon": ["shop_beauty", "shop_hairdresser"],
    "pickup_point": ["shop_outpost"],
}


def assemble() -> dict:
    sal = load_json(collect_rosstat.OUT)
    osm = load_json(collect_osm.OUT, {})
    osm_dates = sorted({v["retrieved_at"] for v in osm.values() if "retrieved_at" in v})
    sources = [
        {"id": "russia_cities", "title": "справочник городов России", "url": "https://github.com/arbaev/russia-cities",
         "license": "факты, без охраняемого текста", "retrieved_at": POPULATION_RETRIEVED},
        {"id": "rosstat_salary", "title": "Росстат", "url": collect_rosstat.PAGE,
         "license": "открытые данные, со ссылкой на источник", "retrieved_at": sal["retrieved_at"]},
        {"id": "osm", "title": "OpenStreetMap", "url": "https://www.openstreetmap.org/copyright",
         "license": "ODbL 1.0", "retrieved_at": osm_dates[-1] if osm_dates else sal["retrieved_at"]},
    ]
    cities, no_venues = [], []
    for name, region, population in target_cities():
        city = {"name": name, "region": region,
                "population": {"value": population, "source": "russia_cities", "year": POPULATION_YEAR, "scope": "city"}}
        s = collect_rosstat.salary_for(region, sal["regions"])
        if s:
            city["avg_salary_rub"] = {"value": s["value"], "source": "rosstat_salary", "year": s["year"], "scope": "region"}
        got = collect_osm.pick(name, osm.get(name, {}).get("elements", []))
        if got:
            year = int(osm[name]["retrieved_at"][:4])
            city["venues"] = {sp: {"value": sum(got["counts"][t] for t in tags), "source": "osm", "year": year, "scope": "city"}
                              for sp, tags in SPHERES.items()}
        else:
            no_venues.append(name)
        cities.append(city)
    generated = max(src["retrieved_at"] for src in sources)
    return {
        "comment": ("Собрано knowledge/build.py из knowledge/raw. Население — справочник городов (2023), зарплата — "
                    "Росстат, среднемесячная номинальная начисленная по региону, число заведений — OpenStreetMap "
                    "(данные неполные, в тексте только «около N»). Пункты выдачи — shop=outpost, без постаматов."),
        "version": 1, "generated_at": generated, "sources": sources, "cities": cities,
    }, no_venues


def check(kb: dict) -> list:
    """Схема контракта и смысловые проверки (как checkKnowledge в contracts/check.mjs, плюс правдоподобие)."""
    from dataset.common import schema_errors
    errs = [f"схема: {e}" for e in schema_errors("knowledge", "cities_file", kb)]
    ids = [s["id"] for s in kb["sources"]]
    if len(set(ids)) != len(ids):
        errs.append("sources: повторяется id")
    names = set()
    for c in kb["cities"]:
        if c["name"] in names:
            errs.append(f"город {c['name']} повторяется")
        names.add(c["name"])
        facts = [("population", c.get("population")), ("avg_salary_rub", c.get("avg_salary_rub"))]
        facts += [(f"venues.{k}", v) for k, v in (c.get("venues") or {}).items()]
        for key, f in facts:
            if f and f["source"] not in ids:
                errs.append(f"{c['name']}.{key}: источник {f['source']} не описан в sources")
        if c.get("avg_salary_rub") and not 20000 <= c["avg_salary_rub"]["value"] <= 400000:
            errs.append(f"{c['name']}: зарплата {c['avg_salary_rub']['value']} неправдоподобна")
        for k, v in (c.get("venues") or {}).items():
            if v["value"] > c["population"]["value"] / 50:
                errs.append(f"{c['name']}.venues.{k}: {v['value']} — больше одного на 50 жителей")
    return errs


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="без сети, только кеш knowledge/raw")
    args = ap.parse_args(argv)
    flags = ["--offline"] if args.offline else []
    collect_rosstat.main(flags)
    collect_osm.main(flags)
    kb, no_venues = assemble()
    errs = check(kb)
    for e in errs:
        print("ОШИБКА", e)
    if errs:
        return 1
    save_json(OUT, kb)
    print(f"{OUT.relative_to(DATA_DIR.parent.parent.parent)}: {len(kb['cities'])} городов, с числом заведений "
          f"{len(kb['cities']) - len(no_venues)}" + (f"; без него: {', '.join(no_venues)}" if no_venues else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
