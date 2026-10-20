"""SQLite Backup API, daily scheduling and explicitly confirmed offline restore.

CLI: python -m app.maintenance --help. Nothing here is exposed over HTTP.
"""
import argparse
import asyncio
import hashlib
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from .config import Settings
from .migrations import CURRENT_VERSION, validate_schema
from .storage import (StorageError, backup_directory, check_space, database_path, file_lock,
                      fsync_directory, fsync_file, integrity, private_directory, readonly, service_lock_path)

logger = logging.getLogger(__name__)
MANAGED = re.compile(r'^xronix-(daily|manual|pre-migration|pre-restore)-\d{8}T\d{6}Z-[a-f0-9]{12}\.sqlite3$')


def verify(path):
    path = Path(path).absolute()
    with closing(readonly(path)) as connection:
        integrity(connection)
        return validate_schema(connection, allow_legacy=True)


def copies(directory):
    return sorted((p for p in directory.iterdir() if MANAGED.fullmatch(p.name) and not p.is_symlink() and p.is_file()), key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)


def _copy_database(settings, source, destination):
    deadline = time.monotonic() + settings.backup_timeout_seconds
    def progress(status, remaining, total):
        if time.monotonic() >= deadline:
            raise StorageError('BACKUP_TIMEOUT')
    with closing(readonly(source)) as reader, closing(sqlite3.connect(destination)) as writer:
        # Read-only SQLite URI (not immutable): committed WAL pages are included.
        reader.set_progress_handler(lambda: int(time.monotonic() >= deadline), 10000)
        writer.set_progress_handler(lambda: int(time.monotonic() >= deadline), 10000)
        reader.backup(writer, pages=256, progress=progress, sleep=0.05)
        writer.execute('PRAGMA journal_mode=DELETE')
        integrity(writer)
        validate_schema(writer, allow_legacy=True)
    os.chmod(destination, 0o600)
    fsync_file(destination)


def snapshot(settings, kind='manual', only_if_due=False):
    """Internal: caller holds a service lock. Only verified snapshots get final names."""
    if kind not in ('daily', 'manual', 'pre-migration', 'pre-restore'):
        raise StorageError('INVALID_BACKUP_KIND')
    source, directory = database_path(settings), backup_directory(settings)
    private_directory(directory)
    with file_lock(directory / '.backup.lock', exclusive=True):
        # An exclusive backup lock proves that partial files are from interrupted runs.
        for stale in directory.glob('.partial-*.sqlite3'):
            if stale.is_file() and not stale.is_symlink():
                stale.unlink()
                for suffix in ('-wal', '-shm', '-journal'):
                    Path(str(stale) + suffix).unlink(missing_ok=True)
        existing = copies(directory)
        daily = [p for p in existing if p.name.startswith('xronix-daily-')]
        if only_if_due and daily and time.time() - daily[0].stat().st_mtime < 86400:
            return None
        with closing(readonly(source)) as reader:
            size = reader.execute('PRAGMA page_count').fetchone()[0] * reader.execute('PRAGMA page_size').fetchone()[0]
        check_space(directory, settings.db_min_free_bytes, needed=size)
        descriptor, temporary = tempfile.mkstemp(prefix='.partial-', suffix='.sqlite3', dir=directory)
        os.close(descriptor)
        temporary = Path(temporary)
        try:
            _copy_database(settings, source, temporary)
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            result = directory / f'xronix-{kind}-{stamp}-{uuid4().hex[:12]}.sqlite3'
            os.replace(temporary, result)
            fsync_directory(directory)
            # Delete only this tool's regular backup files, and only after success.
            for old in copies(directory)[settings.backup_retention_count:]:
                old.unlink()
            fsync_directory(directory)
            logger.info('Database backup completed kind=%s', kind)
            return result
        finally:
            temporary.unlink(missing_ok=True)
            for suffix in ('-wal', '-shm', '-journal'):
                Path(str(temporary) + suffix).unlink(missing_ok=True)


def create_backup(settings, daily=False):
    with file_lock(service_lock_path(settings)):
        return snapshot(settings, kind='daily' if daily else 'manual', only_if_due=daily)


def restore(settings, source, confirmation=None):
    target, source = database_path(settings), Path(source).absolute()
    if confirmation != f'RESTORE {target}':
        raise StorageError('EXPLICIT_RESTORE_CONFIRMATION_REQUIRED')
    if target.is_symlink():
        raise StorageError('DATABASE_FILE_REQUIRED')
    if source.resolve() == target.resolve():
        raise StorageError('RESTORE_SOURCE_IS_WORKING_DATABASE')
    target.parent.mkdir(parents=True, exist_ok=True)
    with file_lock(service_lock_path(settings), exclusive=True):
        # No managed backend/backup may run during restore. Never bypass this lock.
        verify(source)
        check_space(target.parent, settings.db_min_free_bytes, needed=source.stat().st_size)
        descriptor, staged = tempfile.mkstemp(prefix='.restore-', suffix='.sqlite3', dir=target.parent)
        os.close(descriptor)
        staged = Path(staged)
        try:
            _copy_database(settings, source, staged)
            if target.exists():
                # A rollback snapshot of the current state is mandatory.
                snapshot(settings, kind='pre-restore')
                with closing(sqlite3.connect(target, timeout=1)) as working:
                    if working.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0] != 0:
                        raise StorageError('DATABASE_HAS_ACTIVE_SQLITE_CLIENTS')
                    if working.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete':
                        raise StorageError('DATABASE_HAS_ACTIVE_SQLITE_CLIENTS')
            if any(Path(str(target) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')):
                raise StorageError('DATABASE_SIDECARS_REQUIRE_MANUAL_INSPECTION')
            os.replace(staged, target)
            fsync_directory(target.parent)
            logger.info('Database restore completed after explicit confirmation')
        finally:
            staged.unlink(missing_ok=True)
            for suffix in ('-wal', '-shm', '-journal'):
                Path(str(staged) + suffix).unlink(missing_ok=True)


def export_backup(settings, source, destination):
    """Manual copy to an operator-mounted private external filesystem; no cloud SDK."""
    source, destination = Path(source).absolute(), Path(destination).absolute()
    private_directory(destination)
    managed_directory = backup_directory(settings)
    with file_lock(managed_directory / '.backup.lock'):
        if source.parent.resolve() != managed_directory.resolve() or not MANAGED.fullmatch(source.name):
            raise StorageError('EXPORT_REQUIRES_MANAGED_BACKUP')
        verify(source)
        check_space(destination, settings.db_min_free_bytes, needed=source.stat().st_size)
        final = destination / source.name
        if final.exists():
            raise StorageError('EXPORT_DESTINATION_EXISTS')
        descriptor, temporary = tempfile.mkstemp(prefix='.export-', dir=destination)
        os.close(descriptor)
        temporary = Path(temporary)
        try:
            shutil.copyfile(source, temporary)
            def digest(path):
                with path.open('rb') as stream:
                    return hashlib.file_digest(stream, 'sha256').digest()
            if digest(source) != digest(temporary):
                raise StorageError('EXPORT_CHECKSUM_MISMATCH')
            verify(temporary)
            fsync_file(temporary)
            # link is atomic and refuses an existing destination; no silent overwrite.
            os.link(temporary, final)
            fsync_directory(destination)
            return final
        finally:
            temporary.unlink(missing_ok=True)


def check_database(settings):
    path = database_path(settings)
    with file_lock(service_lock_path(settings)):
        schema_version = verify(path)
        free = check_space(path.parent, settings.db_min_free_bytes)
        directory = backup_directory(settings)
        if directory.exists():
            check_space(directory, settings.db_min_free_bytes)
        return {'schema_version': schema_version, 'free_bytes': free}


async def backup_loop(settings):
    while True:
        # Shield the native backup until it cleans up; cancellation must not abandon a partial file.
        operation = asyncio.create_task(asyncio.to_thread(create_backup, settings, True))
        try:
            await asyncio.shield(operation)
        except asyncio.CancelledError:
            try:
                await operation
            except Exception:
                pass
            raise
        except Exception as exc:
            code = exc.code if isinstance(exc, StorageError) else type(exc).__name__
            logger.warning('Database maintenance failed action=backup code=%s', code)
        await asyncio.sleep(60)


def main(argv=None):
    parser = argparse.ArgumentParser(description='Local SQLite maintenance; restore requires a stopped backend and exact confirmation.')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('backup')
    commands.add_parser('check')
    commands.add_parser('migrate')
    commands.add_parser('run-daily')
    validation = commands.add_parser('verify')
    validation.add_argument('--backup', required=True)
    recovery = commands.add_parser('restore')
    recovery.add_argument('--backup', required=True)
    recovery.add_argument('--confirm', help='Exact phrase: RESTORE <absolute path of working database>')
    export = commands.add_parser('export')
    export.add_argument('--backup', required=True)
    export.add_argument('--destination', required=True, help='Already mounted private external storage directory')
    args = parser.parse_args(argv)
    settings = Settings()
    logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
    try:
        if args.command == 'backup':
            print(create_backup(settings))
        elif args.command == 'verify':
            print({'schema_version': verify(args.backup), 'status': 'ok'})
        elif args.command == 'restore':
            restore(settings, args.backup, args.confirm)
            print('Restore completed; start the backend and check /health.')
        elif args.command == 'export':
            print(export_backup(settings, args.backup, args.destination))
        elif args.command == 'migrate':
            from .migrations import running_database
            with running_database(settings):
                print({'schema_version': CURRENT_VERSION})
        elif args.command == 'run-daily':
            create_backup(settings, daily=True)
        else:
            print(check_database(settings))
    except (StorageError, OSError, sqlite3.Error) as exc:
        code = exc.code if isinstance(exc, StorageError) else type(exc).__name__
        logger.error('Database maintenance failed action=%s code=%s', args.command, code)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
