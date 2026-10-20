"""Per-chat facts: only profile snapshots, explicit user text and bound answers."""
import copy
import re

from .errors import ApiError

ALIASES = {'location': 'city', 'own_funds': 'budget_rub', 'budget': 'budget_rub',
           'money': 'budget_rub', 'investment': 'budget_rub', 'sphere': 'idea'}


def profile_facts(user):
    return {key: {'value': getattr(user, key), 'source': 'profile', 'message_id': None}
            for key in ('city', 'experience', 'budget_rub') if getattr(user, key) is not None}


def money_value(value):
    match = re.fullmatch(r'\s*(\d[\d .,]*)\s*(тыс\w*|млн\w*|миллион\w*|руб\w*|₽)?\s*', value, re.I)
    if not match:
        return None
    try:
        number = float(match[1].replace(' ', '').replace(',', '.'))
        unit = (match[2] or '').lower()
        number *= 1_000_000 if unit.startswith(('млн', 'миллион')) else 1000 if unit.startswith('тыс') else 1
        return int(number) if number.is_integer() and 0 <= number <= 9223372036854775807 else None
    except (ValueError, OverflowError):
        return None


def bound_answers(body, previous):
    if not body.answers:
        return []
    if previous is None or previous.role != 'assistant' or previous.reply.get('type') != 'questions':
        raise ApiError('VALIDATION_ERROR')
    questions = {q['id']: q for q in previous.reply['questions']}
    seen, result = set(), []
    for item in body.answers:
        q = questions.get(item.question_id)
        answer = item.answer.strip()
        if q is None or item.question_id in seen or not answer:
            raise ApiError('VALIDATION_ERROR')
        if q['kind'] == 'choice' and answer not in q['options']:
            raise ApiError('VALIDATION_ERROR')
        seen.add(item.question_id)
        result.append({'question_id': item.question_id, 'question': q['text'], 'answer': answer})
    return result


def updated_facts(chat, user, message_id, message, answers):
    facts = copy.deepcopy(chat.facts if chat.facts is not None else profile_facts(user))
    # A user can explicitly replace their business idea; never extract it from
    # an assistant reply, profile tags, a plan or a cross-chat summary.
    match = re.search(r'(?:хочу открыть|идея\s*:|бизнес[- ]план\s+для)\s+(.+)', message, re.I)
    if match and not re.match(r'бизнес\b|пока\b|не знаю\b', match[1], re.I):
        facts['idea'] = {'value': match[1][:1000], 'source': 'user_message', 'message_id': message_id}
    budget = re.search(r'бюджет\s*[:—–-]?\s*(\d[\d .,]*\s*(?:тыс\w*|млн\w*|миллион\w*|руб\w*|₽)?)', message, re.I)
    if budget and (value := money_value(budget[1])) is not None:
        facts['budget_rub'] = {'value': value, 'source': 'user_message', 'message_id': message_id}
    for item in answers:
        key = ALIASES.get(item['question_id'], item['question_id'])
        value = item['answer']
        if key == 'budget_rub':
            number = money_value(value)
            if number is None:
                key = 'budget_answer'  # A range must not become a made-up amount.
            else:
                value = number
        facts[key] = {'value': value, 'source': 'answer', 'message_id': message_id,
                      'question_id': item['question_id']}
    return dict(list(facts.items())[-32:])


def context_payload(user, facts):
    profile = {'name': user.name, 'city': None, 'experience': None, 'budget_rub': None}
    for key in ('city', 'experience', 'budget_rub'):
        if key in facts:
            value = facts[key]['value']
            if key != 'budget_rub' or isinstance(value, int):
                profile[key] = value
    return {'profile': profile, 'tags': user.tags, 'memory': ''}
