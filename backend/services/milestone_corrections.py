"""Administrator timestamp corrections; original audit events remain immutable."""
from datetime import datetime, timezone

from fastapi import HTTPException

from models import IncidentEvent
from services.operational_times import EXCLUDED, audit, iso, unit_arrival, valid_time
from services.incident_scope import effective_response_kind

FIELDS = {
    'receipt': 'report_received_at', 'departure': 'departed_at', 'arrival': 'arrived_at',
    'suppression_start': 'suppression_started_at', 'fire_out': 'fire_out_at',
    'operation_complete': 'operation_completed_at', 'clearance': 'cleared_at',
}


def _between(at, lower=(), upper=(), message='The corrected time conflicts with the recorded timeline.'):
    if any(value and at < value for value in lower) or any(value and at > value for value in upper):
        raise HTTPException(422, message)


def correct_milestone(db, inc, kind, at, previous_at, user, *, unit=None, dispatch=None, key=None):
    """Caller holds the incident lock; compare the loaded value before appending a correction."""
    if user.user_role != 'admin':
        raise HTTPException(403, 'Only administrators may correct operational timestamps.')
    at = valid_time(at)
    if previous_at.tzinfo is None:
        raise HTTPException(422, 'Include a timezone in the previously recorded timestamp.')
    previous_at = previous_at.astimezone(timezone.utc)
    signature = {'kind': kind, 'at': iso(at), 'previous_at': iso(previous_at),
                 'unit_id': unit.dispatch_truck_id if unit else None,
                 'dispatch_id': dispatch.dispatch_id if dispatch else None}
    if key:
        prior = db.query(IncidentEvent).filter_by(idempotency_key=key).first()
        if prior:
            if prior.fire_id != inc.fire_id or (prior.event_metadata or {}).get('submission') != signature:
                raise HTTPException(409, 'This submission key was already used for a different correction.')
            return prior
    if inc.fire_status in EXCLUDED:
        raise HTTPException(422, 'Cancelled or recalled responses do not accept timing corrections.')
    vehicle = kind in ('departure', 'arrival')
    if vehicle != (unit is not None) or (kind == 'clearance') != (dispatch is not None):
        raise HTTPException(422, 'Choose the matching truck or dispatch for this milestone.')
    owner = unit.dispatch_record if unit else dispatch
    if owner and owner.fire_id != inc.fire_id:
        raise HTTPException(404, 'Assignment not found for this incident.')
    if owner and owner.dispatch_status in EXCLUDED:
        raise HTTPException(422, 'This assignment is not an eligible response.')
    events = db.query(IncidentEvent).filter_by(fire_id=inc.fire_id).order_by(IncidentEvent.event_id).all()
    target = unit if vehicle else dispatch if kind == 'clearance' else inc
    field = FIELDS.get(kind)
    if kind == 'classification':
        event = next((event for event in reversed(events) if event.event_type == 'op_classification' and event.verified), None)
        existing = (event.occurred_at or event.created_at) if event else None
        if not inc.response_kind:
            raise HTTPException(422, 'Confirm the response classification first.')
    elif field:
        existing = unit_arrival(unit) if kind == 'arrival' else getattr(target, field)
    else:
        raise HTTPException(422, 'Unknown operational milestone.')
    if existing is None or existing != previous_at:
        raise HTTPException(409, 'The recorded time has changed. Refresh the incident before saving your correction.')
    if at == existing:
        return None

    eligible = [item for item in inc.dispatches if item.dispatch_status not in EXCLUDED and item.dispatch_at]
    from services.report_timing import timeline
    controlled_value = timeline(db, inc, events)['controlled_at']
    controlled = datetime.fromisoformat(controlled_value) if controlled_value else None
    # A dispatch arrival that mirrors this truck must move with the correction,
    # otherwise the old aggregate would continue to win first-arrival calculations.
    mirrored_arrival = None
    if kind == 'arrival' and owner.dispatch_arrived_at == existing:
        mirrored_arrival = min([at, *(other.arrived_at for other in owner.dispatch_trucks
                                      if other is not unit and other.arrived_at)])
    arrivals = []
    for item in eligible:
        for other in item.dispatch_trucks:
            value = at if kind == 'arrival' and other is unit else unit_arrival(other)
            if value:
                arrivals.append(value)
        value = mirrored_arrival if item is owner and mirrored_arrival else item.dispatch_arrived_at
        if value and value >= item.dispatch_at:
            arrivals.append(value)
    first_arrival = min(arrivals, default=None)
    if kind == 'receipt':
        _between(at, upper=[*(item.dispatch_at for item in eligible), inc.suppression_started_at,
                            controlled, inc.fire_out_at, inc.operation_completed_at,
                            *(item.cleared_at for item in eligible)],
                 message='Report receipt must precede dispatch and the recorded operation milestones.')
    elif vehicle:
        _between(at, lower=[owner.dispatch_at, unit.truck_assigned_at, inc.report_received_at],
                 upper=[owner.dispatch_completed_at, owner.cleared_at, inc.operation_completed_at],
                 message='Truck timing must fall between its dispatch/assignment and completion or clearance.')
        if owner.dispatch_at is None:
            raise HTTPException(422, 'Record the dispatch time before correcting truck timing.')
        if kind == 'departure':
            _between(at, upper=[unit_arrival(unit)], message='Departure must precede arrival.')
        else:
            _between(at, lower=[unit.departed_at], message='Arrival must follow departure.')
            fire_times = [value for value in (inc.suppression_started_at, controlled, inc.fire_out_at) if value]
            if first_arrival and fire_times and first_arrival > min(fire_times):
                raise HTTPException(422, 'The first arrival must precede recorded fire milestones.')
    elif kind in ('suppression_start', 'fire_out'):
        if effective_response_kind(inc) != 'fire':
            raise HTTPException(422, 'Suppression timing requires a verified fire response.')
        _between(at, lower=[inc.report_received_at, min((item.dispatch_at for item in eligible), default=None), first_arrival],
                 upper=[inc.operation_completed_at])
        if kind == 'suppression_start':
            _between(at, upper=[controlled, inc.fire_out_at], message='Suppression must precede containment and fire out.')
        else:
            _between(at, lower=[inc.suppression_started_at, controlled], message='Fire out must follow suppression and containment.')
    elif kind == 'clearance':
        _between(at, lower=[owner.dispatch_at, owner.departed_at, owner.dispatch_arrived_at, owner.release_authorized_at,
                            *(other.departed_at for other in owner.dispatch_trucks),
                            *(unit_arrival(other) for other in owner.dispatch_trucks)],
                 upper=[inc.operation_completed_at, *(other.returned_at for other in owner.dispatch_trucks),
                        *(other.ready_at for other in owner.dispatch_trucks)],
                 message='Clearance must follow the dispatch and truck activity, and precede operation completion.')
    elif kind == 'operation_complete':
        if not eligible or any(item.cleared_at is None for item in eligible):
            raise HTTPException(422, 'Record clearance for every responding dispatch first.')
        if effective_response_kind(inc) == 'fire' and inc.fire_out_at is None:
            raise HTTPException(422, 'Record fire out before completing a fire operation.')
        _between(at, lower=[inc.report_received_at, inc.fire_out_at, *(item.cleared_at for item in eligible)],
                 message='Operation completion must follow receipt, fire out and every dispatch clearance.')

    correction = {'kind': kind, 'previous_at': iso(existing), 'occurred_at': iso(at)}
    if field:
        setattr(target, field, at)
    if kind == 'clearance':
        if owner.dispatch_completed_at == existing:
            owner.dispatch_completed_at = at
        for released in owner.dispatch_trucks:
            if released.return_started_at == existing:
                released.return_started_at = at
    if mirrored_arrival:
        owner.dispatch_arrived_at = mirrored_arrival
        correction['dispatch_arrived_at'] = iso(mirrored_arrival)
    from services.report_timing import invalidate_consolidated_timing_review
    invalidate_consolidated_timing_review(db, inc)
    return audit(db, inc, f'op_{kind}', at, user, unit=unit, dispatch=dispatch,
                 source='manual_correction', key=key,
                 metadata={'submission': signature, 'correction': correction})
