"""Keep transient graph, geometry and snapshot allocations from overlapping.

These are thread-level limits inside one API worker, not a training-process or
distributed job lock. Ordinary API reads and health checks do not use this lock.
"""
from functools import wraps
from pathlib import Path
from threading import RLock


memory_work_lock = RLock()


def container_memory():
    """Return (used, limit) bytes for a finite Linux cgroup budget, if exposed."""
    for used_path, limit_path in (
        ('/sys/fs/cgroup/memory.current', '/sys/fs/cgroup/memory.max'),
        ('/sys/fs/cgroup/memory/memory.usage_in_bytes', '/sys/fs/cgroup/memory/memory.limit_in_bytes'),
    ):
        try:
            used = int(Path(used_path).read_text().strip())
            limit = int(Path(limit_path).read_text().strip())
        except (OSError, ValueError):
            continue
        if 0 <= used and 0 < limit < 2**60:
            return used, limit
    return None


def serialized_memory_work(function):
    @wraps(function)
    def run(*args, **kwargs):
        with memory_work_lock:
            return function(*args, **kwargs)
    return run
