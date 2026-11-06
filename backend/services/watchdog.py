"""Stale-driver watchdog and its single-worker advisory lock.

When a route is planned from a driver's live position and that phone goes dark,
the route is rebuilt from the station instead. Exactly one worker process runs
the loop, guarded by a Postgres advisory lock.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from config import (
    STALE_MINUTES, STATION_FALLBACK_GRACE_MINUTES, WATCHDOG_INTERVAL_SECONDS,
    _WATCHDOG_LOCK_KEY,
)
from database import SessionLocal, engine
from models import CurrentLocation, DispatchRecord, Route
from services.routing import _build_rerouted_payload, _rebuild_routes
from state import manager


logger = logging.getLogger(__name__)
_watchdog_lock_conn = None


def _acquire_watchdog_lock() -> bool:
    """Try to claim the singleton watchdog role for this worker process."""
    global _watchdog_lock_conn
    try:
        conn = engine.raw_connection()
        cur = conn.cursor()
        cur.execute("SELECT pg_try_advisory_lock(%s)", (_WATCHDOG_LOCK_KEY,))
        got = bool(cur.fetchone()[0])
        cur.close()
        if got:
            _watchdog_lock_conn = conn  # keep open to hold the session-level lock
            return True
        conn.close()
        return False
    except Exception as exc:
        logger.warning("Watchdog lock acquire failed (%s); running watchdog anyway.", exc)
        return True  # single-worker fallback: don't lose the watchdog on lock error


def _release_watchdog_lock() -> None:
    global _watchdog_lock_conn
    if _watchdog_lock_conn is not None:
        try:
            _watchdog_lock_conn.close()  # closing the session releases the lock
        except Exception:
            pass
        _watchdog_lock_conn = None


def _scan_stale_driver_routes():
    """Run one scan with its session owned and closed by the worker thread."""
    threshold = timedelta(minutes=STALE_MINUTES + STATION_FALLBACK_GRACE_MINUTES)
    active = ("dispatched", "en_route", "on_scene")
    now_ts = datetime.now(timezone.utc)
    broadcasts: list[dict] = []
    db = SessionLocal()
    try:
        dispatches = (
            db.query(DispatchRecord)
            .filter(DispatchRecord.dispatch_status.in_(active))
            .all()
        )
        for dispatch in dispatches:
            if not dispatch.route_id:
                continue
            route = db.get(Route, dispatch.route_id)
            if not route or route.route_origin_source != "driver_location":
                continue

            team = dispatch.team
            station = team.station if team else None
            if not (station and station.station_latitude and station.station_longitude):
                continue

            driver_member = next(
                (
                    m for m in (team.members if team else [])
                    if (m.member_role or "").lower() == "driver"
                ),
                None,
            )

            is_stale = True
            if driver_member:
                loc = db.get(CurrentLocation, driver_member.per_id)
                if loc and loc.recorded_at is not None:
                    rec_at = loc.recorded_at
                    if rec_at.tzinfo is None:
                        rec_at = rec_at.replace(tzinfo=timezone.utc)
                    if (now_ts - rec_at) <= threshold:
                        is_stale = False

            if not is_stale:
                continue

            rebuilt = _rebuild_routes(
                db, dispatch,
                station.station_latitude, station.station_longitude,
                "station",
            )
            if rebuilt is not None:
                selected, saved = rebuilt
                dispatch.is_deviated = False
                dispatch.deviation_connector_geojson = None
                dispatch.deviation_detected_at = None
                db.commit()
                broadcasts.append(_build_rerouted_payload(dispatch, selected, saved, "station"))
    finally:
        db.close()
    return broadcasts


async def _stale_driver_watchdog():
    """Refresh stale-driver routes without blocking HTTP and WebSocket handling."""
    while True:
        try:
            await asyncio.sleep(WATCHDOG_INTERVAL_SECONDS)
            scan = asyncio.create_task(asyncio.to_thread(_scan_stale_driver_routes))
            try:
                broadcasts = await asyncio.shield(scan)
            except asyncio.CancelledError:
                # Finish the in-progress scan before lifespan shuts down routing.
                try:
                    await scan
                except Exception:
                    logger.exception("Stale-driver scan failed during shutdown")
                raise
            for payload in broadcasts:
                await manager.broadcast(payload)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Stale-driver watchdog iteration failed: %s", exc)
