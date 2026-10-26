"""Record personal arrival separately from a confirmed vehicle arrival."""
from datetime import datetime, timezone

from fastapi import HTTPException

from models import DispatchRecord, FireIncident, IncidentEvent, Personnel, ResponseTeamMember


def arrival_for(db, dispatch, per_id):
    if dispatch is None:
        return None
    event = db.query(IncidentEvent).filter_by(
        idempotency_key=f'personnel-arrival:{dispatch.dispatch_id}:{per_id}').first()
    if event:
        return event.occurred_at
    # Older /arrived actions were stored as vehicle events even for leaders.
    # Their authenticated actor still identifies who personally confirmed arrival.
    # Never copy a dispatch-wide timestamp to every member of the crew.
    legacy = db.query(IncidentEvent).join(Personnel, Personnel.user_id == IncidentEvent.user_id).filter(
        IncidentEvent.dispatch_id == dispatch.dispatch_id,
        IncidentEvent.event_type == 'op_arrival', IncidentEvent.source == 'crew_confirmation',
        IncidentEvent.verified.is_(True), Personnel.per_id == per_id,
        IncidentEvent.occurred_at >= dispatch.dispatch_at,
    ).order_by(IncidentEvent.occurred_at, IncidentEvent.event_id).first() if dispatch.dispatch_at else None
    return legacy.occurred_at if legacy else None


def personnel_status(dispatch, arrived_at):
    if dispatch is None:
        return 'standby'
    if dispatch.dispatch_status not in ('dispatched', 'en_route', 'on_scene'):
        return dispatch.dispatch_status
    if arrived_at:
        return 'on_scene'
    return 'en_route' if dispatch.dispatch_status == 'on_scene' else dispatch.dispatch_status


def confirm_arrival(db, dispatch_id, user):
    if user.user_role != 'personnel' or not user.personnel:
        raise HTTPException(403, 'Only personnel accounts can mark arrival.')
    dispatch = db.get(DispatchRecord, dispatch_id)
    if dispatch is None:
        raise HTTPException(404, 'Dispatch not found.')
    inc = db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).with_for_update().one()
    db.refresh(dispatch, with_for_update=True)
    per_id = user.personnel.per_id
    membership = db.query(ResponseTeamMember).filter_by(team_id=dispatch.team_id, per_id=per_id).first()
    if not membership:
        raise HTTPException(403, 'You are not assigned to this dispatch.')
    if (dispatch.dispatch_status not in ('dispatched', 'en_route', 'on_scene')
            or inc.fire_status in ('closed', 'cancelled', 'canceled', 'recalled') or inc.operation_completed_at):
        raise HTTPException(409, 'This response no longer accepts arrival confirmations.')

    from services.operational_times import audit, record_milestone, unit_arrival
    now = datetime.now(timezone.utc)
    arrived_at = arrival_for(db, dispatch, per_id)
    repeated = arrived_at is not None
    if not repeated:
        arrived_at = now
        audit(db, inc, 'op_personnel_arrival', now, user, dispatch=dispatch,
              key=f'personnel-arrival:{dispatch_id}:{per_id}', source='personnel_confirmation',
              metadata={'per_id': per_id})

    # A person's arrival is vehicle evidence only for a unit they explicitly man.
    db.expire(dispatch, ['dispatch_trucks'])
    units = [unit for unit in dispatch.dispatch_trucks if unit.manned_by_per_id == per_id]
    transitioned = False
    vehicle_changed = False
    if units or not dispatch.dispatch_trucks:
        for unit in units:
            # A sole truck can already have an accepted legacy dispatch-level
            # arrival. Confirm the person without replacing that vehicle time.
            if unit_arrival(unit) is None:
                record_milestone(db, inc, 'arrival', now, user, unit, source='manning_driver_confirmation')
                vehicle_changed = True
            if unit.truck:
                unit.truck.truck_status = 'on_scene'
        if dispatch.dispatch_status != 'on_scene':
            dispatch.dispatch_status = 'on_scene'
            dispatch.dispatch_arrived_at = dispatch.dispatch_arrived_at or now
            transitioned = True
    db.commit()
    return {
        'dispatch_id': dispatch_id, 'fire_id': dispatch.fire_id, 'team_id': dispatch.team_id,
        'team_name': dispatch.team.team_name if dispatch.team else f'Team {dispatch.team_id}',
        'personnel_name': ' '.join(part for part in (user.personnel.per_firstname, user.personnel.per_lastname) if part),
        'member_role': membership.member_role,
        'per_id': per_id, 'personnel_status': 'on_scene', 'personnel_arrived_at': arrived_at.isoformat(),
        'dispatch_status': dispatch.dispatch_status,
        'dispatch_arrived_at': dispatch.dispatch_arrived_at.isoformat() if dispatch.dispatch_arrived_at else None,
        'truck_arrived': bool(units), 'truck_ids': [unit.truck_id for unit in units],
        'dispatch_transitioned': transitioned, 'vehicle_changed': vehicle_changed, 'repeated': repeated,
    }
