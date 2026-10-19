"""BFP Capstone — GeoAI Fire Response API.

This module owns only the application object: startup/shutdown (the routing
engine, the routing process pool, the stale-driver watchdog, the token-blacklist
reaper), middleware, and the router mounts. Every endpoint lives in `routers/`,
the logic they share in `services/`, and process-wide mutable state in
`state.py`.
"""
import asyncio
import logging
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import routing_pool
import state
from config import ROUTING_POOL_SIZE, UPLOAD_ROOT
from config import BLACKLIST_REAPER_INTERVAL_SECONDS, WATCHDOG_INTERVAL_SECONDS
from routers import (
    auth, constraints, coverage, dispatch, geodata, incidents, metrics, mobile,
    obstructions, personnel, reporting, routing, shifts, stations, system, teams,
    trucks, operational_times,
)
from routing_setup import build_routing_engine
from services.token_cleanup import (
    _acquire_reaper_lock, _release_reaper_lock, _token_blacklist_reaper,
)
from services.watchdog import (
    _acquire_watchdog_lock, _release_watchdog_lock, _stale_driver_watchdog,
)

logger = logging.getLogger(__name__)


# ── Application lifespan ──────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.main_event_loop = asyncio.get_running_loop()

    # Main-process engine: serves the /api/routing/* endpoints and the
    # stale-driver watchdog. The per-request deviation routing goes through the
    # process pool below instead.
    state.routing_engine = build_routing_engine(register_gym=True)
    if state.routing_engine is not None:
        logger.info("GeoAI routing engine ready. Graph: %s", state.routing_engine.graph.summary())
    else:
        logger.warning("Routing engine failed to start (non-fatal); routing endpoints unavailable.")

    # Process pool for CPU-bound route computation (see _run_routing_via_pool).
    if ROUTING_POOL_SIZE > 0:
        try:
            state.routing_pool_executor = ProcessPoolExecutor(
                max_workers=ROUTING_POOL_SIZE, initializer=routing_pool.init_worker
            )
            # Warm the pool so all workers load their graph now, not on the
            # first deviation request (avoids cold-start latency spikes).
            warm_futs = [
                state.routing_pool_executor.submit(routing_pool.warmup, 0.3)
                for _ in range(ROUTING_POOL_SIZE * 2)
            ]
            ready = sum(1 for f in warm_futs if f.result(timeout=180))
            logger.info(
                "Routing process pool started and warmed (workers=%s, ready=%s).",
                ROUTING_POOL_SIZE, ready,
            )
        except Exception as exc:
            logger.warning("Routing pool failed to start (%s); using in-process fallback.", exc)
            state.routing_pool_executor = None

    watchdog_task = None
    if _acquire_watchdog_lock():
        watchdog_task = asyncio.create_task(_stale_driver_watchdog())
        logger.info("Stale-driver watchdog started (interval=%ss).", WATCHDOG_INTERVAL_SECONDS)
    else:
        logger.info("Stale-driver watchdog held by another worker — not started here.")

    reaper_task = None
    if _acquire_reaper_lock():
        reaper_task = asyncio.create_task(_token_blacklist_reaper())
        logger.info(
            "Token-blacklist reaper started (interval=%ss).",
            BLACKLIST_REAPER_INTERVAL_SECONDS,
        )
    else:
        logger.info("Token-blacklist reaper held by another worker — not started here.")

    yield  # server runs here

    for task in (watchdog_task, reaper_task):
        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    _release_watchdog_lock()
    _release_reaper_lock()

    if state.routing_pool_executor is not None:
        state.routing_pool_executor.shutdown(wait=False, cancel_futures=True)
        logger.info("Routing process pool shut down.")

    if state.routing_engine:
        state.routing_engine.shutdown()
    logger.info("Routing engine shut down.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="BFP Capstone — GeoAI Fire Response API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve uploaded report photos as static files (read-only).
app.mount("/uploads", StaticFiles(directory=UPLOAD_ROOT), name="uploads")


# ── Routers ───────────────────────────────────────────────────────────────────
# Mounted in the order the endpoints were originally declared, so path matching
# is unchanged. Each router keeps its full "/api/..." paths, so no prefixes here.

app.include_router(system.router)
app.include_router(routing.router)
app.include_router(auth.router)
app.include_router(coverage.router)
app.include_router(personnel.router)
app.include_router(stations.router)
app.include_router(shifts.router)
app.include_router(teams.router)
app.include_router(geodata.router)
app.include_router(obstructions.router)
app.include_router(constraints.router)
app.include_router(reporting.router)
app.include_router(incidents.router)
app.include_router(metrics.router)
app.include_router(operational_times.router)
app.include_router(dispatch.router)
app.include_router(mobile.router)
app.include_router(trucks.router)
