import asyncio
import hashlib
import logging
import sqlite3
import re
import time
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
import jwt
from fastapi import BackgroundTasks, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.security import HTTPBearer
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import select, update, delete, text, func
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from .ai import AI, history
from .config import Settings
from .db import Base, Chat, Generation, Message, Plan, RateBucket, User, database, now, uid
from .errors import ApiError
from .chat_context import bound_answers, context_payload, profile_facts, updated_facts
from . import generations, account_security, conveyor, bank, seed
from .consult import Consult
from .integrations import Integrations
from .conveyor_models import Application
from .limits import consume, sqlite_busy
from .maintenance import backup_loop
from .migrations import CURRENT_VERSION, running_database
from .storage import StorageError, backup_directory, check_space, database_path, private_directory
from .middleware import ApiCORS
from .security import hash_password, token_for, verify_password
from .validation import Contracts, recalculate
from .planning import apply_preferences, location_clarification, with_answers

logger = logging.getLogger(__name__)


class Body(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)


class Login(Body):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=1024)

    @field_validator('email')
    @classmethod
    def email_address(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+', value):
            raise ValueError('invalid email')
        return value


class Register(Login):
    password: str = Field(min_length=8, max_length=1024)
    name: str = Field(min_length=1, max_length=60)

    @field_validator('name')
    @classmethod
    def name_not_blank(cls, value):
        if not value.strip():
            raise ValueError('blank name')
        return value.strip()


Tag = Annotated[str, Field(min_length=1, max_length=30)]


class ProfilePatch(Body):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    city: str | None = Field(default=None, max_length=60)
    experience: str | None = Field(default=None, max_length=60)
    budget_rub: int | None = Field(default=None, ge=0, le=9223372036854775807)
    tags: list[Tag] | None = Field(default=None, max_length=12)

    @model_validator(mode='after')
    def nonnullable(self):
        if any(k in self.model_fields_set and getattr(self, k) is None for k in ('name', 'tags')):
            raise ValueError('null name/tags')
        if self.name is not None and not self.name.strip():
            raise ValueError('blank name')
        return self


class Answer(Body):
    question_id: str = Field(min_length=1, max_length=31, pattern=r'^[a-z][a-z0-9_]*$')
    answer: str = Field(min_length=1, max_length=1000)


class SendMessage(Body):
    text: str = Field(min_length=1, max_length=4000)
    answers: list[Answer] = Field(default_factory=list, max_length=6)


def profile(user):
    return {key: getattr(user, key) for key in ('id', 'name', 'email', 'city', 'experience', 'budget_rub', 'tags', 'role')}


def create_app(settings=None, ai_transport=None, integrations_transport=None):
    settings = settings or Settings()
    key = settings.signing_key()
    engine, sessions = database(settings.database_url)
    contracts = Contracts(settings.contracts_dir)

    @asynccontextmanager
    async def lifespan(app):
        try:
            with running_database(settings):
                if settings.backup_enabled:
                    private_directory(backup_directory(settings))
                async with httpx.AsyncClient(transport=ai_transport) as client, httpx.AsyncClient(transport=integrations_transport) as integrations_client:
                    app.state.ai = AI(settings, contracts, client)
                    app.state.integrations = Integrations(settings.integrations_url, contracts, integrations_client)
                    if settings.seed_demo:
                        await seed.seed(app)
                    conveyor_worker = asyncio.create_task(app.state.conveyor.worker(app))
                    task = asyncio.create_task(backup_loop(settings)) if settings.backup_enabled else None
                    worker = asyncio.create_task(app.state.generation_worker())
                    try:
                        yield
                    finally:
                        worker.cancel()
                        conveyor_worker.cancel()
                        await asyncio.gather(worker, conveyor_worker, return_exceptions=True)
                        if task:
                            task.cancel()
                            try:
                                await task
                            except asyncio.CancelledError:
                                pass
        except (StorageError, sqlite3.Error, OSError) as exc:
            code = exc.code if isinstance(exc, StorageError) else type(exc).__name__
            logger.error('Database startup failed code=%s', code)
            raise StorageError('DATABASE_STARTUP_FAILED') from None
        finally:
            engine.dispose()

    app = FastAPI(title='XRONIX Backend', version='1.0.0', lifespan=lifespan)
    app.state.sessions = sessions
    app.state.settings = settings
    app.state.contracts = contracts

    @app.exception_handler(ApiError)
    async def api_error(request, exc):
        return JSONResponse(exc.body(), status_code=exc.status, headers={'Retry-After': '2'} if exc.status == 429 else None)

    @app.exception_handler(OperationalError)
    async def database_error(request, exc):
        return await api_error(request, ApiError('RATE_LIMITED' if sqlite_busy(exc) else 'INTERNAL'))

    @app.exception_handler(RequestValidationError)
    async def invalid(request, exc):
        return await api_error(request, ApiError('VALIDATION_ERROR'))

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return await api_error(request, ApiError('NOT_FOUND' if exc.status_code == 404 else 'VALIDATION_ERROR'))

    @app.exception_handler(Exception)
    async def internal(request, exc):
        logger.error('Request failed: %s', type(exc).__name__)
        return await api_error(request, ApiError('INTERNAL'))

    def db():
        with sessions() as session:
            yield session

    def cookie_name(request):
        return '__Host-xronix_session' if request.url.scheme == 'https' else 'xronix_session'

    def request_token(request):
        header = request.headers.get('authorization', '')
        if header:
            scheme, _, token = header.partition(' ')
            return token if scheme.lower() == 'bearer' else ''
        return request.cookies.get(cookie_name(request), '')

    def revocation_key(token):
        return 'revoked:' + hashlib.sha256(token.encode()).hexdigest()

    def authenticated(request: Request, session: Session = Depends(db), bearer=Depends(HTTPBearer(auto_error=False))):
        token = request_token(request)
        if not token:
            raise ApiError('UNAUTHORIZED')
        # Cookie-authenticated writes require an allowed Origin, even for non-browser clients.
        if not request.headers.get('authorization') and request.method not in ('GET', 'HEAD', 'OPTIONS'):
            if request.headers.get('origin') not in settings.cors_origins:
                raise ApiError('UNAUTHORIZED')
        try:
            payload = jwt.decode(token, key, algorithms=['HS256'], issuer='xronix', audience='xronix-api', options={'require': ['sub', 'iat', 'exp', 'iss', 'aud']})
        except jwt.InvalidTokenError as exc:
            raise ApiError('UNAUTHORIZED') from exc
        if session.get(RateBucket, revocation_key(token)) is not None:
            raise ApiError('UNAUTHORIZED')
        user = session.get(User, payload['sub'])
        if user is None or payload.get('ver', 0) != user.auth_version:
            raise ApiError('UNAUTHORIZED')
        return user

    def auth_result(user, request, response):
        token = token_for(user, key, settings.jwt_expire_minutes)
        response.headers['Cache-Control'] = 'no-store'
        if request.headers.get('x-session-mode') == 'cookie':
            if request.headers.get('origin') not in settings.cors_origins:
                raise ApiError('UNAUTHORIZED')
            response.set_cookie(cookie_name(request), token, max_age=settings.jwt_expire_minutes * 60,
                                secure=request.url.scheme == 'https', httponly=True, samesite='strict', path='/')
        return {'token': token, 'user': profile(user)}

    def owned_chat(session, chat_id, user_id):
        chat = session.scalar(select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id))
        if chat is None:
            raise ApiError('NOT_FOUND')
        return chat

    def recent(session, chat_id, limit):
        return list(reversed(session.scalars(select(Message).where(Message.chat_id == chat_id).order_by(Message.seq.desc()).limit(limit)).all()))

    def completed_plan_replay(session, chat_id, body):
        previous = recent(session, chat_id, 2)
        if len(previous) == 2 and previous[0].role == 'user' and previous[1].role == 'assistant':
            last_user, last_reply = previous
            from datetime import datetime
            age = time.time() - datetime.fromisoformat(last_reply.created_at.replace('Z', '+00:00')).timestamp()
            if (last_reply.reply['type'] == 'plan' and 0 <= age < 120
                    and last_user.reply['text'] == body.text
                    and (last_user.answers or []) == [a.model_dump() for a in body.answers]):
                return last_reply.reply
        return None

    async def summarize(user_id, chat_id):
        # A failed/stale background summary must never lose a finished plan.
        try:
            with sessions() as session:
                user = session.get(User, user_id)
                payload = {'memory': user.memory, 'history': history(recent(session, chat_id, 30))}
            result = await app.state.ai.summarize(payload)
            with sessions() as session:
                user = session.get(User, user_id)
                session.execute(update(User).where(User.id == user_id, User.memory == payload['memory'], User.tags == user.tags).values(
                    memory=result['memory']))
                session.commit()
        except Exception as exc:
            logger.warning('Memory summary skipped: %s', type(exc).__name__)

    @app.get('/health')
    def health(session: Session = Depends(db)):
        if session.execute(text('SELECT MAX(version) FROM schema_migrations')).scalar() != CURRENT_VERSION:
            raise ApiError('INTERNAL')
        try:
            check_space(database_path(settings).parent, settings.db_min_free_bytes)
            directory = backup_directory(settings)
            if settings.backup_enabled and directory.exists():
                check_space(directory, settings.db_min_free_bytes)
        except StorageError as exc:
            logger.warning('Database health failed code=%s', exc.code)
            raise ApiError('INTERNAL') from None
        return {'status': 'ok'}

    @app.post('/api/auth/register', status_code=201)
    def register(body: Register, request: Request, response: Response, session: Session = Depends(db)):
        if request.headers.get('x-session-mode') == 'cookie' and request.headers.get('origin') not in settings.cors_origins:
            raise ApiError('UNAUTHORIZED')
        user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
        session.add(user)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise ApiError('EMAIL_TAKEN') from exc
        return auth_result(user, request, response)

    # Same PBKDF2 cost for unknown email and wrong password.
    dummy_hash = hash_password(uid())

    @app.post('/api/auth/login')
    def login(body: Login, request: Request, response: Response, session: Session = Depends(db)):
        user = session.scalar(select(User).where(User.email == body.email))
        valid = verify_password(body.password, user.password_hash if user else dummy_hash)
        if not valid or user is None:
            raise ApiError('INVALID_CREDENTIALS')
        return auth_result(user, request, response)

    @app.post('/api/auth/logout', status_code=204)
    def logout(request: Request, session: Session = Depends(db)):
        # Idempotent logout also clears an expired cookie. Never accept a cross-site write.
        if request.headers.get('origin') not in settings.cors_origins:
            raise ApiError('UNAUTHORIZED')
        token = request_token(request)
        if token:
            try:
                payload = jwt.decode(token, key, algorithms=['HS256'], issuer='xronix', audience='xronix-api', options={'require': ['sub', 'iat', 'exp', 'iss', 'aud']})
                session.merge(RateBucket(key=revocation_key(token), count=1, expires_at=float(payload['exp'])))
                session.commit()
            except jwt.InvalidTokenError:
                pass
        response = Response(status_code=204, headers={'Cache-Control': 'no-store'})
        response.delete_cookie(cookie_name(request), path='/', secure=request.url.scheme == 'https', httponly=True, samesite='strict')
        return response

    @app.get('/api/me')
    def get_me(user: User = Depends(authenticated)):
        return profile(user)

    @app.patch('/api/me')
    def patch_me(body: ProfilePatch, user: User = Depends(authenticated), session: Session = Depends(db)):
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(user, field, value)
        session.commit()
        return profile(user)

    @app.get('/api/chats')
    def list_chats(user: User = Depends(authenticated), session: Session = Depends(db)):
        chats = session.scalars(select(Chat).where(Chat.user_id == user.id).order_by(Chat.updated_at.desc(), Chat.id.desc()))
        return [{'id': c.id, 'title': c.title, 'updated_at': c.updated_at, 'plan_id': c.plan_id} for c in chats]

    @app.post('/api/chats', status_code=201)
    def create_chat(user: User = Depends(authenticated), session: Session = Depends(db)):
        chat = Chat(user_id=user.id, facts=profile_facts(user))
        session.add(chat)
        session.commit()
        return {'chat_id': chat.id}

    @app.get('/api/chats/{chat_id}')
    def get_chat(chat_id: str, user: User = Depends(authenticated), session: Session = Depends(db)):
        chat = owned_chat(session, chat_id, user.id)
        messages = session.scalars(select(Message).where(Message.chat_id == chat_id).order_by(Message.seq)).all()
        result = []
        for index, m in enumerate(messages):
            reply = m.reply
            if reply['type'] == 'plan' and not chat.consult_state:
                context = {'history': history(messages[:index]), 'message': ''}
                reply = {**reply, 'plan': apply_preferences(recalculate(reply['plan']), context)}
            result.append({'id': m.id, 'role': m.role, 'created_at': m.created_at, 'reply': reply, 'answers': m.answers or []})
        return {'id': chat_id, 'messages': result, 'facts': chat.facts, 'generation': generations.latest(session, chat_id)}

    @app.delete('/api/chats/{chat_id}', status_code=204)
    def delete_chat(chat_id: str, user: User = Depends(authenticated), session: Session = Depends(db)):
        # Acquire SQLite's write lock before reading the lease so send_message
        # cannot acquire it between our check and deletion, even across workers.
        session.execute(update(Chat).where(Chat.id == chat_id, Chat.user_id == user.id).values(busy_until=Chat.busy_until))
        chat = owned_chat(session, chat_id, user.id)
        if chat.busy_until > time.time() or session.scalar(select(Generation.id).where(Generation.chat_id == chat_id, Generation.status.in_(generations.ACTIVE)).limit(1)):
            raise ApiError('RATE_LIMITED')
        if session.scalar(select(Application.id).join(Plan, Application.data['plan_id'].as_string() == Plan.id).where(Plan.chat_id == chat_id).limit(1)):
            raise ApiError('INVALID_TRANSITION')
        session.execute(delete(Generation).where(Generation.chat_id == chat_id))
        session.execute(delete(Plan).where(Plan.chat_id == chat_id))
        session.execute(delete(Message).where(Message.chat_id == chat_id))
        session.execute(delete(Chat).where(Chat.id == chat_id, Chat.user_id == user.id))
        session.commit()
        return Response(status_code=204)

    async def process_message(chat_id, body, background, user, session, generation_id=None):
        if settings.consult_chat:
            return await app.state.consult.process(chat_id, body, background, user, session, generation_id)
        chat = owned_chat(session, chat_id, user.id)
        cached = completed_plan_replay(session, chat_id, body)
        if cached is not None:
            return cached
        stamp = time.time()
        lease = stamp + 200
        try:
            acquired = session.execute(update(Chat).where(Chat.id == chat_id, Chat.busy_until < stamp).values(busy_until=lease)).rowcount
            if not acquired:
                raise ApiError('RATE_LIMITED')
            if generation_id is None and session.scalar(select(Generation.id).where(Generation.user_id == user.id, Generation.status.in_(generations.ACTIVE)).limit(1)):
                raise ApiError('RATE_LIMITED')
            active = Chat.busy_until > stamp
            user_active = session.scalar(select(func.count()).select_from(Chat).where(active, Chat.user_id == user.id))
            global_active = session.scalar(select(func.count()).select_from(Chat).where(active))
            if user_active > 1 or global_active > settings.ai_max_concurrent:
                raise ApiError('RATE_LIMITED')
            session.commit()
        except Exception:
            session.rollback()
            raise
        try:
            # Refresh after acquiring the database lease, including with multiple workers.
            session.refresh(chat)
            session.refresh(user)
            cached = completed_plan_replay(session, chat_id, body)
            if cached is not None:
                return cached
            consume(session, 'ai-user', user.id, settings.ai_requests_per_minute)
            consume(session, 'ai-global', 'all', settings.ai_global_per_minute)
            previous = recent(session, chat_id, 10)
            question_message = next((m for m in reversed(previous) if m.role == 'assistant'), None)
            answers = bound_answers(body, question_message)
            reused = (previous[-1] if previous and previous[-1].role == 'user'
                      and previous[-1].reply.get('text') == body.text
                      and (previous[-1].answers or []) == [a.model_dump() for a in body.answers] else None)
            message_id = reused.id if reused else uid()
            facts = updated_facts(chat, user, message_id, body.text, answers)
            payload = {'mode': 'chat', 'user_context': context_payload(user, facts),
                       'chat_context': {'facts': facts, 'answers': answers},
                       'history': history(previous[:-1] if reused else previous), 'message': body.text}
            chat.facts = facts
            if not session.scalar(select(Message.id).where(Message.chat_id == chat_id).limit(1)):
                chat.title = body.text[:60]
            if reused is None:
                session.add(Message(id=message_id, chat_id=chat_id, role='user', reply={'type': 'message', 'text': body.text}, answers=[a.model_dump() for a in body.answers]))
            chat.updated_at = now()
            session.commit()  # User message survives an unavailable AI service.
            clarification = location_clarification(payload)
            reply = clarification or await app.state.ai.respond(payload, chat.mock_stage)
            if reply['type'] == 'plan':
                reply['plan'] = apply_preferences(reply['plan'], with_answers(payload, [a.model_dump() for a in body.answers]))
                plan_id = uid()
                reply['plan_id'] = plan_id
                session.add(Plan(id=plan_id, user_id=user.id, chat_id=chat.id, body=reply['plan']))
                chat.plan_id = plan_id
                chat.title = reply['plan']['title'][:60]
                # AI tag suggestions belong to the plan, never to the profile.
            contracts.validate('reply', reply)
            session.add(Message(chat_id=chat_id, role='assistant', reply=reply))
            chat.updated_at = now()
            if settings.mock_ai and not clarification:
                chat.mock_stage += 1
            if generation_id:
                session.execute(update(Generation).where(Generation.id == generation_id, Generation.status == 'running')
                                .values(status='succeeded', reply=reply, updated_at=now(), lease_until=0))
            session.commit()
            if reply['type'] == 'plan':
                background.add_task(summarize, user.id, chat_id)
            return reply
        finally:
            session.rollback()
            try:
                session.execute(update(Chat).where(Chat.id == chat_id, Chat.busy_until == lease).values(busy_until=0.0))
                session.commit()
            except SQLAlchemyError as exc:
                session.rollback()
                logger.warning('Chat lease release skipped: %s', type(exc).__name__)

    @app.post('/api/chats/{chat_id}/messages')
    async def send_message(chat_id: str, body: SendMessage, background: BackgroundTasks, user: User = Depends(authenticated), session: Session = Depends(db)):
        return await process_message(chat_id, body, background, user, session)

    generations.install(app, sessions, authenticated, db, owned_chat, SendMessage, process_message)
    account_security.install(app, settings, authenticated, db, cookie_name)

    @app.post('/api/needs/parse')
    async def parse_need(body: dict, user: User = Depends(authenticated)):
        from jsonschema import ValidationError
        try:
            contracts.validate('parse-need', body, 'request')
        except ValidationError:
            raise ApiError('VALIDATION_ERROR') from None
        try:
            result = await app.state.consult.call('parse-need', body)
            if set(result['confidence']) != {k for k,v in result.items() if k!='confidence' and v is not None}:
                raise ValueError('Invalid confidence')
            return result
        except (httpx.HTTPError, TimeoutError, ValueError, ValidationError, KeyError, TypeError):
            return contracts.example('need.empty.json')

    @app.get('/api/plans')
    def list_plans(user: User = Depends(authenticated), session: Session = Depends(db)):
        plans = session.scalars(select(Plan).where(Plan.user_id == user.id).order_by(Plan.created_at.desc(), Plan.id.desc()))
        return [{'plan_id': p.id, 'chat_id': p.chat_id, 'title': p.body['title'], 'created_at': p.created_at} for p in plans]

    @app.get('/api/plans/{plan_id}')
    def get_plan(plan_id: str, user: User = Depends(authenticated), session: Session = Depends(db)):
        allowed = Plan.user_id == user.id
        if user.role == 'analyst':
            linked = select(Application.seq).where(Application.data['plan_id'].as_string() == Plan.id, Application.status != 'draft').exists()
            allowed = allowed | linked
        plan = session.scalar(select(Plan).where(Plan.id == plan_id, allowed))
        if plan is None:
            raise ApiError('NOT_FOUND')
        messages = session.scalars(select(Message).where(Message.chat_id == plan.chat_id).order_by(Message.seq)).all()
        before = []
        for message in messages:
            if message.reply.get('plan_id') == plan_id:
                break
            before.append(message)
        # Repair derived figures on read; keep the historical database record intact.
        plan_chat = session.get(Chat, plan.chat_id)
        view = plan.body if plan_chat and plan_chat.consult_state else apply_preferences(recalculate(plan.body), {'history': history(before), 'message': ''})
        return {'plan_id': plan.id, 'chat_id': plan.chat_id, 'created_at': plan.created_at, 'plan': view}

    conveyor.install(app, settings, contracts, sessions, authenticated, db)
    bank.install(app, authenticated, db)
    app.state.consult = Consult(app, settings, contracts, sessions)

    # Wrap the whole app so even INTERNAL responses include CORS headers.
    return ApiCORS(app, settings, sessions)
