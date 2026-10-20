"""Versioned, additive SQLite migrations. Published definitions must remain immutable."""
import hashlib
import json
import os
import sqlite3
from contextlib import closing, contextmanager

from .fileguard import open_private
from .storage import StorageError, check_space, database_path, file_lock, integrity, readonly, service_lock_path

BASELINE = (
    'CREATE TABLE IF NOT EXISTS users (id VARCHAR NOT NULL PRIMARY KEY, email VARCHAR NOT NULL UNIQUE, password_hash TEXT NOT NULL, name VARCHAR NOT NULL, city VARCHAR, experience VARCHAR, budget_rub INTEGER, tags JSON NOT NULL, memory TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS chats (id VARCHAR NOT NULL PRIMARY KEY, user_id VARCHAR NOT NULL REFERENCES users(id), title VARCHAR NOT NULL, updated_at VARCHAR NOT NULL, plan_id VARCHAR)',
    'CREATE TABLE IF NOT EXISTS messages (seq INTEGER NOT NULL PRIMARY KEY, id VARCHAR NOT NULL UNIQUE, chat_id VARCHAR NOT NULL REFERENCES chats(id), role VARCHAR NOT NULL, created_at VARCHAR NOT NULL, reply JSON NOT NULL)',
    'CREATE TABLE IF NOT EXISTS plans (id VARCHAR NOT NULL PRIMARY KEY, user_id VARCHAR NOT NULL REFERENCES users(id), chat_id VARCHAR NOT NULL REFERENCES chats(id), created_at VARCHAR NOT NULL, body JSON NOT NULL)',
    'CREATE INDEX IF NOT EXISTS ix_chats_user_id ON chats(user_id)',
    'CREATE INDEX IF NOT EXISTS ix_messages_chat_id ON messages(chat_id)',
    'CREATE INDEX IF NOT EXISTS ix_plans_user_id ON plans(user_id)',
    'CREATE INDEX IF NOT EXISTS ix_plans_chat_id ON plans(chat_id)',
)
ADDITIONS = (
    ('messages', 'answers', 'JSON'),
    ('chats', 'mock_stage', 'INTEGER NOT NULL DEFAULT 0'),
    ('chats', 'busy_until', 'FLOAT NOT NULL DEFAULT 0'),
)
LIMITS = (
    'CREATE TABLE IF NOT EXISTS rate_buckets (key VARCHAR NOT NULL PRIMARY KEY, count INTEGER NOT NULL, expires_at FLOAT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS ix_rate_buckets_expires_at ON rate_buckets(expires_at)',
)
FEATURES = (
    ('users', 'auth_version', 'INTEGER NOT NULL DEFAULT 0'),
    ('chats', 'facts', "JSON NOT NULL DEFAULT '{}'"),
    'CREATE TABLE IF NOT EXISTS generations (id VARCHAR PRIMARY KEY NOT NULL, user_id VARCHAR NOT NULL REFERENCES users(id), chat_id VARCHAR NOT NULL REFERENCES chats(id), request_id VARCHAR NOT NULL, payload JSON NOT NULL, status VARCHAR NOT NULL, reply JSON, error_code VARCHAR, created_at VARCHAR NOT NULL, updated_at VARCHAR NOT NULL, lease_until FLOAT NOT NULL DEFAULT 0, UNIQUE(user_id, request_id))',
    'CREATE INDEX IF NOT EXISTS ix_generations_user_id ON generations(user_id)',
    'CREATE INDEX IF NOT EXISTS ix_generations_chat_id ON generations(chat_id)',
    'CREATE INDEX IF NOT EXISTS ix_generations_status ON generations(status)',
    'CREATE TABLE IF NOT EXISTS password_reset_tokens (digest VARCHAR PRIMARY KEY NOT NULL, user_id VARCHAR NOT NULL REFERENCES users(id), expires_at FLOAT NOT NULL, password_binding VARCHAR NOT NULL)',
    'CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_user_id ON password_reset_tokens(user_id)',
)
MIGRATIONS = ((1, 'baseline', BASELINE), (2, 'chat_state_and_limits', (*ADDITIONS, *LIMITS)),
              (3, 'facts_generations_and_auth_version', FEATURES))
CURRENT_VERSION = MIGRATIONS[-1][0]
REQUIRED = {
    'users': {'id', 'email', 'password_hash', 'name', 'city', 'experience', 'budget_rub', 'tags', 'memory'},
    'chats': {'id', 'user_id', 'title', 'updated_at', 'plan_id'},
    'messages': {'seq', 'id', 'chat_id', 'role', 'created_at', 'reply'},
    'plans': {'id', 'user_id', 'chat_id', 'created_at', 'body'},
}


def checksum(migration):
    return hashlib.sha256(json.dumps(migration, ensure_ascii=True).encode()).hexdigest()


def version(connection):
    exists = connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").fetchone()
    if not exists:
        return 0
    rows = connection.execute('SELECT version, name, checksum FROM schema_migrations ORDER BY version').fetchall()
    if len(rows) > len(MIGRATIONS):
        raise StorageError('DATABASE_SCHEMA_NEWER_THAN_CODE')
    for row, migration in zip(rows, MIGRATIONS):
        if row != (migration[0], migration[1], checksum(migration)):
            raise StorageError('MIGRATION_HISTORY_MISMATCH')
    return len(rows)


def validate_schema(connection, allow_legacy=False):
    current = version(connection)
    if not allow_legacy and current != CURRENT_VERSION:
        raise StorageError('DATABASE_MIGRATION_REQUIRED')
    for table, fields in REQUIRED.items():
        columns = {row[1] for row in connection.execute(f'PRAGMA table_info({table})')}
        if not fields <= columns:
            raise StorageError('DATABASE_SCHEMA_MISMATCH')
    if current >= 2:
        for table, field, _ in ADDITIONS:
            if field not in {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}:
                raise StorageError('DATABASE_SCHEMA_MISMATCH')
        if not {'key', 'count', 'expires_at'} <= {r[1] for r in connection.execute('PRAGMA table_info(rate_buckets)')}:
            raise StorageError('DATABASE_SCHEMA_MISMATCH')
    if current >= 3:
        for table, fields in {
            'users': {'auth_version'}, 'chats': {'facts'},
            'generations': {'id', 'user_id', 'chat_id', 'request_id', 'payload', 'status', 'reply', 'error_code', 'created_at', 'updated_at', 'lease_until'},
            'password_reset_tokens': {'digest', 'user_id', 'expires_at', 'password_binding'},
        }.items():
            if not fields <= {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}:
                raise StorageError('DATABASE_SCHEMA_MISMATCH')
    return current


def apply(connection):
    current = version(connection)
    connection.execute('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)')
    for migration in MIGRATIONS[current:]:
        for step in migration[2]:
            if isinstance(step, str):
                connection.execute(step)
            else:
                table, field, definition = step
                if field not in {r[1] for r in connection.execute(f'PRAGMA table_info({table})')}:
                    connection.execute(f'ALTER TABLE {table} ADD COLUMN {field} {definition}')
        connection.execute("INSERT INTO schema_migrations VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))", (migration[0], migration[1], checksum(migration)))
    validate_schema(connection)
    if connection.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise StorageError('DATABASE_FOREIGN_KEYS_FAILED')


@contextmanager
def running_database(settings):
    """Shared lifetime lock blocks restore; pending migrations require all other servers stopped."""
    path = database_path(settings)
    path.parent.mkdir(parents=True, exist_ok=True)
    with file_lock(service_lock_path(settings)) as guard:
        existing = path.exists() and path.stat().st_size > 0
        current = 0
        if existing:
            with closing(readonly(path)) as connection:
                current = version(connection)
                if current == CURRENT_VERSION:
                    validate_schema(connection)
        if current < CURRENT_VERSION:
            try:
                guard.acquire(exclusive=True)
            except BlockingIOError:
                raise StorageError('STOP_BACKEND_BEFORE_MIGRATION') from None
            check_space(path.parent, settings.db_min_free_bytes)
            if existing:
                with closing(readonly(path)) as connection:
                    tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
                if tables:
                    # A verified pre-upgrade snapshot is mandatory before touching existing data.
                    from .maintenance import snapshot
                    snapshot(settings, kind='pre-migration')
            descriptor = open_private(path)
            os.close(descriptor)
            with closing(sqlite3.connect(path, timeout=5)) as connection:
                connection.execute('PRAGMA foreign_keys=ON')
                connection.execute('BEGIN IMMEDIATE')
                try:
                    apply(connection)
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
            os.chmod(path, 0o600)
            guard.acquire()
        yield
