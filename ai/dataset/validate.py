"""Проверка датасетов независимо от генератора: схема контракта + смысловые правила + разбиение.

    python -m dataset.validate          # из папки ai; код возврата 1, если есть хоть одна ошибка
"""
import json
import re
import sys
from collections import Counter

from .common import CITY_NAMES, DATA_DIR, PURPOSES, SPHERES_ALL, TEMPLATES, schema_errors, split_cities

PROMISE = re.compile(r"(?<![а-яё])(одобрят|одобрим|одобрю|точно дадут|гарантирую|гарантируем|не одобрят|откажут вам)(?![а-яё])", re.I)
DIGIT = re.compile(r"\d")


def load(name):
    path = DATA_DIR / f"{name}.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def check_consult(ex) -> list:
    errs = schema_errors("consult", "request", ex["request"]) + schema_errors("consult", "response", ex["response"])
    req, resp = ex["request"], ex["response"]
    st, before = resp["state"], req["state"]
    sphere = st["sphere"]
    # Правило 3: ответы анкеты только из шаблона сферы, числа в пределах, choice — value.
    if st["answers"]:
        if sphere not in TEMPLATES:
            errs.append("answers при сфере без шаблона")
        else:
            qs = {q["id"]: q for q in TEMPLATES[sphere]["questions"]}
            for qid, val in st["answers"].items():
                q = qs.get(qid)
                if not q:
                    errs.append(f"answers.{qid}: нет в шаблоне {sphere}")
                elif q["kind"] == "choice" and val not in [o["value"] for o in q["options"]]:
                    errs.append(f"answers.{qid}={val!r}: не value варианта")
                elif q["kind"] == "number" and not (isinstance(val, (int, float)) and q["min"] <= val <= q["max"]):
                    errs.append(f"answers.{qid}={val!r}: вне {q['min']}–{q['max']}")
    # Правило 4: ready только при известных sphere (не other), city, own_funds_rub.
    if resp["type"] == "ready" and not (sphere in TEMPLATES and st["city"] and st["own_funds_rub"] is not None):
        errs.append("ready без sphere/city/own_funds_rub")
    if resp["type"] != "ready" and sphere == "other":
        pass
    if sphere == "other":
        errs.append("sphere=other в state (нужно предложить ближайший шаблон)")
    # Правило 6/7: message не меняет state.
    if resp["type"] == "message" and st != before:
        errs.append("message изменил state")
    # Правило 1: известное не теряется, меняется только при поправке.
    if "R1_correction" not in ex["rules"]:
        for k in ("sphere", "city", "own_funds_rub"):
            if before[k] is not None and st[k] != before[k]:
                errs.append(f"{k} изменён без поправки: {before[k]!r} -> {st[k]!r}")
        if before["sphere"] == st["sphere"]:
            for qid, val in before["answers"].items():
                if st["answers"].get(qid) != val:
                    errs.append(f"answers.{qid} потерян")
    # Суммы: модель не называет цифр и не придумывает своих денег.
    texts = [resp["text"]] + [q["text"] for q in resp.get("questions", [])] + [o for q in resp.get("questions", []) for o in q.get("options", [])]
    if any(DIGIT.search(t) for t in texts):
        errs.append("цифры в тексте ответа")
    if any(PROMISE.search(t) for t in texts):
        errs.append("обещание или отказ в кредите")
    if st["own_funds_rub"] is not None and st["own_funds_rub"] not in ex["meta"]["user_amounts"]:
        errs.append(f"own_funds_rub={st['own_funds_rub']} человек не называл")
    if resp["type"] == "questions" and len(resp["questions"]) > 4:
        errs.append("больше 4 вопросов")
    if len({q["id"] for q in resp.get("questions", [])}) != len(resp.get("questions", [])):
        errs.append("повтор id вопроса")
    return errs


def check_need(ex) -> list:
    errs = schema_errors("parse-need", "request", ex["request"]) + schema_errors("parse-need", "response", ex["response"])
    r = ex["response"]
    non_null = {k for k in ("purpose", "sphere", "city", "amount_rub", "term_months", "has_collateral") if r[k] is not None}
    if set(r["confidence"]) != non_null:
        errs.append(f"confidence {sorted(r['confidence'])} != не-null поля {sorted(non_null)}")
    if r["purpose"] is not None and r["purpose"] not in PURPOSES:
        errs.append("purpose не из справочника")
    if r["sphere"] is not None and r["sphere"] not in SPHERES_ALL:
        errs.append("sphere не из справочника")
    if r["city"] is not None and r["city"] not in CITY_NAMES:
        errs.append(f"city {r['city']!r} нет в cities.json")
    return errs


def check_split(task, train, hold) -> list:
    errs = []
    st, sh = {e["seed"] for e in train}, {e["seed"] for e in hold}
    if st & sh:
        errs.append(f"{task}: заготовки и в train, и в holdout: {sorted(st & sh)[:5]}")
    key = (lambda e: json.dumps(e["request"], ensure_ascii=False, sort_keys=True)) if task == "consult" else (lambda e: e["request"]["text"].strip().lower())
    dup = {key(e) for e in train} & {key(e) for e in hold}
    if dup:
        errs.append(f"{task}: {len(dup)} одинаковых запросов в train и holdout")
    hold_only = set(split_cities()["holdout"])

    def cities(rows):
        out = set()
        for e in rows:
            if task == "consult":
                out |= {e["request"]["state"]["city"], e["response"]["state"]["city"]}
            else:
                out.add(e["response"]["city"])
        return out - {None}

    leak = cities(train) & hold_only
    if leak:
        errs.append(f"{task}: holdout-города в train: {sorted(leak)[:5]}")
    # Фразы, которые есть только в holdout, не должны встречаться в train (банки без опечаток проверяем точно).
    if task == "consult":
        from .consult import GREETINGS, ROLE_CHANGE
        from .common import bank_split
        hold_phr = set(bank_split(GREETINGS)[1]) | set(bank_split(ROLE_CHANGE)[1])
        seen = [e["id"] for e in train if e["request"]["message"] in hold_phr]
    else:
        from .parse_need import AMBIGUOUS, NOT_BUSINESS
        from .common import bank_split
        hold_phr = {x.lower() for x in bank_split(NOT_BUSINESS)[1] + bank_split(AMBIGUOUS)[1]}
        seen = [e["id"] for e in train if e["request"]["text"].strip().lower().rstrip(".") in hold_phr]
    if seen:
        errs.append(f"{task}: holdout-фразы в train: {seen[:5]}")
    return errs


def main():
    total_bad = 0
    for task, check in (("consult", check_consult), ("parse_need", check_need)):
        train, hold = load(f"{task}.train"), load(f"{task}.holdout")
        bad = Counter()
        examples = {}
        for part, rows in (("train", train), ("holdout", hold)):
            for ex in rows:
                for e in check(ex):
                    bad[e.split(":")[0]] += 1
                    examples.setdefault(e.split(":")[0], (ex["id"], e))
        split = check_split(task, train, hold)
        n_bad = sum(bad.values()) + len(split)
        total_bad += n_bad
        print(f"{task}: train {len(train)}, holdout {len(hold)}, ошибок {n_bad}")
        for k, n in bad.most_common():
            print(f"   {n:>5} × {examples[k][1]}   (например {examples[k][0]})")
        for e in split:
            print("   разбиение:", e)
    print("OK: все примеры проходят схему и правила" if not total_bad else f"ОШИБОК: {total_bad}")
    return 1 if total_bad else 0


if __name__ == "__main__":
    sys.exit(main())
