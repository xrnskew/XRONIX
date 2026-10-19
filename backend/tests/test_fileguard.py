import ctypes
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app import fileguard
from app.storage import StorageError, file_lock


def test_shared_exclusive_upgrade_and_downgrade(tmp_path):
    path=tmp_path/'service.lock'
    with file_lock(path) as first:
        with file_lock(path):
            with pytest.raises(BlockingIOError):first.acquire(exclusive=True)
        first.acquire(exclusive=True)
        with pytest.raises(StorageError):
            with file_lock(path):pass
        first.acquire()
        with file_lock(path):pass
    with file_lock(path,exclusive=True):pass


def test_file_lock_is_enforced_between_processes(tmp_path):
    path=tmp_path/'process.lock'
    code='''import sys
from app.storage import file_lock, StorageError
try:
    with file_lock(__import__('pathlib').Path(sys.argv[1]), exclusive=True):
        raise SystemExit(10)
except StorageError:
    raise SystemExit(0)
'''
    with file_lock(path):
        result=subprocess.run([sys.executable,'-c',code,str(path)],cwd=Path(__file__).resolve().parents[1],capture_output=True)
        assert result.returncode==0,result.stderr.decode()
    with file_lock(path,exclusive=True):pass


def test_open_private_without_posix_nofollow_constant(tmp_path,monkeypatch):
    monkeypatch.delattr(fileguard.os,'O_NOFOLLOW',raising=False)
    descriptor=fileguard.open_private(tmp_path/'key')
    os.close(descriptor)


@pytest.mark.skipif(os.name=='nt',reason='Creating symlinks may require Windows developer mode/admin')
def test_symlink_key_is_rejected(tmp_path):
    original=tmp_path/'original';original.write_text('do not change')
    link=tmp_path/'key';link.symlink_to(original)
    with pytest.raises(OSError):fileguard.open_private(link)
    assert original.read_text()=='do not change'


def test_windows_lock_flags_and_release_without_loading_posix_api(tmp_path,monkeypatch):
    calls=[]
    def lock(handle,flags,reserved,low,high,overlapped):
        calls.append(('lock',flags,low,high));return 1
    def unlock(*args):
        calls.append(('unlock',));return 1
    monkeypatch.setattr(fileguard,'WINDOWS',True)
    monkeypatch.setattr(fileguard,'_windows_api',lambda:(lock,unlock,lambda fd:fd,lambda:0))
    with file_lock(tmp_path/'win.lock') as guard:
        guard.acquire(exclusive=True,blocking=True)
        guard.acquire()
    assert calls==[('lock',1,1,0),('unlock',),('lock',2,1,0),('unlock',),('lock',1,1,0),('unlock',)]
    assert ctypes.sizeof(fileguard._Overlapped)==(32 if ctypes.sizeof(ctypes.c_void_p)==8 else 20)


def test_windows_contention_never_silently_skips_lock(tmp_path,monkeypatch):
    monkeypatch.setattr(fileguard,'WINDOWS',True)
    monkeypatch.setattr(fileguard,'_windows_api',lambda:(lambda *args:0,lambda *args:1,lambda fd:fd,lambda:33))
    with pytest.raises(StorageError,match='IN_USE'):
        with file_lock(tmp_path/'busy.lock'):pass
