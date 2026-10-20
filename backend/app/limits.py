"""Small shared fixed-window limits, persisted in the existing SQLite database."""
import hashlib
import time

from sqlalchemy import case, delete
from sqlalchemy.dialects.sqlite import insert

from .db import RateBucket
from .errors import ApiError


def consume(session, scope, identity, limit, window=60):
    stamp = time.time()
    key = scope + ':' + hashlib.sha256(identity.encode()).hexdigest()
    expired = RateBucket.expires_at <= stamp
    statement = insert(RateBucket).values(key=key, count=1, expires_at=stamp + window)
    statement = statement.on_conflict_do_update(
        index_elements=['key'],
        set_={'count': case((expired, 1), else_=RateBucket.count + 1),
              'expires_at': case((expired, stamp + window), else_=RateBucket.expires_at)},
        where=expired | (RateBucket.count < limit),
    )
    if not session.execute(statement).rowcount:
        raise ApiError('RATE_LIMITED')
    session.execute(delete(RateBucket).where(RateBucket.expires_at < stamp - 3600))


def sqlite_busy(exc):
    return getattr(exc.orig, 'sqlite_errorcode', 0) & 255 in (5, 6)
