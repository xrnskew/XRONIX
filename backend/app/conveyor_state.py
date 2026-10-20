"""Single transition table and transactional event/feed recording."""
import time
from .db import now
from .errors import ApiError
from .conveyor_models import ApplicationEvent, FeedItem

TRANSITIONS = {
    'client': {'draft': {'submitted','withdrawn'}, 'info_requested': {'checking','withdrawn'}, 'approved': {'signing','cancelled'}, 'counter_offer': {'signing','cancelled'}, 'signing': {'funded'}},
    'system': {'submitted': {'checking'}, 'checking': {'info_requested','declined','scoring','manual_review'}, 'scoring': {'approved','counter_offer','manual_review','declined'}},
    'analyst': {'manual_review': {'approved','counter_offer','info_requested','declined'}},
}
AUTO = {'submitted','checking','scoring'}


def expect_version(a, version):
    if type(version) is not int or version < 1:
        raise ApiError('VALIDATION_ERROR','Необходимо передать version заявки.')
    if a.version != version:
        raise ApiError('VERSION_CONFLICT')


def transition(session, a, target, actor, dictionaries, rules, actor_id=None, reason=''):
    if target not in TRANSITIONS.get(actor, {}).get(a.status, set()):
        raise ApiError('INVALID_TRANSITION')
    old = a.status
    a.status, a.updated_at = target, now()
    a.due_at = time.time()+rules['checks']['stage_delay_seconds']['min'] if target in AUTO else 0
    a.lease_until = 0
    session.add(ApplicationEvent(application_id=a.id,from_status=old,to_status=target,actor=actor,actor_id=actor_id,reason=reason))
    info=dictionaries['statuses'][target]
    kind='info_request' if target=='info_requested' else 'offer' if target in {'approved','counter_offer'} else 'status_change'
    session.add(FeedItem(user_id=a.user_id,application_id=a.id,kind=kind,title=info['title'],text=info['now']))
