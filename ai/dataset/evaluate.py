"""Оценка любой функции «запрос -> ответ» на отложенной выборке (holdout).

    python -m dataset.evaluate --task consult --predictor dataset.baseline:consult --name baseline
    python -m dataset.evaluate --task parse_need --predictor dataset.baseline:parse_need --name baseline
    python -m dataset.evaluate --task consult --predictions preds.jsonl --name qwen3-lora   # {"id", "response"} построчно

Результат печатается и сохраняется в dataset/results/<name>.<task>.json (метрики, задержка, 10 ошибок).
Невалидный по схеме ответ считается ошибкой по всем полям.

consult:    точность type, каждого поля state (sphere, city, own_funds_rub, answers целиком), пары answers (P/R/F1),
            state целиком, доля придуманных сумм (должна быть 0), доля обещаний кредита, message без изменения state.
parse_need: точность каждого поля (null тоже значение), все поля сразу, пороги раздела 13.3 docs/CONVEYOR.md.
"""
import argparse
import importlib
import json
import statistics
import sys
import time
from collections import Counter, defaultdict

from app.rules import knowledge
from app.rules.text import amounts

from .common import RESULTS_DIR, schema_errors
from .validate import PROMISE, load

STATE_FIELDS = ("sphere", "city", "own_funds_rub", "answers", "experience")
NEED_FIELDS = ("purpose", "sphere", "city", "amount_rub", "term_months", "has_collateral")
THRESHOLDS = {"purpose": 0.90, "sphere": 0.90, "amount_rub": 0.90, "city": 0.95}


def load_predictor(spec):
    mod, fn = spec.split(":")
    return getattr(importlib.import_module(mod), fn)


def run_predictions(rows, predictor=None, predictions=None):
    preds, latency = {}, []
    if predictions:
        for line in open(predictions, encoding="utf-8"):
            if line.strip():
                p = json.loads(line)
                preds[p["id"]] = p["response"]
        return preds, latency
    for ex in rows:
        t = time.perf_counter()
        try:
            preds[ex["id"]] = predictor(ex["request"])
        except Exception as e:  # падение функции — тоже ошибка ответа
            preds[ex["id"]] = {"__error__": f"{type(e).__name__}: {e}"}
        latency.append(time.perf_counter() - t)
    return preds, latency


def visible_texts(pred) -> list:
    """Всё, что увидит человек: текст ответа, тексты вопросов и варианты. Мусор вместо ответа — пустой список."""
    if not isinstance(pred, dict):
        return []
    out = [pred["text"]] if isinstance(pred.get("text"), str) else []
    questions = pred.get("questions")
    for q in questions if isinstance(questions, list) else []:
        if isinstance(q, dict):
            out += [q["text"]] if isinstance(q.get("text"), str) else []
            out += [o for o in q.get("options") or [] if isinstance(o, str)] if isinstance(q.get("options"), list) else []
    return out


def money_in(text: str) -> list:
    """Денежные суммы в тексте: цифрами («1 500 000», «500 ₽»), сокращениями («800к», «1,5 млн») и словами
    («восемьсот тысяч рублей»). Площадь, люди, машины, сроки и проценты деньгами не считаются (app/rules/text.amounts)."""
    return [value for value, _, _, _ in amounts(text)]


def invented_amounts(ex, pred) -> list:
    """Суммы в ответе, которых человек не называл: свои деньги и денежные ответы анкеты в state, суммы во всех
    видимых текстах. Повторить сумму человека или назвать факт из базы знаний можно, придумать новую — нет."""
    allowed = set(ex["meta"]["user_amounts"])
    if ex["request"]["state"]["own_funds_rub"] is not None:
        allowed.add(ex["request"]["state"]["own_funds_rub"])
    allowed |= {v for k, v in ex["request"]["state"]["answers"].items() if k.endswith("_rub")}
    state = pred.get("state") if isinstance(pred, dict) and isinstance(pred.get("state"), dict) else {}
    # Суммы из базы фактов (зарплата по региону, ai.md правило 8) — не придуманные: для города запроса и ответа.
    for city in {ex["request"]["state"]["city"], state.get("city") if isinstance(state.get("city"), str) else None}:
        allowed |= knowledge.allowed_amounts(city)
    found = []
    own = state.get("own_funds_rub")
    if isinstance(own, (int, float)) and not isinstance(own, bool) and own not in allowed:
        found.append(own)
    answers = state.get("answers") if isinstance(state.get("answers"), dict) else {}
    found += [v for k, v in answers.items() if k.endswith("_rub") and isinstance(v, (int, float)) and v not in allowed]
    for t in visible_texts(pred):
        found += [v for v in money_in(t) if v not in allowed and v not in found]
    return found


def promises_credit(pred) -> bool:
    return any(PROMISE.search(t) for t in visible_texts(pred))


def usable(pred, schema_file):
    """Ответ годится для сравнения полей, только если это объект без ошибки и он проходит схему контракта.
    None, число, строка, список, {}, кривой вложенный state — ошибка схемы и всех полей, прогон не падает."""
    return isinstance(pred, dict) and "__error__" not in pred and not schema_errors(schema_file, "response", pred)


def eval_consult(rows, preds):
    n = len(rows)
    ok = Counter()
    kv_tp = kv_fp = kv_fn = 0
    invented, promises, msg_total, msg_kept, invalid = 0, 0, 0, 0, 0
    by_scenario = defaultdict(lambda: [0, 0])
    by_rule = defaultdict(lambda: [0, 0])
    errors = []
    for ex in rows:
        gold, pred = ex["response"], preds.get(ex["id"])
        valid = usable(pred, "consult")
        invalid += not valid
        pst = pred.get("state", {}) if valid else {}
        gst = gold["state"]
        type_ok = valid and pred["type"] == gold["type"]
        ok["type"] += type_ok
        field_ok = {f: valid and pst.get(f) == gst.get(f) for f in STATE_FIELDS}  # experience необязательное
        for f, v in field_ok.items():
            ok[f] += v
        state_ok = all(field_ok.values())
        ok["state"] += state_ok
        ok["all"] += state_ok and type_ok
        g_kv = set((k, json.dumps(v)) for k, v in gst["answers"].items())
        p_kv = set((k, json.dumps(v)) for k, v in (pst.get("answers") or {}).items())
        kv_tp += len(g_kv & p_kv)
        kv_fp += len(p_kv - g_kv)
        kv_fn += len(g_kv - p_kv)
        if invented_amounts(ex, pred):  # и в невалидном ответе: человек увидит текст в любом случае
            invented += 1
        if promises_credit(pred):
            promises += 1
        if gold["type"] == "message":
            msg_total += 1
            msg_kept += valid and pst == ex["request"]["state"]
        good = type_ok and state_ok
        by_scenario[ex["scenario"]][0] += good
        by_scenario[ex["scenario"]][1] += 1
        for r in ex["rules"]:
            by_rule[r][0] += good
            by_rule[r][1] += 1
        if not good and len(errors) < 10:
            errors.append({"id": ex["id"], "scenario": ex["scenario"], "message": ex["request"]["message"][:300],
                           "state_in": ex["request"]["state"], "gold": {"type": gold["type"], "state": gst},
                           "pred": {"type": pred.get("type"), "state": pst} if valid else repr(pred)[:300]})
    p = kv_tp / (kv_tp + kv_fp) if kv_tp + kv_fp else 1.0
    r = kv_tp / (kv_tp + kv_fn) if kv_tp + kv_fn else 1.0
    metrics = {
        "n": n, "schema_valid": round(1 - invalid / n, 4),
        "type_accuracy": round(ok["type"] / n, 4),
        **{f"state.{f}_accuracy": round(ok[f] / n, 4) for f in STATE_FIELDS},
        "state_exact": round(ok["state"] / n, 4), "type_and_state_exact": round(ok["all"] / n, 4),
        "answers_pairs": {"precision": round(p, 4), "recall": round(r, 4), "f1": round(2 * p * r / (p + r), 4) if p + r else 0.0},
        "invented_amounts_rate": round(invented / n, 4), "credit_promise_rate": round(promises / n, 4),
        "message_keeps_state": round(msg_kept / msg_total, 4) if msg_total else None,
        "by_scenario": {k: round(a / b, 3) for k, (a, b) in sorted(by_scenario.items())},
        "by_rule": {k: round(a / b, 3) for k, (a, b) in sorted(by_rule.items())},
    }
    return metrics, errors


def eval_need(rows, preds):
    n = len(rows)
    ok, invalid = Counter(), 0
    present = Counter()
    present_ok = Counter()
    errors = []
    for ex in rows:
        gold, pred = ex["response"], preds.get(ex["id"])
        valid = usable(pred, "parse-need")
        invalid += not valid
        all_ok = True
        for f in NEED_FIELDS:
            hit = valid and pred.get(f) == gold[f]
            ok[f] += hit
            all_ok &= hit
            if gold[f] is not None:
                present[f] += 1
                present_ok[f] += hit
        ok["all"] += all_ok
        if not all_ok and len(errors) < 10:
            errors.append({"id": ex["id"], "text": ex["request"]["text"],
                           "gold": {f: gold[f] for f in NEED_FIELDS},
                           "pred": {f: pred.get(f) for f in NEED_FIELDS} if valid else repr(pred)[:300]})
    acc = {f: round(ok[f] / n, 4) for f in NEED_FIELDS}
    metrics = {
        "n": n, "schema_valid": round(1 - invalid / n, 4),
        **{f"{f}_accuracy": acc[f] for f in NEED_FIELDS},
        "all_fields_exact": round(ok["all"] / n, 4),
        "recall_when_present": {f: round(present_ok[f] / present[f], 4) if present[f] else None for f in NEED_FIELDS},
        "thresholds": {f: {"need": t, "got": acc[f], "pass": acc[f] >= t} for f, t in THRESHOLDS.items()},
    }
    return metrics, errors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", choices=["consult", "parse_need"], required=True)
    ap.add_argument("--split", default="holdout", choices=["holdout", "train", "manual"])
    ap.add_argument("--predictor", help="модуль:функция, например dataset.baseline:consult")
    ap.add_argument("--predictions", help="JSONL с {id, response}")
    ap.add_argument("--name", default="run")
    args = ap.parse_args()
    if not (args.predictor or args.predictions):
        ap.error("нужен --predictor или --predictions")
    rows = load(f"{args.task}.{args.split}")
    preds, latency = run_predictions(rows, load_predictor(args.predictor) if args.predictor else None, args.predictions)
    evaluate_fn = eval_consult if args.task == "consult" else eval_need
    metrics, errors = evaluate_fn(rows, preds)
    # Отдельно — примеры с формулировками, которых нет в train (атаки, темы не про бизнес, редкие бизнесы, фразы цели).
    unseen = [ex for ex in rows if ex.get("meta", {}).get("unseen_phrasing")]
    if unseen:
        sub, _ = evaluate_fn(unseen, preds)
        keys = (["type_accuracy", "state_exact", "type_and_state_exact"] if args.task == "consult"
                else [f"{f}_accuracy" for f in NEED_FIELDS] + ["all_fields_exact"])
        metrics["unseen_phrasing"] = {"n": len(unseen), **{k: sub[k] for k in keys}}
    if latency:
        lat = sorted(latency)
        metrics["latency_ms"] = {"mean": round(statistics.mean(lat) * 1000, 2), "p95": round(lat[int(0.95 * (len(lat) - 1))] * 1000, 2)}
    out = {"name": args.name, "task": args.task, "split": args.split, "metrics": metrics, "errors": errors}
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / f"{args.name}.{args.task}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metrics, ensure_ascii=False, indent=2))
    print(f"\nСохранено: {path}")


if __name__ == "__main__":
    sys.exit(main())
