"""Administrator archive browsing, restoration and account access controls."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import Users
from security import require_admin
from services.resource_lifecycle import RESOURCES, archive_dict, disable_account

router = APIRouter(tags=['archive'])


@router.get('/api/archive/{kind}')
def archived_resources(kind: str, db: Session = Depends(get_db), actor=Depends(require_admin)):
    if kind == 'obstructions':
        from models import RoadObstruction
        from routers.obstructions import _serialise
        rows = db.query(RoadObstruction).order_by(RoadObstruction.created_at.desc()).all()
        user_ids = {user_id for row in rows for user_id in (row.created_by, row.resolved_by) if user_id is not None}
        users = {user.user_id: user for user in db.query(Users).filter(Users.user_id.in_(user_ids)).options(
            selectinload(Users.admin), selectinload(Users.personnel)).all()} if user_ids else {}
        result = []
        for row in rows:
            creator = users.get(row.created_by)
            resolver = users.get(row.resolved_by)
            result.append({**_serialise(row),
                           'created_by_name': account_dict(creator)['name'] if creator else None,
                           'created_by_role': creator.user_role if creator else None,
                           'resolved_by_name': account_dict(resolver)['name'] if resolver else None,
                           'resolved_by_role': resolver.user_role if resolver else None})
        return result
    if kind not in RESOURCES:
        raise HTTPException(404, 'Unknown resource type.')
    model, key = RESOURCES[kind]
    rows = db.query(model).filter(model.archived_at.is_not(None)).order_by(model.archived_at.desc()).all()
    return [{'id': getattr(row, key), 'name': (
        f'{row.per_firstname or ""} {row.per_lastname or ""}'.strip() if kind == 'personnel' else
        f'INC-{row.fire_id}: {row.fire_location_name or row.fire_address or "Incident"}' if kind == 'incidents' else
        getattr(row, {'teams': 'team_name', 'trucks': 'truck_platenum', 'stations': 'station_name'}[kind])),
        **({'station_type': row.station_type} if kind == 'stations' else {}),
        **archive_dict(row)} for row in rows]


@router.post('/api/archive/{kind}/{resource_id}/restore')
def restore_resource(kind: str, resource_id: int, db: Session = Depends(get_db), actor=Depends(require_admin)):
    if kind not in RESOURCES:
        raise HTTPException(404, 'Unknown resource type.')
    model, key = RESOURCES[kind]
    if kind == 'personnel':
        from services.resource_availability import lock_personnel_assignments
        lock_personnel_assignments(db, [resource_id])
    row = db.query(model).filter(getattr(model, key) == resource_id).with_for_update().first()
    if row is None:
        raise HTTPException(404, 'Resource not found.')
    if row.archived_at is not None:
        if kind == 'personnel':
            from models import DispatchRecord, ResponseTeamMember
            from services.resource_availability import ACTIVE
            if db.query(DispatchRecord).join(ResponseTeamMember, ResponseTeamMember.team_id == DispatchRecord.team_id).filter(
                ResponseTeamMember.per_id == resource_id, DispatchRecord.dispatch_status.in_(ACTIVE),
            ).first():
                raise HTTPException(409, 'Wait until this personnel\'s former team finishes its active response before restoring membership.')
        station = getattr(row, 'station', None)
        parent = getattr(row, 'parent', None)
        if any(link and link.archived_at for link in (station, parent)):
            raise HTTPException(409, 'Restore the parent/home station first.')
        row.archived_at = None
        row.archived_by = None
        # Account access is a separate decision. Restoration does not re-enable it.
        if kind == 'stations':
            import state
            state.invalidate_coverage()
        if kind == 'incidents':
            from datetime import datetime, timezone
            from services.operational_times import audit
            audit(db, row, 'op_restored', datetime.now(timezone.utc), actor, source='admin_archive')
        db.commit()
    return {'id': resource_id, **archive_dict(row)}


def account_dict(user):
    person = user.personnel
    admin = user.admin
    name = (f'{person.per_firstname or ""} {person.per_lastname or ""}' if person else
            f'{admin.admin_firstname or ""} {admin.admin_lastname or ""}' if admin else user.user_email)
    return {'user_id': user.user_id, 'name': name.strip(), 'email': user.user_email, 'role': user.user_role,
            'disabled_at': user.disabled_at.isoformat() if user.disabled_at else None,
            'personnel_archived': bool(person and person.archived_at)}


class AccountAccess(BaseModel):
    enabled: bool


@router.get('/api/accounts')
def accounts(db: Session = Depends(get_db), actor=Depends(require_admin)):
    return [account_dict(user) for user in db.query(Users).filter(Users.user_role != 'admin').options(
        selectinload(Users.personnel), selectinload(Users.admin)).order_by(Users.user_id).all()]


@router.patch('/api/accounts/{user_id}/access')
def account_access(user_id: int, body: AccountAccess, db: Session = Depends(get_db), actor=Depends(require_admin)):
    # Serialize administrative access decisions, including simultaneous disables.
    from sqlalchemy import text
    db.execute(text('SELECT pg_advisory_xact_lock(1179927635, 0)'))
    from security import ensure_account_enabled
    db.refresh(actor)
    ensure_account_enabled(actor)
    user = db.get(Users, user_id)
    if user and user.personnel:
        from services.resource_availability import lock_personnel_assignments
        lock_personnel_assignments(db, [user.personnel.per_id])
    user = db.query(Users).filter_by(user_id=user_id).populate_existing().with_for_update().first()
    if user is None:
        raise HTTPException(404, 'Account not found.')
    if body.enabled:
        if user.personnel and user.personnel.archived_at:
            raise HTTPException(409, 'Restore this personnel record before enabling the account.')
        user.disabled_at = None
        user.disabled_by = None
    else:
        disable_account(db, user, actor)
    db.commit()
    return account_dict(user)
