import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import jwt


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600_000).hex()
    return f'pbkdf2_sha256$600000${salt}${digest}'


def verify_password(password, encoded):
    _, iterations, salt, expected = encoded.split('$')
    actual = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), int(iterations)).hex()
    return hmac.compare_digest(actual, expected)


def token_for(user, key, minutes):
    now = datetime.now(timezone.utc)
    return jwt.encode({'sub': user.id, 'ver': user.auth_version, 'jti': secrets.token_hex(16), 'iat': now, 'exp': now + timedelta(minutes=minutes), 'iss': 'xronix', 'aud': 'xronix-api'}, key, algorithm='HS256')
