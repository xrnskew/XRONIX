"""Сквозная проверка: фронт -> бэк Ильи -> AI-сервис -> GigaChat.

Нужны запущенные:
  AI-сервис:  .\\.venv\\Scripts\\python -m uvicorn app.main:app --port 8001
  бэк Ильи:   MOCK_AI=false, AI_SERVICE_URL=http://localhost:8001, порт 8000
Потом из папки ai:
  .\\.venv\\Scripts\\python e2e_backend.py [http://localhost:8000]

Создаёт одноразового тестового пользователя со случайной почтой @xronix.test в локальной базе бэка.
"""
import secrets
import sys
import time

import httpx

API = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
failed = 0


def check(name, ok, details=""):
    global failed
    failed += not ok
    print(f"{'OK  ' if ok else 'FAIL'} {name} {details}")
    return ok


def send(c, chat_id, text, answers=None):
    t = time.time()
    body = {"text": text} | ({"answers": answers} if answers else {})
    r = c.post(f"/api/chats/{chat_id}/messages", json=body)
    return r, time.time() - t


def answer(questions):
    """Как фронт: у choice берём второй вариант, на text — правдоподобный ответ."""
    answers, lines = [], []
    for q in questions:
        a = q["options"][min(1, len(q["options"]) - 1)] if q["kind"] == "choice" else "Москва, рядом с метро, 20 м²"
        answers.append({"question_id": q["id"], "answer": a})
        lines.append(f"{q['text']} — {a}")
    return "\n".join(lines), answers


with httpx.Client(base_url=API, timeout=60) as c:
    r = c.get("/health")
    if not check("backend /health", r.status_code == 200, r.text):
        sys.exit(1)

    email = f"e2e-{secrets.token_hex(4)}@xronix.test"
    r = c.post("/api/auth/register", json={"email": email, "password": secrets.token_urlsafe(16), "name": "Тест"})
    if not check("register", r.status_code == 201, str(r.status_code)):
        print(r.text)
        sys.exit(1)
    c.headers["Authorization"] = f"Bearer {r.json()['token']}"

    # --- Диалог: идея -> вопросы -> план ---
    chat_id = c.post("/api/chats").json()["chat_id"]
    text, answers = "Хочу открыть кофейню", None
    plan_id = None
    for turn in range(1, 5):
        r, sec = send(c, chat_id, text, answers)
        if r.status_code != 200:
            check(f"ход {turn}", False, f"{r.status_code} за {sec:.1f}s: {r.text[:300]}")
            break
        reply = r.json()
        if reply["type"] == "questions":
            qs = reply["questions"]
            check(f"ход {turn}: вопросы", True, f"{sec:.1f}s, {len(qs)} шт.: " + " | ".join(q["text"][:35] for q in qs))
            text, answers = answer(qs)
            continue
        if reply["type"] == "plan":
            plan_id = reply.get("plan_id")
            p, cr = reply["plan"], reply["plan"]["credit"]
            check(f"ход {turn}: план", bool(plan_id),
                  f"{sec:.1f}s «{p['title']}», кредит {cr['amount_rub']}, платёж {cr['monthly_payment_rub']}, "
                  f"нагрузка {cr['debt_load_percent']}%, вердикт {cr['verdict']}")
        else:
            check(f"ход {turn}: ждали вопросы или план", False, f"{reply['type']}: {reply.get('text', '')[:100]}")
        break

    if plan_id:
        r = c.get(f"/api/plans/{plan_id}")
        check("GET /api/plans/{id}", r.status_code == 200 and r.json()["plan_id"] == plan_id, str(r.status_code))
        r = c.get(f"/api/chats/{chat_id}")
        n = len(r.json().get("messages", [])) if r.status_code == 200 else 0
        check("история чата сохранена", n >= 4, f"{n} сообщений")

    # --- Не по теме, в новом чате ---
    other = c.post("/api/chats").json()["chat_id"]
    r, sec = send(c, other, "Какая завтра погода?")
    if r.status_code == 200:
        reply = r.json()
        check("не по теме -> message", reply["type"] == "message", f"{sec:.1f}s: {reply.get('text', '')[:80]}")
    else:
        check("не по теме", False, f"{r.status_code}: {r.text[:200]}")

    # --- Память и теги: бэк зовёт /ai/summarize в фоне после плана ---
    if plan_id:
        time.sleep(3)
        me = c.get("/api/me").json()
        print(f"инфо: теги после плана: {me.get('tags')}")

print(f"\n{'Всё прошло' if not failed else f'Провалено: {failed}'}")
sys.exit(1 if failed else 0)
