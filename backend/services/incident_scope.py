"""Shared fire-only population for historical fire analytics."""
from sqlalchemy import and_, func, or_

from models import FireIncident

FIRE_OPERATION = 'Firefighting Operations'


def is_fire_incident(incident):
    dispatch_type = (incident.fire_dispatch_type or '').strip()
    return dispatch_type == FIRE_OPERATION or (not dispatch_type and incident.response_kind == 'fire')


def fire_incident_filter():
    dispatch_type = func.trim(func.coalesce(FireIncident.fire_dispatch_type, ''))
    return or_(dispatch_type == FIRE_OPERATION,
               and_(dispatch_type == '', FireIncident.response_kind == 'fire'))
