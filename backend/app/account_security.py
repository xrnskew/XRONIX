"""Password recovery and session revocation. No raw reset token is persisted."""
import asyncio
import hashlib
import logging
import re
import secrets
import smtplib
import ssl
import time
from email.message import EmailMessage
from email.headerregistry import Address

from fastapi import BackgroundTasks, Depends, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .db import ResetToken, User
from .errors import ApiError
from .limits import consume
from .security import hash_password, verify_password

logger = logging.getLogger(__name__)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def send_reset(settings, email, token):
    message = EmailMessage()
    message['From'] = settings.mail_from
    message['To'] = email
    message['Subject'] = 'XRONIX — восстановление пароля'
    message.set_content('Вы запросили новый пароль для XRONIX. Ссылка действует 15 минут и используется один раз:\n\n'
                        + settings.public_app_url + '?recover=1#reset=' + token
                        + '\n\nЕсли вы не отправляли запрос, проигнорируйте письмо. Ваш пароль не изменён.')
    try:
        context = ssl.create_default_context()
        if settings.smtp_port == 465:
            connection = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=15, context=context)
        else:
            connection = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=15)
            connection.ehlo()
            connection.starttls(context=context)
            connection.ehlo()
        with connection:
            connection.login(settings.smtp_user, settings.smtp_password)
            connection.send_message(message)
    except Exception as exc:
        # Tokens, email addresses and SMTP credentials must never enter logs.
        logger.error('Password reset delivery failed kind=%s', type(exc).__name__)


class StrictBody(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class ChangePassword(StrictBody):
    current_password: str = Field(min_length=1, max_length=1024)
    new_password: str = Field(min_length=8, max_length=1024)


class ForgotPassword(StrictBody):
    email: str = Field(min_length=3, max_length=254)

    @field_validator('email')
    @classmethod
    def address(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+', value):
            raise ValueError('invalid email')
        try:
            Address(addr_spec=value)  # One mailbox, never an injected recipient list.
        except (ValueError, IndexError) as exc:
            raise ValueError('invalid mailbox') from exc
        return value


class ResetPassword(StrictBody):
    token: str = Field(min_length=43, max_length=43, pattern=r'^[A-Za-z0-9_-]+$')
    new_password: str = Field(min_length=8, max_length=1024)


def install(app, settings, authenticated, db, cookie_name):
    def clear_cookie(request):
        response = Response(status_code=204, headers={'Cache-Control': 'no-store'})
        response.delete_cookie(cookie_name(request), path='/', secure=request.url.scheme == 'https', httponly=True, samesite='strict')
        return response

    from fastapi import Request

    @app.post('/api/auth/logout-all', status_code=204)
    def logout_all(request: Request, user: User = Depends(authenticated), session: Session = Depends(db)):
        session.execute(update(User).where(User.id == user.id).values(auth_version=User.auth_version + 1))
        session.commit()
        return clear_cookie(request)

    @app.post('/api/auth/change-password', status_code=204)
    def change_password(body: ChangePassword, request: Request, user: User = Depends(authenticated), session: Session = Depends(db)):
        if not verify_password(body.current_password, user.password_hash):
            raise ApiError('INVALID_CREDENTIALS')
        new_hash = hash_password(body.new_password)
        changed = session.execute(update(User).where(User.id == user.id, User.password_hash == user.password_hash)
                                  .values(password_hash=new_hash, auth_version=User.auth_version + 1)).rowcount
        if not changed:
            raise ApiError('UNAUTHORIZED')
        session.execute(delete(ResetToken).where(ResetToken.user_id == user.id))
        session.commit()
        return clear_cookie(request)

    @app.post('/api/auth/forgot-password', status_code=202)
    async def forgot_password(body: ForgotPassword, background: BackgroundTasks, session: Session = Depends(db)):
        if not settings.smtp_ready:
            raise ApiError('RECOVERY_UNAVAILABLE')
        started = time.monotonic()
        consume(session, 'password-reset-email', body.email, 3, window=3600)
        user = session.scalar(select(User).where(User.email == body.email))
        # Same token generation and response shape whether the account exists.
        token = secrets.token_urlsafe(32)
        session.execute(delete(ResetToken).where(ResetToken.expires_at < time.time()))
        if user:
            session.execute(delete(ResetToken).where(ResetToken.user_id == user.id))
            session.add(ResetToken(digest=digest(token), user_id=user.id, expires_at=time.time()+900,
                                   password_binding=digest(user.password_hash)))
        session.commit()
        await asyncio.sleep(max(0, 0.2 - (time.monotonic() - started)))
        if user:
            background.add_task(send_reset, settings, body.email, token)
        return {'message': 'Если аккаунт с этой почтой существует, мы отправили ссылку для восстановления пароля.'}

    @app.post('/api/auth/reset-password', status_code=204)
    def reset_password(body: ResetPassword, request: Request, session: Session = Depends(db)):
        # Acquire a write lock and consume the token in the same transaction as
        # password replacement: simultaneous uses cannot both succeed.
        reset = session.execute(delete(ResetToken).where(ResetToken.digest == digest(body.token),
                                                        ResetToken.expires_at > time.time())
                                .returning(ResetToken.user_id, ResetToken.password_binding)).first()
        if reset is None:
            raise ApiError('RESET_TOKEN_INVALID')
        user = session.get(User, reset.user_id)
        if user is None or digest(user.password_hash) != reset.password_binding:
            raise ApiError('RESET_TOKEN_INVALID')
        user.password_hash = hash_password(body.new_password)
        user.auth_version += 1
        session.execute(delete(ResetToken).where(ResetToken.user_id == user.id))
        session.commit()
        return clear_cookie(request)
