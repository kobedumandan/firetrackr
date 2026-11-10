"""Shared source precedence for incident causes in metrics and register exports."""
from models import IncidentReport
from services.historical_incidents import history


def incident_causes(db, incidents):
    """Use imported source causes, then the latest nonempty report cause."""
    report_causes = {}
    if incidents:
        for fire_id, cause in db.query(IncidentReport.fire_id, IncidentReport.report_cause).filter(
            IncidentReport.fire_id.in_([i.fire_id for i in incidents]),
            IncidentReport.report_cause.isnot(None),
        ).order_by(IncidentReport.report_submitted_at, IncidentReport.report_id):
            if cause.strip():
                report_causes[fire_id] = cause.strip()
    return {i.fire_id: history(i).get('cause_clean') or report_causes.get(i.fire_id) or 'Not recorded'
            for i in incidents}
