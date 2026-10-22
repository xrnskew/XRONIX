"""Общее для сборщиков базы знаний (раунд 3, задача A1). Работает только при разработке, в образ сервиса не входит.

Сеть — только к открытым источникам: Росстат (сертификаты Минцифры в knowledge/certs) и Overpass API OpenStreetMap.
Каждый ответ сохраняется в knowledge/raw/: повторная сборка идёт из кеша, без сети (--offline).
"""
import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).resolve().parent
AI_DIR = KNOWLEDGE_DIR.parent
REPO_DIR = AI_DIR.parent
RAW_DIR = KNOWLEDGE_DIR / "raw"
DATA_DIR = AI_DIR / "app" / "rules" / "data"
CA_BUNDLE = KNOWLEDGE_DIR / "certs" / "russian_bundle.pem"
# Справочник городов фронта: название, регион, население (arbaev/russia-cities, 2023). В app/rules/data/cities.json
# региона нет, поэтому регион берём отсюда.
FRONT_CITIES = REPO_DIR / "frontend" / "src" / "data" / "cities.json"
# Без личных данных: в заголовке только адрес проекта.
USER_AGENT = "XRONIX-hackathon/1.0 (+https://github.com/xrnskew/XRONIX)"
TOP_N = 100


def http(url: str, *, data: dict | None = None, timeout: int = 180, russian_ca: bool = False, retries: int = 4) -> bytes:
    """GET или POST (form) с повтором при 429/5xx и растущей паузой."""
    body = urllib.parse.urlencode(data).encode() if data else None
    ctx = ssl.create_default_context(cafile=str(CA_BUNDLE)) if russian_ca else None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        time.sleep(30 * (attempt + 1))
    raise RuntimeError("unreachable")


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().replace("ё", "е")).strip()


def region_key(name: str) -> str:
    """Ключ региона, одинаковый у Росстата, справочника городов и OSM: «Ханты-Мансийский авт.округ - Югра»,
    «Ханты-Мансийский автономный округ — Югра» и «Республика Татарстан» / «Татарстан» сводятся к одному виду."""
    s = norm(name)
    s = re.sub(r"^(в том числе)?[\s:]*", "", s)  # «в том числе: Ханты-Мансийский авт. округ»
    s = re.sub(r"^г\.\s*", "", s)
    s = s.replace("осетия алания", "осетия-алания")
    s = re.sub(r"\bавт\.\s*", "автономный ", s)
    s = re.sub(r"\s*[-–—]\s*", "-", s)
    s = re.sub(r"\bреспублика\b", "", s)
    s = re.sub(r"\s+", " ", s).strip(" -")
    return REGION_ALIASES.get(s, s)


# Регионы, которые в источниках называются по-разному (после region_key).
REGION_ALIASES = {
    "чувашская": "чувашия", "чувашская-чувашия": "чувашия", "удмуртская": "удмуртия",
    "кабардино-балкарская": "кабардино-балкария", "карачаево-черкесская": "карачаево-черкесия",
    "чеченская": "чечня", "кемеровская область-кузбасс": "кемеровская область",
    "саха /якутия/": "саха (якутия)", "ханты-мансийский автономный округ": "ханты-мансийский автономный округ-югра",
}


def target_cities() -> list:
    """100 крупнейших городов по населению плюс города из засева бэкенда и примеров контрактов.
    Возвращает [(название, регион, население)] по убыванию населения."""
    rows = json.loads(FRONT_CITIES.read_text(encoding="utf-8"))
    by_name = {r[0]: r for r in rows}
    top = sorted(rows, key=lambda r: -r[2])[:TOP_N]
    extra = set()
    sources = [REPO_DIR / "backend" / "app" / "seed.py", *sorted((REPO_DIR / "contracts" / "examples").glob("*.json"))]
    for f in sources:
        if f.exists():
            text = f.read_text(encoding="utf-8")
            extra |= {m for m in re.findall(r"city['\"]?\s*[:=]\s*['\"]([^'\"]+)['\"]", text) if m in by_name}
    chosen = {r[0]: r for r in top}
    for name in sorted(extra):
        chosen.setdefault(name, by_name[name])
    return sorted(chosen.values(), key=lambda r: -r[2])


def save_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def load_json(path: Path, default=None):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default
