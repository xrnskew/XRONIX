"""Разбор текста без моделей: нормализация, числа словами, суммы, сроки, опечатки."""
import re

WORD = re.compile(r"[a-zа-я0-9]+(?:-[a-zа-я0-9]+)*")


def norm(text: str) -> str:
    """Нижний регистр, ё -> е, неразрывные пробелы и кавычки в обычные, пробелы схлопнуты."""
    t = text.lower().replace("ё", "е").replace(" ", " ").replace(" ", " ")
    t = re.sub(r"[«»“”\"']", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def tokens(text: str) -> list:
    return WORD.findall(norm(text))


def edit_distance_le1(a: str, b: str) -> bool:
    """Расстояние Левенштейна (с перестановкой соседних букв) не больше 1."""
    if a == b:
        return True
    la, lb = len(a), len(b)
    if abs(la - lb) > 1:
        return False
    if la == lb:
        diff = [i for i in range(la) if a[i] != b[i]]
        if len(diff) == 1:
            return True
        return len(diff) == 2 and diff[1] == diff[0] + 1 and a[diff[0]] == b[diff[1]] and a[diff[1]] == b[diff[0]]
    if la > lb:
        a, b = b, a
    i = 0
    while i < len(a) and a[i] == b[i]:
        i += 1
    return a[i:] == b[i + 1:]


def fuzzy_in(word: str, options) -> bool:
    """Слово совпадает с одним из вариантов, допускается одна опечатка для слов от 6 букв."""
    return any(word == o or (len(o) >= 6 and edit_distance_le1(word, o)) for o in options)


# ---------- Числа словами ----------

UNITS = {"ноль": 0, "один": 1, "одна": 1, "одно": 1, "два": 2, "две": 2, "три": 3, "четыре": 4, "пять": 5, "шесть": 6,
         "семь": 7, "восемь": 8, "девять": 9, "десять": 10, "одиннадцать": 11, "двенадцать": 12, "тринадцать": 13,
         "четырнадцать": 14, "пятнадцать": 15, "шестнадцать": 16, "семнадцать": 17, "восемнадцать": 18, "девятнадцать": 19}
TENS = {"двадцать": 20, "тридцать": 30, "сорок": 40, "пятьдесят": 50, "шестьдесят": 60, "семьдесят": 70, "восемьдесят": 80,
        "девяносто": 90}
HUNDREDS = {"сто": 100, "двести": 200, "триста": 300, "четыреста": 400, "пятьсот": 500, "шестьсот": 600, "семьсот": 700,
            "восемьсот": 800, "девятьсот": 900}
SMALL = {**UNITS, **TENS, **HUNDREDS}
MULT = {"тысяча": 1000, "тысячи": 1000, "тысяч": 1000, "тыс": 1000, "тыщ": 1000, "тыщи": 1000, "миллион": 10 ** 6, "миллиона": 10 ** 6,
        "миллионов": 10 ** 6, "млн": 10 ** 6, "лям": 10 ** 6, "ляма": 10 ** 6, "лямов": 10 ** 6}


def words_to_number(words: list):
    """['триста', 'пятьдесят', 'тысяч'] -> 350000; ['миллион', 'двести', 'тысяч'] -> 1200000. None, если не число."""
    total, chunk, seen = 0, 0, False
    for w in words:
        if w in SMALL:
            chunk += SMALL[w]
            seen = True
        elif w in MULT:
            total += (chunk or 1) * MULT[w]
            chunk, seen = 0, True
        else:
            return None
    return total + chunk if seen else None


def numbers_in(text: str) -> list:
    """Все числа в тексте: цифры («1 500 000», «1,5») и словами. [(значение, начало, конец)]."""
    t = norm(text)
    out = []
    # «1 200 000» — одно число, в том числе перед запятой или точкой в конце фразы («бюджет 1 200 000, ...»).
    for m in re.finditer(r"\d{1,3}(?: \d{3})+(?!\d)(?![.,]\d)|\d+(?:[.,]\d+)?", t):
        out.append((float(m.group().replace(" ", "").replace(",", ".")), m.start(), m.end()))
    for m in re.finditer(r"(?:(?:" + "|".join(sorted(SMALL, key=len, reverse=True)) + r")\b\s*)+", t):
        n = words_to_number(m.group().split())
        if n is not None:
            out.append((float(n), m.start(), m.end()))
    return sorted(out, key=lambda x: x[1])


# ---------- Суммы ----------

# Что стоит сразу после числа и говорит, что это не деньги.
NOT_MONEY_AFTER = re.compile(r"\s*(мес|месяц|год|года|лет|м2|м²|м\b|кв|квадрат|метр|человек|чел|гост|клиент|покупател|"
                             r"машин|заказ|сотрудник|продавц|пост|мест|кресл|раз|%|процент|минут|час|день|дн)")
MONEY_UNIT = re.compile(r"\s*(млн\.?|миллион\w*|лям\w*|тыс\.?|тысяч\w*|тыщ\w*|к(?![а-я])|руб\w*|р\.|₽)")


def amounts(text: str) -> list:
    """Суммы в рублях с позициями: [(рубли, начало, конец, вид)]. вид: digits | short | words | slang."""
    t = norm(text)
    out = []
    special = [(r"(полтора|полутора)\s+(миллиона|миллионов|ляма|лямов|млн)", 1_500_000, "slang"), (r"полмиллиона|пол-ляма|пол ляма|пол-миллиона", 500_000, "slang"),
               (r"(?<![а-я0-9])(один\s+)?(лям|миллион)(?![а-я])", 1_000_000, "words")]
    taken = []
    # Обратный порядок: «миллиона два», «тысяч триста». Только родительный падеж множителя, перед ним нет числа
    # («2 миллиона три» — это не он), после числа нет второго множителя («миллион двести тысяч» — обычный порядок).
    small_rx = "|".join(sorted(SMALL, key=len, reverse=True))
    for m in re.finditer(r"(?<![а-я])(миллиона|миллионов|ляма|лямов|тысяч)\s+(" + small_rx + r")(?![а-я])(?!\s+(тысяч|миллион|лям))", t):
        before = t[:m.start()].split()
        if before and (before[-1].isdigit() or before[-1] in SMALL):
            continue
        mult = 1000 if m.group(1) == "тысяч" else 10 ** 6
        out.append((SMALL[m.group(2)] * mult, m.start(), m.end(), "words"))
        taken.append((m.start(), m.end()))
    # То же с цифрами: «своих тысяч 700», «миллиона 2». После числа не должно быть единицы («тысяч 5 человек»).
    for m in re.finditer(r"(?<![а-я])(миллиона|миллионов|ляма|лямов|тысяч)\s+(\d{1,3})(?![\d.,])", t):
        before = t[:m.start()].split()
        tail = t[m.end():m.end() + 14]
        if (before and (before[-1].isdigit() or before[-1] in SMALL)) or NOT_MONEY_AFTER.match(tail) \
                or MONEY_UNIT.match(tail) or any(a <= m.start() < b for a, b in taken):
            continue
        mult = 1000 if m.group(1) == "тысяч" else 10 ** 6
        out.append((int(m.group(2)) * mult, m.start(), m.end(), "short"))
        taken.append((m.start(), m.end()))
    for rx, value, kind in special:
        for m in re.finditer(rx, t):
            if not any(a <= m.start() < b for a, b in taken):
                out.append((value, m.start(), m.end(), kind))
                taken.append((m.start(), m.end()))
    for value, start, end in numbers_in(t):
        if any(a <= start < b for a, b in taken):
            continue
        tail = t[end:end + 14]
        unit = MONEY_UNIT.match(tail)
        if unit:
            u = unit.group(1)
            mult = 10 ** 6 if u.startswith(("млн", "миллион", "лям")) else 1000 if u.startswith(("тыс", "тыщ", "к")) else 1
            kind = "short" if mult > 1 and t[start].isdigit() else "words" if not t[start].isdigit() else "digits"
            out.append((int(round(value * mult)), start, end + unit.end(), "slang" if u.startswith("лям") else kind))
            taken.append((start, end + unit.end()))
        elif NOT_MONEY_AFTER.match(tail):
            continue
        elif value >= 1000 and t[start].isdigit():
            out.append((int(value), start, end, "digits"))
            taken.append((start, end))
    # «миллион двести тысяч»: слова-множители уже свёрнуты words_to_number, но «миллион» мог попасть отдельно.
    merged = []
    for a in sorted(out, key=lambda x: x[1]):
        if merged and a[1] - merged[-1][2] <= 1 and merged[-1][0] % 10 ** 6 == 0 and a[0] < 10 ** 6 and a[3] != "digits":
            v, s, _, k = merged.pop()
            a = (v + a[0], s, a[2], k)
        merged.append(a)
    return merged


# ---------- Сроки ----------

TERM_WORDS = [(r"полгода", 6), (r"полтора\s+года", 18), (r"лет\s+на\s+(\w+)", None), (r"на\s+год(?![а-я])", 12),
              (r"за\s+год(?![а-я])", 12), (r"(?<![а-я])год(?![а-я])", 12)]


def term_months(text: str):
    """Срок в месяцах: «на два года» -> 24, «18 мес» -> 18, «полгода» -> 6, «лет на три» -> 36."""
    t = norm(text)
    for value, start, end in numbers_in(t):
        tail = t[end:end + 10]
        m = re.match(r"\s*(мес|месяц\w*)", tail)
        if m:
            return int(value)
        m = re.match(r"\s*(год|года|лет)(?![а-я])", tail)
        if m:
            return int(round(value * 12))
    for rx, months in TERM_WORDS:
        m = re.search(rx, t)
        if m:
            if months is None:
                n = words_to_number([m.group(1)]) if m.group(1) in SMALL else (int(m.group(1)) if m.group(1).isdigit() else None)
                if n:
                    return n * 12
                continue
            return months
    return None
