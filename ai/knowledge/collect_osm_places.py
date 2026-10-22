"""Признаки проходимости в городе — OpenStreetMap через Overpass API (ODbL 1.0): торговые центры, остановки
общественного транспорта, вузы и колледжи. Дополнение к collect_osm.py (раунд 3, предложение команды).

    python -m knowledge.collect_osm_places              # из папки ai: дособрать города, которых нет в кеше
    python -m knowledge.collect_osm_places --offline    # только из knowledge/raw/osm/places.json и offices.json

Граница города берётся из уже собранного collect_osm (osm_area_id), поэтому запрос — только подсчёт по тегам.
Пауза, повторы и кеш — как в collect_osm.
"""
import argparse
import datetime as dt
import re
import sys
import time

from . import collect_osm
from .common import RAW_DIR, load_json, save_json, target_cities

OUT = RAW_DIR / "osm" / "places.json"
TAGS = {
    "shop_mall": '["shop"="mall"]',
    # Остановки размечают по-разному: highway=bus_stop и/или public_transport=platform. Считаем объединение без повторов.
    "transit_stops": ('["highway"="bus_stop"]', '["public_transport"="platform"]', '["railway"="tram_stop"]'),
    "station_subway": '["railway"="station"]["station"="subway"]',
    "amenity_university": '["amenity"="university"]',
    "amenity_college": '["amenity"="college"]',
}
# Бизнес-центры (поле footfall.business_centers): отдельного тега нет, считаем офисные здания и объекты
# с названием «БЦ…» / «Бизнес-центр…». Отдельный кеш: первый набор тегов собран раньше.
OUT_OFFICES = RAW_DIR / "osm" / "offices.json"
TAGS_OFFICES = {
    "business_centers": ('["building"="office"]', '["name"~"^(БЦ|Бизнес-центр|Бизнес центр)"]'),
}
SETS = ((OUT, TAGS), (OUT_OFFICES, TAGS_OFFICES))
# Вузы и колледжи (footfall.universities) — по названиям, а не по числу объектов: корпуса, факультеты и общежития
# в OSM размечены amenity=university/college отдельными объектами (замечание Саши: у Самары 104, у Москвы 672).
OUT_EDU = RAW_DIR / "osm" / "education.json"
EDU_KEEP = ("amenity", "name", "official_name", "operator")  # в кеш — только эти теги
EDU_WORD = re.compile(r"университет|институт|академи|колледж|техникум|училищ|консерватори|школ|лицей|university|college")
NOT_INSTITUTION = re.compile(r"общежити|столов|буфет|кафе|спортзал|спорткомплекс|стадион|бассейн|библиотек|музей|гараж|"
                             r"коллаборац|технопарк|кампус|campus|dormitory")


def edu_query(area_id: int) -> str:
    return f'[out:json][timeout:280];\narea({area_id})->.x;\nnwr(area.x)["amenity"~"^(university|college)$"];\nout tags;'


def _norm_name(s: str) -> str:
    """«Самарский университет, Корпус №1», «… им. академика С.П. Королёва (Самарский университет)»
    -> «самарский университет», «… университет»."""
    s = s.lower().replace("ё", "е")
    s = re.sub(r"\(.*?\)|[«»\"'“”„]", " ", s)
    s = re.sub(r"(?<![а-яa-z])им(ени|\.)\s.*", " ", s)
    s = re.split(r"[,.;:]|\s[-–—]\s", s)[0]
    s = re.sub(r"(учебн\w*|главн\w*|лабораторн\w*)?\s*корпус\w*\s*№?\s*\S*", " ", s)
    return " ".join(w for w in s.split() if len(w) > 1)


def institution_key(tags: dict) -> str | None:
    """Учебное заведение объекта: operator, если это само заведение («Самарский университет» у корпуса техникума),
    иначе название. Без названия, общежития, столовые и т. п. не считаем."""
    name = tags.get("name") or tags.get("official_name") or ""
    if not name or NOT_INSTITUTION.search(name.lower()):
        return None
    op = tags.get("operator") or ""
    key = _norm_name(op) if EDU_WORD.search(op.lower()) else ""
    return key or _norm_name(name) or None


def institutions(elements: list) -> int:
    """Число разных учебных заведений: объекты с одинаковым названием или operator в городе — одно заведение.
    Сокращения и полные названия («СамГТУ» и «Самарский государственный технический университет») не сливаются:
    число — оценка сверху."""
    return len({k for e in elements if (k := institution_key(e.get("tags", {})))})


def collect_education(offline: bool):
    venues = load_json(collect_osm.OUT, {})
    cache = load_json(OUT_EDU, {})
    todo = []
    for name, _, _ in target_cities():
        got = collect_osm.pick(name, venues.get(name, {}).get("elements", []))
        if got and name not in cache:
            todo.append((name, got["osm_area_id"], got["area"]))
    if todo and offline:
        sys.exit(f"в кеше вузов нет {len(todo)} городов, например {todo[0][0]}; запустите без --offline")
    for i, (name, area_id, area) in enumerate(todo, 1):
        q = edu_query(area_id)
        try:
            resp = collect_osm.overpass(q)
        except Exception as e:  # дособерём следующим прогоном
            print(f"  {name}: {type(e).__name__}: {e}")
            continue
        els = [{"type": e["type"], "id": e["id"], "tags": {k: v for k, v in e.get("tags", {}).items() if k in EDU_KEEP}}
               for e in resp["elements"]]
        cache[name] = {"query": q, "area": area, "retrieved_at": dt.date.today().isoformat(), "elements": els}
        save_json(OUT_EDU, cache)
        print(f"[{i}/{len(todo)}] {name}: объектов {len(els)}, заведений {institutions(els)}")
        time.sleep(collect_osm.PAUSE_SEC)
    done = sum(1 for n, _, _ in target_cities() if n in cache)
    print(f"OSM, {OUT_EDU.stem}: {done} из {len(target_cities())} городов -> {OUT_EDU.relative_to(RAW_DIR.parent)}")


def query(area_id: int, tags: dict = TAGS) -> str:
    counts = "\n".join(f"({' '.join(f'nwr(area.x){x};' for x in t)}); out count;" if isinstance(t, tuple)
                       else f"nwr(area.x){t}; out count;" for t in tags.values())
    return f"[out:json][timeout:280];\narea({area_id})->.x;\n{counts}"


def counts(elements: list, tags: dict = TAGS):
    got = [int(e["tags"]["total"]) for e in elements if e["type"] == "count"]
    return dict(zip(tags, got)) if len(got) == len(tags) else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args(argv)
    for out, tags in SETS:
        collect(out, tags, args.offline)
    collect_education(args.offline)


def collect(out, tags: dict, offline: bool):
    venues = load_json(collect_osm.OUT, {})
    cache = load_json(out, {})
    todo = []
    for name, _, _ in target_cities():
        got = collect_osm.pick(name, venues.get(name, {}).get("elements", []))
        if got and name not in cache:
            todo.append((name, got["osm_area_id"], got["area"]))
    if todo and offline:
        sys.exit(f"в кеше нет {len(todo)} городов, например {todo[0][0]}; запустите без --offline")
    for i, (name, area_id, area) in enumerate(todo, 1):
        q = query(area_id, tags)
        t = time.perf_counter()
        try:
            resp = collect_osm.overpass(q)
        except Exception as e:  # дособерём следующим прогоном
            print(f"  {name}: {type(e).__name__}: {e}")
            continue
        cache[name] = {"query": q, "area": area, "retrieved_at": dt.date.today().isoformat(),
                       "elements": resp["elements"], "seconds": round(time.perf_counter() - t, 1)}
        save_json(out, cache)
        print(f"[{i}/{len(todo)}] {name}: {counts(resp['elements'], tags)}")
        time.sleep(collect_osm.PAUSE_SEC)
    done = sum(1 for n, _, _ in target_cities() if counts(cache.get(n, {}).get("elements", []), tags))
    print(f"OSM, {out.stem}: {done} из {len(target_cities())} городов -> {out.relative_to(RAW_DIR.parent)}")


if __name__ == "__main__":
    main()
