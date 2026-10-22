"""Бета-тест 1: «без сотрудников» -> staff = 0 (docs/tasks/ROUND4_danya_final.md, п. 1; templates.md, п. 5: staff — наёмные).
Через HTTP-путь сервиса и схему контракта."""
import unittest

from fastapi.testclient import TestClient

from app.main import app
from dataset.common import schema_errors

STAFF = "Сколько будет сотрудников?"
DONE = {"sphere": "bakery", "city": "Самара", "own_funds_rub": 900000, "answers": {}}
TPL = [{"role": "user", "content": "Пекарня в Самаре, 900 тысяч"},
       {"role": "assistant", "content": "Уточню пару моментов.\nКакая площадь помещения, м²?\n" + STAFF}]
EXP = [{"role": "user", "content": "Пекарня в Самаре, 900 тысяч"},
       {"role": "assistant", "content": "Уточню пару моментов.\nЕсть ли у вас опыт в этом бизнесе? "
                                        "Варианты: Нет опыта / Работал наёмным / Был свой бизнес\n" + STAFF}]


class Staff(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def consult(self, message, state=DONE, history=TPL):
        r = self.client.post("/ai/consult", json={"message": message, "state": state, "history": list(history)})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(schema_errors("consult", "response", body), [], body)
        return body

    def staff(self, *a, **kw):
        return self.consult(*a, **kw)["state"]["answers"].get("staff")

    def test_zero_as_answer(self):
        for ans in ["0", "ноль", "без сотрудников", "никого", "работаю сам", "я один", "сам", "сама", "буду одна",
                    "только я", "без наёмных работников"]:
            with self.subTest(ans=ans):
                self.assertEqual(self.staff(f"{STAFF} {ans}"), 0)

    def test_zero_in_free_text(self):
        for msg in ["работать буду сам", "работаю один, площадь 40", "продавцов не будет, сама за прилавком",
                    "персонала не будет", "сотрудников 0"]:
            with self.subTest(msg=msg):
                self.assertEqual(self.staff(msg), 0)
        first = self.consult("хочу пекарню, работать буду сам", {**DONE, "sphere": None, "city": None, "own_funds_rub": None}, [])
        self.assertEqual(first["state"]["answers"], {"staff": 0})

    def test_not_zero(self):
        for msg, value in [("сам себе хозяин", None), ("я сам решу потом, площадь 50", None), (f"{STAFF} 2 сотрудника", 2),
                           (f"{STAFF} двое", 2), ("работать будут трое", 3), ("60 сотрудников", None),  # 60 > max: не пишем
                           ("работаю один год продавцом", None), ("никого не знаю", None)]:
            with self.subTest(msg=msg):
                self.assertEqual(self.staff(msg), value)
        # «нет» на вопрос не о сотрудниках — не 0.
        hist = [TPL[0], {"role": "assistant", "content": "Уточню пару моментов.\nКакая площадь помещения, м²?"}]
        out = self.consult("нет", DONE, hist)
        self.assertEqual((out["type"], out["state"]["answers"]), ("ready", {}))

    def test_experience_not_confused(self):
        """Правило 9: «нет» в раунде с опытом — опыт none, а не 0 сотрудников; обе строки «Вопрос? Ответ» — оба ответа."""
        out = self.consult("нет", DONE, EXP)
        self.assertEqual((out["state"].get("experience"), out["state"]["answers"]), ("none", {}))
        out = self.consult(f"Есть ли у вас опыт в этом бизнесе? Работал наёмным\n{STAFF} сама", DONE, EXP)
        self.assertEqual((out["state"].get("experience"), out["state"]["answers"]), ("employee", {"staff": 0}))
        out = self.consult("Был свой бизнес, теперь работаю сам", DONE, EXP)
        self.assertEqual((out["state"].get("experience"), out["state"]["answers"]), ("owner", {"staff": 0}))


if __name__ == "__main__":
    unittest.main()
