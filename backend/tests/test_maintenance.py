import os
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Base, User, database
from app.main import create_app
from app.maintenance import (backup_loop, check_database, copies, create_backup, export_backup,
                             main, restore, verify)
from app.migrations import BASELINE, CURRENT_VERSION, MIGRATIONS, checksum, running_database
from app.storage import StorageError, backup_directory, database_path, readonly
from test_backend import chat, register, send


@pytest.fixture
def settings(tmp_path):
    return Settings(database_url=f'sqlite:///{tmp_path}/live.db', jwt_secret='maintenance-test-only-' * 3,
                    backup_dir=str(tmp_path/'backups'), db_min_free_mb=0,
                    ai_requests_per_minute=100, ai_global_per_minute=1000)


def seeded_client(settings):
    return TestClient(create_app(settings), raise_server_exceptions=False)


def make_plan(client):
    h=register(client); cid=chat(client,h)
    send(client,h,cid,'идея')
    p=send(client,h,cid,'ответы').json()
    return h,cid,p


def test_live_wal_snapshot_is_standalone_and_preserves_users_and_plans(settings):
    with seeded_client(settings) as c:
        h,cid,p=make_plan(c)
        path=database_path(settings)
        # Hold a reader so WAL is still present: copying just the main file is unsafe.
        with closing(sqlite3.connect(path)) as connection:
            connection.execute('PRAGMA wal_autocheckpoint=0')
            connection.execute('UPDATE users SET city=?',('Данные из WAL',));connection.commit()
            assert Path(str(path)+'-wal').stat().st_size>0
            backup=create_backup(settings)
            if os.name != 'nt':
                assert backup.stat().st_mode & 0o777==0o600
                assert backup.parent.stat().st_mode & 0o777==0o700
            assert verify(backup)==CURRENT_VERSION
            with closing(readonly(backup)) as reader:
                assert reader.execute('SELECT city FROM users').fetchone()[0]=='Данные из WAL'
                assert reader.execute('SELECT id FROM plans').fetchone()[0]==p['plan_id']
                assert reader.execute('SELECT count(*) FROM messages').fetchone()[0]==4
            assert not Path(str(backup)+'-wal').exists()
        for route in ['/backups/'+backup.name,'/api/backups/'+backup.name,'/data/backups/'+backup.name]:
            assert c.get(route,headers=h).status_code==404
        assert c.get(f'/api/plans/{p["plan_id"]}',headers=h).status_code==200


def test_restore_requires_exact_confirmation_and_stopped_server(settings):
    with seeded_client(settings) as c:
        h,cid,p=make_plan(c); backup=create_backup(settings)
        with pytest.raises(StorageError,match='CONFIRMATION'):
            restore(settings,backup)
        with pytest.raises(StorageError,match='IN_USE'):
            restore(settings,backup,f'RESTORE {database_path(settings)}')
        c.patch('/api/me',headers=h,json={'city':'После снимка'})
    restore(settings,backup,f'RESTORE {database_path(settings)}')
    assert any('pre-restore' in p.name for p in copies(backup_directory(settings)))
    with seeded_client(settings) as c:
        assert c.get('/api/me',headers=h).json()['city'] is None
        assert c.get(f'/api/plans/{p["plan_id"]}',headers=h).json()['plan']==p['plan']
        assert len(c.get(f'/api/chats/{cid}',headers=h).json()['messages'])==4


@pytest.mark.parametrize('damage',['garbage','truncate','unrelated'])
def test_damaged_backup_never_replaces_working_database(settings,damage):
    with seeded_client(settings) as c:
        h=register(c); good=create_backup(settings)
    damaged=good.parent/'damaged.sqlite3'
    if damage=='garbage': damaged.write_bytes(b'not a database containing a private password')
    elif damage=='truncate': damaged.write_bytes(good.read_bytes()[:128])
    else:
        with sqlite3.connect(damaged) as conn: conn.execute('CREATE TABLE unrelated (x TEXT)')
    original=database_path(settings).read_bytes()
    with pytest.raises((StorageError,sqlite3.Error)):
        restore(settings,damaged,f'RESTORE {database_path(settings)}')
    assert database_path(settings).read_bytes()==original
    with seeded_client(settings) as c: assert c.get('/api/me',headers=h).status_code==200


def test_additive_migration_preserves_legacy_rows_and_creates_pre_upgrade_backup(settings):
    path=database_path(settings)
    with sqlite3.connect(path) as connection:
        for statement in BASELINE: connection.execute(statement)
        connection.execute("INSERT INTO users VALUES ('u','legacy@example.com','hash','Legacy',NULL,NULL,100,'[]','old memory')")
        connection.execute("INSERT INTO chats VALUES ('c','u','title','date',NULL)")
        connection.execute("INSERT INTO messages VALUES (1,'m','c','user','date','{\"type\":\"message\",\"text\":\"old\"}')")
        connection.execute("INSERT INTO plans VALUES ('p','u','c','date','{\"title\":\"old plan\"}')")
        connection.execute('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY,name TEXT,checksum TEXT,applied_at TEXT)')
        connection.execute("INSERT INTO schema_migrations VALUES (1,?,?, 'date')",(MIGRATIONS[0][1],checksum(MIGRATIONS[0])))
    with running_database(settings):
        with closing(readonly(path)) as conn:
            assert conn.execute('SELECT email,memory FROM users').fetchone()==('legacy@example.com','old memory')
            assert conn.execute('SELECT body FROM plans').fetchone()[0]=='{"title":"old plan"}'
            assert conn.execute('SELECT mock_stage,busy_until FROM chats').fetchone()==(0,0)
            assert conn.execute('SELECT answers FROM messages').fetchone()==(None,)
            assert conn.execute('SELECT MAX(version) FROM schema_migrations').fetchone()[0]==CURRENT_VERSION
    pre=copies(backup_directory(settings))
    assert len(pre)==1 and 'pre-migration' in pre[0].name
    assert verify(pre[0])==1
    with running_database(settings): pass
    assert len(copies(backup_directory(settings)))==1


def test_existing_sqlalchemy_create_all_database_is_adopted_without_loss(settings):
    engine,sessions=database(settings.database_url)
    Base.metadata.create_all(engine)  # Exact pre-migration application behavior.
    with sessions() as s:
        s.add(User(id='u',email='existing@example.com',name='Existing',password_hash='hash',tags=['личное'],memory='память'))
        s.commit()
    engine.dispose()
    with running_database(settings):
        assert check_database(settings)['schema_version']==CURRENT_VERSION
        with closing(readonly(database_path(settings))) as c:
            assert c.execute('SELECT memory,tags FROM users').fetchone()==('память','["\\u043b\\u0438\\u0447\\u043d\\u043e\\u0435"]')


def test_failed_migration_rolls_back_schema_and_preserves_rows(settings,monkeypatch):
    import app.migrations as migrations
    with seeded_client(settings) as c: register(c)
    with sqlite3.connect(database_path(settings)) as conn:
        conn.execute('DELETE FROM schema_migrations WHERE version=2')
    original=migrations.apply
    def fail(connection):
        connection.execute('ALTER TABLE users ADD COLUMN temporary_field TEXT')
        raise StorageError('TEST_MIGRATION_FAILED')
    monkeypatch.setattr(migrations,'apply',fail)
    with pytest.raises(StorageError):
        with running_database(settings): pass
    with closing(readonly(database_path(settings))) as conn:
        assert 'temporary_field' not in {r[1] for r in conn.execute('PRAGMA table_info(users)')}
        assert conn.execute('SELECT count(*) FROM users').fetchone()[0]==1
    monkeypatch.setattr(migrations,'apply',original)
    with running_database(settings): pass


def test_future_or_modified_migration_history_fails_closed(settings):
    with seeded_client(settings) as c: register(c)
    with sqlite3.connect(database_path(settings)) as conn:
        conn.execute("UPDATE schema_migrations SET checksum='modified' WHERE version=1")
    with pytest.raises(StorageError,match='HISTORY'):
        with running_database(settings): pass
    with closing(readonly(database_path(settings))) as conn:
        assert conn.execute('SELECT count(*) FROM users').fetchone()[0]==1


def test_retention_due_check_restart_and_concurrent_workers(settings):
    settings.backup_retention_count=2
    with seeded_client(settings) as c:
        register(c)
        first=create_backup(settings,daily=True)
        assert create_backup(settings,daily=True) is None
        os.utime(first,(time.time()-90000,)*2)
        with ThreadPoolExecutor(2) as pool:
            results=list(pool.map(lambda _: _daily_attempt(settings),range(2)))
        assert sum(p is not None for p in results)==1
        unrelated=backup_directory(settings)/'keep-me.txt';unrelated.write_text('do not delete')
        create_backup(settings);create_backup(settings)
        assert len(copies(backup_directory(settings)))==2
        assert unrelated.exists()
    with seeded_client(settings) as c:
        assert c.get('/health').status_code==200
        # Manual backups may rotate daily copies; scheduling creates a daily copy if none remains.
        create_backup(settings,daily=True)
        assert create_backup(settings,daily=True) is None


def _daily_attempt(settings):
    try:return create_backup(settings,daily=True)
    except StorageError as exc:
        assert exc.code=='DATABASE_OR_BACKUP_IN_USE'
        return None


def test_low_space_no_snapshot_no_pruning_and_safe_health_error(settings,monkeypatch,caplog):
    import app.storage as storage
    with seeded_client(settings) as c:
        register(c); good=create_backup(settings)
        settings.db_min_free_mb=1
        monkeypatch.setattr(storage.shutil,'disk_usage',lambda p: type('Usage',(),{'free':0})())
        with pytest.raises(StorageError,match='DISK_SPACE'):create_backup(settings)
        assert good.exists()
        r=c.get('/health')
        assert r.status_code==500 and r.json()['error']['code']=='INTERNAL'
        assert 'INSUFFICIENT_DISK_SPACE' in caplog.text
        assert 'maintenance-test-only' not in caplog.text and 'SELECT ' not in caplog.text


def test_daily_scheduler_is_lightweight_and_stops_cleanly(settings):
    settings.backup_enabled=True
    with seeded_client(settings) as c:
        register(c)
        for _ in range(100):
            directory=backup_directory(settings)
            if directory.exists() and copies(directory):break
            time.sleep(0.02)
        else:pytest.fail('daily backup did not run')
        assert len(copies(directory))==1
    with seeded_client(settings):pass
    assert len(copies(directory))==1


def test_external_export_verified_private_and_does_not_overwrite(settings,tmp_path):
    with seeded_client(settings) as c:
        register(c); backup=create_backup(settings)
        exported=export_backup(settings,backup,tmp_path/'external-mount')
        assert exported.read_bytes()==backup.read_bytes()
        if os.name != 'nt':
            assert exported.stat().st_mode & 0o777==0o600
        assert verify(exported)==CURRENT_VERSION
        with pytest.raises(StorageError,match='EXISTS'):export_backup(settings,backup,exported.parent)


def test_failed_backup_cleans_partial_and_does_not_publish(settings,monkeypatch):
    import app.maintenance as maintenance
    with seeded_client(settings) as c:
        register(c);good=create_backup(settings)
        def fail(*args):raise sqlite3.OperationalError('private SQL detail')
        monkeypatch.setattr(maintenance,'_copy_database',fail)
        with pytest.raises(sqlite3.Error):create_backup(settings)
        assert copies(backup_directory(settings))==[good]
        assert not list(backup_directory(settings).glob('.partial-*'))


def test_cli_error_is_sanitized_and_confirmation_cannot_be_omitted(settings,monkeypatch,caplog):
    with seeded_client(settings) as c:
        register(c);good=create_backup(settings)
    import app.maintenance as maintenance
    monkeypatch.setattr(maintenance,'Settings',lambda:settings)
    assert main(['restore','--backup',str(good)])==1
    assert 'CONFIRMATION' in caplog.text
    assert 'maintenance-test-only' not in caplog.text


def test_abandoned_partial_is_cleaned_but_unrelated_files_remain(settings):
    with seeded_client(settings) as c:
        register(c);create_backup(settings)
        folder=backup_directory(settings)
        stale=folder/'.partial-interrupted.sqlite3';stale.write_bytes(b'old partial')
        other=folder/'important.txt';other.write_text('keep')
        create_backup(settings)
        assert not stale.exists() and other.read_text()=='keep'


def test_restore_refuses_active_external_sqlite_writer(settings):
    with seeded_client(settings) as c:
        register(c);backup=create_backup(settings)
    with closing(sqlite3.connect(database_path(settings))) as writer:
        writer.execute('PRAGMA journal_mode=WAL')
        writer.execute('BEGIN IMMEDIATE')
        writer.execute("UPDATE users SET city='uncommitted'")
        with pytest.raises((StorageError,sqlite3.Error)):
            restore(settings,backup,f'RESTORE {database_path(settings)}')
        writer.rollback()
        assert writer.execute('SELECT city FROM users').fetchone()==(None,)


def test_backup_timeout_never_prunes_good_copies(settings,monkeypatch):
    import app.maintenance as maintenance
    with seeded_client(settings) as c:
        register(c);backup=create_backup(settings)
        ticks=iter([0,1000])
        monkeypatch.setattr(maintenance.time,'monotonic',lambda:next(ticks,1000))
        with pytest.raises(StorageError,match='TIMEOUT'):create_backup(settings)
        assert copies(backup_directory(settings))==[backup]
        assert not list(backup_directory(settings).glob('.partial-*'))
