"""Fire incident CRUD and the after-action report readback."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, or_
from sqlalchemy.orm import Session

import state
from auto_dispatch import select_best_team
from database import get_db
from models import (
    DispatchRecord, DispatchTruck, FireIncident, HeatmapData, IncidentEvent,
    IncidentReport, Route, Users,
)
from schemas import IncidentCreate, IncidentUpdate
from security import require_admin
from serializers import _incident_dict, _report_dict
from services.dispatch import (
    _add_incident_to_heatmap, _barangay_id_for_point,
    _complete_dispatch_and_release, _perform_dispatch, _released_payload,
)
from services.incident_events import event_dict, record_changes, snapshot
from state import manager, report_session_phones, report_sessions


router = APIRouter(tags=["incidents"])
_SEV_SORT = case(
    (FireIncident.fire_severity == "Critical", 0),
    (FireIncident.fire_severity == "Moderate", 1),
    else_=2,
)


@router.get("/api/incidents")
def get_incidents(
    period:    str | None = None,   # "day" | "month" | "year"
    status:    str | None = None,
    search:    str | None = None,
    sev:       str | None = None,
    alarm:     str | None = None,
    sort_col:  str = "reported_at",
    sort_dir:  str = "desc",
    page:      int = Query(1,  ge=1),
    page_size: int = Query(15, ge=1, le=100),
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    q = db.query(FireIncident)

    # period filter
    if period in ("day", "month", "year"):
        now = datetime.now(timezone.utc)
        if period == "day":
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif period == "month":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        else:
            start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        q = q.filter(FireIncident.fire_incident_datetime >= start)

    # stats reflect period but not the active status tab
    stats_q = q
    stats = {
        s: stats_q.filter(FireIncident.fire_status == s).count()
        for s in ("pending", "active", "dispatched", "contained", "closed")
    }

    if status and status != "all":
        q = q.filter(FireIncident.fire_status == status)
    if sev:
        q = q.filter(FireIncident.fire_severity == sev)
    if alarm:
        q = q.filter(FireIncident.fire_alarm_level == alarm)
    if search:
        like = f"%{search}%"
        q = q.filter(or_(
            FireIncident.fire_location_name.ilike(like),
            FireIncident.fire_address.ilike(like),
        ))

    total = q.count()

    _sort_map = {
        "id":          FireIncident.fire_id,
        "loc":         FireIncident.fire_location_name,
        "sev":         _SEV_SORT,
        "reported_at": FireIncident.fire_incident_datetime,
        "units":       FireIncident.fire_units_assigned,
    }
    col = _sort_map.get(sort_col, FireIncident.fire_incident_datetime)
    q = q.order_by(col.asc() if sort_dir == "asc" else col.desc())

    rows = q.offset((page - 1) * page_size).limit(page_size).all()
    return {
        "total":     total,
        "page":      page,
        "page_size": page_size,
        "stats":     stats,
        "items":     [_incident_dict(r) for r in rows],
    }


@router.get("/api/incidents/active")
def get_active_incidents(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Plain array of non-closed incidents for the dashboard map/sidebar."""
    rows = (
        db.query(FireIncident)
        .filter(FireIncident.fire_status != "closed")
        .order_by(FireIncident.fire_incident_datetime.desc())
        .all()
    )
    return [_incident_dict(r) for r in rows]


@router.post("/api/incidents", status_code=201)
async def create_incident(
    body: IncidentCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    occurred_at = body.fire_incident_datetime
    if occurred_at is not None:
        if occurred_at.tzinfo is None:
            occurred_at = occurred_at.replace(tzinfo=timezone.utc)
        # A few minutes of slack absorbs client clock skew.
        if occurred_at > now + timedelta(minutes=5):
            raise HTTPException(status_code=422, detail="Incident time can't be in the future.")

    incident = FireIncident(
        fire_incident_datetime=occurred_at or now,
        fire_location_name=body.fire_location_name,
        fire_address=body.fire_address,
        fire_latitude=body.fire_latitude,
        fire_longitude=body.fire_longitude,
        fire_severity=body.fire_severity,
        fire_status=body.fire_status,
        fire_alarm_level=body.fire_alarm_level,
        fire_dispatch_type=body.fire_dispatch_type,
        fire_structure_type=body.fire_structure_type,
        fire_casualties=body.fire_casualties,
        fire_units_assigned=body.fire_units_assigned,
        fire_reporter_name=body.fire_reporter_name,
        fire_reporter_contact=body.fire_reporter_contact,
        fire_location_source=body.fire_location_source,
        fire_remarks=body.fire_remarks,
        confirmed_user_id=_auth.user_id,
        response_kind=body.response_kind,
        brgy_id=_barangay_id_for_point(db, body.fire_latitude, body.fire_longitude),
    )
    db.add(incident)
    if body.report_received_at is not None:
        from services.operational_times import record_milestone
        db.flush()
        record_milestone(db, incident, "receipt", body.report_received_at, _auth, source="operator_intake")
    db.commit()
    db.refresh(incident)
    # Logged already closed (a past incident) — it skips the edit-close path,
    # so record its heatmap point here.
    if incident.fire_status == "closed":
        _add_incident_to_heatmap(db, incident, now)
        db.commit()
    data = _incident_dict(incident)
    await manager.broadcast({"type": "incident_created", "data": data})

    # The reporter location is now persisted as an incident — drop the transient
    # session and tell every dashboard to remove its pin.
    if body.reporter_token:
        report_sessions.pop(body.reporter_token, None)
        report_session_phones.pop(body.reporter_token, None)
        await manager.broadcast({
            "type": "reporter_cleared",
            "data": {"token": body.reporter_token},
        })

    # Only a live (pending) report needs a crew; past incidents never auto-dispatch.
    if body.auto_dispatch and incident.fire_status == "pending":
        selection = select_best_team(db, incident, routing_engine=state.routing_engine)
        if selection.ok:
            dispatch_result = await _perform_dispatch(db, incident.fire_id, selection.team_id)
            data["auto_dispatch"] = {
                "status":      "dispatched",
                "dispatch_id": dispatch_result["dispatch_id"],
                "team_id":     selection.team_id,
                "station_id":  selection.station_id,
                "eta_minutes": round(selection.eta_seconds / 60, 2) if selection.eta_seconds else None,
                "breakdown":   selection.breakdown,
                "routes":      dispatch_result.get("routes", []),
            }
        else:
            data["auto_dispatch"] = {"status": "no_team_available", "reason": selection.reason}
            await manager.broadcast({
                "type": "auto_dispatch_failed",
                "data": {"fire_id": incident.fire_id, "reason": selection.reason},
            })
    else:
        data["auto_dispatch"] = {"status": "skipped"}

    return data


@router.patch("/api/incidents/{fire_id}")
async def update_incident(
    fire_id: int,
    body: IncidentUpdate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    inc = db.get(FireIncident, fire_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found.")
    was_closed = inc.fire_status == "closed"
    released = None
    before = snapshot(inc)
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(inc, field, val)
    record_changes(db, inc, before, user=_auth)
    # If this edit closes the incident, release any still-active dispatch crews
    # and trucks — mirrors the report-filing close path.
    if not was_closed and inc.fire_status == "closed":
        now = datetime.now(timezone.utc)
        active_dispatches = (
            db.query(DispatchRecord)
            .filter(
                DispatchRecord.fire_id == fire_id,
                DispatchRecord.dispatch_status.in_(["dispatched", "en_route", "on_scene"]),
            )
            .all()
        )
        for d in active_dispatches:
            _complete_dispatch_and_release(d, now)
        _add_incident_to_heatmap(db, inc, now)
        # An incident can close with nothing dispatched to it; stay quiet then.
        released = _released_payload(active_dispatches) if active_dispatches else None
    db.commit()
    db.refresh(inc)
    data = _incident_dict(inc)
    await manager.broadcast({"type": "incident_updated", "data": data})
    # Tells the Teams/Trucks pages what just went back to standby; without it
    # they stay stale until a reload.
    if released:
        await manager.broadcast(released)
    return data


@router.delete("/api/incidents/{fire_id}", status_code=204)
async def delete_incident(
    fire_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    inc = db.get(FireIncident, fire_id)
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found.")

    dispatch_ids = [
        d.dispatch_id
        for d in db.query(DispatchRecord).filter(DispatchRecord.fire_id == fire_id).all()
    ]

    # Break the dispatch -> route FK so routes can be removed freely.
    db.query(DispatchRecord).filter(DispatchRecord.fire_id == fire_id).update(
        {"route_id": None}, synchronize_session=False
    )
    if dispatch_ids:
        db.query(DispatchTruck).filter(
            DispatchTruck.dispatch_id.in_(dispatch_ids)
        ).delete(synchronize_session=False)

    # Remove all child rows tied to this incident, then the incident itself.
    db.query(Route).filter(Route.fire_id == fire_id).delete(synchronize_session=False)
    db.query(DispatchRecord).filter(DispatchRecord.fire_id == fire_id).delete(
        synchronize_session=False
    )
    db.query(HeatmapData).filter(HeatmapData.fire_id == fire_id).delete(
        synchronize_session=False
    )
    db.query(IncidentEvent).filter(IncidentEvent.fire_id == fire_id).delete(
        synchronize_session=False
    )

    db.delete(inc)
    db.commit()

    await manager.broadcast({"type": "incident_deleted", "data": {"fire_id": fire_id}})


@router.get("/api/incidents/{fire_id}/report")
def get_incident_report(
    fire_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """The after-action report filed for a (closed) incident, with photo URLs.
    Returns the most recently submitted report, or null when none exists yet."""
    report = (
        db.query(IncidentReport)
        .filter(IncidentReport.fire_id == fire_id)
        .order_by(IncidentReport.report_submitted_at.desc(), IncidentReport.report_id.desc())
        .first()
    )
    if not report:
        return {"report": None}
    return {"report": _report_dict(report)}


@router.get("/api/incidents/{fire_id}/events")
def get_incident_events(
    fire_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Status / alarm / severity changes for the incident timeline, oldest first."""
    if not db.get(FireIncident, fire_id):
        raise HTTPException(status_code=404, detail="Incident not found.")
    rows = (
        db.query(IncidentEvent)
        .filter(IncidentEvent.fire_id == fire_id, IncidentEvent.event_type.in_(("status", "alarm", "severity")))
        .order_by(IncidentEvent.created_at, IncidentEvent.event_id)
        .all()
    )
    return [event_dict(e) for e in rows]
