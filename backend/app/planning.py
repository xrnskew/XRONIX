"""Deterministic constraints around model output, without API schema changes."""
import copy
import json
import re

# Outside the allow-list ask for the actual location instead of assuming a station.
METRO_CITIES = {'москва', 'санкт петербург', 'новосибирск', 'екатеринбург', 'нижний новгород', 'казань', 'самара'}
METRO_LOCATION = re.compile(r'(?:\bу|возле|около|рядом\s+с|вблизи)\s+(?:станци\w*\s+)?метро\b|станци\w*\s+метро\b|пассажир\w*\s+метро\b', re.I)
CREDIT_QUESTION = re.compile(r'кредит|за[её]м', re.I)
REFUSAL = re.compile(r'^(?:нет\b|без\s+кредита\b|не\s+(?:хочу|готов|буду|рассматриваю)\b)', re.I)


def normalized_city(city):
    return re.sub(r'[\s\-]+', ' ', (city or '').strip().casefold().replace('ё', 'е'))


def credit_refused(payload):
    """The last explicit answer wins; unrelated 'Нет' is never a credit answer."""
    refused = False
    questions = []
    for item in [*payload['history'], {'role': 'user', 'content': payload['message']}]:
        if item['role'] == 'assistant':
            try:
                reply = json.loads(item['content'])
                questions = reply.get('questions', []) if isinstance(reply, dict) else []
            except ValueError:
                questions = []
            continue
        text = item['content']
        for question in questions:
            if not CREDIT_QUESTION.search(question.get('text', '')):
                continue
            prefix = question['text'] + ' '
            answer = next((line[len(prefix):].strip() for line in text.splitlines() if line.startswith(prefix)), None)
            if answer is not None:
                refused = bool(REFUSAL.search(answer))
        if re.search(r'\b(?:без кредита|кредит не (?:хочу|нужен)|не (?:хочу|буду|готов)\s+(?:брать\s+)?кредит)', text, re.I):
            refused = True
        elif re.search(r'\b(?:готов|хочу|согласен)\s+(?:взять|брать)\s+кредит', text, re.I):
            refused = False
        questions = []
    return refused


def location_clarification(payload):
    city = payload['user_context']['profile']['city']
    if city and normalized_city(city) not in METRO_CITIES and METRO_LOCATION.search(payload['message']):
        return {'type': 'message', 'text': f'Уточните место в городе {city}: наличие подходящей станции метро не подтверждено. Рассмотрим точку у остановки, торгового центра или другую реальную локацию? Опишите выбранный вариант.'}
    return None


def check_location(plan, payload):
    city = payload['user_context']['profile']['city']
    if city and normalized_city(city) not in METRO_CITIES and METRO_LOCATION.search(json.dumps(plan, ensure_ascii=False)):
        raise ValueError('unconfirmed metro location')


def apply_preferences(plan, payload):
    plan = copy.deepcopy(plan)
    if credit_refused(payload):
        credit = plan['credit']
        credit.update({key: None for key in ('amount_rub', 'purpose', 'recommended_term_months', 'estimated_rate_percent', 'monthly_payment_rub', 'debt_load_percent', 'verdict', 'recommended_product_id')})
        credit['needed'] = False
        gap = plan['finance']['funding_gap_rub']
        credit['comment'] = ('Вы отказались от кредита. ' + (f'Для запуска не хватает {gap} ₽. Уменьшите масштаб, запускайтесь поэтапно или привлеките вклад партнёра.' if gap else 'Стартовые расходы покрываются собственными средствами.'))
    return plan


def retry_context(payload):
    payload = copy.deepcopy(payload)
    city = payload['user_context']['profile']['city']
    feedback = (f'Проверь факты: актуальный город — {city or "не указан"}. Не предполагай наличие метро или пассажиропотока. '
                'Старые идеи и теги не являются фактами о новой идее. Стоимость старта должна покрывать все статьи шагов. ')
    payload['user_context']['memory'] = (feedback + payload['user_context']['memory'])[:800]
    return payload


def with_answers(payload, answers):
    """Bind structured answer IDs to the last server-supplied questionnaire."""
    result = copy.deepcopy(payload)
    for item in reversed(payload['history']):
        if item['role'] != 'assistant':
            continue
        try:
            reply = json.loads(item['content'])
        except ValueError:
            break
        if not isinstance(reply, dict) or reply.get('type') != 'questions':
            break
        questions = {q['id']: q['text'] for q in reply['questions']}
        lines = [questions[a['question_id']] + ' ' + a['answer'] for a in answers if a['question_id'] in questions]
        result['message'] += '\n' + '\n'.join(lines)
        break
    return result
