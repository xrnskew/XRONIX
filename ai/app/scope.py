"""Bounded, deterministic admission policy before any model call.

Unknown topics fail closed. Lexical admission is not a semantic security proof;
the trusted prompt remains necessary for business-looking adversarial input.
"""
import base64
import html
import json
import re
import unicodedata
from urllib.parse import unquote

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
    r'\b(?:перестань|прекрати)\b.{0,60}(?:следовать|соблюдать|выполнять).{0,40}(?:инструкц|правил)',
    r'\b(?:отныне|представь|притворись|сыграй|стань)\b.{0,70}(?:поэт|писател|хакер|роль|без ограничений)',
    r'\b(?:initial|hidden|original|secret)\s+(?:system\s+)?(?:prompt|instructions?)\b',
    r'\b(?:исходн\w*|внутренн\w*|скрыт\w*)\s+(?:промпт|инструкц\w*)',
    r'\b(?:не используй|отключи|измени|нарушь)\b.{0,50}(?:json|формат ответа|фильтр|защит|ограничен)',
    r'\b(?:новые|новая|главные|приоритетные)\s+(?:инструкции|роль|правила)\b',
    r'\b(?:инструкции|правила|ограничения)\b.{0,50}(?:отменены|не действуют|не применяются)',
    r'\b(?:режим разработчика|developer mode|jailbreak|system override|do anything now)\b',
    r'\b(?:ты теперь|теперь ты|you are now|act as)\b.{0,40}\b(?:dan|поэт\w*|писател\w*|без ограничений|pirate|poet|unrestricted)\b',
    r'\b(?:ты теперь|теперь ты|you are now|act as)\s+(?!(?:a\s+)?(?:бизнес|business|финансов|аналитик|consultant)\b)',
    r'\bты (?:больше )?не бизнес[ -]?консультант\b',
    r'(?:\[|<)(?:system|developer)(?:\]|>)|(?:^|\s)(?:system|developer)\s*:|###\s*(?:system|developer)\b',
    r'\b(?:покажи|раскрой|выведи|повтори|распечатай|show|reveal|print|repeat)\b.{0,90}(?:системн\w* (?:промпт|инструкц)|скрыт\w* инструкц|system prompt|developer message|gigachat_auth_key|jwt_secret)',
]
ROLE_OVERRIDE = re.compile('|'.join(f'(?:{p})' for p in _OVERRIDES), re.I)


def needs_redirect(text: str) -> bool:
    return unsafe_reason(text) is not None


# No model (including a separate AI classifier) is used to admit a request.
# Patterns are deliberately explicit; unfamiliar topics request clarification.
BUSINESS_TERMS = re.compile(
    r'бизнес|предприним|реклам|слоган|маркетинг|клиент|бренд|стартап|'
    r'кофе|пекар|магазин|салон|автомой|барбершоп|кафе|ресторан|кондитер|'
    r'парикмахер|маникюр|шиномонтаж|автосервис|мастерск|производств|'
    r'ферм[ауые]|теплиц|доставк|пункт выдачи|пвз\b|маркетплейс|озон|wildberries|'
    r'открыть|открыти[еяю]|запуск|продаж|выручк|прибыл|расход|доход|затрат|'
    r'бюджет|рубл|руб\b|тысяч|тыс\b|миллион|млн\b|аренд|помещени|оборудован|'
    r'сотрудник|персонал|пекар|бариста|поставщик|закуп|себестоим|наценк|'
    r'окупаем|кредит|финансир|инвестиц|налог|самозанят|регистрац.{0,12}(?:ип|ооо)|'
    r'расчет|пересчитай|план\b|план[ауе]|конкурент|аудитори|лицензи|франшиз|'
    r'площадь|кв[ .]*м|квадратн|посадочн|смет|эквайринг|касс[ауы]|аптек|'
    r'онлайн.школ|репетитор|клининг|ателье|фитнес|гостиниц|отел[ья]|туризм|'
    r'business|startup|advertis|marketing|brand|bakery|coffee|shop|sales|revenue|'
    r'budget|profit|rent|premises|equipment|employee|costs?|loan|tax|funding', re.I)

# Mixed requests are rejected as a whole: adding "business" cannot whitelist a
# cat poem, astronomy, medical advice, code execution, or instructions to a bot.
OFF_TOPIC = re.compile(
    r'сатурн|марс[аеу]?\b|юпитер|солнечн.{0,12}систем|астроном|'
    r'погод[ауые]|гороскоп|зодиак|футбол|матч[аеи]?\b|президент|политическ|'
    r'как лечить|чем лечить|назначь.{0,15}(?:таблетк|лекарств)|диагноз|симптом|медицинск.{0,12}совет|'
    r'реши.{0,20}(?:уравнен|задач.{0,10}физик)|домашн.{0,12}задани|'
    r'столиц[аыуе]|кто.{0,15}(?:победил|написал)|'
    r'weather|horoscope|saturn|astronomy|football|diagnosis|prescription', re.I)
CREATIVE = re.compile(r'\bстих(?:и|а|ов|отвор\w*)?\b|сказк|анекдот|поэм|песн[юяи]|роман о|poem|fairy tale|joke|song', re.I)
COMMERCIAL_CREATIVE = re.compile(r'реклам|слоган|advertis|marketing', re.I)
ENCODING_COMMAND = re.compile(
    r'base64|base32|rot13|unicode.escape|\bhex\b|'
    r'декодир|расшифру|раскодир|decode|decrypt|'
    r'(?:выполни|следуй|execute|follow).{0,40}(?:ссылк|файл|url|attachment)|'
    r'(?:переведи|translate).{0,80}(?:выполни|execute|follow)|'
    r'(?:ответ|ответь|верни|выведи).{0,30}(?:только|строго).{0,30}(?:ok\b|ок\b|готово|xml|yaml|html)|'
    r'(?<![а-я])(?:curl|wget|eval|exec)\s*[( ]|<script|javascript:', re.I)
ROLE_MARKERS = re.compile(
    r'<\|(?:im_start|im_end|system|assistant|endoftext)[^>]*>|'
    r'\[/?inst\]|<<\s*/?sys\s*>>|<\s*(?:system|developer)\b[^>]*>|'
    r'[\"\']role[\"\']\s*:\s*[\"\'](?:system|developer|assistant)[\"\']|'
    r'(?:^|\s|#{2,})(?:assistant|developer|system|система|разработчик)\s*:', re.I)


def text_variants(text: str) -> list[str]:
    """Decode bounded transport obfuscation for inspection, never execution."""
    variants = [normalized(text)]
    value = text[:16000]
    for _ in range(2):
        decoded = html.unescape(unquote(value))
        decoded = re.sub(r'\\u([0-9a-fA-F]{4})', lambda m: chr(int(m[1], 16)), decoded)
        decoded = re.sub(r'\\x([0-9a-fA-F]{2})', lambda m: chr(int(m[1], 16)), decoded)
        variants.append(normalized(decoded))
        if decoded == value:
            break
        value = decoded
    # Inspect a limited number of bounded base64 tokens; no recursive expansion.
    for token in re.findall(r'(?<![\w])[A-Za-z0-9+/_-]{24,}={0,2}(?![\w])', text[:16000])[:8]:
        if len(token) > 6000:
            continue
        try:
            raw = base64.b64decode(token + '=' * (-len(token) % 4), altchars=b'-_', validate=True)
            variants.append(normalized(raw.decode('utf-8')))
        except (ValueError, UnicodeError):
            pass
    return list(dict.fromkeys(variants))


def unsafe_reason(text: str) -> str | None:
    if len(text) > 20000:
        return 'oversized_context'
    for value in text_variants(text):
        if ROLE_OVERRIDE.search(value) or ROLE_MARKERS.search(value):
            return 'role_override'
        if ENCODING_COMMAND.search(value):
            return 'encoded_or_executable_instruction'
        # Punctuation/whitespace between letters is a common spelling bypass.
        compact = re.sub(r'[^а-яa-z0-9]', '', re.sub(r'\bне игнорируй инструкции\b', '', value))
        if any(marker in compact for marker in (
            'игнорируйинструкции', 'игнорируйпредыдущиеинструкции',
            'забудьинструкции', 'забудьвсепредыдущиеинструкции',
            'ignorepreviousinstructions', 'ignoreallpreviousinstructions',
            'systemprompt', 'системныйпромпт', 'gigachatauthkey', 'jwtsecret',
        )):
            return 'obfuscated_override'
        if OFF_TOPIC.search(value):
            return 'off_topic'
        if CREATIVE.search(value) and not COMMERCIAL_CREATIVE.search(value):
            return 'unrelated_creative'
    return None


def scope_reason(text: str, *, followup: bool = False, options=()) -> str | None:
    """None means admitted; every rejected request is answered locally."""
    if reason := unsafe_reason(text):
        return reason
    value = normalized(text)
    if re.search(r'(?<![\w])[A-Za-z0-9+/_-]{40,}={0,2}(?![\w])|(?:%[0-9a-f]{2}){6,}|(?:\\u[0-9a-f]{4}){4,}|(?:&#(?:x[0-9a-f]+|[0-9]+);){4,}', text, re.I):
        return 'opaque_encoded_payload'
    if BUSINESS_TERMS.search(value):
        return None
    if followup:
        if any(value == normalized(option) for option in options):
            return None
        # No generic free-text exemption: a questionnaire must not open a path
        # for unrelated tasks. Accept bounded factual shapes and known answers.
        if len(value) <= 160:
            if re.fullmatch(r'(?:да|нет|сам|сама|ищу|не знаю|не решил[аи]?|пока не решил[аи]?|'
                            r'новичок|без опыта|нет опыта|работал наемным|работала наемной|'
                            r'онлайн|офлайн|есть|нет помещения)', value):
                return None
            if re.fullmatch(r'(?:через |до |от |около )?\d[\d .,]*(?:м[²2]?|месяц\w*|недел\w*|лет|год\w*|дн\w*|%)?', value):
                return None
            # Geographic names are title-cased, at most four words, with no
            # sentence punctuation; imperative/task words are excluded.
            if re.fullmatch(r'[А-ЯЁA-Z][а-яёa-z]+(?:[- ][А-ЯЁA-Zа-яёa-z][а-яёa-z]+){0,3}', text.strip()) and not re.search(
                r'напиш|расскаж|покаж|объясн|сочин|сдела|придум|перевед|вычисл|найди|скажи|'
                r'посовет|игнор|забуд|выполн|инструк|правил|роль|притвор|представ|'
                r'write|tell|show|explain|create|translate|recommend|obey|pretend|ignore|forget', value):
                # Multiple words must each start with an uppercase letter,
                # apart from conventional geographic connectors.
                words = re.split(r'[- ]', text.strip())
                if all(w[0].isupper() or w.lower() in ('на', 'ону', 'де') for w in words):
                    return None
    return 'unrecognized_business_request'


def questionnaire_context(req) -> tuple[bool, list[str]]:
    """Only structured assistant questions enable short answer admission."""
    for item in reversed(req.history):
        if item.role != 'assistant':
            continue
        try:
            data = json.loads(item.content)
        except (ValueError, TypeError):
            return False, []
        if not isinstance(data, dict) or data.get('type') != 'questions':
            return False, []
        questions = data.get('questions', [])
        if not isinstance(questions, list) or not questions or unsafe_reason(item.content):
            return False, []
        options = [option for q in questions if isinstance(q, dict)
                   for option in (q.get('options') if isinstance(q.get('options'), list) else [])
                   if isinstance(option, str)]
        return True, options
    return False, []


def sanitize_request(req):
    """Copy, never mutate caller state; do not forward known hostile context."""
    clean = req.model_copy(deep=True)
    profile = clean.user_context.profile
    # A personal name is unnecessary for financial planning and is not sent.
    profile.name = ''
    for field in ('city', 'experience'):
        value = getattr(profile, field)
        if value and (len(value) > 160 or unsafe_reason(value) or re.search(r'инструкц|промпт|выполн|игнор|обяз|system|prompt|obey|follow', normalized(value)) or not re.fullmatch(r'[\w .,()/—–-]+', value)):
            setattr(profile, field, None)
    clean.user_context.tags = [t for t in clean.user_context.tags
                               if len(t) <= 60 and not scope_reason(t)]
    clean.user_context.memory = '\n'.join(
        line for line in clean.user_context.memory.splitlines() if not scope_reason(line))[:800]
    clean.history = []
    for index, item in enumerate(req.history):
        if unsafe_reason(item.content):
            continue
        if item.role == 'user':
            previous = req.model_copy(update={'history': req.history[:index]})
            followup, options = questionnaire_context(previous)
            if scope_reason(item.content, followup=followup, options=options):
                continue
        clean.history.append(item.model_copy(deep=True))
    return clean
