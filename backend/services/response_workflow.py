"""Shared two-account workflow: response, release, return and administrative closure."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import case, or_

from models import DispatchRecord, DispatchTruck, FireIncident, IncidentEvent, IncidentReport, ResponseTeam, ResponseTeamMember
from services.incident_scope import effective_response_kind

ACTIVE = ('dispatched', 'en_route', 'on_scene')
EXCLUDED = ('cancelled', 'canceled', 'recalled')
WORKFLOW_VERSION = 2


def stage(inc):
    status = inc.fire_status or 'pending'
    if status in ('closed', *EXCLUDED):
        return status
    if inc.operation_completed_at:
        return 'operation_complete'
    return {'active': 'responding', 'dispatched': 'responding', 'contained': 'under_control'}.get(status, status)


def stage_expression():
    return case(
        (FireIncident.fire_status.in_(('closed', *EXCLUDED)), FireIncident.fire_status),
        (FireIncident.operation_completed_at.is_not(None), 'operation_complete'),
        (FireIncident.fire_status == 'contained', 'under_control'),
        (FireIncident.fire_status.in_(('active', 'dispatched')), 'responding'),
        else_=FireIncident.fire_status,
    )


def stage_label(inc):
    current = stage(inc)
    if current == 'under_control':
        return 'Fire Contained' if effective_response_kind(inc) == 'fire' else 'Situation Under Control'
    return {'pending': 'Pending', 'responding': 'Responding', 'operation_complete': 'Operation Complete',
            'closed': 'Closed'}.get(current, current.replace('_', ' ').title())


def role_for(db, dispatch, user, *, historical=False):
    if user.user_role != 'personnel' or not user.personnel:
        return None
    per_id = user.personnel.per_id
    roster = (dispatch.context_snapshot or {}).get('roster')
    if historical and roster is not None:
        roles = [row.get('role', '') for row in roster if row.get('per_id') == per_id]
        return next((role for role in roles if role.lower().replace('_', ' ') == 'team leader'), roles[-1] if roles else None)
    if historical and dispatch.dispatch_status not in ACTIVE:
        report = db.query(IncidentReport).filter_by(dispatch_id=dispatch.dispatch_id, per_id=per_id).first()
        return 'team leader' if report else None
    membership = db.query(ResponseTeamMember).filter_by(team_id=dispatch.team_id, per_id=per_id).first()
    return membership.member_role if membership else None


def is_leader(db, dispatch, user, *, historical=False):
    return (role_for(db, dispatch, user, historical=historical) or '').strip().lower().replace('_', ' ') == 'team leader'


def field_report_blocker(db, dispatch, user):
    """Active leaders must arrive personally; past reporting stays available."""
    if dispatch.dispatch_status in ACTIVE and not dispatch.cleared_at:
        from services.personnel_arrival import arrival_for
        if arrival_for(db, dispatch, user.personnel.per_id) is None:
            return 'Confirm your personal arrival before submitting a field report.'
    return None


def owned_query(db, user):
    if user.user_role != 'personnel' or not user.personnel:
        raise HTTPException(403, 'Personnel access required.')
    per_id = user.personnel.per_id
    authored = db.query(IncidentReport.report_id).filter(
        IncidentReport.dispatch_id == DispatchRecord.dispatch_id, IncidentReport.per_id == per_id,
    ).exists()
    witnessed = db.query(IncidentEvent.event_id).filter(
        IncidentEvent.dispatch_id == DispatchRecord.dispatch_id, IncidentEvent.user_id == user.user_id,
    ).exists()
    current = db.query(ResponseTeamMember.members_id).filter(
        ResponseTeamMember.team_id == DispatchRecord.team_id, ResponseTeamMember.per_id == per_id,
        DispatchRecord.dispatch_status.in_(ACTIVE),
    ).exists()
    return db.query(DispatchRecord).filter(or_(
        DispatchRecord.context_snapshot.contains({'roster': [{'per_id': per_id}]}), authored, witnessed, current,
    ))


def own_dispatch(db, dispatch_id, user):
    dispatch = owned_query(db, user).filter(DispatchRecord.dispatch_id == dispatch_id).first()
    if dispatch is None:
        raise HTTPException(404, 'Assignment not found in your response history.')
    return dispatch


def record_fire_milestone(db, dispatch_id, user, kind, at, request_key):
    """An arrived leader records a shared fire fact without submitting a report."""
    if kind not in ('suppression_start', 'fire_out'):
        raise HTTPException(422, 'Choose suppression start or fire out.')
    dispatch = own_dispatch(db, dispatch_id, user)
    inc = db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).populate_existing().with_for_update().one()
    db.refresh(dispatch)
    from services.operational_times import record_milestone
    key = f'fire-milestone:{dispatch_id}:{user.user_id}:{request_key}'
    previous = db.query(IncidentEvent).filter_by(idempotency_key=key).first()
    if previous:
        # Reconcile an uncertain saved request even if the team has since cleared.
        record_milestone(db, inc, kind, at, user, key=key)
        return dispatch, False
    if not is_leader(db, dispatch, user):
        raise HTTPException(403, 'Only the assigned team leader may record fire milestones.')
    if (dispatch.dispatch_status not in ACTIVE or dispatch.cleared_at
            or inc.fire_status in ('closed', *EXCLUDED) or inc.operation_completed_at):
        raise HTTPException(409, 'This response no longer accepts new field milestones.')
    from services.personnel_arrival import arrival_for
    if arrival_for(db, dispatch, user.personnel.per_id) is None:
        raise HTTPException(409, 'Confirm your personal arrival before recording fire milestones.')
    if dispatch.dispatch_status != 'on_scene':
        raise HTTPException(409, 'Wait for the assigned truck to arrive before recording fire milestones. The manning driver must confirm truck arrival.')
    if kind == 'fire_out' and inc.fire_out_at is None and inc.fire_status != 'contained':
        raise HTTPException(409, 'Mark the fire as contained before recording Fire Out.')
    field = 'fire_out_at' if kind == 'fire_out' else 'suppression_started_at'
    changed = getattr(inc, field) is None
    event = record_milestone(db, inc, kind, at, user, key=key, source='personnel_confirmation',
                             metadata={'dispatch_id': dispatch_id, 'command_declared': kind == 'fire_out'})
    if event and changed:
        event.dispatch_id = dispatch_id
    db.flush()
    return dispatch, changed


def return_payload(unit):
    from services.dispatch_history import context, truck_plate
    saved = context(unit.dispatch_record)
    station = saved.get('return_stations', {}).get(str(unit.truck_id), {})
    return {
        'dispatch_truck_id': unit.dispatch_truck_id, 'dispatch_id': unit.dispatch_id,
        'fire_id': unit.dispatch_record.fire_id, 'truck_id': unit.truck_id,
        'plate': truck_plate(unit.dispatch_record, unit.truck_id),
        'status': 'available' if unit.ready_at else 'unavailable' if unit.returned_at else 'returning',
        'driver_per_id': unit.return_driver_per_id,
        'started_at': unit.return_started_at.isoformat() if unit.return_started_at else None,
        'returned_at': unit.returned_at.isoformat() if unit.returned_at else None,
        'ready_at': unit.ready_at.isoformat() if unit.ready_at else None,
        'reason': unit.not_ready_reason,
        'station_id': unit.return_station_id,
        'station_name': station.get('name'),
        'station_latitude': station.get('latitude'),
        'station_longitude': station.get('longitude'),
    }


def release_confirmations(db, dispatches):
    """Read the work confirmation belonging to each current release authorization."""
    authorized = {d.dispatch_id: d for d in dispatches if d.release_authorized_at}
    if not authorized:
        return set()
    events = db.query(IncidentEvent).filter(
        IncidentEvent.dispatch_id.in_(authorized),
        IncidentEvent.event_type == 'op_release_authorized', IncidentEvent.verified.is_(True),
    ).all()
    return {event.dispatch_id for event in events
            if event.occurred_at == authorized[event.dispatch_id].release_authorized_at
            and event.user_id == authorized[event.dispatch_id].release_authorized_by
            and (event.event_metadata or {}).get('team_work_finished') is True}


def release_state(inc, dispatch, dispatches, confirmed):
    """Use the same normal-release rules in both clients and both server mutations."""
    remaining = [d for d in dispatches if d.dispatch_id != dispatch.dispatch_id
                 and d.team_id is not None and d.team_id != dispatch.team_id
                 and d.dispatch_status == 'on_scene' and not d.cleared_at]
    last = not remaining
    blocker = None
    if (dispatch.dispatch_status != 'on_scene' or dispatch.cleared_at or inc.operation_completed_at
            or inc.fire_status in ('closed', *EXCLUDED)):
        blocker = 'Only an active on-scene team can be released.'
    elif last and effective_response_kind(inc) == 'fire' and not inc.fire_out_at:
        blocker = 'Record Fire Out before releasing the last on-scene team. Another team still travelling does not provide scene coverage.'
    work_finished = dispatch.dispatch_id in confirmed
    clearance_blocker = blocker
    if not clearance_blocker and not dispatch.release_authorized_at:
        clearance_blocker = 'Wait for dispatcher release authorization before confirming team clearance.'
    if not clearance_blocker and last and not work_finished:
        clearance_blocker = 'The dispatcher must confirm this team\'s work is finished before final-team clearance.'
    return {'can_authorize': blocker is None, 'authorization_blocker': blocker,
            'can_clear': clearance_blocker is None, 'clearance_blocker': clearance_blocker,
            'is_last_on_scene': last, 'work_finished_confirmed': work_finished}


def locked_release_state(db, inc, dispatch):
    # Call only while holding the incident lock. Refresh every assignment so a
    # competing clearance cannot leave stale on-scene coverage in this session.
    dispatches = db.query(DispatchRecord).filter_by(fire_id=inc.fire_id).populate_existing().all()
    return release_state(inc, dispatch, dispatches, release_confirmations(db, dispatches))


def authorize_release(db, dispatch_id, user, *, work_finished=False):
    if user.user_role != 'admin':
        raise HTTPException(403, 'Only the dispatcher can record release authorization.')
    existing = db.get(DispatchRecord, dispatch_id)
    if not existing:
        raise HTTPException(404, 'Dispatch not found.')
    inc = db.query(FireIncident).filter_by(fire_id=existing.fire_id).populate_existing().with_for_update().one()
    dispatch = db.query(DispatchRecord).filter_by(dispatch_id=dispatch_id).populate_existing().with_for_update().one()
    eligibility = locked_release_state(db, inc, dispatch)
    if dispatch.release_authorized_at and eligibility['work_finished_confirmed']:
        dispatch._workflow_changed = False
        return dispatch
    if not eligibility['can_authorize']:
        raise HTTPException(409, eligibility['authorization_blocker'])
    if work_finished is not True:
        raise HTTPException(422, 'Confirm that this team\'s assigned work is finished before authorizing release.')
    from services.operational_times import audit
    now = datetime.now(timezone.utc)
    dispatch.release_authorized_at, dispatch.release_authorized_by = now, user.user_id
    dispatch._workflow_changed = True
    audit(db, inc, 'op_release_authorized', now, user, dispatch=dispatch, source='dispatcher_radio_instruction',
          metadata={'team_work_finished': True, 'last_on_scene_at_authorization': eligibility['is_last_on_scene']})
    return dispatch


def start_return(db, dispatch, at):
    """End one scene assignment without declaring its truck or crew ready."""
    dispatch.dispatch_status = 'completed'
    dispatch.dispatch_completed_at = at
    if dispatch.team_id:
        db.query(ResponseTeam).filter_by(team_id=dispatch.team_id).with_for_update().one()
    for unit in dispatch.dispatch_trucks:
        if unit.return_started_at:
            continue
        unit.return_started_at = at
        unit.return_station_id = unit.truck.station_id if unit.truck else None
        station = unit.truck.station if unit.truck else None
        saved = dispatch.context_snapshot or {}
        dispatch.context_snapshot = {**saved, 'return_stations': {
            **saved.get('return_stations', {}), str(unit.truck_id): {
                'name': station.station_name if station else None,
                'latitude': station.station_latitude if station else None,
                'longitude': station.station_longitude if station else None,
            }}}
        unit.return_driver_per_id = unit.manned_by_per_id
        if unit.return_driver_per_id is None and len(dispatch.dispatch_trucks) == 1:
            drivers = {row['per_id'] for row in (dispatch.context_snapshot or {}).get('roster', [])
                       if (row.get('role') or '').lower().replace('_', ' ') == 'driver' and not row.get('released_at')}
            unit.return_driver_per_id = next(iter(drivers)) if len(drivers) == 1 else None
        if unit.truck:
            unit.truck.truck_status = 'returning'
    if dispatch.team:
        dispatch.team.team_status = 'returning' if dispatch.dispatch_trucks else 'standby'
        for member in dispatch.team.members:
            if (member.member_status or '').lower().replace('_', '') not in ('offduty', 'inactive'):
                member.member_status = dispatch.team.team_status


def sync_return_crew(db, dispatch):
    """Station arrival ends Returning even when a truck still needs service."""
    if not dispatch.team or db.query(DispatchRecord.dispatch_id).filter(
            DispatchRecord.team_id == dispatch.team_id, DispatchRecord.dispatch_status.in_(ACTIVE),
    ).first():
        return
    status = 'standby' if all(unit.returned_at for unit in dispatch.dispatch_trucks) else 'returning'
    dispatch.team.team_status = status
    for member in dispatch.team.members:
        if (member.member_status or '').lower().replace('_', '') not in ('offduty', 'inactive'):
            member.member_status = status


def confirm_readiness(db, unit_id, user, *, ready, reason=None):
    existing = db.get(DispatchTruck, unit_id)
    if existing is None:
        raise HTTPException(404, 'Truck return not found.')
    dispatch = existing.dispatch_record
    db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).with_for_update().one()
    unit = db.query(DispatchTruck).filter_by(dispatch_truck_id=unit_id).populate_existing().with_for_update().one()
    if dispatch.team_id:
        db.query(ResponseTeam).filter_by(team_id=dispatch.team_id).populate_existing().with_for_update().one()
    truck = unit.truck
    db.refresh(truck, with_for_update=True)
    per_id = user.personnel.per_id if user.user_role == 'personnel' and user.personnel else None
    if user.user_role != 'admin' and (per_id is None or unit.return_driver_per_id != per_id):
        raise HTTPException(403, 'Only the responsible Driver or dispatcher may confirm this return.')
    if user.user_role == 'admin' and not (reason or '').strip():
        raise HTTPException(422, 'Record a reason/source for dispatcher readiness confirmation.')
    if not ready and not (reason or '').strip():
        raise HTTPException(422, 'Explain why the truck is not ready.')
    if not unit.return_started_at or not dispatch.cleared_at:
        raise HTTPException(409, 'Record actual team clearance before return/readiness.')
    if unit.ready_at:
        if ready:
            sync_return_crew(db, dispatch)
            unit._workflow_changed = False
            return unit
        raise HTTPException(409, 'This return is already complete; use the dispatcher fleet correction.')
    if truck.truck_status not in ('returning', 'unavailable', 'maintenance'):
        raise HTTPException(409, 'Truck state no longer matches this return.')
    if not ready and unit.returned_at and unit.not_ready_reason == reason.strip() and truck.truck_status == 'unavailable':
        sync_return_crew(db, dispatch)
        unit._workflow_changed = False
        return unit
    other = db.query(DispatchTruck.dispatch_truck_id).join(DispatchRecord).filter(
        DispatchTruck.truck_id == unit.truck_id, DispatchRecord.dispatch_status.in_(ACTIVE),
    ).first()
    if other:
        raise HTTPException(409, 'This truck has another active assignment.')
    from services.operational_times import audit
    now = datetime.now(timezone.utc)
    unit._workflow_changed = True
    unit.returned_at = unit.returned_at or now
    unit.not_ready_reason = None if ready else reason.strip()
    unit.ready_at = now if ready else None
    truck.truck_status = 'available' if ready else 'unavailable'
    if ready:
        unit.manned_by_per_id, unit.manned_since = None, None
        truck.readiness_note = (reason or '').strip() or 'Driver confirmed physical return and readiness.'
        truck.readiness_confirmed_at, truck.readiness_confirmed_by = now, user.user_id
    audit(db, dispatch.fire_incident, 'op_truck_ready' if ready else 'op_truck_not_ready', now,
          user, dispatch=dispatch, unit=unit, source='driver_confirmation' if per_id else 'dispatcher_confirmation',
          metadata={'reason': reason, 'returned_at': unit.returned_at.isoformat()})
    sync_return_crew(db, dispatch)
    return unit


def consolidated_report(db, fire_id):
    return db.query(IncidentReport).filter_by(fire_id=fire_id, report_kind='consolidated').order_by(
        IncidentReport.report_id.desc()).first()


def close_incident(db, inc, user, report_id, revision):
    if user.user_role != 'admin':
        raise HTTPException(403, 'Only the dispatcher can review and close an incident.')
    report = consolidated_report(db, inc.fire_id)
    if not report or report.report_id != report_id or report.revision != revision:
        raise HTTPException(409, 'The consolidated report changed. Reload before reviewing and closing.')
    if inc.fire_status == 'closed' and report.reviewed_at:
        return report
    if inc.fire_status in EXCLUDED or (inc.fire_status != 'closed' and not inc.operation_completed_at):
        raise HTTPException(409, 'Confirm operation completion before administrative closure.')
    if inc.fire_status != 'closed' and any(d.dispatch_status not in EXCLUDED and d.dispatch_at and not d.cleared_at for d in inc.dispatches):
        raise HTTPException(409, 'Account for every responding team before closure.')
    if inc.fire_status != 'closed' and effective_response_kind(inc) == 'fire' and not inc.fire_out_at:
        raise HTTPException(409, 'Record fire out before closing a fire operation.')
    from services.incident_events import record_changes, snapshot
    from services.operational_times import audit
    now = datetime.now(timezone.utc)
    before = snapshot(inc)
    report.reviewed_at, report.reviewed_by_user_id = now, user.user_id
    inc.fire_casualties = report.report_casualties
    inc.casualties_reviewed_at = now
    inc.fire_status = 'closed'
    record_changes(db, inc, before, user=user, at=now)
    audit(db, inc, 'report_reviewed', now, user, source='dispatcher_review',
          metadata={'report_id': report.report_id, 'revision': report.revision})
    from services.report_timing import capture_consolidated_timing
    capture_consolidated_timing(db, inc, report, user, now, phase='reviewed')
    return report
