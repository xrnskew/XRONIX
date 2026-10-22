"""Классы ошибок независимой оценки (docs/tasks/ROUND4_danya_eval_fixes.md) — на своих фразах: фразы самой оценки
«раскрыты» и сюда не копируются. Через HTTP-путь сервиса и схемы контракта."""
import unittest

from fastapi.testclient import TestClient

from app.main import app
from dataset.common import schema_errors

EMPTY = {"sphere": None, "city": None, "own_funds_rub": None, "answers": {}}


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def need(self, text):
        r = self.client.post("/ai/parse-need", json={"text": text})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(schema_errors("parse-need", "response", r.json()), [], r.json())
        return r.json()

    def consult(self, message):
        r = self.client.post("/ai/consult", json={"message": message, "state": EMPTY, "history": []})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(schema_errors("consult", "response", r.json()), [], r.json())
        return r.json()


class OwnMoneyIsNotLoan(Base):
    """Класс 1: свои деньги и желаемый доход — не сумма кредита."""

    def test_amounts(self):
        for text, amount in [("Нужен кредит 2 миллиона, свои 700 тысяч уже есть", 2_000_000),
                             ("накопила 400 тысяч, на запуск не хватает ещё 900 тысяч", 900_000),
                             ("есть 1,2 млн своих, у банка нужно ещё 800 тысяч", 800_000),
                             ("3кк надо на автомойку, своих 1кк", 3_000_000),
                             ("отложено 250к, займ нужен на 600к", 600_000),
                             ("хочу выйти на 200 тысяч чистыми в месяц, сколько займа понадобится?", None),
                             ("чтобы зарабатывать 150к в месяц, какой кредит брать?", None),
                             ("свои 500 тысяч есть, сколько ещё нужно?", None)]:
            with self.subTest(text=text):
                self.assertEqual(self.need(text)["amount_rub"], amount)

    def test_revenue_and_collateral_unchanged(self):
        self.assertEqual(self.need("выручка 2 млн в месяц, нужно 1 млн на пылесосы")["amount_rub"], 1_000_000)
        self.assertEqual(self.need("надо 4 млн. есть недвижимость под залог")["amount_rub"], 4_000_000)


class AgeIsNotTerm(Base):
    """Класс 2: возраст и стаж — не срок кредита."""

    def test_terms(self):
        for text, term in [("мне 23 года, хочу взять кредит на открытие пекарни", None),
                           ("возраст 30 лет, нужен займ 500 тысяч", None),
                           ("в бизнесе 7 лет, нужно 2 млн на оборудование", None),
                           ("работаем 8 месяцев, нужно 300к на полгода", 6),
                           ("исполнилось 45 лет, дадут кредит на 3 года?", 36),
                           ("дайте мне на 3 года 500 тысяч", 36),
                           ("кредит на 2 года, мне 40 лет", 24)]:
            with self.subTest(text=text):
                self.assertEqual(self.need(text)["term_months"], term)


class ColloquialAmountsAndTerms(Base):
    """Класс 3: «тысяч 600», «тыщ 300», «тыс 900», «2кк», «лет на 5», «месяцев на 8», «срок лет 3»."""

    def test_amount_and_term(self):
        for text, amount, term in [("нужно тысяч 600, лет на 5", 600_000, 60),
                                   ("тыщ 300 на закупку товара, месяцев на 8", 300_000, 8),
                                   ("кредит на миллион, срок лет 3", 1_000_000, 36),
                                   ("тыс 900 бы на ремонт, года на 2", 900_000, 24),
                                   ("надо тысяч 250.", 250_000, None),
                                   ("не хватает миллиона, срок года 2", 1_000_000, 24),
                                   ("2кк на оборудование", 2_000_000, None)]:
            with self.subTest(text=text):
                r = self.need(text)
                self.assertEqual((r["amount_rub"], r["term_months"]), (amount, term))

    def test_old_forms_kept(self):
        for text, amount in [("2 миллиона на 3 года", 2_000_000), ("1,5 миллиона", 1_500_000), ("полтора миллиона", 1_500_000),
                             ("миллиона 2 не хватает", 2_000_000), ("800к", 800_000)]:
            with self.subTest(text=text):
                self.assertEqual(self.need(text)["amount_rub"], amount)


class GenericCityWord(Base):
    """Класс 4: «в городе», «в нашем городке», «в центре», «в районе» — не название города."""

    def test_no_city(self):
        for msg in ["хочу открыть пекарню у себя в городе", "пекарня у нас в городе, своих 500к",
                    "автомойку в родном городе открыть хочу", "кофейню в центре города хочу",
                    "салон красоты в моем районе", "пвз в нашем посёлке"]:
            with self.subTest(msg=msg):
                self.assertIsNone(self.consult(msg)["state"]["city"])
        self.assertIsNone(self.need("кредит на кофейню в нашем городе")["city"])

    def test_real_city_still_found(self):
        for msg, city in [("кофейня в городе Тверь", "Тверь"), ("пекарня в Городце", "Городец")]:
            with self.subTest(msg=msg):
                self.assertEqual(self.consult(msg)["state"]["city"], city)


class CitySpelling(Base):
    """Класс 5: названия с дефисом — без дефиса, строчными, заглавными, первая часть в другом падеже."""

    def test_cities(self):
        for msg, city in [("автомойка в ростов на дону", "Ростов-на-Дону"),
                          ("магазин одежды в комсомольске на амуре", "Комсомольск-на-Амуре"),
                          ("кофейня, город санкт петербург", "Санкт-Петербург"),
                          ("пекарня в петропавловске камчатском", "Петропавловск-Камчатский"),
                          ("ПВЗ В УЛАН УДЭ", "Улан-Удэ"),
                          ("салон красоты в ростове-на-дону", "Ростов-на-Дону")]:
            with self.subTest(msg=msg):
                self.assertEqual(self.consult(msg)["state"]["city"], city)
        self.assertEqual(self.need("кредит на пекарню в нижнем новгороде")["city"], "Нижний Новгород")


class SphereNotGuessed(Base):
    """Класс 6: кофейный автомат — не кофейня (предлагаем как похожую с вопросом); два варианта — спрашиваем."""

    def test_vending(self):
        for msg in ["хочу поставить кофейные автоматы в торговом центре", "вендинг с кофе в бизнес-центре",
                    "думаю про автомат с кофе у вокзала", "кофейный аппарат в институте поставить"]:
            with self.subTest(msg=msg):
                r = self.consult(msg)
                self.assertIsNone(r["state"]["sphere"])
                self.assertIn("кофейню", r["questions"][0]["text"])  # «Ближе всего по расчёту — кофейню. Считаем так?»
        self.assertEqual(self.consult("хочу кофейню, кофе с собой")["state"]["sphere"], "coffee")
        self.assertEqual(self.need("купить кофемашину для кофейни")["sphere"], "coffee")

    def test_two_options(self):
        for msg, options in [("то ли барбершоп, то ли магазин одежды", ["Салон красоты", "Магазин одежды"]),
                             ("кофейня или пекарня, пока не решил, в Твери", ["Кофейня", "Пекарня"]),
                             ("может шиномонтаж, а может пункт выдачи", ["Автомойка", "Пункт выдачи заказов"]),
                             ("либо ПВЗ, либо что-то с автомобилями", ["Пункт выдачи заказов", "Автомойка"])]:
            with self.subTest(msg=msg):
                r = self.consult(msg)
                self.assertIsNone(r["state"]["sphere"])
                self.assertEqual((r["questions"][0]["id"], r["questions"][0]["options"]), ("sphere", options))
        for msg, sphere in [("кофейня или кафе с посадкой", "coffee"), ("не кофейня, а пекарня", "bakery"),
                            ("может, пекарню?", "bakery")]:
            with self.subTest(msg=msg):
                self.assertEqual(self.consult(msg)["state"]["sphere"], sphere)
        self.assertIsNone(self.need("кредит на кофейню или пекарню")["sphere"])

    def test_choice_answer_sets_sphere(self):
        r = self.consult("то ли барбершоп, то ли магазин одежды")
        hist = [{"role": "user", "content": "то ли барбершоп, то ли магазин одежды"},
                {"role": "assistant", "content": r["text"] + "\n" + r["questions"][0]["text"]}]
        out = self.client.post("/ai/consult", json={"message": "Какой вариант посчитаем? Магазин одежды", "state": EMPTY,
                                                    "history": hist}).json()
        self.assertEqual(out["state"]["sphere"], "clothing_store")


if __name__ == "__main__":
    unittest.main()
