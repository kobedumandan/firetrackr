"""Keep transient graph, geometry and snapshot allocations from overlapping.

These are thread-level limits inside one API worker, not a training-process or
distributed job lock. Ordinary API reads and health checks do not use this lock.
"""
from functools import wraps
from pathlib import Path
from threading import RLock


memory_work_lock = RLock()


def container_memory():
    """Return (working set, limit), excluding reclaimable inactive file cache."""
    for used_path, limit_path, cache_key in (
        ('/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory.max', 'inactive_file'),
        ('/sys/fs/cgroup/memory/memory.usage_in_bytes', '/sys/fs/cgroup/memory/memory.limit_in_bytes', 'total_inactive_file'),
    ):
        try:
            used = int(Path(used_path).read_text().strip())
            limit = int(Path(limit_path).read_text().strip())
        except (OSError, ValueError):
            continue
        if 0 <= used and 0 < limit < 2**60:
            try:
                stats = dict(line.split() for line in Path(limit_path).with_name('memory.stat').read_text().splitlines())
                inactive = int(stats.get(cache_key, '0'))
                if 0 <= inactive <= used:
                    used -= inactive
            except (OSError, ValueError):
                pass  # Missing/malformed counters retain the conservative total.
            return used, limit
    return None


def release_unused_memory():
    """Return unreachable Python objects and unused glibc heap pages to Linux."""
    import gc
    import sys

    gc.collect()
    if sys.platform.startswith('linux'):
        import ctypes

        try:
            trim = ctypes.CDLL(None).malloc_trim
            trim.argtypes = [ctypes.c_size_t]
            trim.restype = ctypes.c_int
            trim(0)
        except (AttributeError, OSError):
            pass  # Other Linux allocators need no glibc-specific handling.


def serialized_memory_work(function):
    @wraps(function)
    def run(*args, **kwargs):
        with memory_work_lock:
            return function(*args, **kwargs)
    return run
