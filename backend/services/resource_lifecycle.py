"""Retire resources without removing operational evidence or identity."""
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_

from models import DispatchRecord, DispatchTruck, FireIncident, Personnel, ResponseTeam, ResponseTeamMember, Station, Truck, Users
from services.resource_availability import ACTIVE, lock_membership_team, lock_personnel_assignments


RESOURCES = {'teams': (ResponseTeam, 'team_id'), 'trucks': (Truck, 'truck_id'),
             'personnel': (Personnel, 'per_id'), 'stations': (Station, 'station_id'),
             'incidents': (FireIncident, 'fire_id')}


def require_unarchived(row, label='Resource'):
    if row is None:
        raise HTTPException(404, f'{label} not found.')
    if row.archived_at is not None:
        raise HTTPException(409, f'{label} is archived. Restore it before changing or assigning it.')
    return row


def active_reference(db, model, resource_id, label='Resource'):
    # Shared row locks prevent a target being archived between validation and commit.
    from sqlalchemy import inspect
    key = inspect(model).primary_key[0]
    row = db.query(model).filter(key == resource_id).populate_existing().with_for_update(read=True).first()
    return require_unarchived(row, label)


def archive_resource(db, kind, resource_id, actor):
    model, key = RESOURCES[kind]
    if kind == 'teams':
        row = lock_membership_team(db, resource_id)
    else:
        # Crew writers use the same advisory lock, before truck reservations.
        if kind == 'personnel':
            lock_personnel_assignments(db, [resource_id])
        row = db.query(model).filter(getattr(model, key) == resource_id).populate_existing().with_for_update().first()
    if row is None:
        raise HTTPException(404, 'Resource not found.')
    if row.archived_at is not None:
        return row
    unfinished = or_(DispatchRecord.dispatch_status.in_(ACTIVE),
                     DispatchTruck.return_started_at.is_not(None) & DispatchTruck.ready_at.is_(None))
    query = db.query(DispatchRecord.dispatch_id).outerjoin(DispatchTruck)
    if kind == 'teams':
        query = query.filter(DispatchRecord.team_id == resource_id)
    elif kind == 'incidents':
        query = query.filter(DispatchRecord.fire_id == resource_id)
    elif kind == 'trucks':
        query = query.filter(DispatchTruck.truck_id == resource_id)
    elif kind == 'personnel':
        teams = db.query(ResponseTeamMember.team_id).filter(ResponseTeamMember.per_id == resource_id)
        query = query.filter(or_(DispatchRecord.team_id.in_(teams),
            DispatchTruck.manned_by_per_id == resource_id, DispatchTruck.return_driver_per_id == resource_id))
    else:
        # Close a station only after its operational resources have been moved or retired.
        for child, station_key in ((Personnel, 'station_id'), (Truck, 'station_id'),
                                   (ResponseTeam, 'station_id'), (Station, 'parent_station_id')):
            if db.query(child).filter(getattr(child, station_key) == resource_id, child.archived_at.is_(None)).first():
                raise HTTPException(409, 'Reassign or archive this station\'s personnel, trucks, teams and sub-stations first.')
        query = query.filter(DispatchTruck.return_station_id == resource_id)
    if query.filter(unfinished).first():
        raise HTTPException(409, 'Complete the active response and truck return/readiness before archiving this resource.')
    if kind == 'incidents' and row.fire_status not in ('closed', 'cancelled', 'canceled', 'recalled') and not row.operation_completed_at:
        raise HTTPException(409, 'Complete or cancel this incident before archiving it. Archiving preserves its historical analysis.')
    now = datetime.now(timezone.utc)
    row.archived_at = now
    row.archived_by = actor.user_id if actor else None
    if kind == 'incidents':
        from services.operational_times import audit
        audit(db, row, 'op_archived', now, actor, source='admin_archive',
              metadata={'analytics_preserved': True})
    if kind == 'personnel' and row.user:
        disable_account(db, row.user, actor, at=now)
    if kind == 'stations':
        import state
        state.invalidate_coverage()
    return row


def disable_account(db, account, actor, *, at=None):
    if actor and account.user_id == actor.user_id:
        raise HTTPException(409, 'You cannot disable your own account.')
    if account.user_role == 'admin':
        raise HTTPException(403, 'Administrator accounts cannot be disabled.')
    if account.personnel:
        per_id = account.personnel.per_id
        lock_personnel_assignments(db, [per_id])
        team_ids = db.query(ResponseTeamMember.team_id).filter(ResponseTeamMember.per_id == per_id)
        if db.query(DispatchRecord).outerjoin(DispatchTruck).filter(
            or_(DispatchRecord.team_id.in_(team_ids), DispatchTruck.manned_by_per_id == per_id,
                DispatchTruck.return_driver_per_id == per_id),
            or_(DispatchRecord.dispatch_status.in_(ACTIVE),
                DispatchTruck.return_started_at.is_not(None) & DispatchTruck.ready_at.is_(None)),
        ).first():
            raise HTTPException(409, 'Complete this responder\'s response and return/readiness before disabling their account.')
    account.disabled_at = at or datetime.now(timezone.utc)
    account.disabled_by = actor.user_id if actor else None
    # A token issued before disabling must stay unusable after re-enabling.
    account.sessions_revoked_at = account.disabled_at


def archive_dict(row):
    return {'archived_at': row.archived_at.isoformat() if row.archived_at else None,
            'archived_by': row.archived_by}
