"""Provenance for imported BFP history, stored in the existing event audit table."""
from datetime import datetime

from models import IncidentEvent

IMPORT_EVENT = "bfp_import"


def attach_history(db, incidents):
    """One batch lookup; never join one-to-many events into incident counts."""
    by_id = {inc.fire_id: inc for inc in incidents}
    for inc in incidents:
        inc._historical_source = {}
    if by_id:
        for event in db.query(IncidentEvent).filter(
            IncidentEvent.fire_id.in_(by_id), IncidentEvent.event_type == IMPORT_EVENT,
        ).order_by(IncidentEvent.event_id):
            by_id[event.fire_id]._historical_source = event.event_metadata or {}
    return incidents


def history(inc):
    return getattr(inc, "_historical_source", {})


def demo_times(inc):
    """Only explicit imported demo records qualify. Real dispatches take precedence."""
    source = history(inc)
    if (source.get("timing_basis") != "synthetic_demo" or inc.dispatches
            or inc.report_received_at or inc.suppression_started_at or inc.fire_out_at):
        return None
    timeline = source.get("synthetic_timeline", {})
    try:
        times = [datetime.fromisoformat(timeline[k]) for k in (
            "report_received_at", "dispatch_at", "departed_at", "arrived_at",
            "suppression_started_at", "fire_out_at")]
        if any(t.tzinfo is None for t in times) or times != sorted(times):
            return None
    except (KeyError, ValueError, TypeError):
        return None
    receipt, dispatch, departure, arrival, suppression, fire_out = times
    return {"processing": (dispatch-receipt).total_seconds(),
            "preparation": (departure-dispatch).total_seconds(),
            "travel": (arrival-departure).total_seconds(),
            "suppression": (fire_out-suppression).total_seconds(),
            "cta": (arrival-receipt).total_seconds()}
