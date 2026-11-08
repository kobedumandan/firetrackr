"""Shared fire-only population for historical fire analytics."""
from sqlalchemy import and_, func, or_

from models import FireIncident

FIRE_OPERATION = 'Firefighting Operations'


def effective_response_kind(incident):
    operation = (incident.fire_dispatch_type or '').strip()
    if operation == FIRE_OPERATION:
        return 'fire'
    if operation == 'Emergency Medical Services (EMS)':
        return 'medical'
    if operation:
        return incident.response_kind if incident.response_kind in ('medical', 'rescue', 'other') else 'other'
    return incident.response_kind


def validate_classification(operation, response_kind):
    """Reject contradictory new declarations without rewriting legacy evidence."""
    operation = (operation or '').strip()
    if operation and response_kind:
        if (operation == FIRE_OPERATION) != (response_kind == 'fire'):
            raise ValueError('Operation type and response classification conflict. Correct the operation type or classification.')
        if operation == 'Emergency Medical Services (EMS)' and response_kind != 'medical':
            raise ValueError('EMS operations require a medical response classification.')


def is_fire_incident(incident):
    dispatch_type = (incident.fire_dispatch_type or '').strip()
    return dispatch_type == FIRE_OPERATION or (not dispatch_type and incident.response_kind == 'fire')


def fire_incident_filter():
    dispatch_type = func.trim(func.coalesce(FireIncident.fire_dispatch_type, ''))
    return or_(dispatch_type == FIRE_OPERATION,
               and_(dispatch_type == '', FireIncident.response_kind == 'fire'))
