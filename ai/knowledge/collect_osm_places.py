"""Признаки проходимости в городе — OpenStreetMap через Overpass API (ODbL 1.0): торговые центры, остановки
общественного транспорта, вузы и колледжи. Дополнение к collect_osm.py (раунд 3, предложение команды).

    python -m knowledge.collect_osm_places              # из папки ai: дособрать города, которых нет в кеше
    python -m knowledge.collect_osm_places --offline    # только из knowledge/raw/osm/places.json и offices.json

Граница города берётся из уже собранного collect_osm (osm_area_id), поэтому запрос — только подсчёт по тегам.
Пауза, повторы и кеш — как в collect_osm.
"""
import argparse
import datetime as dt
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
