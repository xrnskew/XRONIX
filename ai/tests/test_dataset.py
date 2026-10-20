"""Датасет: валидатор ловит нарушения правил, данные проходят проверку, генерация детерминирована.

Запуск из папки ai: python -m unittest tests.test_dataset -v (нужны dataset/requirements.txt и сгенерированные данные).
"""
import copy
import random
import unittest

from dataset.consult import Seed, expected, empty_state
from dataset.validate import check_consult, check_need, load


class ValidatorCatches(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.consult = load("consult.holdout")
        cls.need = load("parse_need.holdout")
        cls.ready = next(e for e in cls.consult if e["response"]["type"] == "ready" and e["response"]["state"]["sphere"] == "coffee")
        cls.msg = next(e for e in cls.consult if e["response"]["type"] == "message")

    def broken(self, ex, mutate):
        ex = copy.deepcopy(ex)
        mutate(ex)
        return check_consult(ex)

    def test_clean_examples_pass(self):
        self.assertEqual(check_consult(self.ready), [])
        self.assertEqual(check_consult(self.msg), [])

    def test_choice_label_instead_of_value(self):
        self.assertTrue(self.broken(self.ready, lambda e: e["response"]["state"]["answers"].update(format="Кофе с собой")))

    def test_number_out_of_range(self):
        self.assertTrue(self.broken(self.ready, lambda e: e["response"]["state"]["answers"].update(area_m2=5000)))

    def test_answer_from_other_template(self):
        self.assertTrue(self.broken(self.ready, lambda e: e["response"]["state"]["answers"].update(posts=2)))

    def test_digits_or_promise_in_text(self):
        self.assertTrue(self.broken(self.ready, lambda e: e["response"].update(text="Нужно 1500000 рублей")))
        self.assertTrue(self.broken(self.msg, lambda e: e["response"].update(text="Вам точно одобрят кредит")))

    def test_invented_own_funds(self):
        self.assertTrue(self.broken(self.ready, lambda e: e["response"]["state"].update(own_funds_rub=777777)))

    def test_message_changes_state(self):
        self.assertTrue(self.broken(self.msg, lambda e: e["response"]["state"].update(city="Тверь")))

    def test_need_confidence_and_city(self):
        ex = copy.deepcopy(next(e for e in self.need if e["response"]["amount_rub"]))
        ex["response"]["confidence"].pop("amount_rub")
        self.assertTrue(check_need(ex))


class Rules(unittest.TestCase):
    def test_offtopic_keeps_state(self):
        prev = {"sphere": "coffee", "city": "Казань", "own_funds_rub": 300000, "answers": {"format": "to_go"}}
        r = expected(prev, {}, flag="offtopic")
        self.assertEqual((r["type"], r["state"]), ("message", prev))

    def test_one_template_round_then_ready(self):
        facts = {"sphere": "coffee", "city": "Казань", "own_funds_rub": 300000, "answers": {}}
        first = expected(empty_state(), facts)
        self.assertEqual(first["type"], "questions")
        self.assertLessEqual(len(first["questions"]), 4)
        second = expected(first["state"], {"answers": {"area_m2": 20}})
        self.assertEqual(second["type"], "ready")
        self.assertEqual(second["state"]["answers"], {"area_m2": 20})

    def test_deterministic(self):
        def build(i):
            r = random.Random(f"t{i}")
            return Seed(f"s{i}", r, lambda: r.choice(["Казань", "Самара", "Тверь"])).build(random.Random(f"v{i}"))
        self.assertEqual([build(i) for i in range(30)], [build(i) for i in range(30)])


if __name__ == "__main__":
    unittest.main()
