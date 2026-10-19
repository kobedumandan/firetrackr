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
    ResponseTeam, ResponseTeamMember, Route,
)
from serializers import _incident_dict
from services.incident_events import record_changes, snapshot
from services.push import notify_dispatch_assigned
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
    incident = db.get(FireIncident, fire_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")
    team = db.get(ResponseTeam, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")

    dispatch = DispatchRecord(
        fire_id=fire_id,
        team_id=team_id,
        dispatch_status="dispatched",
        dispatch_truck_count=0,
    )
    db.add(dispatch)

    incident.fire_units_assigned = (incident.fire_units_assigned or 0) + 1
    before = snapshot(incident)
    incident.fire_status = "dispatched"
    record_changes(db, incident, before)
    team.team_status = "dispatched"
    for m in team.members or []:
        m.member_status = "dispatched"

    db.commit()
    db.refresh(dispatch)
    db.refresh(incident)

    # Attach the team's assigned truck to this dispatch (if any). This is what the
    # driver later "mans" and what _sync_truck follows.
    if team.truck_id:
        db.add(DispatchTruck(dispatch_id=dispatch.dispatch_id, truck_id=team.truck_id))
        dispatch.dispatch_truck_count = 1
        if team.truck:
            team.truck.truck_status = "dispatched"
        db.commit()
        db.refresh(dispatch)

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
                    snapshot_routes(db, dispatch)
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


def _complete_dispatch_and_release(dispatch: DispatchRecord, now: datetime) -> None:
    """Wrap up a dispatch when its incident is closed: complete the dispatch and
    return its team, members, and truck to standby/available — the reverse of the
    "dispatched" state set in _perform_dispatch. Also clears any active manning so
    the truck stops following a driver's phone. Idempotent; safe to call once per
    active dispatch from either close path (report filing or a direct status edit)."""
    dispatch.dispatch_status       = "completed"
    dispatch.dispatch_completed_at = now

    team = dispatch.team
    if team:
        team.team_status = "standby"
        for m in team.members or []:
            m.member_status = "standby"

    for dt in dispatch.dispatch_trucks or []:
        if dt.truck:
            dt.truck.truck_status = "available"
        dt.manned_by_per_id = None
        dt.manned_since     = None


def _released_payload(dispatches) -> dict:
    """WS payload naming everything _complete_dispatch_and_release just returned
    to standby.

    Closing an incident used to broadcast only `incident_updated`, whose payload
    is the incident dict — it says nothing about teams or trucks. The database
    was correct immediately, but the Teams and Trucks pages had no way to hear
    about it and kept showing a released crew as dispatched until a reload, which
    reads as "the close didn't work".

    Build this BEFORE db.commit(), while the released rows are still loaded in
    the session; afterwards the default expire-on-commit would re-query every
    attribute touched here.
    """
    dispatch_ids, team_ids, truck_ids, per_ids = set(), set(), set(), set()
    for d in dispatches:
        dispatch_ids.add(d.dispatch_id)
        if d.team_id:
            team_ids.add(d.team_id)
        for m in (d.team.members if d.team else []) or []:
            per_ids.add(m.per_id)
        for dt in d.dispatch_trucks or []:
            if dt.truck_id:
                truck_ids.add(dt.truck_id)
    return {
        "type": "dispatch_completed",
        "data": {
            "dispatch_ids": sorted(dispatch_ids),
            "team_ids":     sorted(team_ids),
            "truck_ids":    sorted(truck_ids),
            "per_ids":      sorted(per_ids),
        },
    }


# Severity → heatmap weight. Closed incidents become weighted points so the
# fire-density heatmap accumulates from real history.
_SEVERITY_WEIGHT = {"Minor": 0.4, "Moderate": 0.7, "Critical": 1.0}


def _add_incident_to_heatmap(db: Session, inc: FireIncident, now: datetime):
    """Record a newly closed incident as a heatmap point. Idempotent — skips if
    this incident already has a heatmap row (an incident only closes once, but
    this guards against either close path running twice)."""
    if inc.fire_latitude is None or inc.fire_longitude is None:
        return
    already = (
        db.query(HeatmapData)
        .filter(HeatmapData.fire_id == inc.fire_id)
        .first()
    )
    if already:
        return
    weight = _SEVERITY_WEIGHT.get((inc.fire_severity or "").strip(), 0.5)
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
