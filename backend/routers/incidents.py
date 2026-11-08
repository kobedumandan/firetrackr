"""Fire incident CRUD and administrator after-action report management."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import ValidationError
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

import state
from auto_dispatch import select_best_team
from database import get_db
from models import (
    DispatchRecord, DispatchTruck, FireIncident, HeatmapData, IncidentEvent,
    IncidentReport, ReportPhoto, Route, Users,
)
from schemas import IncidentCreate, IncidentReportSave, IncidentUpdate
from security import require_admin
from serializers import _incident_dict, _report_dict
from services.dispatch import (
    _add_incident_to_heatmap, _barangay_id_for_point,
    _perform_dispatch,
)
from services.incident_events import event_dict, record_changes, snapshot
from services.report_photos import cleanup_report_photos
from services.reporting_periods import custom_reporting_window
from services.resource_availability import ACTIVE
from shift_utils import SHIFT_TZ
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
    date_from: str | None = None,
    date_to:   str | None = None,
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
    if period == "custom" or date_from is not None or date_to is not None:
        if not date_from and not date_to:
            raise HTTPException(status_code=422, detail="Choose a start or end date.")
        now = datetime.now(timezone.utc)
        today = now.astimezone(SHIFT_TZ).date().isoformat()
        try:
            start, end = custom_reporting_window(date_from or date_to, date_to or today, now)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        if date_from:
            q = q.filter(FireIncident.fire_incident_datetime >= start.astimezone(timezone.utc))
        q = q.filter(FireIncident.fire_incident_datetime < end.astimezone(timezone.utc))
    elif period in ("day", "month", "year"):
        now = datetime.now(timezone.utc).astimezone(SHIFT_TZ)
        if period == "day":
            start = now.replace(hour=0, minute=0, second=0, microsecond=0)
            end = start + timedelta(days=1)
        elif period == "month":
            start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
            end = start.replace(year=start.year + 1, month=1) if start.month == 12 else start.replace(month=start.month + 1)
        else:
            start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
            end = start.replace(year=start.year + 1)
        q = q.filter(FireIncident.fire_incident_datetime >= start.astimezone(timezone.utc),
                     FireIncident.fire_incident_datetime < end.astimezone(timezone.utc))

    # Stats reflect the period before any list filters, in one database trip.
    from services.response_workflow import stage_expression
    counts, stages = {}, {}
    for raw, stage, count in q.with_entities(
        FireIncident.fire_status, stage_expression(), func.count(FireIncident.fire_id)
    ).group_by(FireIncident.fire_status, stage_expression()).all():
        counts[raw] = counts.get(raw, 0) + count
        stages[stage] = stages.get(stage, 0) + count
    stats = {
        s: counts.get(s, 0)
        for s in ("pending", "active", "dispatched", "contained", "closed")
    }
    stats.update({key: stages.get(key, 0) for key in ('responding', 'under_control', 'operation_complete')})

    if status and status != "all":
        q = q.filter(stage_expression() == status) if status in ('responding', 'under_control', 'operation_complete') else q.filter(FireIncident.fire_status == status)
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


@router.get("/api/incidents/{fire_id}")
def get_incident(
    fire_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Load a bookmarked incident without relying on the current register page."""
    incident = db.get(FireIncident, fire_id)
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return _incident_dict(incident)


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
        fire_alarm_level=body.fire_alarm_level if body.fire_dispatch_type == 'Firefighting Operations' else None,
        fire_dispatch_type=body.fire_dispatch_type,
        fire_structure_type=body.fire_structure_type if body.fire_dispatch_type == 'Firefighting Operations' else None,
        fire_casualties=body.fire_casualties,
        fire_units_assigned=body.fire_units_assigned,
        fire_reporter_name=body.fire_reporter_name,
        fire_reporter_contact=body.fire_reporter_contact,
        fire_location_source=body.fire_location_source,
        fire_remarks=body.fire_remarks,
        confirmed_user_id=_auth.user_id,
        response_kind=body.response_kind,
        record_kind=body.record_kind,
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
            saved_fire_id = incident.fire_id
            try:
                dispatch_result = await _perform_dispatch(db, saved_fire_id, selection.team_id)
            except HTTPException as error:
                if error.status_code not in (404, 409):
                    raise
                # Intake has already committed. A lost recommendation must not
                # turn successful intake into an apparent failure and duplicate retry.
                db.rollback()
                incident = db.get(FireIncident, saved_fire_id)
                if incident is None:
                    raise HTTPException(404, 'The saved incident is no longer available.') from None
                data = _incident_dict(incident)
                data['auto_dispatch'] = {'status': 'no_team_available',
                    'reason': 'selected_team_unavailable', 'detail': str(error.detail)}
                await manager.broadcast({'type': 'auto_dispatch_failed', 'data': {
                    'fire_id': saved_fire_id, 'reason': 'Selected team is no longer available. Incident saved; review another team.'}})
                return data
            data = _incident_dict(incident)
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
    if body.fire_status == 'closed' and not was_closed:
        raise HTTPException(409, 'Use Review & Close after operation completion and consolidated reporting.')
    if was_closed and body.fire_status and body.fire_status != 'closed':
        raise HTTPException(409, 'A closed incident cannot be reopened by a general edit. Record a new response.')
    if inc.operation_completed_at and body.fire_status and body.fire_status not in (inc.fire_status, 'closed'):
        raise HTTPException(409, 'This operation has a verified completion. Log a new incident for a renewed response.')
    if 'fire_casualties' in body.model_fields_set:
        if db.query(IncidentReport.report_id).filter_by(fire_id=fire_id, report_kind='consolidated').first():
            raise HTTPException(409, 'Correct casualty outcomes through the consolidated report.')
        inc.casualties_reviewed_at = None
    if 'fire_dispatch_type' in body.model_fields_set and body.fire_dispatch_type != inc.fire_dispatch_type:
        old_classification = {'operation': inc.fire_dispatch_type, 'response_kind': inc.response_kind}
        # Declared operation type remains authoritative while old timing facts
        # stay attached to their original record for review.
        if body.fire_dispatch_type == 'Firefighting Operations':
            inc.response_kind = 'fire'
        elif body.fire_dispatch_type == 'Emergency Medical Services (EMS)':
            inc.response_kind = 'medical'
        elif body.fire_dispatch_type and inc.response_kind == 'fire':
            inc.response_kind = 'other'
        from services.operational_times import audit
        audit(db, inc, 'op_classification', datetime.now(timezone.utc), _auth,
              source='dispatcher_operation_correction', metadata={'before': old_classification,
              'after': {'operation': body.fire_dispatch_type, 'response_kind': inc.response_kind}})
        from services.report_timing import invalidate_consolidated_timing_review
        invalidate_consolidated_timing_review(db, inc)
    before = snapshot(inc)
    for field, val in body.model_dump(exclude_unset=True).items():
        setattr(inc, field, val)
    if inc.fire_dispatch_type and inc.fire_dispatch_type != 'Firefighting Operations':
        inc.fire_alarm_level = None
        inc.fire_structure_type = None
    record_changes(db, inc, before, user=_auth)
    if inc.fire_status == 'closed' and (not was_closed or 'fire_dispatch_type' in body.model_fields_set):
        _add_incident_to_heatmap(db, inc, datetime.now(timezone.utc))
    db.commit()
    db.refresh(inc)
    data = _incident_dict(inc)
    await manager.broadcast({"type": "incident_updated", "data": data})
    return data


@router.delete("/api/incidents/{fire_id}", status_code=204)
async def delete_incident(
    fire_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    # Match dispatch assignment/clearance and report submission's incident lock
    # so the eligibility check and deletion see one consistent response state.
    inc = (db.query(FireIncident).filter_by(fire_id=fire_id)
           .populate_existing().with_for_update().first())
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found.")

    if db.query(DispatchRecord.dispatch_id).filter(
        DispatchRecord.fire_id == fire_id,
        DispatchRecord.dispatch_status.in_(ACTIVE),
    ).first():
        raise HTTPException(409, 'Cannot delete an incident with an ongoing dispatch. Clear all responding teams first.')
    if db.query(DispatchTruck.dispatch_truck_id).join(DispatchRecord).filter(
        DispatchRecord.fire_id == fire_id,
        DispatchTruck.return_started_at.is_not(None),
        DispatchTruck.ready_at.is_(None),
    ).first():
        raise HTTPException(409, 'Cannot delete an incident while a truck return or readiness confirmation is pending.')

    photo_names = [name for (name,) in db.query(ReportPhoto.file_name)
                   .join(IncidentReport).filter(IncidentReport.fire_id == fire_id).all()]
    dispatch_ids = [
        d.dispatch_id
        for d in db.query(DispatchRecord).filter(DispatchRecord.fire_id == fire_id).all()
    ]

    # Break the dispatch -> route FK so routes can be removed freely.
    db.query(DispatchRecord).filter(DispatchRecord.fire_id == fire_id).update(
        {"route_id": None}, synchronize_session=False
    )
    if dispatch_ids:
        from models import TruckLog
        unit_ids = [u.dispatch_truck_id for u in db.query(DispatchTruck).filter(DispatchTruck.dispatch_id.in_(dispatch_ids))]
        if unit_ids:
            db.query(TruckLog).filter(TruckLog.dispatch_truck_id.in_(unit_ids)).delete(synchronize_session=False)
        db.query(DispatchTruck).filter(
            DispatchTruck.dispatch_id.in_(dispatch_ids)
        ).delete(synchronize_session=False)

    # Remove all child rows tied to this incident, then the incident itself.
    # Reports reference both the incident and its dispatch. Remove them before
    # the dispatches; their photo rows cascade, and object cleanup follows commit.
    db.query(IncidentReport).filter(IncidentReport.fire_id == fire_id).delete(
        synchronize_session="fetch"
    )
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
    await run_in_threadpool(cleanup_report_photos, photo_names)

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
        .filter(IncidentReport.fire_id == fire_id, IncidentReport.report_kind == 'consolidated')
        .order_by(IncidentReport.report_submitted_at.desc(), IncidentReport.report_id.desc())
        .first()
    )
    if not report:
        return {"report": None}
    from services.incident_reports import report_closed_at
    from services.report_timing import report_timeline
    return {"report": {**_report_dict(report), 'operational_timing': report_timeline(db, report),
                       'closed_at': report_closed_at(db, report)}}


@router.put("/api/incidents/{fire_id}/report")
async def save_incident_report(
    fire_id: int,
    body: IncidentReportSave,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Recover a missing report or correct its text without changing field times."""
    return await _save_incident_report(fire_id, body, db, _auth)


@router.post("/api/incidents/{fire_id}/report/photos")
async def save_incident_report_with_photos(
    fire_id: int,
    report: str = Form(...),
    photos: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Save dispatcher edits and additional photos together, preserving existing photos."""
    try:
        body = IncidentReportSave.model_validate_json(report)
    except ValidationError as error:
        raise HTTPException(422, detail=error.errors(include_context=False, include_input=False)) from None
    uploads = [photo for photo in photos if photo and photo.filename]
    if not uploads:
        raise HTTPException(422, 'Choose at least one photo to attach.')
    return await _save_incident_report(fire_id, body, db, _auth, uploads)


async def _save_incident_report(fire_id, body, db, user, photos=()):
    from services.incident_events import actor_name
    from services.incident_reports import append_admin_report_photos, report_closed_at, save_admin_report
    from services.report_timing import report_timeline

    written_names = []
    try:
        report, inc, released, creating = save_admin_report(db, fire_id, body, user, photos_added=len(photos))
        await append_admin_report_photos(db, report, photos, written_names)
        # Resolve links before commit so failed storage work cannot partially save
        # text changes, close an incident or release its responding crews.
        report_payload = await run_in_threadpool(_report_dict, report)
        db.commit()
    except Exception:
        try:
            db.rollback()
        finally:
            await run_in_threadpool(cleanup_report_photos, written_names)
        raise
    db.refresh(report)
    db.refresh(inc)
    report_data = {**report_payload, 'operational_timing': report_timeline(db, report),
                   'closed_at': report_closed_at(db, report)}
    incident_data = _incident_dict(inc)
    await manager.broadcast({
        'type': 'report_submitted' if creating else 'report_updated',
        'data': {
            'fire_id': inc.fire_id, 'report_id': report.report_id,
            'dispatch_id': report.dispatch_id, 'filed_by': report_data['author'],
            'edited_by': actor_name(user), 'photo_count': len(report.photos),
            'incident': incident_data,
            'report_kind': report.report_kind,
        },
    })
    await manager.broadcast({'type': 'incident_updated', 'data': incident_data})
    from routers.response_workflow import notify
    await notify(db, 'report_prepared' if creating else 'report_corrected', inc)
    if released:
        await manager.broadcast(released)
    return {'report': report_data, 'incident': incident_data}


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
