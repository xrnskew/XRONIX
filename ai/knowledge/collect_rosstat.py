"""Средняя зарплата по регионам — Росстат, «Среднемесячная номинальная начисленная заработная плата работников
по полному кругу организаций в целом по экономике по субъектам Российской Федерации», последний полный год.

    python -m knowledge.collect_rosstat              # из папки ai: скачать (если нет в raw/) и разобрать
    python -m knowledge.collect_rosstat --offline    # только из knowledge/raw/rosstat

Результат — knowledge/raw/rosstat/salary.json: {регион: {"value", "year"}}. Нужен openpyxl (knowledge/requirements.txt).
"""
import argparse
import datetime as dt
import re
import sys

from .common import RAW_DIR, http, load_json, region_key, save_json

PAGE = "https://rosstat.gov.ru/labor_market_employment_salaries"
FILE = "tab4-zpl-2025.xlsx"
URL = f"https://rosstat.gov.ru/storage/mediabank/{FILE}"
OUT = RAW_DIR / "rosstat" / "salary.json"
# Для городов этих областей берём строку без автономных округов: в округах зарплаты северные и сильно выше.
WITHOUT_AO = {"тюменская область": "тюменская область без автономный округов",
              "архангельская область": "архангельская область без автономный округа"}


def download(offline: bool):
    path = RAW_DIR / "rosstat" / FILE
    if not path.exists():
        if offline:
            sys.exit(f"нет {path}, запустите без --offline")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(http(URL, russian_ca=True, timeout=120))
    return path


def parse(path) -> dict:
    import openpyxl
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True)["с 2018"]
    rows = list(ws.iter_rows(values_only=True))
    # Заголовок: 2018, 2019, ..., «20251)» (сноска про новые регионы). Последний год с числами — последний полный.
    header = next(r for r in rows if r and r[1] == 2018)
    years = [int(re.match(r"\d{4}", str(c)).group()) if c is not None else None for c in header[1:]]
    col = max(i for i, y in enumerate(years) if y is not None)
    out = {}
    for r in rows:
        name, value = r[0], r[1 + col] if len(r) > 1 + col else None
        if isinstance(name, str) and isinstance(value, (int, float)) and "федеральный округ" not in name.lower() \
                and "российская федерация" not in name.lower():
            key = region_key(name.replace("в том числе", ""))
            out[key] = {"value": round(value), "year": years[col], "title": name.strip()}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args(argv)
    path = download(args.offline)
    regions = parse(path)
    prev = load_json(OUT, {})
    retrieved = prev.get("retrieved_at") if prev.get("file") == FILE else None
    save_json(OUT, {"source": URL, "page": PAGE, "file": FILE,
                    "retrieved_at": retrieved or dt.date.today().isoformat(), "regions": regions})
    print(f"Росстат: {len(regions)} регионов, год {next(iter(regions.values()))['year']} -> {OUT.relative_to(RAW_DIR.parent)}")


def salary_for(region: str, salaries: dict):
    key = region_key(region)
    return salaries.get(WITHOUT_AO.get(key, key))


if __name__ == "__main__":
    main()
