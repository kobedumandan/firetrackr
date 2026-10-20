"""First server-received acknowledgement/departure, with incident-first locking."""
from datetime import datetime, timezone

from fastapi import HTTPException

from models import DispatchRecord, FireIncident, ResponseTeamMember
from services.operational_times import audit, iso, record_milestone, snapshot_routes
from services.response_performance import arrival


def confirm(db, dispatch_id, user, kind):
    if user.user_role != "personnel" or not user.personnel:
        raise HTTPException(403, "Only assigned personnel may confirm dispatch milestones.")
    existing = db.get(DispatchRecord, dispatch_id)
    if not existing:
        raise HTTPException(404, "Dispatch not found.")
    inc = db.query(FireIncident).filter_by(fire_id=existing.fire_id).with_for_update().one()
    dispatch = db.query(DispatchRecord).filter_by(dispatch_id=dispatch_id).populate_existing().with_for_update().one()
    membership = db.query(ResponseTeamMember).filter_by(team_id=dispatch.team_id, per_id=user.personnel.per_id).first()
    role = (membership.member_role or "").strip().lower().replace("_", " ") if membership else ""
    if role not in ("team leader", "driver"):
        raise HTTPException(403, "Only the assigned team leader or driver may confirm this action.")
    if kind not in ("acknowledge", "depart"):
        raise HTTPException(422, "Unknown dispatch action.")
    field = "acknowledged_at" if kind == "acknowledge" else "departed_at"
    if getattr(dispatch, field) is not None:
        return result(dispatch)
    if dispatch.dispatch_status not in ("dispatched", "en_route") or arrival(dispatch) is not None:
        raise HTTPException(409, "New milestones cannot be recorded after arrival or completion.")
    if inc.fire_status in ("contained", "closed", "cancelled", "canceled", "recalled"):
        raise HTTPException(409, "This incident no longer accepts departure actions.")
    if kind == "depart":
        snapshot_routes(db, dispatch, reason="departure_confirmation")
    at = datetime.now(timezone.utc)
    if not dispatch.dispatch_at or at < dispatch.dispatch_at:
        raise HTTPException(409, "The dispatch timestamp is unavailable or in the future.")
    if dispatch.acknowledged_at is None:
        dispatch.acknowledged_at = at
        dispatch.acknowledged_by = user.user_id
        audit(db, inc, "op_acknowledgement", at, user, dispatch=dispatch,
              source="mobile_action", metadata={"implicit": kind == "depart"})
    if kind == "depart":
        dispatch.departed_at = at
        dispatch.departed_by = user.user_id
        dispatch.dispatch_status = "en_route"
        audit(db, inc, "op_dispatch_departure", at, user, dispatch=dispatch, source="mobile_action")
        # A sole truck has an unambiguous departure; never stamp all trucks.
        if len(dispatch.dispatch_trucks) == 1 and dispatch.dispatch_trucks[0].departed_at is None:
            record_milestone(db, inc, "departure", at, user, dispatch.dispatch_trucks[0], source="mobile_action")
    return result(dispatch)


def result(dispatch):
    return {"dispatch_id": dispatch.dispatch_id, "dispatch_status": dispatch.dispatch_status,
            "acknowledged_at": iso(dispatch.acknowledged_at), "acknowledged_by": dispatch.acknowledged_by,
            "departed_at": iso(dispatch.departed_at), "departed_by": dispatch.departed_by,
            "timestamp_basis": "server_received_action"}
