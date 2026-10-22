"""«Денег пока нет» = own_funds_rub 0 (ошибка, найденная Сашей на a9bf846). Через HTTP-путь сервиса и схему контракта.

Граница: отрицание — ноль своих денег, только рядом со словами про деньги или в ответ на вопрос о них.
Просто «нет» и «нет опыта» — не ноль; ответ «нет» про деньги — не ответ про опыт (правило 9).
"""
import unittest

from fastapi.testclient import TestClient

from app.main import app
from app.rules.consult import FUNDS_INTRO
from dataset.common import schema_errors

EMPTY = {"sphere": None, "city": None, "own_funds_rub": None, "answers": {}}
FUNDS_Q = "Уточню.\nСколько своих денег готовы вложить в запуск? Если своих нет, напишите «нет»."
SASHA_FORMS = ["денег пока нет", "денег нет", "своих денег нет", "пока нет денег", "ничего нет", "без денег", "нет своих", "ноль"]
OUR_FORMS = ["средств нет", "накоплений пока нет", "денег у меня нет совсем", "ни копейки", "своих средств нет"]


class ZeroFunds(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def consult(self, message, state=EMPTY, history=()):
        r = self.client.post("/ai/consult", json={"message": message, "state": state, "history": list(history)})
        self.assertEqual(r.status_code, 200, r.text)
        body = r.json()
        self.assertEqual(schema_errors("consult", "response", body), [], body)
        return body

    def test_sasha_case(self):
        r = self.consult("Хочу салон красоты в Твери, денег пока нет")
        self.assertEqual(r["state"]["own_funds_rub"], 0)
        self.assertNotIn("own_funds", [q["id"] for q in r["questions"]])  # про деньги второй раз не спрашиваем

    def test_answer_to_funds_question(self):
        st = {**EMPTY, "sphere": "coffee", "city": "Казань"}
        hist = [{"role": "user", "content": "Кофейня в Казани"}, {"role": "assistant", "content": FUNDS_Q}]
        for msg in SASHA_FORMS + OUR_FORMS:
            with self.subTest(msg=msg):
                out = self.consult(msg, st, hist)
                self.assertEqual((out["state"]["own_funds_rub"], out["state"].get("experience")), (0, None))

    def test_first_message_with_money_words(self):
        for msg in ["хочу пекарню, денег пока нет", "нет денег, но есть идея автомойки", "Хочу ПВЗ в Омске, без денег",
                    "Кофейня в Самаре, пока нет денег", "Барбершоп в Королёве, нет своих, только идея",
                    "Магазин одежды в Туле, своих средств пока нет", "Пекарня в Перми, денег нет, нужен кредит 500 тысяч"]:
            with self.subTest(msg=msg):
                self.assertEqual(self.consult(msg)["state"]["own_funds_rub"], 0)

    def test_bare_no_is_not_zero(self):
        self.assertIsNone(self.consult("нет")["state"]["own_funds_rub"])
        # «нет» на вопрос о городе: не ноль денег и не «не по теме» — спрашиваем снова.
        hist = [{"role": "user", "content": "Хочу пекарню"}, {"role": "assistant", "content": "Уточню.\nВ каком городе открываетесь?"}]
        out = self.consult("нет", {**EMPTY, "sphere": "bakery"}, hist)
        self.assertEqual((out["type"], out["state"]["own_funds_rub"]), ("questions", None))
        for msg in ["Хочу кофейню в Казани, ничего нет", "Хочу кофейню в Казани, ноль"]:  # нет слов про деньги
            with self.subTest(msg=msg):
                self.assertIsNone(self.consult(msg)["state"]["own_funds_rub"])

    def test_no_experience_is_not_zero_funds(self):
        for msg in ["Хочу кофейню в Казани, нет опыта", "Барбершоп в Королёве, опыта ноль"]:
            with self.subTest(msg=msg):
                self.assertIsNone(self.consult(msg)["state"]["own_funds_rub"])
        # Ответ «нет опыта» на вопрос о своих деньгах — тоже не ноль.
        st = {**EMPTY, "sphere": "coffee", "city": "Казань"}
        hist = [{"role": "user", "content": "Кофейня в Казани"}, {"role": "assistant", "content": FUNDS_Q}]
        self.assertIsNone(self.consult("нет опыта", st, hist)["state"]["own_funds_rub"])
        # В раунде с вопросом об опыте «нет» — опыт none, свои деньги не меняются.
        msg = "Хочу пекарню в Самаре, своих 900 тысяч"
        r = self.consult(msg)
        seen = "\n".join([r["text"]] + [q["text"] + (" Варианты: " + " / ".join(q["options"]) if q.get("options") else "")
                                        for q in r["questions"]])
        out = self.consult("нет", r["state"], [{"role": "user", "content": msg}, {"role": "assistant", "content": seen}])
        self.assertEqual((out["state"]["own_funds_rub"], out["state"].get("experience")), (900000, "none"))

    def test_funds_intro_is_specific(self):
        r = self.consult("Хочу салон красоты в Твери")
        self.assertEqual([q["id"] for q in r["questions"]], ["own_funds"])
        self.assertEqual(r["text"], FUNDS_INTRO)


if __name__ == "__main__":
    unittest.main()
