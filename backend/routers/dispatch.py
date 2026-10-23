"""Dispatching teams, route selection, and the on-scene lifecycle
(arrival, truck manning, containment, and the after-action report)."""
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import (
    APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile,
)
from sqlalchemy.orm import Session

import state
from auto_dispatch import ALARM_UNIT_TARGETS, recommend_teams
from config import (
    ALLOWED_PHOTO_TYPES, MAX_PHOTO_BYTES, MAX_REPORT_PHOTOS, REPORT_PHOTO_DIR,
    _PHOTO_EXT,
)
from database import get_db
from models import (
    CurrentLocation, DispatchRecord, FireIncident, IncidentReport, ReportPhoto,
    ResponseTeamMember, Route, Users,
)
from schemas import DispatchCreate, SelectRouteBody, TruckManningBody
from security import get_current_user, require_admin
from serializers import _incident_dict, _report_photo_url
from services.dispatch import (
    _add_incident_to_heatmap, _complete_dispatch_and_release, _is_driver,
    _released_payload,
    _normalize_role, _perform_dispatch,
)
from services.routing import (
    _build_rerouted_payload, _load_active_obstructions, _rebuild_routes,
)
from services.incident_events import record_changes, snapshot
from state import manager


logger = logging.getLogger(__name__)
router = APIRouter(tags=["dispatch"])


@router.patch("/api/dispatch/{dispatch_id}/acknowledge")
def acknowledge_dispatch(dispatch_id: int, background_tasks: BackgroundTasks,
                         db: Session = Depends(get_db), user: Users = Depends(get_current_user)):
    from services.dispatch_milestones import confirm
    data = confirm(db, dispatch_id, user, "acknowledge")
    db.commit()
    background_tasks.add_task(manager.broadcast, {"type": "dispatch_acknowledged", "data": data})
    return data


@router.patch("/api/dispatch/{dispatch_id}/depart")
def depart_dispatch(dispatch_id: int, background_tasks: BackgroundTasks,
                    db: Session = Depends(get_db), user: Users = Depends(get_current_user)):
    from services.dispatch_milestones import confirm
    data = confirm(db, dispatch_id, user, "depart")
    db.commit()
    background_tasks.add_task(manager.broadcast, {"type": "dispatch_departed", "data": data})
    return data


@router.post("/api/dispatch", status_code=201)
async def create_dispatch(
    body: DispatchCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    return await _perform_dispatch(db, body.fire_id, body.team_id)


@router.get("/api/incidents/{fire_id}/dispatch-recommendations")
def get_dispatch_recommendations(
    fire_id: int,
    limit: int = 8,
    target_level: str | None = None,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Ranked shortlist of teams to send for an alarm escalation.

    Read-only: it never dispatches. The escalate-alarm flow shows this list so a
    dispatcher can review and confirm which additional units go. Teams already
    actively dispatched to this incident are excluded so they aren't re-offered.

    `target_level` (the alarm level being escalated to) drives `target_units` in
    the response — the total number of units that level warrants — so the client
    can compute how many *more* to dispatch (target minus already active).
    """
    incident = db.get(FireIncident, fire_id)
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")

    active = (
        db.query(DispatchRecord)
        .filter(
            DispatchRecord.fire_id == fire_id,
            DispatchRecord.dispatch_status.in_(["dispatched", "en_route", "on_scene"]),
        )
        .all()
    )
    exclude_ids = [d.team_id for d in active]

    recommended, reason, _meta = recommend_teams(
        db, incident,
        routing_engine=state.routing_engine,
        limit=max(1, min(limit, 25)),
        exclude_team_ids=exclude_ids,
    )

    target_units = ALARM_UNIT_TARGETS.get(target_level) if target_level else None

    return {
        "fire_id":          fire_id,
        "target_level":     target_level,
        "target_units":     target_units,
        "already_active":   len(active),
        "excluded_team_ids": exclude_ids,
        "recommended": [
            {
                "team_id":      c["team_id"],
                "team_name":    c["team_name"],
                "station_id":   c["station_id"],
                "station_name": c.get("station_name"),
                "eta_seconds":  c["eta_seconds"],
                "eta_minutes":  round(c["eta_seconds"] / 60, 2),
                "eta_source":   c["eta_source"],
                "haversine_m":  c["haversine_m"],
            }
            for c in recommended
        ],
        "available_count": len(recommended),
        "reason":          reason,   # non-null when nothing eligible remains
    }


@router.get("/api/dispatch")
def get_dispatches(
    fire_id: int | None = None,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    q = db.query(DispatchRecord)
    if fire_id:
        q = q.filter(DispatchRecord.fire_id == fire_id)
    rows = q.order_by(DispatchRecord.dispatch_at.desc()).all()
    def _dispatch_routes(r):
        # Routes owned by this specific dispatch, ordered by rank
        inc_routes = (
            db.query(Route)
            .filter(Route.dispatch_id == r.dispatch_id)
            .order_by(Route.route_rank)
            .all()
        )
        return [
            {
                "route_id":              rt.route_id,
                "rank":                  rt.route_rank,
                "route_type":            rt.route_type,
                "is_selected":           rt.route_is_selected,
                "route_wkt":             rt.route_path_geojson,
                "eta_minutes":           rt.route_est_minutes,
                "distance_meters":       rt.route_distance_meters,
            }
            for rt in inc_routes
        ]

    def _team_members(r):
        if not r.team:
            return []
        return [
            {
                "per_id":      m.per_id,
                "name":        f"{m.personnel.per_firstname} {m.personnel.per_lastname}" if m.personnel else "—",
                "rank":        m.personnel.per_rank        if m.personnel else "—",
                "designation": m.personnel.per_designation if m.personnel else "—",
                "member_role": m.member_role,
                "initials":    (
                    (m.personnel.per_firstname or "?")[0].upper() +
                    (m.personnel.per_lastname  or "?")[0].upper()
                ) if m.personnel else "?",
            }
            for m in r.team.members
        ]

    return [
        {
            "dispatch_id":        r.dispatch_id,
            "fire_id":            r.fire_id,
            "team_id":            r.team_id,
            "team_name":          r.team.team_name if r.team else "—",
            "team_code":          r.team.team_code if r.team else None,
            "dispatch_status":    r.dispatch_status,
            "dispatch_at":        r.dispatch_at.isoformat() if r.dispatch_at else None,
            "arrived_at":         r.dispatch_arrived_at.isoformat() if r.dispatch_arrived_at else None,
            "completed_at":       r.dispatch_completed_at.isoformat() if r.dispatch_completed_at else None,
            "truck_platenums":    [dt.truck.truck_platenum for dt in r.dispatch_trucks if dt.truck],
            "station_name":       r.team.station.station_name if (r.team and r.team.station) else None,
            "station_latitude":   r.team.station.station_latitude  if (r.team and r.team.station) else None,
            "station_longitude":  r.team.station.station_longitude if (r.team and r.team.station) else None,
            "incident_latitude":  r.fire_incident.fire_latitude  if r.fire_incident else None,
            "incident_longitude": r.fire_incident.fire_longitude if r.fire_incident else None,
            "members":            _team_members(r),
            "routes":             _dispatch_routes(r),
        }
        for r in rows
    ]


@router.get("/api/incidents/{fire_id}/routes")
def get_incident_routes(
    fire_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    routes = (
        db.query(Route)
        .filter(Route.fire_id == fire_id)
        .order_by(Route.route_rank)
        .all()
    )
    # Fetch the active dispatch for this incident to attach deviation/connector info
    active_dispatch = (
        db.query(DispatchRecord)
        .filter(
            DispatchRecord.fire_id == fire_id,
            DispatchRecord.dispatch_status.in_(["dispatched", "en_route", "on_scene"]),
        )
        .order_by(DispatchRecord.dispatch_at.desc())
        .first()
    )

    return [
        {
            "route_id":      rt.route_id,
            "fire_id":       rt.fire_id,
            "rank":          rt.route_rank,
            "route_type":    rt.route_type,
            "is_selected":   rt.route_is_selected,
            "route_wkt":     rt.route_path_geojson,
            "eta_minutes":   rt.route_est_minutes,
            "origin_source": rt.route_origin_source,
            "connector_geojson": (
                active_dispatch.deviation_connector_geojson
                if active_dispatch and active_dispatch.route_id == rt.route_id
                   and active_dispatch.is_deviated
                else None
            ),
        }
        for rt in routes
    ]


@router.patch("/api/dispatch/{dispatch_id}/select-route")
def select_dispatch_route(
    dispatch_id: int,
    body: SelectRouteBody,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    dispatch = db.get(DispatchRecord, dispatch_id)
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found.")

    route = db.get(Route, body.route_id)
    if not route or route.dispatch_id != dispatch.dispatch_id:
        raise HTTPException(status_code=404, detail="Route not found for this dispatch.")

    # Deselect all routes for this dispatch, then select the chosen one
    db.query(Route).filter(Route.dispatch_id == dispatch.dispatch_id).update(
        {Route.route_is_selected: False}
    )
    route.route_is_selected = True
    dispatch.route_id = body.route_id
    from services.operational_times import snapshot_routes
    snapshot_routes(db, dispatch, reason="manual_selection")
    db.commit()
    db.refresh(route)

    return {
        "route_id":    route.route_id,
        "fire_id":     route.fire_id,
        "rank":        route.route_rank,
        "route_type":  route.route_type,
        "is_selected": route.route_is_selected,
        "route_wkt":   route.route_path_geojson,
        "eta_minutes": route.route_est_minutes,
    }


@router.patch("/api/dispatch/{dispatch_id}/arrived")
def mark_arrived(
    dispatch_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    if current_user.user_role != "personnel" or not current_user.personnel:
        raise HTTPException(status_code=403, detail="Only personnel accounts can mark arrival.")

    per_id = current_user.personnel.per_id

    dispatch = db.get(DispatchRecord, dispatch_id)
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found.")

    membership = (
        db.query(ResponseTeamMember)
        .filter(
            ResponseTeamMember.team_id == dispatch.team_id,
            ResponseTeamMember.per_id  == per_id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="You are not assigned to this dispatch.")

    # Only the first arrival counts. A second tap (another crew member, or a
    # retry) must not overwrite dispatch_arrived_at, which response-time
    # metrics are measured against.
    if dispatch.dispatch_status not in ("dispatched", "en_route"):
        raise HTTPException(status_code=409, detail="This dispatch is already marked as arrived or has ended.")

    now = datetime.now(timezone.utc)
    dispatch.dispatch_status     = "on_scene"
    dispatch.dispatch_arrived_at = now

    # A crew's explicit arrival confirmation can identify its sole assigned unit.
    # Multiple trucks require separate confirmation; never assign one time to all.
    if len(dispatch.dispatch_trucks) == 1:
        from services.operational_times import record_milestone
        unit = dispatch.dispatch_trucks[0]
        if unit.arrived_at is None:
            db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).with_for_update().one()
            db.refresh(unit)
            if unit.arrived_at is None:
                record_milestone(db, dispatch.fire_incident, "arrival", now, current_user, unit, source="crew_confirmation")

    if dispatch.is_deviated:
        dispatch.is_deviated                 = False
        dispatch.deviation_connector_geojson = None
        dispatch.deviation_detected_at       = None

    dispatch_truck = dispatch.dispatch_trucks[0] if dispatch.dispatch_trucks else None
    if dispatch_truck and dispatch_truck.truck:
        dispatch_truck.truck.truck_status = "on_scene"

    db.commit()

    # Arrival used to commit silently, so the dashboard never learned a unit had
    # reached the scene. This endpoint is sync (it is called from the mobile app
    # and has no other awaits), so the broadcast goes through BackgroundTasks —
    # the same pattern as the reroute broadcast above.
    background_tasks.add_task(
        manager.broadcast,
        {
            "type": "dispatch_arrived",
            "data": {
                "dispatch_id": dispatch.dispatch_id,
                "fire_id":     dispatch.fire_id,
                "team_id":     dispatch.team_id,
                "team_name":   (dispatch.team.team_name if dispatch.team else None)
                               or f"Team {dispatch.team_id}",
                "arrived_at":  dispatch.dispatch_arrived_at.isoformat(),
            },
        },
    )

    return {
        "dispatch_id":         dispatch.dispatch_id,
        "dispatch_status":     dispatch.dispatch_status,
        "dispatch_arrived_at": dispatch.dispatch_arrived_at.isoformat(),
    }


@router.patch("/api/dispatch/{dispatch_id}/truck-manning")
def set_truck_manning(
    dispatch_id: int,
    body: TruckManningBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    """Driver claims/releases that they are manning (driving) the dispatched truck.
    Only while manned does the truck's live position follow the driver's GPS."""
    if current_user.user_role != "personnel" or not current_user.personnel:
        raise HTTPException(status_code=403, detail="Only personnel accounts can man a truck.")

    per_id = current_user.personnel.per_id

    dispatch = db.get(DispatchRecord, dispatch_id)
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found.")

    membership = (
        db.query(ResponseTeamMember)
        .filter(
            ResponseTeamMember.team_id == dispatch.team_id,
            ResponseTeamMember.per_id  == per_id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="You are not assigned to this dispatch.")

    dispatch_truck = dispatch.dispatch_trucks[0] if dispatch.dispatch_trucks else None
    if not dispatch_truck or not dispatch_truck.truck:
        raise HTTPException(status_code=404, detail="No truck assigned to this dispatch.")

    now = datetime.now(timezone.utc)
    released = False

    if body.manning:
        if not _is_driver(db, dispatch, per_id):
            raise HTTPException(status_code=403, detail="Only the team's driver can man the truck.")
        dispatch_truck.manned_by_per_id = per_id
        dispatch_truck.manned_since     = now
        # Seed the truck position from the driver's last known location so the
        # truck snaps to them immediately rather than waiting for the next ping.
        cur = db.get(CurrentLocation, per_id)
        if cur is not None:
            dispatch_truck.truck.truck_latitude     = float(cur.latitude)
            dispatch_truck.truck.truck_longitude    = float(cur.longitude)
            dispatch_truck.truck.truck_last_updated = now
    else:
        # Only release if this person is the one currently manning it.
        if dispatch_truck.manned_by_per_id == per_id:
            dispatch_truck.manned_by_per_id = None
            dispatch_truck.manned_since     = None
            released = True

    db.commit()

    # When the driver explicitly unmans, the truck is no longer following their
    # phone, so a route that was rebuilt around the driver's location is stale
    # immediately. Default it back to the station-origin route now rather than
    # waiting out the stale-driver watchdog. Mirrors the watchdog's fallback.
    if released and dispatch.route_id:
        route = db.get(Route, dispatch.route_id)
        if route and route.route_origin_source == "driver_location":
            team    = dispatch.team
            station = team.station if team else None
            if station and station.station_latitude and station.station_longitude:
                rebuilt = _rebuild_routes(
                    db, dispatch,
                    station.station_latitude, station.station_longitude,
                    "station",
                )
                if rebuilt is not None:
                    selected, saved = rebuilt
                    dispatch.is_deviated                 = False
                    dispatch.deviation_connector_geojson = None
                    dispatch.deviation_detected_at       = None
                    db.commit()
                    background_tasks.add_task(
                        manager.broadcast,
                        _build_rerouted_payload(dispatch, selected, saved, "station"),
                    )

    return {
        "dispatch_id":      dispatch.dispatch_id,
        "truck_id":         dispatch_truck.truck.truck_id,
        "truck_platenum":   dispatch_truck.truck.truck_platenum,
        "manned_by_per_id": dispatch_truck.manned_by_per_id,
        "is_manning":       dispatch_truck.manned_by_per_id == per_id,
        "manned_since":     dispatch_truck.manned_since.isoformat() if dispatch_truck.manned_since else None,
    }


@router.patch("/api/dispatch/{dispatch_id}/contain")
async def mark_contained(
    dispatch_id: int,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    """Personnel mark the dispatch's incident as contained. The dispatch itself
    stays active (crew remains on scene for overhaul); 'closed' is a later step."""
    if current_user.user_role != "personnel" or not current_user.personnel:
        raise HTTPException(status_code=403, detail="Only personnel accounts can mark an incident contained.")

    per_id = current_user.personnel.per_id

    dispatch = db.get(DispatchRecord, dispatch_id)
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found.")

    membership = (
        db.query(ResponseTeamMember)
        .filter(
            ResponseTeamMember.team_id == dispatch.team_id,
            ResponseTeamMember.per_id  == per_id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="You are not assigned to this dispatch.")
    if _normalize_role(membership.member_role) != "team leader":
        raise HTTPException(status_code=403, detail="Only the team leader can mark an incident contained.")

    inc = dispatch.fire_incident
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found for this dispatch.")

    before = snapshot(inc)
    inc.fire_status = "contained"
    record_changes(db, inc, before, user=current_user)
    db.commit()
    db.refresh(inc)

    data = _incident_dict(inc)
    await manager.broadcast({"type": "incident_updated", "data": data})
    return {"fire_id": inc.fire_id, "fire_status": inc.fire_status}


@router.post("/api/dispatch/{dispatch_id}/report")
async def submit_incident_report(
    dispatch_id: int,
    narrative: str = Form(...),
    cause: str | None = Form(None),
    casualties: str | None = Form(None),
    damage_estimate: str | None = Form(None),
    recommendations: str | None = Form(None),
    photos: list[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    """Assigned personnel file the after-action report for a contained incident.
    The request is multipart/form-data: text fields plus zero or more scene
    photos. Submitting the report closes the incident (fire_status='closed') and
    completes the dispatch."""
    if current_user.user_role != "personnel" or not current_user.personnel:
        raise HTTPException(status_code=403, detail="Only personnel accounts can submit an incident report.")

    if not (narrative or "").strip():
        raise HTTPException(status_code=422, detail="The report narrative is required.")

    # FastAPI passes a single empty UploadFile when the field is sent with no
    # filename; treat anything without a filename as "no photo".
    photos = [p for p in (photos or []) if p and p.filename]
    if len(photos) > MAX_REPORT_PHOTOS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_REPORT_PHOTOS} photos may be attached.")
    for p in photos:
        ctype = (p.content_type or "").lower()
        if ctype not in ALLOWED_PHOTO_TYPES:
            raise HTTPException(status_code=422, detail=f"Unsupported photo type: {p.content_type or 'unknown'}.")

    per_id = current_user.personnel.per_id

    dispatch = db.get(DispatchRecord, dispatch_id)
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found.")

    membership = (
        db.query(ResponseTeamMember)
        .filter(
            ResponseTeamMember.team_id == dispatch.team_id,
            ResponseTeamMember.per_id  == per_id,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="You are not assigned to this dispatch.")
    # Filing closes the incident and completes the dispatch, so it is held to
    # the same team-leader rule as marking the incident contained.
    if _normalize_role(membership.member_role) != "team leader":
        raise HTTPException(status_code=403, detail="Only the team leader can file the incident report.")

    inc = dispatch.fire_incident
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found for this dispatch.")

    if inc.fire_status == "closed":
        raise HTTPException(status_code=409, detail="This incident is already closed.")
    if inc.fire_status != "contained":
        raise HTTPException(status_code=409, detail="The incident must be contained before filing a report.")

    now = datetime.now(timezone.utc)
    report = IncidentReport(
        fire_id                = inc.fire_id,
        dispatch_id            = dispatch.dispatch_id,
        per_id                 = per_id,
        report_cause           = (cause or "").strip() or None,
        report_casualties      = (casualties or "").strip() or None,
        report_damage_estimate = (damage_estimate or "").strip() or None,
        report_narrative       = narrative.strip(),
        report_recommendations = (recommendations or "").strip() or None,
        report_submitted_at    = now,
    )
    db.add(report)
    db.flush()  # assign report_id so photo rows / filenames can reference it

    # Persist each photo to disk and record it. Files written here are removed if
    # the request fails before commit, so we never leave orphaned bytes behind.
    written_paths: list[str] = []
    try:
        for up in photos:
            ext = _PHOTO_EXT.get((up.content_type or "").lower(), ".jpg")
            file_name = f"report{report.report_id}_{uuid.uuid4().hex}{ext}"
            dest = os.path.join(REPORT_PHOTO_DIR, file_name)
            data_bytes = await up.read()
            if len(data_bytes) > MAX_PHOTO_BYTES:
                raise HTTPException(status_code=422, detail=f"Photo '{up.filename}' exceeds the 10 MB limit.")
            with open(dest, "wb") as fh:
                fh.write(data_bytes)
            written_paths.append(dest)
            db.add(ReportPhoto(
                report_id     = report.report_id,
                file_name     = file_name,
                original_name = up.filename,
                content_type  = up.content_type,
            ))
    except Exception:
        for path in written_paths:
            try:
                os.remove(path)
            except OSError:
                pass
        db.rollback()
        raise

    # Filing the report closes out the incident and wraps up the dispatch,
    # returning the crew to standby and freeing their truck.
    before = snapshot(inc)
    inc.fire_status = "closed"
    record_changes(db, inc, before, user=current_user, at=now)
    _complete_dispatch_and_release(dispatch, now)
    _add_incident_to_heatmap(db, inc, now)
    released = _released_payload([dispatch])

    db.commit()
    db.refresh(report)
    db.refresh(inc)

    # Tell the dashboard a report landed, ahead of the incident_updated that
    # closes it: the dashboard names the place from its incident snapshot, and
    # this way the snapshot still holds it when the alert is built.
    filer = current_user.personnel
    await manager.broadcast({
        "type": "report_submitted",
        "data": {
            "report_id":   report.report_id,
            "fire_id":     inc.fire_id,
            "dispatch_id": dispatch.dispatch_id,
            "team_name":   dispatch.team.team_name if dispatch.team else None,
            "filed_by":    " ".join(
                x for x in (filer.per_rank, filer.per_lastname) if x
            ) or None,
            "photo_count": len(report.photos),
        },
    })

    data = _incident_dict(inc)
    await manager.broadcast({"type": "incident_updated", "data": data})
    # Same reason as the status-edit close path in routers/incidents.py.
    await manager.broadcast(released)
    return {
        "report_id":   report.report_id,
        "fire_id":     inc.fire_id,
        "fire_status": inc.fire_status,
        "dispatch_id": dispatch.dispatch_id,
        "dispatch_status": dispatch.dispatch_status,
        "photos":      [_report_photo_url(p.file_name) for p in report.photos],
    }


@router.post("/api/dispatch/{dispatch_id}/full-reroute")
async def full_reroute(
    dispatch_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Dispatcher-only: replace the current route from the driver's live position."""
    dispatch = db.get(DispatchRecord, dispatch_id)
    if not dispatch:
        raise HTTPException(status_code=404, detail="Dispatch not found.")
    if dispatch.dispatch_status not in ("dispatched", "en_route", "on_scene"):
        raise HTTPException(status_code=409, detail="Dispatch is not active.")

    incident = dispatch.fire_incident
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found.")

    if not state.routing_engine:
        raise HTTPException(status_code=503, detail="Routing engine not available.")

    # Resolve origin: driver → team_leader → any member → station
    members = (
        db.query(ResponseTeamMember)
        .filter(ResponseTeamMember.team_id == dispatch.team_id)
        .all()
    )
    drivers = [m for m in members if m.member_role == "driver"]
    leaders = [m for m in members if m.member_role == "team_leader"]
    ordered = drivers or leaders or members

    origin_lat = origin_lng = None
    for m in ordered:
        loc = db.get(CurrentLocation, m.per_id)
        if loc:
            origin_lat = float(loc.latitude)
            origin_lng = float(loc.longitude)
            break

    origin_source = "driver_location"
    if origin_lat is None:
        station = dispatch.team.station if dispatch.team else None
        if not station or not station.station_latitude:
            raise HTTPException(status_code=422, detail="No driver location and no station coordinates.")
        origin_lat    = station.station_latitude
        origin_lng    = station.station_longitude
        origin_source = "station"

    src_nodes = state.routing_engine.graph.nodes_near(origin_lat, origin_lng, radius_km=2.0)
    tgt_nodes = state.routing_engine.graph.nodes_near(
        incident.fire_latitude, incident.fire_longitude, radius_km=2.0
    )
    if not src_nodes or not tgt_nodes:
        raise HTTPException(status_code=422, detail="Could not resolve origin/destination graph nodes.")

    obs = _load_active_obstructions(db)
    route_results = state.routing_engine.compute_routes_multi_alpha(src_nodes[0][0], tgt_nodes[0][0], obstructions=obs)
    if not route_results:
        # A closure that severs every path is a legitimate answer, not a
        # failure, but the two are indistinguishable from an empty list. Re-run
        # without the obstructions: if that finds a route, the closures are the
        # reason, and the dispatcher needs to be told which situation they are
        # in rather than reading "no results" and assuming the button is broken.
        if obs and state.routing_engine.compute_routes_multi_alpha(
            src_nodes[0][0], tgt_nodes[0][0]
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    "Active road obstructions leave no route to this incident. "
                    "Remove or move one, then reroute."
                ),
            )
        raise HTTPException(status_code=422, detail="Route computation returned no results.")

    # Delete only THIS dispatch's existing routes (release FK first).
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
    dispatch.route_id                    = selected.route_id
    snapshot_routes(db, dispatch, reason="full_reroute")
    dispatch.is_deviated                 = False
    dispatch.deviation_connector_geojson = None
    dispatch.deviation_detected_at       = None
    db.commit()

    await manager.broadcast({
        "type": "route_updated",
        "data": {
            "dispatch_id": dispatch_id,
            "route_id":    selected.route_id,
            "route_wkt":   selected.route_path_geojson,
        },
    })

    return {
        "dispatch_id":   dispatch_id,
        "new_route_id":  selected.route_id,
        "origin_source": origin_source,
        "routes": [
            {
                "route_id":    ro.route_id,
                "rank":        r["rank"],
                "route_type":  r["route_type"],
                "is_selected": r["is_selected"],
                "eta_minutes": round(r["eta_seconds"] / 60, 2),
                # The caller replaces its whole route set for this dispatch from
                # this payload, so it needs the geometry too — without route_wkt
                # there is nothing to draw and the map goes blank after a reroute.
                "route_wkt":       r["route_wkt"],
                "distance_meters": r.get("route_distance_meters"),
            }
            for ro, r in saved
        ],
    }
