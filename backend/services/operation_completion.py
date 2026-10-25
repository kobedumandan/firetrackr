"""Physical clearance is independent of administrative incident closure."""
from fastapi import HTTPException

from models import DispatchRecord, FireIncident, ResponseTeamMember
from services.operational_times import EXCLUDED, audit, iso, valid_time


def clear_dispatch(db, dispatch_id, user, at, key):
    at = valid_time(at)
    dispatch = db.get(DispatchRecord, dispatch_id)
    if dispatch is None:
        raise HTTPException(404, 'Dispatch not found.')
    inc = db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).with_for_update().one()
    db.refresh(dispatch)
    if user.user_role != 'admin':
        person = user.personnel if user.user_role == 'personnel' else None
        membership = db.query(ResponseTeamMember).filter_by(team_id=dispatch.team_id, per_id=person.per_id).first() if person else None
        role = (membership.member_role or '').lower().replace('_', ' ') if membership else ''
        if role != 'team leader':
            raise HTTPException(403, 'Only an administrator or assigned team leader may confirm clearance.')
        if dispatch.cleared_at is None and dispatch.dispatch_status != 'on_scene':
            raise HTTPException(409, 'Team clearance requires an on-scene dispatch.')
    if dispatch.cleared_at is not None:
        if dispatch.cleared_at != at:
            raise HTTPException(409, 'Clearance is already verified; its original timestamp is preserved.')
        return {'dispatch_id': dispatch_id, 'cleared_at': iso(dispatch.cleared_at)}
    if inc.operation_completed_at or dispatch.dispatch_status in EXCLUDED or inc.fire_status in EXCLUDED:
        raise HTTPException(409, 'This response no longer accepts a new clearance.')
    prior = [v for v in (dispatch.dispatch_at, dispatch.departed_at, dispatch.dispatch_arrived_at,
                        *(u.arrived_at for u in dispatch.dispatch_trucks)) if v]
    if not prior or at < max(prior):
        raise HTTPException(422, 'Clearance must follow dispatch and any recorded arrival.')
    from models import IncidentEvent
    existing = db.query(IncidentEvent).filter_by(idempotency_key=key).first()
    if existing:
        raise HTTPException(409, 'This submission key was already used for another event.')
    dispatch.cleared_at = at
    audit(db, inc, 'op_clearance', at, user, dispatch=dispatch, key=key)
    return {'dispatch_id': dispatch_id, 'cleared_at': iso(at)}
