"""Process-wide mutable state shared by the routers and services.

Anything rebound at runtime (the routing engine, the process pool, the event
loop) lives here and MUST be read through the module — `state.routing_engine`,
never `from state import routing_engine` — so readers see the value lifespan
assigned. Objects that are only ever mutated in place (`manager`, the reporter
session dicts) are safe to import by name.
"""
import asyncio
import logging

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

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._active.add(ws)

    def disconnect(self, ws: WebSocket):
        self._active.discard(ws)

    async def broadcast(self, message: dict):
        dead: set[WebSocket] = set()
        for ws in self._active:
            try:
                await ws.send_json(message)
            except Exception:
                dead.add(ws)
        self._active -= dead


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
