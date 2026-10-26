"""Shared current-position routing for dispatchers and assigned truck drivers."""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

import routing_pool
import state
from config import ROUTING_POOL_TIMEOUT
from models import CurrentLocation, DispatchRecord, DispatchTruck, FireIncident, LocationLog, ResponseTeamMember, Route
from services.dispatch import _normalize_role
from services.routing import _build_rerouted_payload, _load_active_obstructions
from services.operational_times import snapshot_routes

logger = logging.getLogger(__name__)
ACTIVE = ('dispatched', 'en_route', 'on_scene')


def live_driver_origin(db, dispatch):
    now = datetime.now(timezone.utc)
    candidates = [unit.manned_by_per_id for unit in dispatch.dispatch_trucks if unit.manned_by_per_id]
    members = db.query(ResponseTeamMember).filter_by(team_id=dispatch.team_id).all()
    if not candidates:
        candidates = [member.per_id for member in members if _normalize_role(member.member_role) == 'driver']
    for per_id in dict.fromkeys(candidates):
        location = db.get(CurrentLocation, per_id)
        if location is None:
            continue
        at = location.recorded_at
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        if now - timedelta(minutes=2) <= at <= now + timedelta(seconds=30) and (not dispatch.dispatch_at or at >= dispatch.dispatch_at):
            previous = db.query(LocationLog).filter(LocationLog.per_id == per_id, LocationLog.recorded_at < at,
                LocationLog.recorded_at >= at-timedelta(seconds=60)).order_by(LocationLog.recorded_at.desc()).first()
            return float(location.latitude), float(location.longitude), 'driver_location', (
                (previous.log_latitude, previous.log_longitude) if previous else None)
    return None


def current_origin(db, dispatch, require_driver=False):
    origin = live_driver_origin(db, dispatch)
    if origin is not None:
        return origin
    if require_driver:
        raise HTTPException(422, 'A fresh driver location is required to refresh live navigation.')
    station = dispatch.team.station if dispatch.team else None
    if not station or station.station_latitude is None or station.station_longitude is None:
        raise HTTPException(422, 'No current driver position or station coordinates are available.')
    return station.station_latitude, station.station_longitude, 'station', None


def recalculate(db, dispatch, preferred_type=None, reason='full_reroute', preferred_ordinal=0,
                require_driver=False, allow_preference_fallback=False):
    """Compute before changing rows; replace this dispatch's routes atomically."""
    if dispatch.dispatch_status not in ACTIVE or not dispatch.fire_incident or dispatch.fire_incident.fire_status in ('closed', 'cancelled', 'canceled', 'recalled'):
        raise HTTPException(409, 'Dispatch is no longer active.')
    if state.routing_engine is None:
        raise HTTPException(503, 'Routing engine not available.')
    lat, lon, source, previous = current_origin(db, dispatch, require_driver=require_driver)
    incident = dispatch.fire_incident
    obstructions = _load_active_obstructions(db)
    args = (lat, lon, incident.fire_latitude, incident.fire_longitude, obstructions, previous)
    try:
        routes = None
        if source == 'station':
            from services.routing import _run_routing_via_pool
            routes = _run_routing_via_pool('routes', lat, lon, incident.fire_latitude, incident.fire_longitude, obstructions)
        elif state.routing_pool_executor is not None:
            try:
                routes = state.routing_pool_executor.submit(routing_pool.compute_position_routes, *args).result(timeout=ROUTING_POOL_TIMEOUT)
            except Exception:
                logger.warning('Position routing worker failed; retrying in process.', exc_info=True)
        if routes is None and source != 'station':
            routes = state.routing_engine.compute_routes_from_position(*args)
    except Exception:
        logger.exception('Position routing failed for dispatch %s', dispatch.dispatch_id)
        raise HTTPException(503, 'Route calculation failed. The previous route has been preserved.')
    if not routes:
        raise HTTPException(422, 'No connected road route is available from the current position with the active obstructions. The previous route has been preserved.')
    matching = [route for route in routes if route['route_type'] == preferred_type] if preferred_type else routes
    ordinal = preferred_ordinal if preferred_type == 'alternative' else 0
    chosen = matching[ordinal] if len(matching) > ordinal else None
    if chosen is None and allow_preference_fallback:
        chosen = routes[0]
    if chosen is None:
        raise HTTPException(409, f'The {preferred_type} option is no longer distinct or reachable from the current position. Use Force Reroute to review the remaining options.')
    snapshot_routes(db, dispatch)
    dispatch.route_id = None
    db.flush()
    db.query(Route).filter_by(dispatch_id=dispatch.dispatch_id).delete(synchronize_session=False)
    saved = []
    for result in routes:
        result = {**result, 'is_selected': result is chosen}
        row = Route(fire_id=dispatch.fire_id, dispatch_id=dispatch.dispatch_id, route_rank=result['rank'],
                    route_type=result['route_type'], route_path_geojson=result['route_wkt'],
                    route_distance_meters=float(result['route_distance_meters']) if result.get('route_distance_meters') is not None else None,
                    route_est_minutes=round(float(result['eta_seconds'])/60, 2),
                    route_is_selected=result['is_selected'], route_origin_source=source, route_origin_lat=lat, route_origin_lng=lon)
        db.add(row)
        saved.append((row, result))
    db.flush()
    selected = next(row for row, result in saved if result['is_selected'])
    dispatch.route_id = selected.route_id
    dispatch.is_deviated = False
    dispatch.deviation_connector_geojson = None
    dispatch.deviation_detected_at = None
    snapshot_routes(db, dispatch, reason=reason)
    payload = _build_rerouted_payload(dispatch, selected, saved, source)['data']
    payload.update(origin_latitude=lat, origin_longitude=lon)
    db.commit()
    return {**payload, 'route_id': selected.route_id, 'rank': selected.route_rank,
            'route_type': selected.route_type, 'is_selected': True,
            'route_wkt': selected.route_path_geojson, 'eta_minutes': selected.route_est_minutes}


def refresh_returning_driver(dispatch_id, per_id, expected_route_id):
    """Re-anchor an offline/station plan on the first accepted driver GPS fix."""
    from database import SessionLocal
    from state import broadcast_threadsafe
    payload = None
    with SessionLocal() as db:
        try:
            dispatch = db.get(DispatchRecord, dispatch_id)
            if not dispatch:
                return
            db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).with_for_update().one()
            db.refresh(dispatch, with_for_update=True)
            if dispatch.route_id != expected_route_id or dispatch.dispatch_status not in ACTIVE:
                return
            if not db.query(DispatchTruck).filter_by(dispatch_id=dispatch_id, manned_by_per_id=per_id).first():
                return
            selected = db.get(Route, dispatch.route_id)
            ordinal = db.query(Route).filter(Route.dispatch_id == dispatch_id, Route.route_type == selected.route_type,
                                             Route.route_rank < selected.route_rank).count() if selected else 0
            data = recalculate(db, dispatch, preferred_type=selected.route_type if selected else None,
                               preferred_ordinal=ordinal, require_driver=True, allow_preference_fallback=True,
                               reason='driver_online_refresh')
            payload = {'type': 'dispatch_rerouted', 'data': data}
        except Exception as error:
            db.rollback()
            logger.warning('Driver-online route refresh failed for dispatch %s: %s', dispatch_id, error)
    if payload is not None:
        broadcast_threadsafe(payload)
