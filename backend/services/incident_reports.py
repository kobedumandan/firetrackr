"""Administrator report recovery and correction, preserving field attribution."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func

from models import DispatchRecord, FireIncident, IncidentEvent, IncidentReport
from services.dispatch import _add_incident_to_heatmap, _complete_dispatch_and_release, _released_payload
from services.incident_events import record_changes, snapshot
from services.operational_times import audit, iso
from services.report_timing import timeline


REPORT_FIELDS = {
    'cause': 'report_cause',
    'casualties': 'report_casualties',
    'damage_estimate': 'report_damage_estimate',
    'narrative': 'report_narrative',
    'recommendations': 'report_recommendations',
}


def report_closed_at(db, report):
    """A late recovery report must not move the incident's original closure."""
    closed = (db.query(IncidentEvent)
              .filter_by(fire_id=report.fire_id, event_type='status', event_to='closed')
              .order_by(func.coalesce(IncidentEvent.occurred_at, IncidentEvent.created_at), IncidentEvent.event_id)
              .first())
    if closed:
        return iso(closed.occurred_at or closed.created_at)
    # Legacy team-leader submission itself closed the incident. Administrator
    # recovery can happen later, so its submission cannot establish this clock.
    return iso(report.report_submitted_at) if report.per_id is not None else None


def save_admin_report(db, fire_id, body, user):
    """Lock and save within the caller's transaction; never rewrite event times."""
    if user.user_role != 'admin':
        raise HTTPException(403, 'Admin access required')
    inc = db.query(FireIncident).filter_by(fire_id=fire_id).populate_existing().with_for_update().first()
    if not inc:
        raise HTTPException(404, 'Incident not found.')
    if inc.fire_status not in ('contained', 'closed'):
        raise HTTPException(409, 'The incident must be contained or closed before filing an after-action report.')
    report = (db.query(IncidentReport).filter_by(fire_id=fire_id)
              .order_by(IncidentReport.report_submitted_at.desc(), IncidentReport.report_id.desc())
              .populate_existing().with_for_update().first())
    if (report is None) != (body.report_id is None) or (report and report.report_id != body.report_id):
        raise HTTPException(409, 'The report has changed. Reload the incident before saving your changes.')

    now = datetime.now(timezone.utc)
    creating = report is None
    if creating:
        report = IncidentReport(fire_id=fire_id, per_id=None, author_user_id=user.user_id,
                                report_submitted_at=now)
        db.add(report)
    before = {key: getattr(report, column) for key, column in REPORT_FIELDS.items()}
    outcome_before = {'casualties': inc.fire_casualties, 'remarks': inc.fire_remarks}
    values = body.model_dump(exclude_unset=True)
    for key, column in REPORT_FIELDS.items():
        if key in values:
            setattr(report, column, values[key])
    if 'casualties' in values:
        inc.fire_casualties = body.casualties
    if 'remarks' in values:
        inc.fire_remarks = body.remarks
    db.flush()
    after = {key: getattr(report, column) for key, column in REPORT_FIELDS.items()}
    audit(db, inc, 'report_created' if creating else 'report_edited', now, user,
          source='admin_report', metadata={
              'report_id': report.report_id,
              'changes': {key: {'before': before[key], 'after': value}
                          for key, value in after.items() if before[key] != value},
              'outcome_changes': {key: {'before': outcome_before[key], 'after': value}
                                  for key, value in {'casualties': inc.fire_casualties, 'remarks': inc.fire_remarks}.items()
                                  if outcome_before[key] != value},
          })
    if creating:
        # Capture known evidence only. Filing does not establish operational times.
        audit(db, inc, 'op_report_timing', now, user, source='admin_report',
              metadata={'report_id': report.report_id, 'timeline': timeline(db, inc)})

    released = None
    if inc.fire_status == 'contained':
        incident_before = snapshot(inc)
        inc.fire_status = 'closed'
        record_changes(db, inc, incident_before, user=user, at=now)
        active = db.query(DispatchRecord).filter(
            DispatchRecord.fire_id == fire_id,
            DispatchRecord.dispatch_status.in_(('dispatched', 'en_route', 'on_scene')),
        ).all()
        for dispatch in active:
            _complete_dispatch_and_release(dispatch, now)
        _add_incident_to_heatmap(db, inc, now)
        released = _released_payload(active) if active else None
    return report, inc, released, creating
