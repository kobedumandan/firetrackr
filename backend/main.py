"""BFP Capstone — GeoAI Fire Response API.

This module owns only the application object: startup/shutdown (the routing
engine, the routing process pool, the stale-driver watchdog, the token-blacklist
reaper), middleware, and the router mounts. Every endpoint lives in `routers/`,
the logic they share in `services/`, and process-wide mutable state in
`state.py`.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import state
from config import UPLOAD_ROOT
from config import BLACKLIST_REAPER_INTERVAL_SECONDS, WATCHDOG_INTERVAL_SECONDS
from routers import (
    auth, constraints, coverage, dispatch, geodata, incidents, metrics, mobile,
    obstructions, personnel, reporting, routing, shifts, stations, system, teams,
    trucks, models, operational_times,
)
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

    from services.routing_reload import reload_routing, poll_routing_changes

    try:
        await reload_routing(force=True, register_gym=True)
    except Exception:
        logger.exception("Routing initialization failed; endpoints remain unavailable until synchronization succeeds")
    routing_sync_task = asyncio.create_task(poll_routing_changes())
    from services.model_registry import poll_model_jobs
    model_jobs_task = asyncio.create_task(poll_model_jobs())

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

    for task in (watchdog_task, reaper_task, routing_sync_task, model_jobs_task):
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
app.include_router(models.router)
app.include_router(reporting.router)
app.include_router(incidents.router)
app.include_router(metrics.router)
app.include_router(operational_times.router)
app.include_router(dispatch.router)
app.include_router(mobile.router)
app.include_router(trucks.router)
