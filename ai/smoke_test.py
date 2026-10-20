"""Быстрая проверка запущенного сервиса: ведёт диалог как бэк и сверяет ответы с контрактом.

Сначала запусти сервис (в отдельном окне):
  .\\.venv\\Scripts\\python -m uvicorn app.main:app --port 8001
Потом:
  .\\.venv\\Scripts\\python smoke_test.py
Всё по-настоящему через GigaChat: ~30 с и ~6000 токенов.

FAIL — нарушен контракт (бэк такое отклонит). WARN — контракт соблюдён, но ИИ ответил не тем типом,
который ожидался по смыслу (повод посмотреть промпт).
"""
import json
import sys
import time

import httpx
from pydantic import ValidationError

from app.models import MessageReply, PlanReply, QuestionsReply, SummarizeResponse

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001"
REPLIES = {"message": MessageReply, "questions": QuestionsReply, "plan": PlanReply}

# Профиль почти пустой, чтобы ИИ было что спрашивать.
CONTEXT = {"profile": {"name": "Даня", "city": None, "experience": None, "budget_rub": None}, "tags": [], "memory": ""}
IDEA = "Хочу открыть кофейню"

failed = 0


def check(name, ok, details=""):
    global failed
    failed += not ok
    print(f"{'OK  ' if ok else 'FAIL'} {name} {details}")


def warn(name, details=""):
    print(f"WARN {name} {details}")


def ask(c, history, message):
    """Один запрос к /ai/respond. Возвращает (ответ, секунды) или (None, секунды) при нарушении контракта."""
    t = time.time()
    r = c.post("/ai/respond", json={"mode": "chat", "user_context": CONTEXT, "history": history, "message": message})
    sec = time.time() - t
    body = r.json()
    if r.status_code != 200:
        check(f"«{message[:30]}»", False, f"{r.status_code} {r.text[:200]}")
        return None, sec
    model = REPLIES.get(body.get("type"))
    try:
        model.model_validate(body)
    except (AttributeError, ValidationError) as e:
        check(f"«{message[:30]}»", False, f"не по контракту: {str(e)[:300]}")
        return None, sec
    if "plan_id" in body:
        check(f"«{message[:30]}»", False, "plan_id ставит бэк, не мы")
        return None, sec
    return body, sec


def answer_questions(questions) -> str:
    """Отвечаем как пользователь: у choice берём второй вариант, на text — что-то правдоподобное."""
    parts = []
    for q in questions:
        a = q["options"][min(1, len(q["options"]) - 1)] if q["kind"] == "choice" else "Москва, рядом с метро, 20 м²"
        parts.append(f"{q['text']} — {a}")
    return "\n".join(parts)


with httpx.Client(base_url=URL, timeout=60) as c:
    r = c.get("/ai/health")
    check("health", r.status_code == 200 and r.json() == {"status": "ok"}, r.text)

    # 1. Не про бизнес -> message
    body, sec = ask(c, [], "Какая завтра погода?")
    if body:
        details = f"{body['type']}, {sec:.1f}s: {body['text'][:80]}"
        if body["type"] == "message":
            check("не по теме -> message", True, details)
        else:
            warn("не по теме -> message", details)

    # 2. Идея без деталей -> вопросы -> ... -> план
    history, message = [], IDEA
    for turn in range(1, 5):
        body, sec = ask(c, history, message)
        if not body:
            break
        if body["type"] == "questions":
            qs = body["questions"]
            check(f"ход {turn}: вопросы", True, f"{sec:.1f}s, {len(qs)} шт.: " + " | ".join(q["text"][:40] for q in qs))
            history += [{"role": "user", "content": message},
                        {"role": "assistant", "content": json.dumps(body, ensure_ascii=False)}]
            message = answer_questions(qs)
            continue
        if body["type"] == "plan":
            p = PlanReply.model_validate(body).plan
            check(f"ход {turn}: план", sec < 25,
                  f"{sec:.1f}s «{p.title}», старт {p.finance.startup_cost_rub}, кредит {p.credit.amount_rub}")
            if turn == 1:
                warn("план без единого вопроса", "по идее «Хочу открыть кофейню» данных мало")
        else:
            warn(f"ход {turn}: ждали вопросы или план", f"{body['type']}: {body.get('text', '')[:80]}")
        break
    else:
        check("диалог дошёл до плана", False, "4 хода без плана")

    # 3. summarize
    r = c.post("/ai/summarize", json={"memory": "", "history": [{"role": "user", "content": IDEA}]})
    try:
        SummarizeResponse.model_validate(r.json())
        check("summarize", r.status_code == 200, r.text[:120])
    except Exception as e:
        check("summarize", False, f"{r.status_code} {e}")

    # 4. Кривой запрос -> 422 в формате ошибки контракта
    r = c.post("/ai/respond", json={"message": "привет"})
    check("bad request -> 422 VALIDATION_ERROR",
          r.status_code == 422 and r.json().get("error", {}).get("code") == "VALIDATION_ERROR", r.text[:120])

print(f"\n{'Всё прошло' if not failed else f'Провалено: {failed}'}")
sys.exit(1 if failed else 0)
