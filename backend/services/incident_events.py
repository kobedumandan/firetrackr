"""History of an incident's status, alarm level and severity (incident_events).

Callers snapshot the tracked fields before mutating an incident, then call
record_changes() in the same transaction so the event commits (or rolls back)
together with the change it describes.
"""
from datetime import datetime, timezone

from models import FireIncident, IncidentEvent, Users

# Incident column -> event_type
TRACKED = {
    "fire_status":      "status",
    "fire_alarm_level": "alarm",
    "fire_severity":    "severity",
}


def snapshot(inc: FireIncident) -> dict:
    return {field: getattr(inc, field) for field in TRACKED}


def actor_name(user: Users | None) -> str | None:
    """Display name for whoever made the change; falls back to the email."""
    if user is None:
        return None
    name = ""
    if user.personnel:
        p = user.personnel
        name = f"{p.per_firstname or ''} {p.per_lastname or ''}".strip()
    elif user.admin:
        a = user.admin
        name = f"{a.admin_firstname or ''} {a.admin_lastname or ''}".strip()
    return name or user.user_email


def record_changes(db, inc: FireIncident, before: dict, user: Users | None = None, at: datetime | None = None) -> list[IncidentEvent]:
    """Append one event per tracked field that differs from `before`."""
    at = at or datetime.now(timezone.utc)
    actor = actor_name(user)
    events = []
    for field, event_type in TRACKED.items():
        old, new = before.get(field), getattr(inc, field)
        if old == new:
            continue
        ev = IncidentEvent(
            fire_id=inc.fire_id,
            event_type=event_type,
            event_from=old,
            event_to=new,
            user_id=user.user_id if user else None,
            event_actor=actor,
            created_at=at,
        )
        db.add(ev)
        events.append(ev)
    return events


def event_dict(ev: IncidentEvent) -> dict:
    return {
        "event_id": ev.event_id,
        "type":     ev.event_type,
        "from":     ev.event_from,
        "to":       ev.event_to,
        "actor":    ev.event_actor,
        "at":       ev.created_at.isoformat() if ev.created_at else None,
        "reason":   (ev.event_metadata or {}).get('reason'),
    }
