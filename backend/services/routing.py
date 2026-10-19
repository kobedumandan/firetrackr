"""Route computation, rebuilds, and deviation handling.

Everything here is shared by more than one caller (the dispatch endpoints, the
location-update path, and the stale-driver watchdog), which is why it lives
outside the routers.
"""
import logging
import math
from datetime import datetime, timezone

from sqlalchemy import or_, text
from sqlalchemy.orm import Session

import routing_pool
import state
from config import (
    CONNECTOR_MERGE_TOLERANCE_M, DEVIATION_THRESHOLD_M, REJOIN_THRESHOLD_M,
    ROUTING_POOL_TIMEOUT,
)
from database import SessionLocal
from models import DispatchRecord, FireIncident, RoadObstruction, Route
from state import broadcast_threadsafe


logger = logging.getLogger(__name__)


def _load_active_obstructions(db: Session) -> list:
    # expires_at is honoured here rather than by a sweeper: an obstruction that
    # has lapsed must stop affecting routing immediately, and nothing else in
    # the system clears it. Without this an hour-long closure keeps blocking
    # roads indefinitely, and the dispatcher has no way to see why.
    now = datetime.now(timezone.utc)
    rows = (
        db.query(RoadObstruction)
        .filter(RoadObstruction.is_active == True)
        .filter(or_(RoadObstruction.expires_at.is_(None),
                    RoadObstruction.expires_at > now))
        .all()
    )
    return [
        {"type": r.type, "latitude": r.latitude, "longitude": r.longitude}
        for r in rows
    ]


def _haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi    = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _rebuild_routes(
    db: Session,
    dispatch: DispatchRecord,
    origin_lat: float,
    origin_lng: float,
    origin_source: str,
):
    """
    Recompute the main + alternative routes from `origin_*` to the dispatch's
    incident, replacing the existing route set for this fire.

    `origin_source` is stored on each new Route row ("driver_location" or
    "station").

    Returns (selected_route, saved_results) or None on failure.
      saved_results is a list of (Route, raw_dict) so callers can build payloads.
    """
    if not state.routing_engine:
        logger.warning(
            "Route rebuild skipped (dispatch=%s, origin=%s): routing_engine not loaded",
            dispatch.dispatch_id, origin_source,
        )
        return None
    incident = dispatch.fire_incident
    if not incident:
        logger.warning(
            "Route rebuild skipped (dispatch=%s, origin=%s): no fire_incident attached",
            dispatch.dispatch_id, origin_source,
        )
        return None

    src_nodes = state.routing_engine.graph.nodes_near(origin_lat, origin_lng, radius_km=2.0)
    tgt_nodes = state.routing_engine.graph.nodes_near(
        incident.fire_latitude, incident.fire_longitude, radius_km=2.0
    )
    if not src_nodes or not tgt_nodes:
        logger.warning(
            "Route rebuild skipped (dispatch=%s, origin=%s): no graph nodes within 2km "
            "(src=%.6f,%.6f found=%d; tgt=%.6f,%.6f found=%d)",
            dispatch.dispatch_id, origin_source,
            origin_lat, origin_lng, len(src_nodes or []),
            incident.fire_latitude, incident.fire_longitude, len(tgt_nodes or []),
        )
        return None

    try:
        obs = _load_active_obstructions(db)
        route_results = state.routing_engine.compute_routes_multi_alpha(
            src_nodes[0][0], tgt_nodes[0][0], obstructions=obs
        )
    except Exception as exc:
        logger.warning(
            "Route rebuild failed (dispatch=%s, origin=%s): %s",
            dispatch.dispatch_id, origin_source, exc,
        )
        return None
    if not route_results:
        logger.warning(
            "Route rebuild skipped (dispatch=%s, origin=%s): compute_routes_multi_alpha returned no routes",
            dispatch.dispatch_id, origin_source,
        )
        return None

    return _persist_rebuilt_routes(
        db, dispatch, route_results, origin_lat, origin_lng, origin_source
    )


def _persist_rebuilt_routes(
    db: Session,
    dispatch: DispatchRecord,
    route_results: list,
    origin_lat: float,
    origin_lng: float,
    origin_source: str,
):
    """Replace this dispatch's Route rows with a freshly computed set and point
    the dispatch at the new selected route. `route_results` is the raw output of
    the routing compute (in-process or from the pool). Returns (selected, saved)
    or None. All DB work; safe to call from any process's own session.
    """
    if not route_results:
        return None

    # Release the FK on this dispatch, then delete only THIS dispatch's
    # routes (other dispatches on the same fire keep their own route sets).
    from services.operational_times import snapshot_routes
    snapshot_routes(db, dispatch)
    dispatch.route_id = None
    db.commit()
    db.query(Route).filter(Route.dispatch_id == dispatch.dispatch_id).delete(
        synchronize_session=False
    )
    db.commit()

    saved = []
    for r in route_results:
        ro = Route(
            fire_id=dispatch.fire_id,
            dispatch_id=dispatch.dispatch_id,
            route_rank=r["rank"],
            route_type=r["route_type"],
            route_path_geojson=r["route_wkt"],
            route_distance_meters=r.get("route_distance_meters"),
            route_est_minutes=round(r["eta_seconds"] / 60, 2),
            route_is_selected=r["is_selected"],
            route_origin_source=origin_source,
            route_origin_lat=origin_lat,
            route_origin_lng=origin_lng,
        )
        db.add(ro)
        saved.append((ro, r))
    db.commit()
    for ro, _ in saved:
        db.refresh(ro)

    selected = next((ro for ro, r in saved if r["is_selected"]), saved[0][0])
    dispatch.route_id = selected.route_id
    snapshot_routes(db, dispatch)
    db.commit()
    return selected, saved


def _run_routing_via_pool(
    kind: str, a: float, b: float, c: float, d: float, obstructions: list
):
    """Run a CPU-bound routing computation in the process pool so it executes
    with real parallelism, off this process's GIL. Falls back to the
    main-process engine if the pool is unavailable or errors.

    `kind` is "routes" (returns route_results list) or "connector" (returns a
    connector GeoJSON dict). a,b = source lat,lng; c,d = target lat,lng.
    """
    pool = state.routing_pool_executor
    if pool is not None:
        fn = routing_pool.compute_routes if kind == "routes" else routing_pool.compute_connector
        try:
            return pool.submit(fn, a, b, c, d, obstructions).result(timeout=ROUTING_POOL_TIMEOUT)
        except Exception as exc:
            logger.warning("Pool routing (%s) failed (%s); falling back in-process.", kind, exc)

    if state.routing_engine is None:
        return None
    if kind == "connector":
        return state.routing_engine.compute_connector(a, b, c, d, obstructions=obstructions)
    src = state.routing_engine.graph.nodes_near(a, b, radius_km=2.0)
    tgt = state.routing_engine.graph.nodes_near(c, d, radius_km=2.0)
    if not src or not tgt:
        return None
    return state.routing_engine.compute_routes_multi_alpha(src[0][0], tgt[0][0], obstructions=obstructions)


def _build_rerouted_payload(dispatch: DispatchRecord, selected: Route, saved, origin_source: str) -> dict:
    return {
        "type": "dispatch_rerouted",
        "data": {
            "dispatch_id":   dispatch.dispatch_id,
            "fire_id":       dispatch.fire_id,
            "new_route_id":  selected.route_id,
            "origin_source": origin_source,
            "routes": [
                {
                    "route_id":    ro.route_id,
                    "route_wkt":   ro.route_path_geojson,
                    "rank":        r["rank"],
                    "route_type":  r["route_type"],
                    "is_selected": r["is_selected"],
                    "eta_minutes": round(r["eta_seconds"] / 60, 2),
                    "distance_meters": r.get("route_distance_meters"),
                }
                for ro, r in saved
            ],
        },
    }


def _annotate_connector_merge(
    db: Session,
    dispatch: DispatchRecord,
    connector: "dict | None",
) -> "dict | None":
    """
    Trim a connector at the point where it converges onto the dispatch's main
    route, so the map can draw it as a branch that merges into the route
    instead of a second full-length line running to the incident.

    The merge is DETECTED, never forced. The connector geometry is still the
    optimal path from the responder's own position — a non-driver may well have
    a faster approach that never touches the truck's corridor, and routing them
    back onto it would be slower. All this does is stop re-drawing the tail the
    two paths already share (they resolve to the same target node near the
    fire, so a shared tail is the common case).

    Adds two GeoJSON foreign members (RFC 7946 §6.1) to the returned dict:
      merges      — True if the path converges onto the route
      merge_point — [lon, lat] of the convergence vertex, else None

    Returns None when the responder is already sitting on the route, since a
    branch would be pure duplicate geometry.
    """
    coords = (connector or {}).get("coordinates") or []
    if len(coords) < 2:
        return connector

    route = db.get(Route, dispatch.route_id) if dispatch.route_id else None
    if not route or not route.route_path_geojson:
        return {**connector, "merges": False, "merge_point": None}

    conn_wkt = "LINESTRING(" + ", ".join(f"{lon} {lat}" for lon, lat in coords) + ")"

    # ST_DumpPoints preserves vertex order, so the lowest matching path index is
    # the first place the connector touches the route — the convergence point.
    row = db.execute(
        text("""
            SELECT (dp.path)[1] AS idx
            FROM ST_DumpPoints(ST_SetSRID(ST_GeomFromText(:conn), 4326)) AS dp
            WHERE ST_DWithin(
                dp.geom::geography,
                ST_SetSRID(ST_GeomFromText(:route), 4326)::geography,
                :tol
            )
            ORDER BY (dp.path)[1]
            LIMIT 1
        """),
        {
            "conn":  conn_wkt,
            "route": route.route_path_geojson,
            "tol":   CONNECTOR_MERGE_TOLERANCE_M,
        },
    ).fetchone()

    idx = int(row.idx) if row is not None and row.idx is not None else None

    if idx is None:
        # Never converges — an independent approach. Frontend keeps it dashed
        # the whole way to the fire.
        return {**connector, "merges": False, "merge_point": None}

    # idx is 1-based; idx == 1 means the responder's own position is already on
    # the route, leaving nothing to draw.
    if idx < 2:
        return None

    return {
        **connector,
        "coordinates": coords[:idx],
        "merges":      True,
        "merge_point": coords[idx - 1],
    }


def _recompute_deviation_routing_bg(
    dispatch_id: int, per_id: int, lat: float, lon: float, manning: bool
) -> None:
    """Runs AFTER the /api/location/update response is sent (in the threadpool,
    with its own DB session). Performs the CPU-bound routing a deviation
    triggers — a full route rebuild if this person mans the truck, otherwise a
    connector to the fire — so the GNN/graph compute never blocks the
    location-update request thread. Delivers the result to dashboards via WS.
    """
    db = SessionLocal()
    payload = None
    try:
        dispatch = db.get(DispatchRecord, dispatch_id)
        if dispatch is None or dispatch.dispatch_status not in ("dispatched", "en_route", "on_scene"):
            return
        if not dispatch.is_deviated:
            return  # rejoined the route before this task ran — nothing to do

        obs = _load_active_obstructions(db)

        if manning:
            incident = dispatch.fire_incident
            if not incident or incident.fire_latitude is None or incident.fire_longitude is None:
                return
            # CPU-bound full route rebuild — run in the process pool (parallel,
            # off this process's GIL); DB persistence stays here.
            route_results = _run_routing_via_pool(
                "routes", lat, lon, incident.fire_latitude, incident.fire_longitude, obs
            )
            rebuilt = _persist_rebuilt_routes(
                db, dispatch, route_results, lat, lon, "driver_location"
            )
            if rebuilt is None:
                return
            selected, saved = rebuilt
            dispatch.is_deviated                 = False
            dispatch.deviation_connector_geojson = None
            dispatch.deviation_detected_at       = None
            db.commit()
            payload = _build_rerouted_payload(dispatch, selected, saved, "driver_location")
        else:
            connector = None
            fire = db.get(FireIncident, dispatch.fire_id)
            if fire and fire.fire_latitude is not None and fire.fire_longitude is not None:
                # CPU-bound connector build — run in the process pool.
                connector = _run_routing_via_pool(
                    "connector", lat, lon, fire.fire_latitude, fire.fire_longitude, obs
                )
                connector = _annotate_connector_merge(db, dispatch, connector)
            dispatch.deviation_connector_geojson = connector
            db.commit()
            payload = {
                "type": "dispatch_deviation",
                "data": {
                    "dispatch_id":           dispatch.dispatch_id,
                    "per_id":                per_id,
                    "is_deviated":           True,
                    "connector_geojson":     connector,
                    "deviation_detected_at": dispatch.deviation_detected_at.isoformat()
                                             if dispatch.deviation_detected_at else None,
                },
            }
    except Exception as exc:
        logger.warning("Background deviation routing failed (dispatch=%s): %s", dispatch_id, exc)
        db.rollback()
        return
    finally:
        db.close()

    if payload is not None:
        broadcast_threadsafe(payload)


def _check_deviation(
    db: Session,
    dispatch: DispatchRecord,
    lat: float,
    lon: float,
    compute_connector: bool = True,
) -> "tuple[bool, dict | None]":
    """
    Returns (is_deviated, connector_geojson | None).
    Uses PostGIS geography distance for metre-accurate checks.
    Buffer zone (50–280 m) preserves the existing deviation state.

    When `compute_connector` is False, deviation is still detected (cheap
    PostGIS distance) but the expensive connector routing is skipped — the
    caller is expected to build it off the request thread.
    """
    if not dispatch.route_id:
        return False, None

    route = db.get(Route, dispatch.route_id)
    if not route or not route.route_path_geojson:
        return False, None

    row = db.execute(
        text("""
            SELECT ST_Distance(
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography,
                ST_SetSRID(ST_GeomFromText(:wkt),    4326)::geography
            ) AS dist_m
        """),
        {"lng": lon, "lat": lat, "wkt": route.route_path_geojson},
    ).fetchone()

    if row is None:
        return dispatch.is_deviated, None

    dist = row.dist_m

    if dist > DEVIATION_THRESHOLD_M:
        connector = None
        if compute_connector and state.routing_engine:
            fire = db.get(FireIncident, dispatch.fire_id)
            if fire and fire.fire_latitude is not None and fire.fire_longitude is not None:
                try:
                    obs = _load_active_obstructions(db)
                    connector = state.routing_engine.compute_connector(
                        lat, lon, fire.fire_latitude, fire.fire_longitude,
                        obstructions=obs,
                    )
                except Exception as exc:
                    logger.warning("Connector computation failed: %s", exc)
        return True, connector

    if dist <= REJOIN_THRESHOLD_M:
        return False, None

    # Buffer zone — keep existing state unchanged
    if dispatch.is_deviated:
        return True, dispatch.deviation_connector_geojson
    return False, None
