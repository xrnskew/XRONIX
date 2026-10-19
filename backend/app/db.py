from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker
from sqlalchemy.engine import make_url
from pathlib import Path


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = 'users'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    email: Mapped[str] = mapped_column(String, unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(String)
    city: Mapped[str | None] = mapped_column(String, nullable=True)
    experience: Mapped[str | None] = mapped_column(String, nullable=True)
    budget_rub: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    memory: Mapped[str] = mapped_column(Text, default='')


class Chat(Base):
    __tablename__ = 'chats'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    title: Mapped[str] = mapped_column(String, default='Новый диалог')
    updated_at: Mapped[str] = mapped_column(String, default=now)
    plan_id: Mapped[str | None] = mapped_column(String, nullable=True)
    mock_stage: Mapped[int] = mapped_column(Integer, default=0)
    busy_until: Mapped[float] = mapped_column(default=0.0)


class Message(Base):
    __tablename__ = 'messages'
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String, unique=True, default=uid)
    chat_id: Mapped[str] = mapped_column(ForeignKey('chats.id'), index=True)
    role: Mapped[str] = mapped_column(String)
    created_at: Mapped[str] = mapped_column(String, default=now)
    reply: Mapped[dict] = mapped_column(JSON)
    answers: Mapped[list | None] = mapped_column(JSON, nullable=True)


class Plan(Base):
    __tablename__ = 'plans'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    chat_id: Mapped[str] = mapped_column(ForeignKey('chats.id'), index=True)
    created_at: Mapped[str] = mapped_column(String, default=now)
    body: Mapped[dict] = mapped_column(JSON)


def database(url):
    parsed = make_url(url)
    if parsed.drivername != 'sqlite':
        raise ValueError('MVP supports SQLite only')
    if parsed.database and parsed.database != ':memory:':
        Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, connect_args={'check_same_thread': False, 'timeout': 10})

    @event.listens_for(engine, 'connect')
    def configure(connection, _):
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA journal_mode=WAL')

    return engine, sessionmaker(engine, expire_on_commit=False)
