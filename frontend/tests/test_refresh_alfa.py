import importlib.util
import json
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('refresh', Path(__file__).parents[1] / 'scripts/refresh_alfa.py')
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)
# Representative fixture from the official comparison table; discounted hero rate differs.
CASH = '''<h1>От 14% Ставка со скидкой</h1><table>
<tr><th></th><th>Кредит одной суммой без залога</th><th>Кредит одной суммой с залогом</th></tr>
<tr><td>Ставка</td><td>от 23,5%</td><td>от 21,5%</td></tr>
<tr><td>Ставка со скидкой при оформлении Защиты бизнеса и Подписки</td><td>от 14%</td><td>от 14%</td></tr>
<tr><td>Сумма</td><td>От 300\u202f000 ₽ до 30 млн ₽</td><td>От 500 000 ₽ до 150 млн ₽</td></tr>
<tr><td>Срок</td><td>От 1 до 5 лет</td><td>От 1 до 10 лет</td></tr></table>
<p>Возобновляемая кредитная линия с залогом — от 500 тысяч ₽ до 60 млн ₽, срок кредитования — 60 месяцев</p>
<p>Срок ведения бизнеса от 9 месяцев на дату подачи заявки</p>'''
MORTGAGE = '<p>От 23% Процентная ставка</p><p>До 150 млн ₽ Сумма кредита</p><p>До 10 лет Срок кредита</p>'
class ParserTests(unittest.TestCase):
    def setUp(self): self.previous = json.loads(refresh.OUTPUT.read_text())
    def test_table_and_hero_rates_remain_distinct(self):
        data = refresh.parse_snapshot({'businesscredit': CASH, 'businessipoteka': MORTGAGE}, self.previous)
        p = {p['id']: p for p in data['products']}
        self.assertEqual(p['fast']['rateFrom'], 23.5)
        self.assertEqual(p['fast']['discountRateFrom'], 14)
        self.assertEqual(p['fast']['amountMax'], 30_000_000)
        self.assertEqual(p['secured']['amountMin'], 500_000)
        self.assertEqual(p['mortgage']['rateFrom'], 23)
        self.assertEqual(p['revolving']['termMax'], 60)
        self.assertEqual(p['revolving']['amountMin'], 500_000)
    def test_bad_layout_does_not_publish_partial_terms(self):
        for cash, mortgage in [(CASH.replace('Ставка</td>', 'Новая колонка</td>'), MORTGAGE), ('<p>Доступ ограничен</p>', MORTGAGE), (CASH, '<p>Попробуйте позже</p>')]:
            with self.assertRaises(ValueError): refresh.parse_snapshot({'businesscredit': cash, 'businessipoteka': mortgage}, self.previous)
        self.assertEqual(json.loads(refresh.OUTPUT.read_text()), self.previous)
    def test_number_formats(self):
        self.assertEqual(refresh.money('От 500 тысяч ₽ до 60 млн ₽'), [500_000, 60_000_000])
        self.assertEqual(refresh.money('От 300\u00a0000\u202f₽ до 30 млн ₽'), [300_000, 30_000_000])
        self.assertEqual(refresh.terms('От одного до десяти лет'), (12, 120))
        with self.assertRaises(ValueError): refresh.rate('по запросу')
