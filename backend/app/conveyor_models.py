"""Persistent conveyor state; optimistic versions guard business mutations."""
from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base, uid, now

class Company(Base):
    __tablename__ = 'companies'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    inn: Mapped[str] = mapped_column(String, unique=True)
    registry: Mapped[dict] = mapped_column(JSON)

class CompanyMember(Base):
    __tablename__ = 'company_members'
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), primary_key=True)
    company_id: Mapped[str] = mapped_column(ForeignKey('companies.id'), primary_key=True)
    member_role: Mapped[str] = mapped_column(String)
    authority_confirmed: Mapped[bool] = mapped_column(default=False)
    authority_path: Mapped[str | None] = mapped_column(Text, nullable=True)

class Application(Base):
    __tablename__ = 'applications'
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String, unique=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    company_id: Mapped[str] = mapped_column(ForeignKey('companies.id'))
    status: Mapped[str] = mapped_column(String, default='draft', index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[str] = mapped_column(String, default=now)
    updated_at: Mapped[str] = mapped_column(String, default=now)
    due_at: Mapped[float] = mapped_column(default=0.0)
    lease_until: Mapped[float] = mapped_column(default=0.0)
    __mapper_args__ = {'version_id_col': version}

class ApplicationEvent(Base):
    __tablename__ = 'application_events'
    seq: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    id: Mapped[str] = mapped_column(String, unique=True, default=uid)
    application_id: Mapped[str] = mapped_column(ForeignKey('applications.id'), index=True)
    from_status: Mapped[str | None] = mapped_column(String, nullable=True)
    to_status: Mapped[str] = mapped_column(String)
    actor: Mapped[str] = mapped_column(String)
    actor_id: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str] = mapped_column(Text, default='')
    at: Mapped[str] = mapped_column(String, default=now)

class CheckResult(Base):
    __tablename__ = 'check_results'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    application_id: Mapped[str] = mapped_column(ForeignKey('applications.id'), index=True)
    kind: Mapped[str] = mapped_column(String)
    result: Mapped[str] = mapped_column(String)
    data: Mapped[dict] = mapped_column(JSON)
    source: Mapped[str] = mapped_column(String)
    at: Mapped[str] = mapped_column(String, default=now)

class ScoringResult(Base):
    __tablename__ = 'scoring_results'
    application_id: Mapped[str] = mapped_column(ForeignKey('applications.id'), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    rules_version: Mapped[str] = mapped_column(String)

class Offer(Base):
    __tablename__ = 'offers'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    application_id: Mapped[str] = mapped_column(ForeignKey('applications.id'), index=True)
    data: Mapped[dict] = mapped_column(JSON)

class Document(Base):
    __tablename__ = 'documents'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    application_id: Mapped[str] = mapped_column(ForeignKey('applications.id'), index=True)
    kind: Mapped[str] = mapped_column(String)
    filename: Mapped[str] = mapped_column(String)
    stored_path: Mapped[str] = mapped_column(Text)
    uploaded_at: Mapped[str] = mapped_column(String, default=now)

class FeedItem(Base):
    __tablename__ = 'feed_items'
    id: Mapped[str] = mapped_column(String, primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey('users.id'), index=True)
    application_id: Mapped[str | None] = mapped_column(ForeignKey('applications.id'), nullable=True)
    kind: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(String, default=now)
    read: Mapped[bool] = mapped_column(default=False)
