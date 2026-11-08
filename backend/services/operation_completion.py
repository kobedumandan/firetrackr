"""Physical clearance is independent of administrative incident closure."""
from fastapi import HTTPException

from models import DispatchRecord, FireIncident, ResponseTeamMember
from services.operational_times import EXCLUDED, audit, iso, valid_time


def clear_dispatch(db, dispatch_id, user, at, key, reason=None):
    at = valid_time(at)
    dispatch = db.get(DispatchRecord, dispatch_id)
    if dispatch is None:
        raise HTTPException(404, 'Dispatch not found.')
    inc = db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).populate_existing().with_for_update().one()
    db.refresh(dispatch)
    if user.user_role == 'admin' and not (reason or '').strip():
        raise HTTPException(422, 'Record the source/reason for dispatcher-confirmed clearance.')
    if user.user_role != 'admin':
        person = user.personnel if user.user_role == 'personnel' else None
        from services.response_workflow import is_leader
        if not person or not is_leader(db, dispatch, user, historical=bool(dispatch.cleared_at)):
            raise HTTPException(403, 'Only an administrator or assigned team leader may confirm clearance.')
        if dispatch.cleared_at is None and dispatch.dispatch_status != 'on_scene':
            raise HTTPException(409, 'Team clearance requires an on-scene dispatch.')
    if dispatch.cleared_at is not None:
        if at < dispatch.cleared_at:
            raise HTTPException(409, 'Clearance is already verified; its original timestamp is preserved.')
        return {'dispatch_id': dispatch_id, 'fire_id': dispatch.fire_id, 'cleared_at': iso(dispatch.cleared_at), 'repeated': True}
    if inc.operation_completed_at or dispatch.dispatch_status in EXCLUDED or inc.fire_status in ('closed', *EXCLUDED):
        raise HTTPException(409, 'This response no longer accepts a new clearance.')
    if not dispatch.release_authorized_at:
        raise HTTPException(409, 'Wait for dispatcher release authorization before confirming team clearance.')
    from services.response_workflow import locked_release_state
    eligibility = locked_release_state(db, inc, dispatch)
    if not eligibility['can_clear']:
        raise HTTPException(409, eligibility['clearance_blocker'])
    prior = [v for v in (dispatch.dispatch_at, dispatch.departed_at, dispatch.dispatch_arrived_at,
                        *(u.arrived_at for u in dispatch.dispatch_trucks)) if v]
    prior.append(dispatch.release_authorized_at)
    if eligibility['is_last_on_scene'] and inc.fire_out_at:
        prior.append(inc.fire_out_at)
    if not prior or at < max(prior):
        raise HTTPException(422, 'Clearance must follow dispatch, release authorization, recorded arrival and Fire Out for the final team.')
    from models import IncidentEvent
    existing = db.query(IncidentEvent).filter_by(idempotency_key=key).first()
    if existing:
        raise HTTPException(409, 'This submission key was already used for another event.')
    dispatch.cleared_at = at
    audit(db, inc, 'op_clearance', at, user, dispatch=dispatch, key=key,
          source='dispatcher_radio_confirmation' if user.user_role == 'admin' else 'leader_confirmation',
          metadata={'reason': reason})
    from services.response_workflow import start_return
    start_return(db, dispatch, at)
    return {'dispatch_id': dispatch_id, 'fire_id': dispatch.fire_id, 'cleared_at': iso(at), 'repeated': False}
