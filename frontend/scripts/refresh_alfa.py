#!/usr/bin/env python3
"""Refresh public Alfa-Bank terms; no API keys, personal data or disabled TLS checks.

python3 scripts/refresh_alfa.py [--html-dir saved-pages] [--allow-cached]
Only a complete, validated snapshot replaces the previous one, using an atomic rename.
"""
import argparse
from datetime import datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'src/data/alfaProducts.snapshot.json'
URLS = {
    'businesscredit': 'https://alfabank.ru/sme/profits/businesscredit/',
    'businessipoteka': 'https://alfabank.ru/sme/profits/businessipoteka/',
}


def clean(text):
    return re.sub(r'\s+', ' ', text.replace('\xa0', ' ').replace('\u202f', ' ')).strip()


class Page(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.tables, self.parts, self.rows, self.cells, self.cell = [], [], None, None, None
        self.skip = 0
        self.feed(html)
        self.text = clean(' '.join(self.parts))

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'): self.skip += 1
        if self.skip: return
        if tag == 'table': self.rows = []
        if tag == 'tr' and self.rows is not None: self.cells = []
        if tag in ('td', 'th') and self.cells is not None: self.cell = []

    def handle_data(self, data):
        if self.skip: return
        self.parts.append(data)
        if self.cell is not None: self.cell.append(data)

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
            return
        if self.skip: return
        if tag in ('td', 'th') and self.cell is not None:
            self.cells.append(clean(' '.join(self.cell))); self.cell = None
        if tag == 'tr' and self.cells is not None:
            self.rows.append(self.cells); self.cells = None
        if tag == 'table' and self.rows is not None:
            self.tables.append(self.rows); self.rows = None


def rate(text):
    match = re.search(r'(\d+(?:[.,]\d+)?)\s*%', text)
    if not match: raise ValueError(f'Rate missing: {text}')
    value = float(match[1].replace(',', '.'))
    if not 0 < value <= 100: raise ValueError('Rate outside expected range')
    return value


def money(text):
    values = []
    for m in re.finditer(r'(\d[\d ]*(?:[.,]\d+)?)\s*(млн|миллион\w*|тыс\w*|₽|руб\w*)', clean(text), re.I):
        amount = float(m[1].replace(' ', '').replace(',', '.'))
        unit = m[2].lower()
        amount *= 1_000_000 if unit.startswith(('млн', 'миллион')) else 1000 if unit.startswith('тыс') else 1
        values.append(round(amount))
    if not values: raise ValueError(f'Amounts missing: {text}')
    if not all(10_000 <= n <= 10_000_000_000 for n in values): raise ValueError('Amount outside expected range')
    return values


def terms(text):
    text = clean(text).lower().replace('одного', '1').replace('пяти', '5').replace('десяти', '10')
    match = re.search(r'от\s*(\d+)\s*(?:до|[–—-])\s*(\d+)\s*(лет|год\w*|мес\w*)', text)
    if not match: raise ValueError(f'Term range missing: {text}')
    scale = 1 if match[3].startswith('мес') else 12
    lo, hi = int(match[1]) * scale, int(match[2]) * scale
    if not 1 <= lo <= hi <= 240: raise ValueError('Term outside expected range')
    return lo, hi


def cash_products(page, products):
    # Require the official side-by-side table and exact product columns. Do not take
    # the advertised discounted hero rate as the ordinary interest rate.
    for rows in page.tables:
        header = next((r for r in rows if any('Кредит одной суммой без залога' in c for c in r)
                       and any('Кредит одной суммой с залогом' in c for c in r)), None)
        if header is None: continue
        for pid, phrase in [('fast', 'без залога'), ('secured', 'с залогом')]:
            idx = next(i for i, c in enumerate(header) if phrase in c)
            # Some tables omit the leading empty header cell; align from the right.
            offset = len(header) - idx
            data = {}
            for row in rows:
                if not row or len(row) <= offset: continue
                label, value = row[0].lower(), row[-offset]
                if label == 'ставка': data['rateFrom'] = rate(value)
                elif 'ставка со скидкой' in label: data['discountRateFrom'] = rate(value)
                elif label == 'сумма':
                    amounts = money(value)
                    if len(amounts) != 2: raise ValueError('Expected both amount bounds')
                    data.update(amountMin=amounts[0], amountMax=amounts[1])
                elif label == 'срок':
                    lo, hi = terms(value); data.update(termMin=lo, termMax=hi)
            required = {'rateFrom', 'discountRateFrom', 'amountMin', 'amountMax', 'termMin', 'termMax'}
            if data.keys() != required: raise ValueError(f'Incomplete table for {pid}: {list(data)}')
            p = next(p for p in products if p['id'] == pid)
            p.update(data)
            p['note'] = (f"Обычная ставка от {data['rateFrom']:g}%; от {data['discountRateFrom']:g}% — "
                         'при оформлении Защиты бизнеса и Подписки. Стоимость дополнительных услуг уточняйте в банке.')
        return
    raise ValueError('Official cash loan table not found; layout may have changed')


def parse_snapshot(pages, previous):
    products = json.loads(json.dumps(previous['products']))
    page = Page(pages['businesscredit'])
    cash_products(page, products)
    # Keep the credit-line facts together, rather than mixing a general hero limit
    # with another product's terms. Stop if the official wording changes.
    m = re.search(r'Возобновляемая кредитная линия с залогом.{0,500}?срок кредитования\s*[—–-]?\s*(\d+)\s*месяц', page.text, re.I)
    if not m: raise ValueError('Secured revolving line terms not found')
    amounts = money(m[0])
    if len(amounts) != 2: raise ValueError('Credit line amount bounds missing')
    line = next(p for p in products if p['id'] == 'revolving')
    line.update(amountMin=amounts[0], amountMax=amounts[1], termMax=int(m[1]))
    # Requirements are shared by these business loans; fail closed on change.
    age = re.search(r'Срок ведения бизнеса от\s*(\d+)\s*месяц', page.text, re.I)
    if not age: raise ValueError('Business age requirement missing')
    mortgage = Page(pages['businessipoteka'])
    hero = re.search(r'От\s*\d+(?:[.,]\d+)?\s*%\s*Процентная ставка.{0,200}?Срок кредита', mortgage.text, re.I)
    if not hero: raise ValueError('Mortgage main terms missing')
    max_years = re.search(r'До\s*(\d+)\s*лет', hero[0], re.I)
    if not max_years: raise ValueError('Mortgage maximum term missing')
    p = next(p for p in products if p['id'] == 'mortgage')
    p.update(rateFrom=rate(hero[0]), amountMax=max(money(hero[0])), termMax=int(max_years[1]) * 12)
    for p in products:
        p['minBusinessMonths'] = int(age[1])
        if p['amountMin'] is not None and p['amountMin'] > p['amountMax']: raise ValueError('Reversed amounts')
        if not 1 <= p['termMax'] <= 240: raise ValueError('Unexpected maximum term')
        if not p['url'].startswith('https://alfabank.ru/sme/profits/'): raise ValueError('Unexpected destination')
    return {'checkedAt': datetime.now(ZoneInfo('Asia/Sakhalin')).date().isoformat(), 'method': 'official-html-parser', 'products': products}


def main():
    cli = argparse.ArgumentParser()
    cli.add_argument('--html-dir', type=Path)
    cli.add_argument('--allow-cached', action='store_true')
    args = cli.parse_args()
    try:
        pages = {}
        for key, url in URLS.items():
            if args.html_dir:
                pages[key] = (args.html_dir / f'{key}.html').read_text()
            else:
                req = Request(url, headers={'User-Agent': 'XRONIX-PublicTerms/1.0', 'Accept-Language': 'ru'})
                with urlopen(req, timeout=25) as response:
                    if not response.url.startswith('https://alfabank.ru/'):
                        raise ValueError('Unexpected redirect outside official bank site')
                    pages[key] = response.read(5_000_001).decode('utf-8')
                    if len(pages[key]) > 5_000_000: raise ValueError('Page too large')
        snapshot = parse_snapshot(pages, json.loads(OUTPUT.read_text()))
        temp = OUTPUT.with_suffix('.tmp')
        temp.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
        temp.replace(OUTPUT)
        print('Official Alfa-Bank snapshot refreshed:', snapshot['checkedAt'])
    except Exception as exc:
        print(f'Cannot refresh Alfa-Bank terms; previous dated snapshot retained: {exc}', file=sys.stderr)
        if not args.allow_cached: return 1
        print('::warning::Alfa-Bank refresh failed; using the last checked, dated snapshot.')
    return 0


if __name__ == '__main__': sys.exit(main())
