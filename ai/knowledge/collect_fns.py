"""Число зарегистрированных малых и средних бизнесов по виду деятельности в городе — Единый реестр субъектов МСП
ФНС России (открытые данные, набор 7707329152-rsmp).

    python -m knowledge.collect_fns            # из папки ai: разобрать архив в knowledge/raw/fns/*.zip (2,2 ГБ)
    python -m knowledge.collect_fns --offline  # ничего не разбирать: подсчёт уже лежит в knowledge/raw/fns/counts.json

Архив скачивается отдельно (в git не попадает):
    https://www.nalog.gov.ru/opendata/7707329152-rsmp/data-10102026-structure-12052026.zip
Читается прямо из zip, без распаковки. Из каждой записи берутся только регион, город и основной код ОКВЭД;
ФИО, ИНН и названия не сохраняются. Результат — knowledge/raw/fns/counts.json: {"регион|город": {сфера: число}}.

Важно для текста: реестр считает регистрации (ИП и компании с основным видом деятельности), а не точки:
сеть — одна запись, часть зарегистрированных может не работать.
"""
import argparse
import datetime as dt
import re
import sys
import time
import zipfile
from collections import Counter, defaultdict

from .common import RAW_DIR, load_json, norm, save_json

DATASET = "https://www.nalog.gov.ru/opendata/7707329152-rsmp/"
ARCHIVE = "data-10102026-structure-12052026.zip"
OUT = RAW_DIR / "fns" / "counts.json"
# Основной ОКВЭД -> сфера. Пункты выдачи своего кода не имеют — по ним факта нет.
OKVED = {
    "coffee": ("56.30",),              # подача напитков: кофейни и бары
    "bakery": ("10.71", "47.24"),      # хлеб и выпечка: производство и розница
    "car_wash": ("45.20.3",),          # мойка автотранспортных средств
    "clothing_store": ("47.71",),      # розничная торговля одеждой
    "beauty_salon": ("96.02",),        # парикмахерские и салоны красоты
}
DOC = re.compile(r'<СведМН КодРегион="(\d+)">(.*?)</СведМН>.*?(?:<СвОКВЭДОсн КодОКВЭД="([^"]+)"|</Документ>)', re.S)
ATTR = re.compile(r'<(Регион|Район|Город|НаселПункт)\b([^>]*)/?>')
NAME, TYPE = re.compile(r'Наим="([^"]*)"'), re.compile(r'Тип="([^"]*)"')
FEDERAL = {"77": "Москва", "78": "Санкт-Петербург", "92": "Севастополь"}


def sphere_of(code):
    if not code:
        return None
    return next((sp for sp, prefixes in OKVED.items()
                 if any(code == p or code.startswith(p + ".") for p in prefixes)), None)


def count_xml(text: str, counts: dict, totals: Counter) -> int:
    n = 0
    for region_code, place, okved in DOC.findall(text):
        n += 1
        parts = {}
        for tag, attrs in ATTR.findall(place):
            name, kind = NAME.search(attrs), TYPE.search(attrs)
            parts[tag] = (name.group(1) if name else "", kind.group(1) if kind else "")
        # Город — в «Город»; у городских округов он бывает в «Район» с типом «г.» («Нижний Новгород», «Люберцы»),
        # тогда посёлки внутри округа считаются к нему, как и граница городского округа в OSM.
        district = parts.get("Район", ("", ""))
        city = (FEDERAL.get(region_code) or parts.get("Город", ("", ""))[0]
                or (district[0] if district[1].startswith("г") else "") or parts.get("НаселПункт", ("", ""))[0])
        if not city:
            continue
        key = f"{region_code}|{norm(city)}"
        totals[key] += 1
        sp = sphere_of(okved)
        if sp:
            counts[key][sp] += 1
    return n


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args(argv)
    if args.offline:
        if not OUT.exists():
            sys.exit(f"нет {OUT}")
        print(f"ФНС: подсчёт из {OUT.relative_to(RAW_DIR.parent)}")
        return
    path = RAW_DIR / "fns" / ARCHIVE
    if not path.exists():
        sys.exit(f"нет архива {path}: скачайте {DATASET}{ARCHIVE}")
    counts, totals, docs, t = defaultdict(Counter), Counter(), 0, time.perf_counter()
    with zipfile.ZipFile(path) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".xml")]
        for i, name in enumerate(names, 1):
            docs += count_xml(z.read(name).decode("utf-8"), counts, totals)
            if i % 500 == 0:
                print(f"  {i}/{len(names)} файлов, {docs} записей, {time.perf_counter() - t:.0f} с")
    save_json(OUT, {"dataset": DATASET, "file": ARCHIVE, "date": ARCHIVE.split("-")[1],
                    "retrieved_at": dt.date.today().isoformat(), "records": docs, "okved": OKVED,
                    "cities": {k: {"total": totals[k], **dict(counts.get(k, {}))} for k in sorted(totals) if totals[k] >= 100}})
    print(f"ФНС: {docs} записей, {len(totals)} населённых пунктов -> {OUT.relative_to(RAW_DIR.parent)}")


def value_for(city: str, region_code: str, data: dict):
    return data["cities"].get(f"{region_code}|{norm(city)}")


if __name__ == "__main__":
    main()
