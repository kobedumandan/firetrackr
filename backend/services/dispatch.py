"""Dispatch lifecycle: creating a dispatch, closing one out, and the
location/role helpers the mobile endpoints share."""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

import state
from config import RACE_WINDOW_SECONDS, STALE_MINUTES, _SOURCE_PRIORITY
from models import (
    CurrentLocation, DispatchRecord, DispatchTruck, FireIncident, HeatmapData,
    ResponseTeam, ResponseTeamMember, Route, Station, Truck,
)
from serializers import _incident_dict
from services.incident_events import record_changes, snapshot
from services.heatmap import severity_weight
from services.incident_scope import is_fire_incident
from services.push import notify_dispatch_assigned
from services.resource_availability import lock_personnel_assignments, team_unavailability
from services.routing import _haversine_meters, _load_active_obstructions
from state import manager


logger = logging.getLogger(__name__)


def _barangay_id_for_point(db: Session, lat: float, lon: float) -> int | None:
    """Return the brgy_id whose boundary polygon contains (lat, lon), else None."""
    return db.execute(
        text(
            """
            SELECT brgy_id FROM barangay_boundaries
            WHERE ST_Contains(brgy_polygon, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
            LIMIT 1
            """
        ),
        {"lat": lat, "lon": lon},
    ).scalar()


async def _perform_dispatch(
    db: Session,
    fire_id: int,
    team_id: int,
) -> dict:
    """Shared dispatch logic used by manual POST /api/dispatch and auto-dispatch.

    Creates the DispatchRecord, marks the incident dispatched, locks the team,
    computes up to 3 GNN routes, and returns the response payload. Broadcasts
    an `incident_updated` event over the websocket.

    Raises HTTPException(404) if incident or team not found.
    """
    # Serialize assignment against incident closure and concurrent requests. A
    # recommendation is only a snapshot; availability must be checked again here.
    incident = db.query(FireIncident).filter_by(fire_id=fire_id).populate_existing().with_for_update().first()
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")
    if incident.archived_at:
        raise HTTPException(409, 'This incident is archived. Restore it before taking new actions.')
    team = db.query(ResponseTeam).filter_by(team_id=team_id).populate_existing().with_for_update().first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")
    if incident.operation_completed_at is not None:
        raise HTTPException(409, 'This operation is already complete. Log a new incident for a renewed response.')
    if incident.fire_status in ('closed', 'cancelled', 'canceled', 'recalled'):
        raise HTTPException(409, 'This incident no longer accepts dispatches.')
    members = db.query(ResponseTeamMember).filter_by(team_id=team_id).populate_existing().all()
    lock_personnel_assignments(db, [member.per_id for member in members])
    db.expire_all()  # Re-read archive/account state after waiting for crew assignment locks.
    members = [m for m in members if not m.personnel.archived_at]
    truck = None
    if team.truck_id:
        truck = db.query(Truck).filter_by(truck_id=team.truck_id).populate_existing().with_for_update().one()
    if team.station_id:
        # Station relocation holds this same row lock. Capture either the old
        # station before its move, or the new station before dispatching.
        db.query(Station).filter_by(station_id=team.station_id).populate_existing().with_for_update().one()
        db.expire(team, ['station'])
    unavailable = team_unavailability(db, team, members=members, truck=truck)
    if unavailable:
        raise HTTPException(409, unavailable[1])

    from services.dispatch_history import assignment_context
    assigned_at = datetime.now(timezone.utc)

    dispatch = DispatchRecord(
        fire_id=fire_id,
        team_id=team_id,
        dispatch_status="dispatched",
        dispatch_at=assigned_at,
        dispatch_truck_count=0,
        context_snapshot=assignment_context(team, members, assigned_at),
    )
    db.add(dispatch)

    incident.fire_units_assigned = (incident.fire_units_assigned or 0) + 1
    before = snapshot(incident)
    if incident.fire_status != 'contained':
        incident.fire_status = "dispatched"
    record_changes(db, incident, before)
    team.team_status = "dispatched"
    for m in members:
        m.member_status = "dispatched"

    # Attach the team's assigned truck to this dispatch (if any). This is what the
    # driver later "mans" and what _sync_truck follows. Reserve it in the same
    # transaction as its team, before releasing either resource lock.
    if truck:
        db.flush()
        db.add(DispatchTruck(dispatch_id=dispatch.dispatch_id, truck_id=truck.truck_id))
        dispatch.dispatch_truck_count = 1
        truck.truck_status = "dispatched"
    db.commit()
    db.refresh(dispatch)
    db.refresh(incident)

    await manager.broadcast({"type": "incident_updated", "data": _incident_dict(incident)})

    # ── Route origin selection (150 m threshold) ──────────────────────────────
    # Origin is the driver's live position if they are more than 150 m from the
    # station; otherwise the station is used (e.g. truck still in the bay).
    ORIGIN_THRESHOLD_M = 150

    station = team.station
    origin_lat = origin_lng = None
    origin_source = "station"

    if station and station.station_latitude and station.station_longitude:
        # Try to find the driver's current location
        driver_membership = next(
            (m for m in team.members if m.member_role == "driver"), None
        )
        if driver_membership:
            driver_loc = db.get(CurrentLocation, driver_membership.per_id)
            now_ts = datetime.now(timezone.utc)
            if driver_loc:
                rec_at = driver_loc.recorded_at
                if rec_at.tzinfo is None:
                    rec_at = rec_at.replace(tzinfo=timezone.utc)
                loc_age_ok = (now_ts - rec_at) <= timedelta(minutes=STALE_MINUTES)
                if loc_age_ok:
                    dist_to_station = _haversine_meters(
                        float(driver_loc.latitude), float(driver_loc.longitude),
                        station.station_latitude,   station.station_longitude,
                    )
                    if dist_to_station > ORIGIN_THRESHOLD_M:
                        origin_lat    = float(driver_loc.latitude)
                        origin_lng    = float(driver_loc.longitude)
                        origin_source = "driver_location"

        if origin_lat is None:
            origin_lat    = station.station_latitude
            origin_lng    = station.station_longitude
            origin_source = "station"

    # ── Compute up to 3 GNN routes ────────────────────────────────────────────
    saved_routes = []
    if state.routing_engine and origin_lat is not None and incident.fire_latitude and incident.fire_longitude:
        try:
            src_candidates = state.routing_engine.graph.nodes_near(origin_lat, origin_lng, radius_km=2.0)
            tgt_candidates = state.routing_engine.graph.nodes_near(
                incident.fire_latitude, incident.fire_longitude, radius_km=2.0)
            if src_candidates and tgt_candidates:
                obs = _load_active_obstructions(db)
                route_results = state.routing_engine.compute_routes_multi_alpha(
                    src_candidates[0][0], tgt_candidates[0][0], obstructions=obs)
                for r in route_results:
                    route_obj = Route(
                        fire_id=fire_id,
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
                    db.add(route_obj)
                    saved_routes.append((route_obj, r))
                db.commit()
                for route_obj, _ in saved_routes:
                    db.refresh(route_obj)
                selected_obj = next((ro for ro, r in saved_routes if r["is_selected"]), None)
                if selected_obj:
                    dispatch.route_id = selected_obj.route_id
                    from services.operational_times import snapshot_routes
                    snapshot_routes(db, dispatch, reason="initial_selection")
                    db.commit()
        except Exception as exc:
            logger.warning("Route computation failed (dispatch will proceed): %s", exc)

    # Wake the crew's phones. Sent after the routes are saved so the app has a
    # route to show when the responder opens the alert; the send itself runs in
    # the background and can never fail the dispatch.
    try:
        notify_dispatch_assigned(db, dispatch, incident, team)
    except Exception as exc:
        logger.warning("Dispatch alert could not be queued: %s", exc)

    def _route_dict(ro, r):
        return {
            "route_id":      ro.route_id,
            "rank":          r["rank"],
            "route_type":    r["route_type"],
            "is_selected":   r["is_selected"],
            "route_wkt":     r["route_wkt"],
            "eta_minutes":   round(r["eta_seconds"] / 60, 2),
            "origin_source": origin_source,
        }

    return {
        "dispatch_id":     dispatch.dispatch_id,
        "fire_id":         dispatch.fire_id,
        "team_id":         dispatch.team_id,
        "dispatch_status": dispatch.dispatch_status,
        "dispatch_at":     dispatch.dispatch_at.isoformat() if dispatch.dispatch_at else None,
        "origin_source":   origin_source,
        "routes":          [_route_dict(ro, r) for ro, r in saved_routes],
    }


# Severity → heatmap weight. Closed incidents become weighted points so the
# fire-density heatmap accumulates from real history.


def _add_incident_to_heatmap(db: Session, inc: FireIncident, now: datetime):
    """Record a newly closed incident as a heatmap point. Idempotent — skips if
    this incident already has a heatmap row (an incident only closes once, but
    this guards against either close path running twice)."""
    if not is_fire_incident(inc) or inc.fire_latitude is None or inc.fire_longitude is None:
        return
    already = (
        db.query(HeatmapData)
        .filter(HeatmapData.fire_id == inc.fire_id)
        .first()
    )
    if already:
        return
    weight = severity_weight(inc.fire_severity)
    db.add(HeatmapData(
        fire_id                 = inc.fire_id,
        heatmap_latitude        = inc.fire_latitude,
        heatmap_longitude       = inc.fire_longitude,
        heatmap_severity_weight = weight,
        heatmap_density_value   = weight,
        heatmap_generated_at    = now,
    ))


def _race_condition_winner(
    existing: "CurrentLocation | None",
    incoming_source: str,
    incoming_recorded_at: datetime,
    now: datetime,
) -> bool:
    """Return True if the incoming update should overwrite current_locations."""
    if existing is None:
        return True

    rec_at = existing.recorded_at
    if rec_at.tzinfo is None:
        rec_at = rec_at.replace(tzinfo=timezone.utc)

    # Delayed packets from the same source must never move a person backwards.
    if existing.source == incoming_source:
        return incoming_recorded_at > rec_at

    if (now - rec_at) > timedelta(minutes=STALE_MINUTES):
        return True

    diff_s = abs((incoming_recorded_at - rec_at).total_seconds())
    if diff_s <= RACE_WINDOW_SECONDS:
        return (
            _SOURCE_PRIORITY.get(incoming_source, 0)
            >= _SOURCE_PRIORITY.get(existing.source, 0)
        )

    return incoming_recorded_at > rec_at


def _sync_truck(
    db: Session,
    dispatch: DispatchRecord,
    per_id: int,
    lat: float,
    lon: float,
    now: datetime,
) -> None:
    dispatch_truck = dispatch.dispatch_trucks[0] if dispatch.dispatch_trucks else None
    if not dispatch_truck or not dispatch_truck.truck:
        return

    # Only the person who has explicitly claimed to be manning this truck drives
    # its position. If no one has, we leave the truck where it is rather than
    # inferring that the driver/leader is aboard.
    if dispatch_truck.manned_by_per_id is None or per_id != dispatch_truck.manned_by_per_id:
        return

    truck = dispatch_truck.truck
    truck.truck_latitude     = lat
    truck.truck_longitude    = lon
    truck.truck_last_updated = now
    db.commit()


def _is_manning_truck(dispatch: DispatchRecord, per_id: int) -> bool:
    """True iff `per_id` has claimed they are manning the dispatch's truck."""
    dt = dispatch.dispatch_trucks[0] if dispatch.dispatch_trucks else None
    return bool(dt and dt.manned_by_per_id == per_id)


def _normalize_role(role: str | None) -> str:
    """Normalize a member_role for comparison (e.g. "Team Leader", "team_leader")."""
    return (role or "").strip().lower().replace("_", " ")


def _is_driver(db: Session, dispatch: DispatchRecord, per_id: int) -> bool:
    """True iff `per_id` is the designated driver of the dispatch's team."""
    member = (
        db.query(ResponseTeamMember)
        .filter(
            ResponseTeamMember.team_id == dispatch.team_id,
            ResponseTeamMember.per_id  == per_id,
        )
        .first()
    )
    return bool(member and (member.member_role or "").lower() == "driver")
