"""Число заведений по 6 сферам в городе — OpenStreetMap через Overpass API (ODbL 1.0).

    python -m knowledge.collect_osm              # из папки ai: дособрать города, которых нет в кеше
    python -m knowledge.collect_osm --offline    # только из knowledge/raw/osm
    python -m knowledge.collect_osm --refresh    # собрать заново (один прогон — одна сборка, Overpass не нагружаем)

Как ищется город: точка place=city|town с таким названием внутри региона, затем административная граница, в которой
она лежит и которая называется так же («Самара», «городской округ Самара», «город Киров»). Если таких несколько —
самая мелкая (больший admin_level). Города без подходящей границы остаются без числа заведений.
Между запросами пауза PAUSE_SEC, сырые ответы — в knowledge/raw/osm/overpass.json.
"""
import argparse
import datetime as dt
import json
import re
import sys
import time

from .common import RAW_DIR, http, load_json, norm, region_key, save_json, target_cities

OVERPASS = "https://overpass-api.de/api/interpreter"
PAUSE_SEC = 5
OUT = RAW_DIR / "osm" / "overpass.json"
REGIONS = RAW_DIR / "osm" / "regions.json"

# Теги (docs/tasks/ROUND3.md, A1) считаются по отдельности, а в сферы складываются при сборке (build.py):
# так постаматы не попадают в «пункты выдачи». У кофеен cuisine может быть списком через «;».
TAGS = {
    "cafe_coffee_shop": '["amenity"="cafe"]["cuisine"~"(^|;)coffee_shop(;|$)"]',
    "shop_coffee": '["shop"="coffee"]',
    "shop_bakery": '["shop"="bakery"]',
    "amenity_car_wash": '["amenity"="car_wash"]',
    "shop_clothes": '["shop"="clothes"]',
    "shop_beauty": '["shop"="beauty"]',
    "shop_hairdresser": '["shop"="hairdresser"]',
    "shop_outpost": '["shop"="outpost"]',
    "amenity_parcel_locker": '["amenity"="parcel_locker"]',
}
CITY_PREFIX = r"(?:городской округ|муниципальное образование|городское поселение|муниципальный округ|город|г\.)?\s*(?:город\s+)?"


def overpass(query: str) -> dict:
    return json.loads(http(OVERPASS, data={"data": query}, timeout=300))


def regions(offline: bool) -> dict:
    """Регионы России в OSM: ключ region_key -> id области поиска Overpass (3600000000 + id отношения)."""
    cached = load_json(REGIONS)
    if not cached:
        if offline:
            sys.exit(f"нет {REGIONS}, запустите без --offline")
        q = ('[out:json][timeout:180];area["ISO3166-1"="RU"]["admin_level"="2"]->.ru;'
             'rel(area.ru)["admin_level"="4"]["boundary"="administrative"];out tags;')
        cached = {"query": q, "retrieved_at": dt.date.today().isoformat(), "elements": overpass(q)["elements"]}
        save_json(REGIONS, cached)
        time.sleep(PAUSE_SEC)
    out = {}
    for e in cached["elements"]:
        iso = e["tags"].get("ISO3166-2", "")
        if iso.startswith("RU-") or e["tags"].get("name") == "Республика Крым":
            out[region_key(e["tags"]["name"])] = 3600000000 + e["id"]
    return out


def city_query(name: str, region_area: int, federal: bool) -> str:
    levels = "4" if federal else "5|6|7|8"
    counts = "\n".join(f"  nwr(area.x){t}; out count;" for t in TAGS.values())
    return (f'[out:json][timeout:280];\narea({region_area})->.r;\n'
            f'node(area.r)["place"~"^(city|town)$"]["name"="{name}"]->.p;\n'
            f'.p is_in->.a;\narea.a["boundary"="administrative"]["admin_level"~"^({levels})$"]->.c;\n'
            f'foreach.c->.x(\n  .x out tags;\n{counts}\n);')


def pick(name: str, elements: list):
    """Из ответа: [(граница, {сфера: число})] -> лучшая граница с названием города и её числа."""
    blocks, cur = [], None
    for e in elements:
        if e["type"] == "area":
            cur = {"id": e["id"], "tags": e.get("tags", {}), "counts": []}
            blocks.append(cur)
        elif e["type"] == "count" and cur is not None:
            cur["counts"].append(int(e["tags"]["total"]))
    rx = re.compile(rf"^{CITY_PREFIX}{re.escape(norm(name))}$")
    # «Челябинский городской округ»: прилагательное от названия города + «городской округ».
    stem = norm(name)[:max(4, len(name) - 2)]
    adj = re.compile(rf"^{re.escape(stem)}\w* городской округ$")

    def named(b):
        n = norm(b["tags"].get("name", ""))
        return bool(rx.match(n) or (" " not in name and adj.match(n)))

    good = [b for b in blocks if named(b) and len(b["counts"]) == len(TAGS)]
    if not good:
        # «Старооскольский городской округ»: единственный городской округ с основой последнего слова названия.
        last = norm(name).split()[-1]
        okrug = [b for b in blocks if norm(b["tags"].get("name", "")).endswith("городской округ")
                 and last[:max(4, len(last) - 2)] in norm(b["tags"].get("name", "")) and len(b["counts"]) == len(TAGS)]
        good = okrug if len(okrug) == 1 else []
    if not good:
        return None
    best = max(good, key=lambda b: int(b["tags"].get("admin_level", "0")))
    return {"area": best["tags"].get("name"), "admin_level": best["tags"].get("admin_level"),
            "osm_area_id": best["id"], "counts": dict(zip(TAGS, best["counts"]))}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args(argv)
    reg = regions(args.offline)
    cache = {} if args.refresh else load_json(OUT, {})
    cities = target_cities()
    missing = [c for c in cities if c[0] not in cache]
    if missing and args.offline:
        sys.exit(f"в кеше нет {len(missing)} городов, например {missing[0][0]}; запустите без --offline")
    for i, (name, region, _) in enumerate(missing, 1):
        area = reg.get(region_key(region))
        if area is None:
            cache[name] = {"error": f"регион {region!r} не найден в OSM"}
        else:
            q = city_query(name, area, federal=region_key(region) == region_key(name))
            t = time.perf_counter()
            try:
                resp = overpass(q)
                cache[name] = {"query": q, "retrieved_at": dt.date.today().isoformat(),
                               "elements": resp["elements"], "seconds": round(time.perf_counter() - t, 1)}
            except Exception as e:  # сбой одного города не останавливает сборку: дособерём следующим прогоном
                print(f"  {name}: {type(e).__name__}: {e}")
                continue
        save_json(OUT, cache)  # после каждого города: прерванный прогон продолжится с того же места
        got = pick(name, cache[name].get("elements", []))
        print(f"[{i}/{len(missing)}] {name}: {got['area'] + ' ' + str(got['counts']) if got else cache[name].get('error', 'граница не найдена')}")
        time.sleep(PAUSE_SEC)
    found = sum(1 for c in cities if pick(c[0], cache.get(c[0], {}).get("elements", [])))
    print(f"OSM: {found} из {len(cities)} городов с числом заведений -> {OUT.relative_to(RAW_DIR.parent)}")


if __name__ == "__main__":
    main()
