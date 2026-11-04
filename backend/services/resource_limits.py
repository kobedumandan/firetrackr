"""Keep transient graph, geometry and snapshot allocations from overlapping.

These are thread-level limits inside one API worker, not a training-process or
distributed job lock. Ordinary API reads and health checks do not use this lock.
"""
from functools import wraps
from threading import RLock


memory_work_lock = RLock()


def serialized_memory_work(function):
    @wraps(function)
    def run(*args, **kwargs):
        with memory_work_lock:
            return function(*args, **kwargs)
    return run
