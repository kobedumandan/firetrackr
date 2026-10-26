"""Process-wide mutable state shared by the routers and services.

Anything rebound at runtime (the routing engine, the process pool, the event
loop) lives here and MUST be read through the module — `state.routing_engine`,
never `from state import routing_engine` — so readers see the value lifespan
assigned. Objects that are only ever mutated in place (`manager`, the reporter
session dicts) are safe to import by name.
"""
import asyncio
from collections import deque
from copy import deepcopy
import logging
from uuid import uuid4

from fastapi import WebSocket


logger = logging.getLogger(__name__)


# Populated by main.lifespan on startup.
routing_engine = None                  # GeoAIRoutingEngine | None
routing_pool_executor = None           # ProcessPoolExecutor | None
active_model_source = None             # Loaded immutable source; None = configured baseline.
routing_generation = 0                 # Prevent in-flight readers caching an older model after a swap.


# Cached derived data, invalidated by the endpoints that change their inputs.
gnn_constraints_cache: "tuple | None" = None  # (generation, response)
constraint_style_cache: "tuple | None" = None  # (generation, source, style)
coverage_cache: "dict | None" = None


class ConnectionManager:
    def __init__(self):
        self._active: set[WebSocket] = set()
        self._broadcast_lock = asyncio.Lock()
        self._notification_stream = uuid4().hex
        self._notification_sequence = 0
        self._notification_events = deque(maxlen=1000)

    @property
    def notification_cursor(self):
        return f'{self._notification_stream}:{self._notification_sequence}'

    async def connect(self, ws: WebSocket, *, notifications=False, cursor=None):
        await ws.accept()
        # Subscribe only after replay. The same lock serializes live delivery,
        # closing the gap between a history snapshot and the next broadcast.
        async with self._broadcast_lock:
            if notifications:
                previous = -1
                if cursor:
                    stream, _, sequence = cursor.partition(':')
                    if stream == self._notification_stream and sequence.isascii() and sequence.isdigit():
                        previous = int(sequence)
                earliest = self._notification_events[0][0] if self._notification_events else self._notification_sequence + 1
                reset = bool(cursor) and not earliest - 1 <= previous <= self._notification_sequence
                if cursor:
                    for sequence, event in self._notification_events:
                        if reset or sequence > previous:
                            await ws.send_json({**event, 'replayed': True})
                await ws.send_json({'type': 'notification_stream', 'data': {
                    'cursor': self.notification_cursor, 'reset': reset,
                }})
            self._active.add(ws)

    def disconnect(self, ws: WebSocket):
        self._active.discard(ws)

    async def broadcast(self, message: dict):
        async with self._broadcast_lock:
            if message.get('type') in NOTIFICATION_EVENTS:
                self._notification_sequence += 1
                message = {**deepcopy(message), 'notification_cursor': self.notification_cursor}
                self._notification_events.append((self._notification_sequence, message))
            dead: set[WebSocket] = set()
            for ws in tuple(self._active):
                try:
                    await ws.send_json(message)
                except Exception:
                    dead.add(ws)
            self._active -= dead


NOTIFICATION_EVENTS = frozenset({
    'incident_created', 'incident_updated', 'incident_deleted',
    'personnel_arrived', 'dispatch_arrived', 'dispatch_completed',
    'report_submitted', 'auto_dispatch_failed', 'model_candidate_ready',
    'model_training_failed', 'model_training_cancelled', 'model_promoted',
})

manager = ConnectionManager()


# token → {"lat", "lng", "accuracy", "received_at"} or None
report_sessions: dict[str, dict | None] = {}


# token → reporter phone number (set when an SMS link is generated/sent)
report_session_phones: dict[str, str] = {}


# The event loop of the worker that owns `manager`, captured in lifespan. Sync
# background tasks (which run in the threadpool) use it to schedule WS broadcasts
# back onto the loop.
main_event_loop: "asyncio.AbstractEventLoop | None" = None


def broadcast_threadsafe(payload: dict) -> None:
    """Schedule an async manager.broadcast() from a synchronous worker thread."""
    loop = main_event_loop
    if loop is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(manager.broadcast(payload), loop)
    except Exception as exc:
        logger.warning("Thread-safe broadcast failed: %s", exc)
