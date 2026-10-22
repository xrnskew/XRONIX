"""Бета-тест 1: «не знаю», «что-то прибыльное», «посоветуйте» — три разных ответа подряд, а не один и тот же вопрос
о сфере (docs/tasks/ROUND4_danya_final.md, п. 2). Через HTTP-путь сервиса и схему контракта."""
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.rules import knowledge as kn
from app.rules.text import amounts
from dataset.common import schema_errors

EMPTY = {"sphere": None, "city": None, "own_funds_rub": None, "answers": {}}


def seen(r: dict) -> str:
    return "\n".join([r["text"]] + [q["text"] + (" Варианты: " + " / ".join(q["options"]) if q.get("options") else "")
                                    for q in r.get("questions", [])])


class Undecided(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def series(self, messages, state=EMPTY):
        out, hist = [], []
        for m in messages:
            r = self.client.post("/ai/consult", json={"message": m, "state": state, "history": hist}).json()
            self.assertEqual(schema_errors("consult", "response", r), [], r)
            out.append(r)
            hist = hist + [{"role": "user", "content": m}, {"role": "assistant", "content": seen(r)}]
            state = r["state"]
        return out

    def test_three_different_answers(self):
        for city in (None, "Самара", "Тверь"):
            with self.subTest(city=city):
                rs = self.series(["не знаю", "хочу что-то прибыльное", "посоветуйте"], {**EMPTY, "city": city})
                self.assertEqual([r["type"] for r in rs], ["questions"] * 3)
                self.assertEqual(len({r["text"] for r in rs}), 3)  # тексты разные
                self.assertEqual(len({seen(r) for r in rs}), 3)  # и вопросы не повторяются слово в слово
                for r in rs:
                    self.assertLessEqual(len(r["text"]), 600)
                    self.assertEqual(amounts(seen(r)), [])  # ни одной суммы
                    self.assertIsNone(r["state"]["sphere"])
                self.assertIn("Что ближе", rs[0]["text"])
                self.assertIn("Например, пекарня", rs[1]["text"])
                if city:  # пример — в городе из state, число только из базы
                    self.assertIn(kn.city_in()[city].lower(), rs[1]["text"].lower())
                    self.assertIn("OpenStreetMap", rs[1]["text"])
                labels = [o for q in rs[2]["questions"] for o in q["options"]]
                self.assertEqual(len(labels), 6)  # шесть сфер кнопками (у choice не больше 5 — два вопроса)

    def test_buttons_lead_to_sphere(self):
        rs = self.series(["не знаю что открыть", "Что ближе? Общепит", "Да, давайте"], {**EMPTY, "city": "Казань"})
        self.assertIn("кофейн", rs[1]["text"])
        self.assertEqual(rs[2]["state"]["sphere"], "coffee")
        rs = self.series(["не знаю", "посоветуйте", "Нет, другой бизнес", "Или услуги? Автомойка"])
        self.assertEqual(rs[2]["questions"][1]["id"], "sphere_services")
        self.assertEqual(rs[3]["state"]["sphere"], "car_wash")

    def test_button_answer_parsed_by_answer_only(self):
        """Замечание Саши к d9cffea: «Посчитаем для примера пекарню? Нет, другой бизнес» — сфера не из вопроса."""
        from app.rules.consult import SPHERE_ACC
        for code, acc in SPHERE_ACC.items():
            q = f"Посчитаем для примера {acc}?"
            hist = [{"role": "user", "content": "не знаю"},
                    {"role": "assistant", "content": f"Например.\n{q} Варианты: Да, давайте / Нет, другой бизнес"}]
            for h in (hist, []):  # и когда бэкенд не положил вопрос в history
                for ans in ["Нет, другой бизнес", "нет", "не хочу", "другой"]:
                    with self.subTest(sphere=code, ans=ans, history=bool(h)):
                        r = self.client.post("/ai/consult", json={"message": f"{q} {ans}", "state": EMPTY, "history": h}).json()
                        self.assertIsNone(r["state"]["sphere"])
                        self.assertEqual([x["id"] for x in r["questions"]], ["sphere", "sphere_services"])  # шесть сфер
                with self.subTest(sphere=code, ans="да", history=bool(h)):
                    r = self.client.post("/ai/consult", json={"message": f"{q} Да, давайте", "state": EMPTY, "history": h}).json()
                    self.assertEqual(r["state"]["sphere"], code)
        hist = [{"role": "user", "content": "не знаю"}, {"role": "assistant", "content": "Что ближе? Варианты: Общепит / Услуги / Торговля"}]
        for ans in ["Общепит", "Услуги", "Торговля"]:
            r = self.client.post("/ai/consult", json={"message": f"Что ближе? {ans}", "state": EMPTY, "history": hist}).json()
            self.assertIsNone(r["state"]["sphere"])  # категория — пример, а не сфера
        hist = [{"role": "user", "content": "посоветуйте"}, {"role": "assistant", "content": "Общепит или торговля? Варианты: Кофейня / "
                                                                                          "Пекарня / Магазин одежды\nИли услуги?"}]
        r = self.client.post("/ai/consult", json={"message": "Общепит или торговля? Магазин одежды", "state": EMPTY, "history": hist}).json()
        self.assertEqual(r["state"]["sphere"], "clothing_store")

    def test_experience_answer_still_parsed(self):
        """Правило 9 не задето: «Есть ли у вас опыт…? Нет опыта» — опыт none, сфера и деньги прежние."""
        st = {"sphere": "bakery", "city": "Самара", "own_funds_rub": 900000, "answers": {}}
        hist = [{"role": "user", "content": "Пекарня в Самаре, 900 тысяч"},
                {"role": "assistant", "content": "Уточню.\nЕсть ли у вас опыт в этом бизнесе? Варианты: Нет опыта / Работал наёмным / "
                                                 "Был свой бизнес\nКакая площадь помещения, м²?"}]
        for ans, value in [("Нет опыта", "none"), ("Был свой бизнес", "owner"), ("нет", "none")]:
            r = self.client.post("/ai/consult", json={"message": f"Есть ли у вас опыт в этом бизнесе? {ans}", "state": st,
                                                      "history": hist}).json()
            self.assertEqual((r["state"].get("experience"), r["state"]["sphere"], r["state"]["own_funds_rub"]),
                             (value, "bakery", 900000))

    def test_known_sphere_not_affected(self):
        """«Не знаю» при известной сфере — пропуск вопроса анкеты, а не подбор сферы."""
        r = self.series(["Хочу кофейню в Казани, своих 300 тысяч, формат не знаю"])[0]
        self.assertEqual(r["state"]["sphere"], "coffee")
        self.assertNotIn("Что ближе", r["text"])


if __name__ == "__main__":
    unittest.main()
