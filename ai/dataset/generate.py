"""Генерация датасетов /ai/consult и /ai/parse-need.

Запуск из папки ai:
    python -m dataset.generate                 # оба датасета, seed по умолчанию
    python -m dataset.generate --task consult --seed 7

Разбиение до генерации вариантов:
  * города: крупнейшие 20 общие, остальные делятся по хешу; holdout-города в train не встречаются;
  * заготовки (seed): train и holdout строятся из разных генераторов случайных чисел и разных частей городов,
    варианты одной заготовки попадают только в её часть;
  * повторы текста запроса внутри части и между частями удаляются (между частями — из train).
Каждый пример проверяется JSON Schema контракта. Невалидный пример — ошибка генерации, а не пропуск.
"""
import argparse
import json
import random
import sys
from collections import Counter

from .common import DATA_DIR, pick_city, schema_errors, split_cities
from .consult import RULES, Seed
from .parse_need import NeedSeed

PLAN = {  # заготовок, вариантов на заготовку
    "consult": {"train": (1000, 3), "holdout": (300, 1)},
    "parse_need": {"train": (950, 3), "holdout": (300, 1)},
}


def _key(task, ex):
    if task == "consult":
        return json.dumps(ex["request"], ensure_ascii=False, sort_keys=True)
    return ex["request"]["text"].strip().lower()


def _validate(task, ex):
    if task == "consult":
        return schema_errors("consult", "request", ex["request"]) + schema_errors("consult", "response", ex["response"])
    return schema_errors("parse-need", "request", ex["request"]) + schema_errors("parse-need", "response", ex["response"])


def build_part(task, part, seed, cities_split):
    n_seeds, n_var = PLAN[task][part]
    rng = random.Random(f"{task}:{part}:{seed}")
    own = cities_split["holdout" if part == "holdout" else "train"]
    shared = cities_split["shared"]
    examples, seen = [], set()
    for i in range(n_seeds):
        seed_id = f"{task}-{part}-{i:04d}"
        srng = random.Random(f"{seed_id}:{seed}")
        city_fn = lambda r=srng: pick_city(r, own, shared)
        s = Seed(seed_id, srng, city_fn, part) if task == "consult" else NeedSeed(seed_id, srng, city_fn, part)
        for v in range(n_var):
            ex = s.build(random.Random(f"{seed_id}:{seed}:v{v}"))
            k = _key(task, ex)
            if k in seen:
                continue
            seen.add(k)
            errs = _validate(task, ex)
            if errs:
                raise SystemExit(f"{seed_id} v{v}: пример не прошёл схему: {errs[:3]}\n{json.dumps(ex, ensure_ascii=False)[:800]}")
            examples.append(ex)
    return examples


def generate(task, seed):
    cs = split_cities()
    train = build_part(task, "train", seed, cs)
    hold = build_part(task, "holdout", seed, cs)
    hold_keys = {_key(task, e) for e in hold}
    hold_seeds = {e["seed"] for e in hold}
    before = len(train)
    train = [e for e in train if _key(task, e) not in hold_keys]
    assert not hold_seeds & {e["seed"] for e in train}
    for part, rows in (("train", train), ("holdout", hold)):
        for i, e in enumerate(rows):
            e["id"] = f"{task}.{part}.{i:05d}"
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    for part, rows in (("train", train), ("holdout", hold)):
        path = DATA_DIR / f"{task}.{part}.jsonl"
        with path.open("w", encoding="utf-8", newline="\n") as f:
            for e in rows:
                f.write(json.dumps(e, ensure_ascii=False) + "\n")
    return train, hold, before - len(train)


def summary(task, train, hold, dropped):
    print(f"\n=== {task}: train {len(train)}, holdout {len(hold)} (удалено из train совпавших с holdout: {dropped})")
    if task == "consult":
        for part, rows in (("train", train), ("holdout", hold)):
            types = Counter(e["response"]["type"] for e in rows)
            print(f"  {part}: типы {dict(types)}")
        cov_t = Counter(r for e in train for r in e["rules"])
        cov_h = Counter(r for e in hold for r in e["rules"])
        print("  покрытие правил (train / holdout):")
        for r in RULES:
            print(f"    {r:<22} {cov_t[r]:>5} / {cov_h[r]:<4} {RULES[r]}")
        missing = [r for r in RULES if not cov_t[r] or not cov_h[r]]
        if missing:
            raise SystemExit(f"правила без примеров: {missing}")
    else:
        for part, rows in (("train", train), ("holdout", hold)):
            kinds = Counter(e["kind"] for e in rows)
            nulls = {f: sum(e["response"][f] is None for e in rows) for f in ("purpose", "sphere", "city", "amount_rub", "term_months", "has_collateral")}
            print(f"  {part}: виды {dict(kinds)}\n         null по полям {nulls}")
        print("  цели:", dict(Counter(e["response"]["purpose"] for e in train)))
        print("  сферы:", dict(Counter(e["response"]["sphere"] for e in train)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=["consult", "parse_need", "all"], default="all")
    ap.add_argument("--seed", default="20261020")
    args = ap.parse_args()
    tasks = ["consult", "parse_need"] if args.task == "all" else [args.task]
    for t in tasks:
        summary(t, *generate(t, args.seed))
    print(f"\nФайлы: {DATA_DIR}")


if __name__ == "__main__":
    sys.exit(main())
