"""Durable admission and polling. Ambiguous interrupted model calls never auto-retry."""
import asyncio
import logging
import time

from fastapi import BackgroundTasks, Depends
from pydantic import Field
from sqlalchemy import delete, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from .db import Chat, Generation, User, now
from .errors import ApiError

logger = logging.getLogger(__name__)
ACTIVE = ('queued', 'running')


def view(job):
    return {'id': job.id, 'chat_id': job.chat_id, 'request_id': job.request_id,
            'status': job.status, 'reply': job.reply, 'error_code': job.error_code,
            'created_at': job.created_at, 'updated_at': job.updated_at,
            'request': job.payload}


def latest(session, chat_id):
    job = session.scalar(select(Generation).where(Generation.chat_id == chat_id)
                         .order_by(Generation.created_at.desc(), Generation.id.desc()).limit(1))
    return view(job) if job else None


def install(app, sessions, authenticated, db, owned_chat, send_type, process):
    class Enqueue(send_type):
        request_id: str = Field(min_length=16, max_length=80, pattern=r'^[a-zA-Z0-9_-]+$')

    @app.post('/api/chats/{chat_id}/generations', status_code=202)
    def enqueue(chat_id: str, body: Enqueue, user: User = Depends(authenticated), session: Session = Depends(db)):
        # SQLite write lock serializes admission across workers and chats.
        session.execute(update(User).where(User.id == user.id).values(auth_version=User.auth_version))
        chat = owned_chat(session, chat_id, user.id)
        payload = body.model_dump(exclude={'request_id'})
        prior = session.scalar(select(Generation).where(Generation.user_id == user.id, Generation.request_id == body.request_id))
        if prior:
            if prior.chat_id != chat_id or prior.payload != payload:
                raise ApiError('VALIDATION_ERROR')
            return view(prior)
        if session.scalar(select(Chat.id).where(Chat.user_id == user.id, Chat.busy_until > time.time()).limit(1)) or session.scalar(select(Generation.id).where(
                Generation.user_id == user.id, Generation.status.in_(ACTIVE)).limit(1)):
            raise ApiError('RATE_LIMITED')
        # Validate question IDs and choices before persisting a queued operation.
        from .chat_context import bound_answers
        from .db import Message
        previous = session.scalar(select(Message).where(Message.chat_id == chat_id, Message.role == 'assistant').order_by(Message.seq.desc()).limit(1))
        bound_answers(body, previous)
        job = Generation(user_id=user.id, chat_id=chat_id, request_id=body.request_id, payload=payload)
        session.add(job)
        session.commit()
        return view(job)

    @app.get('/api/generations/{generation_id}')
    def get_generation(generation_id: str, user: User = Depends(authenticated), session: Session = Depends(db)):
        job = session.scalar(select(Generation).where(Generation.id == generation_id, Generation.user_id == user.id))
        if job is None:
            raise ApiError('NOT_FOUND')
        return view(job)

    async def run_one(job_id):
        with sessions() as session:
            job = session.get(Generation, job_id)
            user = session.get(User, job.user_id)
            background = BackgroundTasks()
            try:
                reply = await process(job.chat_id, send_type.model_validate(job.payload), background, user, session, job_id)
                session.execute(update(Generation).where(Generation.id == job_id, Generation.status == 'running')
                                .values(status='succeeded', reply=reply, updated_at=now(), lease_until=0))
                session.commit()
            except asyncio.CancelledError:
                # Shutdown leaves a lease: timeout marks uncertainty as failed,
                # not queued, so a provider request is never silently duplicated.
                session.rollback()
                raise
            except Exception as exc:
                session.rollback()
                code = exc.code if isinstance(exc, ApiError) else 'INTERNAL'
                logger.warning('Generation failed code=%s', code)
                session.execute(update(Generation).where(Generation.id == job_id, Generation.status == 'running')
                                .values(status='failed', error_code=code, updated_at=now(), lease_until=0))
                session.commit()
            else:
                # Summary failure must not change a durable successful result.
                await background()

    async def worker():
        tasks = set()
        try:
            while True:
                try:
                    for done in [task for task in tasks if task.done()]:
                        if not done.cancelled() and done.exception():
                            logger.warning('Generation task failed kind=%s', type(done.exception()).__name__)
                    tasks = {task for task in tasks if not task.done()}
                    with sessions() as session:
                        session.execute(update(Generation).where(Generation.status == 'running', Generation.lease_until < time.time())
                                        .values(status='failed', error_code='AI_UNAVAILABLE', updated_at=now(), lease_until=0))
                        if len(tasks) < app.state.settings.ai_max_concurrent:
                            job_id = session.scalar(select(Generation.id).where(Generation.status == 'queued')
                                                    .order_by(Generation.created_at, Generation.id).limit(1))
                            if job_id and session.execute(update(Generation).where(Generation.id == job_id, Generation.status == 'queued')
                                                           .values(status='running', lease_until=time.time()+210, updated_at=now())).rowcount:
                                session.commit()
                                tasks.add(asyncio.create_task(run_one(job_id)))
                        session.commit()
                except SQLAlchemyError as exc:
                    logger.warning('Generation queue retry kind=%s', type(exc).__name__)
                await asyncio.sleep(0.3)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    app.state.generation_worker = worker
