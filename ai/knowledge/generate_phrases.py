"""Банк фраз через GigaChat при разработке (раунд 3, A2). В образ сервиса не входит, зависимости — knowledge/requirements.txt.

Из папки ai, ключ только в переменной окружения (в код, логи и файлы он не попадает):
    $env:GIGACHAT_AUTH_KEY = "..."                         # PowerShell; Linux/macOS: export GIGACHAT_AUTH_KEY=...
    python -m knowledge.generate_phrases                   # слоты без сырого ответа -> GigaChat -> knowledge/phrases.review.md
    python -m knowledge.generate_phrases --slots ask_city --refresh   # перегенерировать отдельные слоты
    python -m knowledge.generate_phrases --review-only     # пересобрать файл вычитки из сырых ответов, без сети
    python -m knowledge.generate_phrases --assemble --reviewed-by "Даня"   # отмеченное [x] -> app/rules/data/phrases.json

Вычитка: в knowledge/phrases.review.md у каждого варианта стоит [x] (годится) или [ ] (автопроверка не прошла).
Человек снимает [x] с неудачных, может поправить текст. --assemble ещё раз гоняет автопроверку и требует
от MIN_VARIANTS до MAX_VARIANTS вариантов на слот. Промпт — knowledge/phrases_prompt.md, ответы — knowledge/raw/gigachat/.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import time

from .common import CA_BUNDLE, DATA_DIR, KNOWLEDGE_DIR, RAW_DIR, load_json, save_json
from .phrase_rules import MAX_VARIANTS, MIN_VARIANTS, SLOTS, check_variant, slot_sphere

RAW = RAW_DIR / "gigachat"
REVIEW = KNOWLEDGE_DIR / "phrases.review.md"
PROMPT = KNOWLEDGE_DIR / "phrases_prompt.md"
OUT = DATA_DIR / "phrases.json"
ASK = 15  # просим с запасом: часть отсеет автопроверка и вычитка


def prompt_parts() -> tuple:
    text = PROMPT.read_text(encoding="utf-8")
    system = text.split("## system", 1)[1].split("## user", 1)[0].strip()
    user = text.split("## user", 1)[1].strip()
    return system, user


def slot_messages(slot: str) -> list:
    description, instruction, required, allowed, question = SLOTS[slot]
    system, user = prompt_parts()
    fill = {"description": description, "instruction": instruction, "count": str(ASK),
            "placeholders": ", ".join("{" + p + "}" for p in sorted(allowed)) or "нет, фраза без подстановок",
            "required": ", ".join("{" + p + "}" for p in sorted(required)) or "нет",
            "question_rule": "Каждый вариант — прямой вопрос со знаком «?», до 150 символов." if question
            else "Каждый вариант — до 250 символов."}
    for k, v in fill.items():
        user = user.replace("{{" + k + "}}", v)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def call_gigachat(messages: list) -> tuple:
    from gigachat import GigaChat
    from gigachat.models import Chat, Messages, MessagesRole

    key = os.environ.get("GIGACHAT_AUTH_KEY", "").strip()
    if not key:
        sys.exit("Нет переменной окружения GIGACHAT_AUTH_KEY (ключ в файлы не кладём)")
    model = os.environ.get("GIGACHAT_MODEL", "GigaChat-2-Max")
    roles = {"system": MessagesRole.SYSTEM, "user": MessagesRole.USER}
    chat = Chat(model=model, temperature=0.9, max_tokens=3000,
                messages=[Messages(role=roles[m["role"]], content=m["content"]) for m in messages])
    for attempt in range(3):  # обрыв соединения (часто из-за VPN) — повторяем, остальные ошибки сразу наверх
        giga = GigaChat(credentials=key, scope=os.environ.get("GIGACHAT_SCOPE", "GIGACHAT_API_PERS"), model=model,
                        ca_bundle_file=str(CA_BUNDLE), timeout=90)
        try:
            resp = giga.chat(chat)
            break
        except Exception as e:
            if "ConnectError" not in type(e).__name__ or attempt == 2:
                raise
            print(f"  обрыв соединения с GigaChat, повтор {attempt + 1}/2 через 10 с (VPN выключен?)")
            time.sleep(10)
        finally:
            giga.close()
    usage = resp.usage.model_dump() if getattr(resp, "usage", None) else None
    return resp.choices[0].message.content, getattr(resp, "model", model), usage


def parse_variants(text: str) -> list:
    """JSON-массив из ответа; если модель обернула его в ``` или дописала пояснение — достаём массив."""
    m = re.search(r"\[.*\]", text, re.S)
    try:
        items = json.loads(m.group()) if m else []
    except json.JSONDecodeError:
        items = [re.sub(r'^\s*(?:[-*•]|\d+[.)])\s*|^"|",?\s*$', "", line) for line in text.splitlines()]
    seen, out = set(), []
    for t in items:
        t = re.sub(r"\s+", " ", str(t)).strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return out


# ---------- файл вычитки ----------

# Строка варианта: «- [x] текст   ← пометка вычитки   ← автопроверка: …». Пометки в текст не входят;
# пометка вычитки сохраняется при перезаписи файла, автопроверка пересчитывается заново.
LINE = re.compile(r"^- \[( |x|X)\] (.+)$")
SEP = "   ← "


def read_review() -> dict:
    """{слот: [(отмечен, текст, пометка вычитки или None)]}."""
    out, slot = {}, None
    if not REVIEW.exists():
        return out
    for line in REVIEW.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            slot = line[3:].strip()
            out[slot] = []
        elif slot and (m := LINE.match(line)):
            text, *notes = m.group(2).split(SEP)
            note = next((n.strip() for n in notes if not n.startswith("автопроверка")), None)
            out[slot].append((m.group(1).lower() == "x", text.strip(), note))
    return out


def write_review(review: dict) -> None:
    lines = ["# Вычитка банка фраз", "",
             "Снимите `[x]` с неудачных вариантов (или поправьте текст), затем: "
             "`python -m knowledge.generate_phrases --assemble --reviewed-by \"Имя\"`.",
             f"Нужно от {MIN_VARIANTS} до {MAX_VARIANTS} отмеченных вариантов на слот. "
             "`[ ]` с пометкой «автопроверка» — вариант не прошёл проверку и в банк не попадёт, даже если поставить `[x]`. "
             "Пометка «Claude: …» — предложение при вычитке: согласны — оставьте как есть, нет — поменяйте отметку. "
             "Пометки после «   ← » в текст фразы не входят.", ""]
    for slot in SLOTS:
        lines += [f"## {slot}", f"> {SLOTS[slot][0]}", ""]
        for ok, text, note in review.get(slot, []):
            problems = check_variant(slot, text)
            mark = "x" if ok and not problems else " "
            lines.append(f"- [{mark}] {text}" + (SEP + note if note else "") +
                         (f"{SEP}автопроверка: {'; '.join(problems)}" if problems else ""))
        lines.append("")
    REVIEW.write_text("\n".join(lines), encoding="utf-8")


def generate(slots: list, refresh: bool) -> None:
    review = read_review()
    for slot in slots:
        path = RAW / f"{slot}.json"
        if path.exists() and not refresh:
            continue
        messages = slot_messages(slot)
        text, model, usage = call_gigachat(messages)
        if path.exists():  # предыдущий сырой ответ не затираем: он остаётся рядом как <slot>.prev<N>.json
            n = len(list(RAW.glob(f"{slot}.prev*.json"))) + 1
            path.rename(RAW / f"{slot}.prev{n}.json")
        save_json(path, {"slot": slot, "model": model, "date": dt.date.today().isoformat(), "messages": messages,
                         "response": text, "usage": usage})
        variants = parse_variants(text)
        review[slot] = [(not check_variant(slot, v), v, None) for v in variants]
        ok = sum(1 for v in variants if not check_variant(slot, v))
        print(f"{slot}: {len(variants)} вариантов, прошли автопроверку {ok}")
        write_review(review)  # после каждого слота: прерванный прогон не теряет готовое


def review_only() -> None:
    review = read_review()
    for slot in SLOTS:
        raw = load_json(RAW / f"{slot}.json")
        if raw and slot not in review:
            review[slot] = [(not check_variant(slot, v), v, None) for v in parse_variants(raw["response"])]
    write_review(review)
    print(f"Вычитка: {REVIEW}")


def assemble(reviewed_by: str) -> int:
    review, errs, slots = read_review(), [], {}
    models = sorted({load_json(RAW / f"{s}.json", {}).get("model") for s in SLOTS} - {None})
    dates = sorted({load_json(RAW / f"{s}.json", {}).get("date") for s in SLOTS} - {None})
    for slot, (description, *_rest) in SLOTS.items():
        variants = []
        for ok, text, _note in review.get(slot, []):
            if ok and not check_variant(slot, text) and text not in variants:
                variants.append(text)
        if len(variants) < MIN_VARIANTS:
            errs.append(f"{slot}: отмечено {len(variants)}, нужно не меньше {MIN_VARIANTS}")
        entry = {"description": description, "variants": variants[:MAX_VARIANTS]}
        if slot_sphere(slot):
            entry["sphere"] = slot_sphere(slot)
        slots[slot] = entry
    for e in errs:
        print("ОШИБКА", e)
    if errs:
        return 1
    bank = {"comment": "Варианты сгенерированы GigaChat по knowledge/phrases_prompt.md, проверены автоматически "
                       "(knowledge/phrase_rules.py) и вычитаны человеком. Числа — только через подстановки.",
            "version": 1,
            "generated": {"tool": f"{', '.join(models) or 'GigaChat'} через API", "date": dates[-1] if dates else
                          dt.date.today().isoformat(), "reviewed_by": reviewed_by},
            "slots": slots}
    from dataset.common import schema_errors
    bad = schema_errors("knowledge", "phrases_file", bank)
    if bad:
        print("ОШИБКА схемы:", bad[:5])
        return 1
    save_json(OUT, bank)
    print(f"{OUT}: {len(slots)} слотов, {sum(len(s['variants']) for s in slots.values())} вариантов")
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--slots", help="через запятую; по умолчанию все")
    ap.add_argument("--refresh", action="store_true", help="перегенерировать, даже если сырой ответ уже есть")
    ap.add_argument("--review-only", action="store_true")
    ap.add_argument("--assemble", action="store_true")
    ap.add_argument("--reviewed-by")
    args = ap.parse_args(argv)
    if args.assemble:
        if not args.reviewed_by:
            ap.error("--assemble требует --reviewed-by")
        return assemble(args.reviewed_by)
    if args.review_only:
        return review_only()
    slots = args.slots.split(",") if args.slots else list(SLOTS)
    unknown = [s for s in slots if s not in SLOTS]
    if unknown:
        ap.error(f"неизвестные слоты: {unknown}")
    generate(slots, args.refresh)
    print(f"Вычитка: {REVIEW}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
