"""Датасет: валидатор ловит нарушения правил, данные проходят проверку, генерация детерминирована.

Запуск из папки ai: python -m unittest tests.test_dataset -v (нужны dataset/requirements.txt и сгенерированные данные).
"""
import copy
import random
import unittest

from dataset.consult import Seed, expected, empty_state
from dataset.evaluate import eval_consult, eval_need, invented_amounts, promises_credit, run_predictions
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


class HistoryShowsQuestions(unittest.TestCase):
    """Ревью Ильи, п. 1: в history — всё, что видел человек; ожидаемых фактов вне запроса нет."""

    @classmethod
    def setUpClass(cls):
        cls.rows = load("consult.train") + load("consult.holdout")

    def test_every_assistant_turn_has_questions(self):
        for ex in self.rows:
            for h in ex["request"]["history"]:
                if h["role"] == "assistant":
                    self.assertIn("?", h["content"], ex["id"])

    def test_confirmed_sphere_was_proposed(self):
        confirmed = [e for e in self.rows if e["scenario"] == "confirm_nearest" and e["response"]["state"]["sphere"]]
        self.assertTrue(confirmed)
        for ex in confirmed:
            hist = "\n".join(h["content"] for h in ex["request"]["history"])
            self.assertIn("Ближе всего по расчёту", hist, ex["id"])
            self.assertIn("Варианты: Да, подходит / Нет, другой бизнес", hist, ex["id"])

    def test_short_answers_refer_to_asked_questions(self):
        """«Какая площадь помещения, м²? 20» — вопрос из строки ответа есть в истории."""
        checked = 0
        for ex in self.rows:
            hist = "\n".join(h["content"] for h in ex["request"]["history"])
            for line in ex["request"]["message"].split("\n"):
                if ex["scenario"] in ("answer_template", "answer_core") and "?" in line:
                    question = line.split("?")[0] + "?"
                    self.assertIn(question, hist, ex["id"])
                    checked += 1
        self.assertGreater(checked, 100)

    def test_validator_rejects_text_only_history(self):
        ex = copy.deepcopy(next(e for e in self.rows if e["scenario"] == "confirm_nearest" and e["response"]["state"]["sphere"]))
        ex["request"]["history"][-1]["content"] = "Такого шаблона у меня нет, но могу посчитать по похожему бизнесу."
        errs = check_consult(ex)
        self.assertIn("в history реплика ассистента без вопросов", errs)
        self.assertIn("подтверждение сферы без предложения в history", errs)


class InventedAmounts(unittest.TestCase):
    """Ревью Ильи, п. 2: суммы цифрами, словами и сокращениями во всех видимых текстах."""

    @classmethod
    def setUpClass(cls):
        cls.ex = next(e for e in load("consult.holdout") if not e["meta"]["user_amounts"] and e["request"]["state"]["own_funds_rub"] is None)
        cls.own = next(e for e in load("consult.holdout") if e["response"]["state"]["own_funds_rub"])

    def resp(self, text, questions=None, base=None):
        r = copy.deepcopy((base or self.ex)["response"])
        r["text"] = text
        if questions is not None:
            r["questions"] = questions
        return r

    def test_invented_in_any_form(self):
        for text in ["Запуск стоит восемьсот тысяч рублей.", "Прибыль составит пятьдесят тысяч рублей в месяц.",
                     "Для запуска нужно 500 ₽.", "Кредит на 1,5 млн", "Нужно около 800к", "Аренда 120 000 в месяц"]:
            self.assertTrue(invented_amounts(self.ex, self.resp(text)), text)

    def test_questions_and_options_checked(self):
        q = [{"id": "x", "text": "Хватит ли 300 тысяч?", "kind": "text"}]
        self.assertTrue(invented_amounts(self.ex, self.resp("Уточню.", q)))
        q = [{"id": "x", "text": "Бюджет?", "kind": "choice", "options": ["до 500 тыс", "больше"]}]
        self.assertTrue(invented_amounts(self.ex, self.resp("Уточню.", q)))

    def test_not_money(self):
        self.assertEqual(invented_amounts(self.ex, self.resp("Площадь 20 м², 3 сотрудника, 120 гостей в день, на 24 месяца.")), [])

    def test_repeating_own_funds_is_ok_inventing_is_not(self):
        own = self.own["response"]["state"]["own_funds_rub"]
        self.assertEqual(invented_amounts(self.own, self.resp(f"Учту ваши {own} рублей.", base=self.own)), [])
        bad = copy.deepcopy(self.own["response"])
        bad["state"]["own_funds_rub"] = own + 123_000
        self.assertTrue(invented_amounts(self.own, bad))

    def test_promise_anywhere_visible(self):
        q = [{"id": "x", "text": "Продолжим?", "kind": "choice", "options": ["Да, вам одобрят", "Нет"]}]
        self.assertTrue(promises_credit(self.resp("Уточню.", q)))
        self.assertFalse(promises_credit(self.resp("Решение принимает банк, обещать не могу.")))


class EvaluatorSurvivesGarbage(unittest.TestCase):
    """Ревью Ильи, п. 3: любой ответ predictor — ошибка схемы и полей, но не падение прогона."""

    def test_garbage_predictions(self):
        c, n = load("consult.holdout")[0], load("parse_need.holdout")[0]
        bad_state = {"type": "ready", "text": "x", "state": {"sphere": 5, "city": None, "own_funds_rub": None, "answers": {}}}
        for bad in [None, 42, "строка", [1, 2], {}, bad_state, {"__error__": "boom"}]:
            m, _ = eval_consult([c], {c["id"]: bad})
            self.assertEqual((m["schema_valid"], m["type_accuracy"], m["state_exact"]), (0.0, 0.0, 0.0), repr(bad))
            m, _ = eval_need([n], {n["id"]: bad})
            self.assertEqual((m["schema_valid"], m["all_fields_exact"]), (0.0, 0.0), repr(bad))

    def test_predictor_exception(self):
        def boom(_):
            raise RuntimeError("модель упала")
        rows = load("consult.holdout")[:3]
        preds, _ = run_predictions(rows, boom)
        m, errors = eval_consult(rows, preds)
        self.assertEqual(m["schema_valid"], 0.0)
        self.assertEqual(len(errors), 3)


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
        second = expected(first["state"], {"answers": {"area_m2": 20}}, template_asked=True)
        self.assertEqual(second["type"], "ready")
        self.assertEqual(second["state"]["answers"], {"area_m2": 20})

    def test_full_state_alone_does_not_mean_round_passed(self):
        """Раунд анкеты определяется по истории, а не по полноте state."""
        full = {"sphere": "coffee", "city": "Казань", "own_funds_rub": 300000, "answers": {}}
        self.assertEqual(expected(full, {}, template_asked=False)["type"], "questions")
        self.assertEqual(expected(full, {}, template_asked=True)["type"], "ready")

    def test_deterministic(self):
        def build(i):
            r = random.Random(f"t{i}")
            return Seed(f"s{i}", r, lambda: r.choice(["Казань", "Самара", "Тверь"])).build(random.Random(f"v{i}"))
        self.assertEqual([build(i) for i in range(30)], [build(i) for i in range(30)])


if __name__ == "__main__":
    unittest.main()
