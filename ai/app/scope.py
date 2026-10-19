"""Small deterministic guard for explicit role overrides; the prompt covers wider cases.

This is not a general prompt-injection detector. Never treat profile/history/memory
as trusted instructions, even when this guard finds no known pattern.
"""
import re
import unicodedata

BUSINESS_REDIRECT = ('Я помогаю с открытием и развитием бизнеса: идеей, бюджетом, шагами запуска и финансированием. '
                     'Расскажите, какой бизнес вы хотите открыть, или задайте вопрос по вашему плану.')

_LOOKALIKES = str.maketrans({'a': 'а', 'c': 'с', 'e': 'е', 'o': 'о', 'p': 'р', 'x': 'х', 'y': 'у'})

def normalized(text: str) -> str:
    text = ''.join(c for c in unicodedata.normalize('NFKC', text) if unicodedata.category(c) != 'Cf').casefold().replace('ё', 'е')
    def unmixed(match):
        word = match.group()
        return word.translate(_LOOKALIKES) if re.search('[а-я]', word) and re.search('[a-z]', word) else word
    return re.sub(r'\s+', ' ', re.sub(r'\w+', unmixed, text)).strip()


_OVERRIDES = [
    r'(?<!не )\b(?:забудь|игнорируй|отбрось|отмени|обойди|не выполняй|не соблюдай)\b.{0,90}\b(?:инструкц\w*|правил\w*|ограничени\w*|промпт\w*)',
    r'\b(?:ignore|disregard|forget|override|bypass)\b.{0,90}\b(?:instructions?|rules?|system prompt|restrictions?)\b',
    r'\b(?:режим разработчика|developer mode|jailbreak|system override|do anything now)\b',
    r'\b(?:ты теперь|теперь ты|you are now|act as)\b.{0,40}\b(?:dan|поэт\w*|писател\w*|без ограничений|pirate|poet|unrestricted)\b',
    r'\bты (?:больше )?не бизнес[ -]?консультант\b',
    r'(?:\[|<)(?:system|developer)(?:\]|>)|(?:^|\s)(?:system|developer)\s*:|###\s*(?:system|developer)\b',
    r'\b(?:покажи|раскрой|выведи|повтори|распечатай|show|reveal|print|repeat)\b.{0,90}(?:системн\w* (?:промпт|инструкц)|скрыт\w* инструкц|system prompt|developer message|gigachat_auth_key|jwt_secret)',
]
ROLE_OVERRIDE = re.compile('|'.join(f'(?:{p})' for p in _OVERRIDES), re.I)
DISTRACTION = re.compile(r'\b(?:напиши|сочини|расскажи)\b.{0,60}\b(?:стих\w*|сказк\w*|анекдот\w*)|\b(?:write|tell)\b.{0,60}\b(?:poem|fairy tale|joke)\b', re.I)
BUSINESS_CONTEXT = re.compile(r'бизнес|предприним|реклам|слоган|маркетинг|клиент|бренд|кофейн|пекар|магазин|салон|автомой|стартап|business|startup|advertis|marketing|brand', re.I)


def needs_redirect(text: str) -> bool:
    text = normalized(text)
    return bool(ROLE_OVERRIDE.search(text) or (DISTRACTION.search(text) and not BUSINESS_CONTEXT.search(text)))
