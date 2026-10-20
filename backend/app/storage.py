"""Local SQLite maintenance primitives. No public HTTP routes."""
import os
import shutil
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy.engine import make_url

from . import fileguard
from .fileguard import FileGuard, open_private


class StorageError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def database_path(settings):
    url = make_url(settings.database_url)
    if url.drivername != 'sqlite' or not url.database or url.database == ':memory:':
        raise StorageError('FILE_DATABASE_REQUIRED')
    return Path(url.database).absolute()


def backup_directory(settings):
    return Path(settings.backup_dir).absolute() if settings.backup_dir else database_path(settings).parent / 'backups'


def private_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.is_symlink() or not path.is_dir() or (not fileguard.WINDOWS and path.stat().st_mode & 0o077):
        raise StorageError('BACKUP_DIRECTORY_MUST_BE_PRIVATE')


@contextmanager
def file_lock(path, exclusive=False, blocking=False):
    descriptor = open_private(path)
    with os.fdopen(descriptor, 'r+', encoding='utf-8') as stream:
        guard = FileGuard(stream)
        try:
            try:
                guard.acquire(exclusive=exclusive, blocking=blocking)
            except BlockingIOError:
                raise StorageError('DATABASE_OR_BACKUP_IN_USE') from None
            yield guard
        finally:
            guard.release()


def service_lock_path(settings):
    path = database_path(settings)
    return path.with_name(path.name + '.service.lock')


def check_space(directory, reserve, needed=0):
    free = shutil.disk_usage(directory).free
    if free < reserve + needed:
        raise StorageError('INSUFFICIENT_DISK_SPACE')
    return free


def readonly(path):
    if path.is_symlink() or not path.is_file():
        raise StorageError('DATABASE_FILE_REQUIRED')
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1)
    connection.execute('PRAGMA trusted_schema=OFF')
    return connection


def integrity(connection):
    if connection.execute('PRAGMA integrity_check').fetchone() != ('ok',):
        raise StorageError('DATABASE_INTEGRITY_FAILED')
    if connection.execute('PRAGMA foreign_key_check').fetchone() is not None:
        raise StorageError('DATABASE_FOREIGN_KEYS_FAILED')
    if connection.execute("SELECT 1 FROM sqlite_master WHERE type IN ('trigger', 'view') LIMIT 1").fetchone():
        raise StorageError('UNEXPECTED_DATABASE_SCHEMA')


def fsync_file(path):
    with path.open('r+b' if fileguard.WINDOWS else 'rb') as stream:
        os.fsync(stream.fileno())


def fsync_directory(path):
    if fileguard.WINDOWS:
        # Directory fsync has no os-level Windows equivalent; files are still fsynced.
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
