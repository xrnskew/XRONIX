"""Быстрая проверка запущенного сервиса: шлёт запросы как бэк и сверяет ответы с контрактом.

Сначала запусти сервис (в отдельном окне):
  .\\.venv\\Scripts\\python -m uvicorn app.main:app --port 8001
Потом:
  .\\.venv\\Scripts\\python smoke_test.py
План генерируется по-настоящему: ~10 с и ~2000 токенов.
"""
import json
import sys
import time

import httpx

from app.models import PlanReply, QuestionsReply, SummarizeResponse

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8001"

CONTEXT = {
    "profile": {"name": "Александр", "city": "Москва", "experience": "Новичок", "budget_rub": 500000},
    "tags": ["общепит", "новичок"],
    "memory": "",
}
IDEA = "Хочу открыть кофейню у метро"
ANSWERS = "500 тыс – 2 млн, опыта нет, Москва, у станции Таганская"

failed = 0


def check(name, ok, details=""):
    global failed
    failed += not ok
    print(f"{'OK  ' if ok else 'FAIL'} {name} {details}")


with httpx.Client(base_url=URL, timeout=60) as c:
    r = c.get("/ai/health")
    check("health", r.status_code == 200 and r.json() == {"status": "ok"}, r.text)

    # 1. Первое сообщение -> вопросы
    first = {"mode": "chat", "user_context": CONTEXT, "history": [], "message": IDEA}
    r = c.post("/ai/respond", json=first)
    questions = r.json()
    try:
        QuestionsReply.model_validate(questions)
        check("respond -> questions", r.status_code == 200, f"{len(questions['questions'])} вопроса")
    except Exception as e:
        check("respond -> questions", False, f"{r.status_code} {e}")

    # 2. Ответы на вопросы -> план (настоящий GigaChat)
    second = {
        "mode": "chat", "user_context": CONTEXT,
        "history": [{"role": "user", "content": IDEA},
                    {"role": "assistant", "content": json.dumps(questions, ensure_ascii=False)}],
        "message": ANSWERS,
    }
    t = time.time()
    r = c.post("/ai/respond", json=second)
    sec = time.time() - t
    try:
        reply = PlanReply.model_validate(r.json())
        p = reply.plan
        check("respond -> plan", r.status_code == 200 and "plan_id" not in r.json(),
              f"{sec:.1f}s «{p.title}», старт {p.finance.startup_cost_rub}, кредит {p.credit.amount_rub}")
        check("plan < 25s (бюджет бэка 30s)", sec < 25, f"{sec:.1f}s")
    except Exception as e:
        check("respond -> plan", False, f"{r.status_code} {r.text[:300]} {e}")

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
