"""Complete optional routes after publishing navigation, keeping its revision."""
import asyncio
import logging

import state
from database import SessionLocal
from models import DispatchRecord, FireIncident, Route
from services.location_routing import LocationRoutingQueue
from services.operational_times import snapshot_routes
from services.routing import _build_rerouted_payload, _load_active_obstructions, _run_routing_via_pool


logger = logging.getLogger(__name__)
route_alternatives = LocationRoutingQueue()
ACTIVE = ('dispatched', 'en_route', 'on_scene')
CLOSED = ('closed', 'cancelled', 'canceled', 'recalled')


async def schedule_route_alternatives(data):
    if data.get('alternatives_pending'):
        # One waiting enrichment per dispatch. A newer revision replaces it.
        await route_alternatives.enqueue(_complete, data['dispatch_id'], 0, data['new_route_id'])


def queue_route_alternatives(data):
    """Schedule from a routing thread after its primary broadcast is submitted."""
    loop = state.main_event_loop
    if loop is not None and not loop.is_closed() and data.get('alternatives_pending'):
        asyncio.run_coroutine_threadsafe(schedule_route_alternatives(data), loop)


def _obstruction_signature(obstructions):
    return sorted((item['type'], item['latitude'], item['longitude']) for item in obstructions)


def _complete(dispatch_id, _queue_key, expected_route_id):
    payload = None
    with SessionLocal() as db:
        try:
            dispatch = db.get(DispatchRecord, dispatch_id)
            if (dispatch is None or dispatch.route_id != expected_route_id
                    or dispatch.dispatch_status not in ACTIVE or dispatch.cleared_at):
                return
            incident = dispatch.fire_incident
            selected = db.get(Route, expected_route_id)
            if (incident is None or incident.fire_status in CLOSED or selected is None
                    or selected.route_type != 'recommended' or selected.route_rank != 1):
                return
            generation = state.routing_generation
            fire_id = dispatch.fire_id
            destination = incident.fire_latitude, incident.fire_longitude
            origin = float(selected.route_origin_lat), float(selected.route_origin_lng)
            source = selected.route_origin_source
            primary_wkt = selected.route_path_geojson
            drivers = tuple(sorted(unit.manned_by_per_id for unit in dispatch.dispatch_trucks if unit.manned_by_per_id))
            obstructions = _load_active_obstructions(db)
            db.rollback()  # Optional graph work owns no database connection.
            kind = 'position_routes' if source == 'driver_location' else 'routes'
            results = _run_routing_via_pool(kind, *origin, *destination, obstructions)
            # A model/time-bucket change may produce a different primary path.
            # Never move the navigation already delivered to the crew.
            if not results or results[0]['route_wkt'] != primary_wkt or len(results) < 2:
                return
            incident = db.query(FireIncident).filter_by(fire_id=fire_id).with_for_update().one()
            db.refresh(dispatch, with_for_update=True)
            db.expire(dispatch, ['dispatch_trucks'])
            if (dispatch.route_id != expected_route_id or dispatch.dispatch_status not in ACTIVE
                    or dispatch.cleared_at or incident.fire_status in CLOSED
                    or (incident.fire_latitude, incident.fire_longitude) != destination
                    or state.routing_generation != generation):
                return
            current_drivers = tuple(sorted(unit.manned_by_per_id for unit in dispatch.dispatch_trucks if unit.manned_by_per_id))
            if source == 'driver_location' and current_drivers != drivers:
                return
            if _obstruction_signature(_load_active_obstructions(db)) != _obstruction_signature(obstructions):
                return
            rows = db.query(Route).filter_by(dispatch_id=dispatch_id).order_by(Route.route_rank).all()
            if len(rows) != 1 or rows[0].route_id != expected_route_id:
                return  # Already enriched, or a newer route set was saved.
            selected = rows[0]
            saved = [(selected, {**results[0], 'is_selected': True})]
            for result in results[1:]:
                row = Route(fire_id=fire_id, dispatch_id=dispatch_id, route_rank=result['rank'],
                            route_type=result['route_type'], route_path_geojson=result['route_wkt'],
                            route_distance_meters=result.get('route_distance_meters'),
                            route_est_minutes=round(float(result['eta_seconds']) / 60, 2),
                            route_is_selected=False, route_origin_source=source,
                            route_origin_lat=origin[0], route_origin_lng=origin[1])
                db.add(row)
                saved.append((row, {**result, 'is_selected': False}))
            db.flush()
            snapshot_routes(db, dispatch, reason='route_options_ready')
            payload = _build_rerouted_payload(dispatch, selected, saved, source)
            payload['data'].update(alternatives_pending=False, options_only=True)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception('Optional routes failed for dispatch %s; primary navigation retained.', dispatch_id)
            payload = None
    if payload is not None:
        state.broadcast_threadsafe(payload)
