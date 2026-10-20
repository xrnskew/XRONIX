"""Native file locks on POSIX and Windows; no optional/no-op locking."""
import ctypes
import errno
import os
import stat

WINDOWS = os.name == 'nt'
if not WINDOWS:
    import fcntl


class _Overlapped(ctypes.Structure):
    _fields_ = [('Internal', ctypes.c_size_t), ('InternalHigh', ctypes.c_size_t),
                ('Offset', ctypes.c_uint32), ('OffsetHigh', ctypes.c_uint32),
                ('hEvent', ctypes.c_void_p)]


def _windows_api():
    import msvcrt
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    lock = kernel.LockFileEx
    lock.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32,
                     ctypes.c_uint32, ctypes.c_uint32, ctypes.POINTER(_Overlapped)]
    lock.restype = ctypes.c_int
    unlock = kernel.UnlockFileEx
    unlock.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32,
                       ctypes.c_uint32, ctypes.POINTER(_Overlapped)]
    unlock.restype = ctypes.c_int
    return lock, unlock, msvcrt.get_osfhandle, ctypes.get_last_error


class FileGuard:
    def __init__(self, stream):
        self.stream = stream
        self.locked = False
        self.overlapped = _Overlapped()

    def acquire(self, exclusive=False, blocking=False):
        if WINDOWS:
            # Windows cannot atomically upgrade a byte-range lock. Release first;
            # a failed reacquisition aborts startup rather than bypassing protection.
            self.release()
            self.overlapped = _Overlapped()
            lock, _, handle, error = _windows_api()
            flags = (2 if exclusive else 0) | (0 if blocking else 1)
            if not lock(handle(self.stream.fileno()), flags, 0, 1, 0, ctypes.byref(self.overlapped)):
                code = error()
                if code == 33:  # ERROR_LOCK_VIOLATION
                    raise BlockingIOError(errno.EAGAIN, 'File lock unavailable')
                raise OSError(code, 'Windows file lock failed')
        else:
            fcntl.flock(self.stream, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) |
                        (0 if blocking else fcntl.LOCK_NB))
        self.locked = True

    def release(self):
        if not self.locked:
            return
        if WINDOWS:
            _, unlock, handle, error = _windows_api()
            if not unlock(handle(self.stream.fileno()), 0, 1, 0, ctypes.byref(self.overlapped)):
                raise OSError(error(), 'Windows file unlock failed')
        else:
            fcntl.flock(self.stream, fcntl.LOCK_UN)
        self.locked = False


def open_private(path):
    """Keep O_NOFOLLOW on POSIX; validate final reparse/link targets on Windows."""
    if path.is_symlink():
        raise OSError(errno.ELOOP, 'Symbolic link rejected')
    descriptor = os.open(path, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0) |
                         getattr(os, 'O_BINARY', 0), 0o600)
    try:
        info, entry = os.fstat(descriptor), os.lstat(path)
        if (not stat.S_ISREG(info.st_mode) or not os.path.samestat(info, entry)
                or getattr(entry, 'st_file_attributes', 0) & 0x400):  # FILE_ATTRIBUTE_REPARSE_POINT
            raise OSError(errno.ELOOP, 'Non-regular file or reparse point rejected')
        return descriptor
    except Exception:
        os.close(descriptor)
        raise


def private_mode(stream, path):
    if WINDOWS:
        # Windows permissions use inherited NTFS ACLs, not POSIX mode bits.
        os.chmod(path, 0o600)
    else:
        os.fchmod(stream.fileno(), 0o600)
