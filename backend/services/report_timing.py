"""Actual fire milestones confirmed in an after-action report, never filing time."""
from datetime import datetime, timezone

from fastapi import HTTPException

from models import IncidentEvent
from services.operational_times import audit, incident_metrics, iso, record_milestone, valid_time
from services.timing_metrics import EXCLUDED


def timeline(db, inc, events=None):
    if events is None:
        events = db.query(IncidentEvent).filter(
            IncidentEvent.fire_id == inc.fire_id,
            IncidentEvent.event_type.in_(['op_fire_control', 'status']),
        ).order_by(IncidentEvent.event_id).all()
    # The containment action owns this clock. Retain an older verified milestone
    # only when a legacy incident has no saved containment status event.
    control = next((e for e in events if e.event_type == 'status' and e.event_to == 'contained'), None)
    control = control or next((e for e in events if e.event_type == 'op_fire_control'), None)
    return {
        'response_kind': inc.response_kind,
        'suppression_started_at': iso(inc.suppression_started_at),
        'controlled_at': iso(control.occurred_at or control.created_at) if control else None,
        'controlled_at_verified': control is not None,
        'fire_out_at': iso(inc.fire_out_at),
        'suppression_seconds': incident_metrics(inc)['suppression']['seconds'],
    }


def record_report_timing(db, inc, user, report_id, *, response_kind=None,
                         suppression_started_at=None, controlled_at=None, fire_out_at=None):
    """The caller holds the incident lock; commit together with report and closure."""
    recorded = timeline(db, inc)
    control = datetime.fromisoformat(recorded['controlled_at']) if recorded['controlled_at'] else None
    values = {key: valid_time(at) for key, at in {
        'suppression_started_at': suppression_started_at,
        'controlled_at': controlled_at,
        'fire_out_at': fire_out_at,
    }.items() if at is not None}
    if controlled_at is not None and values['controlled_at'] != control:
        raise HTTPException(409, 'Containment time is recorded when the incident is marked contained and cannot be changed in a report.')
    if response_kind and inc.response_kind and response_kind != inc.response_kind:
        raise HTTPException(409, 'Response classification is already verified.')
    if values and (response_kind or inc.response_kind) != 'fire':
        raise HTTPException(422, 'Confirm a fire response before recording fire-operation times.')
    if values and inc.operation_completed_at is not None:
        # Existing verified fields may be included unchanged by a prefilled form.
        old = {'suppression_started_at': inc.suppression_started_at, 'fire_out_at': inc.fire_out_at,
               'controlled_at': control}
        if any(old[key] != at for key, at in values.items()):
            raise HTTPException(409, 'This operation is complete; preserve its verified timeline.')
    metadata = {'report_id': report_id}
    if response_kind and not inc.response_kind:
        record_milestone(db, inc, 'classification', next(iter(values.values()), datetime.now(timezone.utc)), user,
                         response_kind=response_kind, source='incident_report', metadata=metadata)
    if values:
        start = values.get('suppression_started_at', inc.suppression_started_at)
        out = values.get('fire_out_at', inc.fire_out_at)
        dispatches = [d for d in inc.dispatches if d.dispatch_status not in EXCLUDED and d.dispatch_at]
        from services.operational_times import unit_arrival
        arrivals = [unit_arrival(u) for d in dispatches for u in d.dispatch_trucks if unit_arrival(u)]
        arrivals += [d.dispatch_arrived_at for d in dispatches if d.dispatch_arrived_at and d.dispatch_arrived_at >= d.dispatch_at]
        lower = [v for v in [inc.report_received_at, min((d.dispatch_at for d in dispatches), default=None), min(arrivals, default=None)] if v]
        if lower and any(at < max(lower) for at in values.values()):
            raise HTTPException(422, 'Fire-operation times cannot precede receipt, first dispatch or first unit arrival.')
        ordered = [at for at in (start, control, out) if at is not None]
        if ordered != sorted(ordered):
            raise HTTPException(422, 'Use chronological times: suppression start, fire under control, then fire out.')
        if out is not None and start is None:
            raise HTTPException(422, 'Record suppression start before fire out, or leave unknown times blank.')
        for field, kind in [('suppression_started_at', 'suppression_start'), ('fire_out_at', 'fire_out')]:
            if field in values:
                # Unchanged prefilled fields do not create another audit event.
                if getattr(inc, field) == values[field]:
                    continue
                record_milestone(db, inc, kind, values[field], user, source='incident_report', metadata=metadata)
    db.flush()
    result = timeline(db, inc)
    # Keep the submitted timeline with the report even if later evidence is added.
    audit(db, inc, 'op_report_timing', datetime.now(timezone.utc), user, source='incident_report',
          metadata={**metadata, 'timeline': result})
    return result


def report_timeline(db, report):
    events = db.query(IncidentEvent).filter_by(fire_id=report.fire_id, event_type='op_report_timing').order_by(IncidentEvent.event_id).all()
    saved = next((e for e in events if (e.event_metadata or {}).get('report_id') == report.report_id), None)
    current = timeline(db, report.fire_incident)
    if not saved:
        return current
    return {**saved.event_metadata['timeline'], 'controlled_at': current['controlled_at'],
            'controlled_at_verified': current['controlled_at_verified']}
