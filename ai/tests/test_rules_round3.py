"""Доработки правил раунда 3 по ошибкам ручного набора (dataset/manual.py, первичный результат — manual-before)."""
import unittest

from app.rules import extract as ex
from app.rules import parse_need
from app.rules.consult import respond
from app.rules.text import amounts

EMPTY = {"sphere": None, "city": None, "own_funds_rub": None, "answers": {}}


class Round3Rules(unittest.TestCase):
    def test_colloquial_cities(self):
        for text, city in [("пекарня в Нижнем", "Нижний Новгород"), ("кофейня в Новгороде", "Великий Новгород"),
                           ("мойка в Челнах", "Набережные Челны"), ("Питер, кофейня", "Санкт-Петербург"),
                           ("в Нижнем Новгороде", "Нижний Новгород")]:
            self.assertEqual(ex.pick_city(text)[0], city, text)
        self.assertIsNone(ex.pick_city("на нижнем этаже")[0])

    def test_amounts(self):
        self.assertEqual(amounts("накопил 400 тыщ")[0][0], 400000)
        self.assertEqual(amounts("своих тысяч 700")[0][0], 700000)
        self.assertEqual(amounts("тысяч 5 человек"), [])

    def test_own_funds_word_order_and_corrections(self):
        self.assertEqual(ex.own_funds("Пекарня в Ростове, 300 тысяч свои"), 300000)
        self.assertEqual(ex.own_funds("3 млн своих, машин 50 в день"), 3000000)
        self.assertIsNone(ex.own_funds("кредит 2 млн своими силами"))
        self.assertEqual(ex.own_funds("поправка: своих не миллион, а 800 тысяч"), 800000)
        self.assertEqual(ex.own_funds("нисколько, всё в кредит", asked=True), 0)

    def test_negated_sphere(self):
        self.assertEqual(ex.sphere_direct("Не кофейня, а пекарня")[0], "bakery")
        self.assertEqual(ex.sphere_direct("Не хочу автомойку, хочу пункт выдачи")[0], "pickup_point")
        self.assertTrue(ex.sphere_negated("Нет, не кофейню, пекарню"))
        self.assertFalse(ex.sphere_negated("Хочу кофейню"))

    def test_credit_question_and_weather_are_messages(self):
        self.assertEqual(respond({"history": [], "message": "А банк мне точно даст кредит на бизнес?", "state": EMPTY})["type"],
                         "message")
        st = {"sphere": "bakery", "city": "Самара", "own_funds_rub": None, "answers": {}}
        r = respond({"history": [{"role": "user", "content": "Пекарня в Самаре"}], "message": "А какая погода завтра в Самаре?",
                     "state": st})
        self.assertEqual((r["type"], r["state"]), ("message", st))

    def test_bare_amount_only_on_first_turn_without_credit(self):
        self.assertEqual(respond({"history": [], "message": "Питер, кофейня, 1 млн", "state": EMPTY})["state"]["own_funds_rub"], 1000000)
        self.assertIsNone(respond({"history": [], "message": "Кофейня, нужен кредит 1 млн", "state": EMPTY})["state"]["own_funds_rub"])

    def test_parse_need_purposes(self):
        for text, purpose in [("Открываю пункт выдачи Wildberries в Твери", "new_location"),
                              ("Купить склад под пункт выдачи", "real_estate"),
                              ("Добавить к салону красоты услугу массажа", "new_direction"),
                              ("Кофейня в Твери, хотим вторую в Торжке", "new_location")]:
            self.assertEqual(parse_need.parse({"text": text})["purpose"], purpose, text)
        r = parse_need.parse({"text": "У нас автомойка, выручка 2 млн в месяц, нужно 1 млн на новые пылесосы"})
        self.assertEqual((r["purpose"], r["amount_rub"]), ("equipment", 1000000))


if __name__ == "__main__":
    unittest.main()
