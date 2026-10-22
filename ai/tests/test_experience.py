"""Правило 9 contracts/ai.md: опыт в этом бизнесе (ROUND4_experience.md). Через HTTP-путь сервиса и схему контракта."""
import json
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from dataset.common import schema_errors

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
EMPTY = {"sphere": None, "city": None, "own_funds_rub": None, "answers": {}}


def seen(r: dict) -> str:
    return "\n".join([r["text"]] + [q["text"] + (" Варианты: " + " / ".join(q["options"]) if q.get("options") else "")
                                    for q in r.get("questions", [])])


class Experience(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.labels = [v["title"] for v in json.loads((CONTRACTS / "dictionaries.json").read_text(encoding="utf-8"))
                      ["experiences"].values()]

    def consult(self, message, state, history=()):
        r = self.client.post("/ai/consult", json={"message": message, "state": state, "history": list(history)})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(schema_errors("consult", "response", body), [], body)
        return body

    def first_round(self):
        msg = "Хочу пекарню в Самаре, своих 900 тысяч"
        r = self.consult(msg, EMPTY)
        return r, [{"role": "user", "content": msg}, {"role": "assistant", "content": seen(r)}]

    def test_asked_first_in_questionnaire_round(self):
        r, _ = self.first_round()
        q = r["questions"]
        self.assertEqual((q[0]["id"], q[0]["kind"], q[0]["options"]), ("experience", "choice", self.labels))
        self.assertLessEqual(len(q), 4)  # maxItems consult.schema.json
        self.assertNotIn("experience", r["state"])  # в запросе не было — в ответе не появляется, пока не узнали

    def test_answers_by_label_and_words(self):
        r, hist = self.first_round()
        for msg, value in [("Нет опыта", "none"), ("Работал наёмным", "employee"), ("Был свой бизнес", "owner"),
                           ("Есть ли у вас опыт в этом бизнесе? Нет опыта\nКакая площадь помещения, м²? 40", "none"),
                           ("опыта нет, площадь 40", "none"), ("работала по найму два года", "employee")]:
            with self.subTest(msg=msg):
                out = self.consult(msg, r["state"], hist)
                self.assertEqual((out["type"], out["state"].get("experience")), ("ready", value))

    def test_other_answer_gives_null_and_no_second_ask(self):
        r, hist = self.first_round()
        out = self.consult("Не знаю, считайте как обычно", r["state"], hist)
        self.assertEqual(out["type"], "ready")  # ready от опыта не зависит, повторно не спрашиваем
        self.assertIsNone(out["state"].get("experience"))

    def test_separate_round_when_questionnaire_not_needed(self):
        msg = "Пекарня в Самаре, своих 900 тысяч, площадь 40, покупателей 150 в день, чек 300, сотрудников 4"
        r = self.consult(msg, EMPTY)
        self.assertEqual((r["type"], [q["id"] for q in r["questions"]]), ("questions", ["experience"]))
        out = self.consult("Был свой бизнес", r["state"], [{"role": "user", "content": msg},
                                                             {"role": "assistant", "content": seen(r)}])
        self.assertEqual((out["type"], out["state"]["experience"]), ("ready", "owner"))

    def test_known_experience_is_kept_and_not_asked(self):
        state = {**EMPTY, "experience": "employee"}
        r = self.consult("Хочу пекарню в Самаре, своих 900 тысяч", state)
        self.assertNotIn("experience", [q["id"] for q in r["questions"]])
        self.assertEqual(r["state"]["experience"], "employee")

    def test_no_from_hints_and_own_funds_is_not_experience(self):
        """«Нет» из подсказки ассистента или ответ про свои деньги — не ответ про опыт (критерий Ильи)."""
        r, hist = self.first_round()
        for msg in ["Сколько своих денег готовы вложить в запуск? Если своих нет, напишите «нет». 900 тысяч",
                    "своих нет, считайте", "Нет, давайте лучше кофейню", "денег нет, площадь 40", "нет, не знаю"]:
            with self.subTest(msg=msg):
                out = self.consult(msg, r["state"], hist)
                self.assertIsNone(out["state"].get("experience"))
        # Тот же короткий «нет» в раунде без вопроса об опыте (про свои деньги) — тоже не опыт.
        st = {**EMPTY, "sphere": "bakery", "city": "Самара"}
        hist2 = [{"role": "user", "content": "Пекарня в Самаре"},
                 {"role": "assistant", "content": "Уточню.\nСколько своих денег готовы вложить в запуск? Если своих нет, напишите «нет»."}]
        out = self.consult("нет", st, hist2)
        self.assertEqual((out["state"]["own_funds_rub"], out["state"].get("experience")), (0, None))

    def test_new_chat_asks_again(self):
        """Опыт — свойство бизнеса из этого диалога: новый чат спрашивает снова, старый ответ не переносится."""
        r, hist = self.first_round()
        self.consult("Был свой бизнес", r["state"], hist)
        again = self.consult("Хочу автомойку в Казани, своих 2 млн", EMPTY)
        self.assertEqual(again["questions"][0]["id"], "experience")

    def test_contract_example(self):
        ex = json.loads((CONTRACTS / "examples" / "consult.response.experience.json").read_text(encoding="utf-8"))
        r = self.consult("Хочу открыть кофейню в Казани, есть около 300 тысяч", EMPTY)
        self.assertEqual(r["questions"][0]["options"], ex["questions"][0]["options"])
        self.assertEqual({k: v for k, v in r["state"].items() if k != "experience"},
                         {k: v for k, v in ex["state"].items() if k != "experience"})


if __name__ == "__main__":
    unittest.main()
