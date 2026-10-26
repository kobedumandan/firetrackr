"""Personnel approaches share storage, but never replace the truck's selected routes.

The existing connector JSON retains a GeoJSON LineString for older readers. Its
personnel_routes foreign member attributes each branch to its responder and route
revision, preventing one person's GPS from clearing another person's deviation.
"""
from copy import deepcopy
from datetime import datetime, timezone


def navigation_for(dispatch, per_id):
    if not dispatch or dispatch.dispatch_status not in ('dispatched', 'en_route', 'on_scene'):
        return {}
    entry = (dispatch.deviation_connector_geojson or {}).get('personnel_routes', {}).get(str(per_id), {})
    return entry if entry.get('route_id') == dispatch.route_id else {}


def save_navigation(db, dispatch, per_id, *, expected_route_id, is_deviated,
                    connector=None, route_wkt=None, detected_at=None):
    """Merge under the dispatch lock; reject a result for a superseded plan."""
    db.refresh(dispatch, with_for_update=True)
    if dispatch.route_id != expected_route_id or dispatch.dispatch_status not in ('dispatched', 'en_route', 'on_scene'):
        return False
    routes = deepcopy((dispatch.deviation_connector_geojson or {}).get('personnel_routes', {}))
    routes = {key: value for key, value in routes.items() if value.get('route_id') == dispatch.route_id}
    previous = routes.get(str(per_id), {})
    at = detected_at or previous.get('deviation_detected_at') or datetime.now(timezone.utc).isoformat()
    routes[str(per_id)] = {
        'route_id': dispatch.route_id, 'is_deviated': bool(is_deviated),
        'deviation_detected_at': at if is_deviated else None,
        'connector_geojson': connector if is_deviated else None,
        'route_wkt': route_wkt,
    }
    latest = connector or {'type': 'LineString', 'coordinates': []}
    dispatch.deviation_connector_geojson = {**latest, 'personnel_routes': routes}
    dispatch.is_deviated = any(entry.get('is_deviated') for entry in routes.values())
    dispatch.deviation_detected_at = datetime.fromisoformat(at) if dispatch.is_deviated else None
    db.commit()
    return True


def build_personnel_navigation(db, dispatch, per_id, lat, lon, *, is_deviated, expected_route_id):
    """Return the full road path for movement and its trimmed branch for display."""
    from fastapi import HTTPException
    from models import CurrentLocation
    from services.routing import _annotate_connector_merge, _haversine_meters, _load_active_obstructions, _run_routing_via_pool

    incident = dispatch.fire_incident
    if not incident or incident.fire_status in ('closed', 'cancelled', 'canceled', 'recalled'):
        raise HTTPException(409, 'Incident is no longer active.')
    try:
        full = _run_routing_via_pool('connector', lat, lon, incident.fire_latitude, incident.fire_longitude,
                                   _load_active_obstructions(db))
    except ValueError:
        raise HTTPException(422, 'No connected personnel route is available. Your position has been preserved.')
    coordinates = (full or {}).get('coordinates', [])
    if len(coordinates) < 2:
        raise HTTPException(422, 'No connected personnel route is available. Your position has been preserved.')
    route_wkt = 'LINESTRING(' + ', '.join(f'{lon} {lat}' for lon, lat in coordinates) + ')'
    # Lock only for persistence, after graph work; a newer dispatcher revision wins.
    db.refresh(dispatch, with_for_update=True)
    if dispatch.route_id != expected_route_id:
        raise HTTPException(409, 'The selected route changed. Refresh personnel navigation again.')
    current = db.get(CurrentLocation, per_id, populate_existing=True)
    if current is None or _haversine_meters(lat, lon, float(current.latitude), float(current.longitude)) > 2:
        raise HTTPException(409, 'A newer location superseded this personnel route. Refresh navigation again.')
    connector = _annotate_connector_merge(db, dispatch, full)
    if not save_navigation(db, dispatch, per_id, expected_route_id=expected_route_id,
                           is_deviated=is_deviated, connector=connector, route_wkt=route_wkt):
        raise HTTPException(409, 'The dispatch changed while personnel navigation was calculated.')
    entry = navigation_for(dispatch, per_id)
    return {'dispatch_id': dispatch.dispatch_id, 'per_id': per_id, 'route_wkt': route_wkt,
            'is_deviated': bool(is_deviated), 'connector_geojson': entry.get('connector_geojson'),
            'deviation_detected_at': entry.get('deviation_detected_at')}
