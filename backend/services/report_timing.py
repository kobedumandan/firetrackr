"""Actual fire milestones confirmed in an after-action report, never filing time."""
from datetime import datetime, timezone

from fastapi import HTTPException

from models import IncidentEvent, IncidentReport
from services.operational_times import audit, incident_metrics, iso, record_milestone, valid_time
from services.timing_metrics import EXCLUDED
from services.incident_scope import effective_response_kind, validate_classification


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
        'effective_response_kind': effective_response_kind(inc),
        'suppression_started_at': iso(inc.suppression_started_at),
        'controlled_at': iso(control.occurred_at or control.created_at) if control else None,
        'controlled_at_verified': control is not None,
        'fire_out_at': iso(inc.fire_out_at),
        'suppression_seconds': incident_metrics(inc)['suppression']['seconds'],
    }


def record_report_timing(db, inc, user, report_id, *, response_kind=None,
                         suppression_started_at=None, controlled_at=None, fire_out_at=None):
    """The caller holds the incident lock; commit together with field information."""
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
    if response_kind:
        try:
            validate_classification(inc.fire_dispatch_type, response_kind)
        except ValueError as error:
            raise HTTPException(422, str(error)) from None
    if values and (effective_response_kind(inc) or response_kind) != 'fire':
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


def capture_consolidated_timing(db, inc, report, user, at, *, phase):
    """Keep each draft/review snapshot with the report revision it describes."""
    return audit(db, inc, 'op_report_timing', at, user, source='dispatcher_report',
                 metadata={'report_id': report.report_id, 'revision': report.revision,
                           'phase': phase, 'timeline': timeline(db, inc)})


def invalidate_consolidated_timing_review(db, inc):
    """An audited clock correction must be reviewed against a new report version."""
    reports = db.query(IncidentReport).filter_by(
        fire_id=inc.fire_id, report_kind='consolidated').with_for_update().all()
    for report in reports:
        report.revision = (report.revision or 1) + 1
        report.reviewed_at, report.reviewed_by_user_id = None, None
    if reports:
        inc.casualties_reviewed_at = None


def report_timeline(db, report):
    if report.report_kind == 'consolidated':
        # Drafts reflect new field evidence. Review freezes the exact timeline
        # for that revision; corrections invalidate review rather than rewrite it.
        if report.reviewed_at:
            reviewed = db.query(IncidentEvent).filter_by(
                fire_id=report.fire_id, event_type='op_report_timing'
            ).order_by(IncidentEvent.event_id.desc()).all()
            saved = next((event for event in reviewed
                          if (event.event_metadata or {}).get('report_id') == report.report_id
                          and event.event_metadata.get('revision') == report.revision
                          and event.event_metadata.get('phase') == 'reviewed'), None)
            if saved:
                return saved.event_metadata['timeline']
        return timeline(db, report.fire_incident)
    events = db.query(IncidentEvent).filter_by(fire_id=report.fire_id, event_type='op_report_timing').order_by(IncidentEvent.event_id).all()
    saved = next((e for e in events if (e.event_metadata or {}).get('report_id') == report.report_id), None)
    current = timeline(db, report.fire_incident)
    if not saved:
        return current
    return {**saved.event_metadata['timeline'], 'controlled_at': current['controlled_at'],
            'controlled_at_verified': current['controlled_at_verified']}
