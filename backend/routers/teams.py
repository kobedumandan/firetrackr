"""Response team CRUD and team membership."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload

from database import get_db
from models import (
    DispatchRecord, DispatchTruck, Personnel, ResponseTeam, ResponseTeamMember, Shift, Station, Truck, Users,
)
from schemas import TeamCreate, TeamMemberBody, TeamMemberRoleUpdate, TeamUpdate
from security import require_admin
from serializers import _team_dict
from services.resource_availability import (
    lock_membership_team, lock_personnel_assignments, personnel_assignment_reason, return_assignment_locks,
    pending_return_context,
)


router = APIRouter(tags=["teams"])


@router.get("/api/teams")
def get_teams(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    # Load everything the serializer reads without one query per team/member.
    rows = (
        db.query(ResponseTeam)
        .options(
            joinedload(ResponseTeam.station),
            joinedload(ResponseTeam.shift),
            joinedload(ResponseTeam.truck),
            selectinload(ResponseTeam.members)
            .joinedload(ResponseTeamMember.personnel)
            .joinedload(Personnel.shift),
            selectinload(ResponseTeam.dispatches),
        )
        .order_by(ResponseTeam.team_id)
        .all()
    )
    context = pending_return_context(db, team_ids=[team.team_id for team in rows],
        per_ids=[member.per_id for team in rows for member in team.members])
    return_locks = {per_id: row['assignment_reason'] for per_id, row in context['drivers'].items()}
    return [_team_dict(r, return_locks=return_locks, return_context=context) for r in rows]


@router.post("/api/teams", status_code=201)
def create_team(
    body: TeamCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    if body.team_status in ('dispatched', 'on_scene', 'returning'):
        raise HTTPException(422, 'Create a standby or inactive team; dispatch actions establish response states.')
    if body.station_id and not db.get(Station, body.station_id):
        raise HTTPException(status_code=404, detail="Station not found.")
    if body.shift_id is not None and not db.get(Shift, body.shift_id):
        raise HTTPException(status_code=404, detail="Shift not found.")
    if body.truck_id is not None and not db.get(Truck, body.truck_id):
        raise HTTPException(status_code=404, detail="Truck not found.")
    team = ResponseTeam(
        team_name=body.team_name,
        team_code=body.team_code,
        team_status=body.team_status,
        station_id=body.station_id,
        shift_id=body.shift_id,
        truck_id=body.truck_id,
    )
    db.add(team)
    db.commit()
    db.refresh(team)
    return _team_dict(team)


@router.patch("/api/teams/{team_id}")
def update_team(
    team_id: int,
    body: TeamUpdate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    # Dispatch creation also locks this team before reserving its truck. Keep the
    # active-dispatch check and any truck edit in that same serialized order.
    team = db.query(ResponseTeam).filter_by(team_id=team_id).populate_existing().with_for_update().first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")
    active_or_returning = db.query(DispatchRecord.dispatch_id).outerjoin(DispatchTruck).filter(
        DispatchRecord.team_id == team_id,
        (DispatchRecord.dispatch_status.in_(('dispatched', 'en_route', 'on_scene')) |
         (DispatchTruck.return_started_at.is_not(None) & DispatchTruck.ready_at.is_(None))),
    ).first()
    if active_or_returning and any(
        field in body.model_fields_set and getattr(body, field) != getattr(team, field)
        for field in ('team_status', 'truck_id', 'station_id')
    ):
        raise HTTPException(409, 'Use response clearance and truck return/readiness before changing this team assignment or availability.')
    if body.team_status is not None and body.team_status != team.team_status and body.team_status in ('dispatched', 'on_scene', 'returning'):
        raise HTTPException(409, 'Response team states are recorded by dispatch and clearance actions.')
    if "truck_id" in body.model_fields_set and body.truck_id != team.truck_id:
        active = db.query(DispatchRecord.dispatch_id).filter(
            DispatchRecord.team_id == team_id,
            DispatchRecord.dispatch_status.in_(("dispatched", "en_route", "on_scene")),
        ).first()
        if active:
            raise HTTPException(status_code=409, detail="Cannot change a team's truck during an active dispatch.")
    if body.team_name   is not None: team.team_name   = body.team_name
    if body.team_code   is not None: team.team_code   = body.team_code
    if body.team_status is not None and body.team_status != team.team_status:
        team.team_status = body.team_status
        # Cascade to all team members so member_status mirrors the team's
        # current state (used by auto-dispatch eligibility checks).
        for m in team.members or []:
            m.member_status = body.team_status
    if "station_id" in body.model_fields_set:
        if body.station_id is not None and not db.get(Station, body.station_id):
            raise HTTPException(status_code=404, detail="Station not found.")
        team.station_id = body.station_id
    if "shift_id" in body.model_fields_set:
        if body.shift_id != team.shift_id:
            if team.members:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot change a team's shift while it has members. Remove all members first.",
                )
            if body.shift_id is not None and not db.get(Shift, body.shift_id):
                raise HTTPException(status_code=404, detail="Shift not found.")
        team.shift_id = body.shift_id
    if "truck_id" in body.model_fields_set:
        if body.truck_id is not None and not db.get(Truck, body.truck_id):
            raise HTTPException(status_code=404, detail="Truck not found.")
        team.truck_id = body.truck_id
    db.commit()
    db.refresh(team)
    return _team_dict(team)


@router.delete("/api/teams/{team_id}", status_code=204)
def delete_team(
    team_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    team = db.get(ResponseTeam, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")
    # Dispatch records keep the incident history intact, so a team that has
    # ever been sent can't be removed; retiring it is the way out.
    if team.dispatches:
        raise HTTPException(
            status_code=409,
            detail="This team has dispatch history, so it can't be deleted. Set its status to inactive instead.",
        )
    # Memberships have a NOT NULL team_id, so they go first; the personnel stay.
    for m in list(team.members):
        db.delete(m)
    db.delete(team)
    db.commit()


@router.post("/api/teams/{team_id}/members", status_code=201)
def add_team_member(
    team_id: int,
    body: TeamMemberBody,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    team = lock_membership_team(db, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")
    lock_personnel_assignments(db, [body.per_id])
    person = db.get(Personnel, body.per_id)
    if not person:
        raise HTTPException(status_code=404, detail="Personnel not found.")
    if team.shift_id is not None and person.shift_id != team.shift_id:
        raise HTTPException(
            status_code=400,
            detail="Personnel shift does not match the team's shift.",
        )
    existing = db.query(ResponseTeamMember).filter(
        ResponseTeamMember.team_id == team_id,
        ResponseTeamMember.per_id  == body.per_id,
    ).first()
    if existing:
        same_role = body.member_role is None or _member_value(body.member_role) == _member_value(existing.member_role)
        same_status = body.member_status is None or _member_value(body.member_status) == _member_value(existing.member_status)
        if same_role and same_status:
            return {"members_id": existing.members_id, "team_id": existing.team_id,
                    "per_id": existing.per_id, "member_role": existing.member_role}
        raise HTTPException(status_code=409, detail="Already a member of this team.")
    reason = personnel_assignment_reason(db, body.per_id, exclude_team_id=team_id)
    if reason:
        raise HTTPException(409, reason)
    m = ResponseTeamMember(
        team_id=team_id,
        per_id=body.per_id,
        member_role=body.member_role,
        member_status=body.member_status or "standby",
    )
    db.add(m)
    from services.personnel_deployment import sync_rosters
    sync_rosters(db, team_id, _auth)
    db.commit()
    db.refresh(m)
    return {"members_id": m.members_id, "team_id": m.team_id, "per_id": m.per_id, "member_role": m.member_role}


@router.patch("/api/teams/{team_id}/members/{per_id}", status_code=200)
def update_team_member(
    team_id: int,
    per_id: int,
    body: TeamMemberRoleUpdate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    lock_membership_team(db, team_id)
    lock_personnel_assignments(db, [per_id])
    m = db.query(ResponseTeamMember).filter(
        ResponseTeamMember.team_id == team_id,
        ResponseTeamMember.per_id  == per_id,
    ).populate_existing().first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found.")
    changed = any(getattr(body, field) is not None and
                  _member_value(getattr(body, field)) != _member_value(getattr(m, field))
                  for field in ('member_role', 'member_status'))
    reason = return_assignment_locks(db, [per_id]).get(per_id) if changed else None
    if reason:
        raise HTTPException(409, reason)
    for field in ('member_role', 'member_status'):
        value = getattr(body, field)
        if value is not None and _member_value(value) != _member_value(getattr(m, field)):
            setattr(m, field, value)
    from services.personnel_deployment import sync_rosters
    sync_rosters(db, team_id, _auth)
    db.commit()
    return {"members_id": m.members_id, "team_id": m.team_id, "per_id": m.per_id, "member_role": m.member_role}


@router.delete("/api/teams/{team_id}/members/{per_id}", status_code=204)
def remove_team_member(
    team_id: int,
    per_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    lock_membership_team(db, team_id)
    lock_personnel_assignments(db, [per_id])
    m = db.query(ResponseTeamMember).filter(
        ResponseTeamMember.team_id == team_id,
        ResponseTeamMember.per_id  == per_id,
    ).populate_existing().first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found.")
    reason = return_assignment_locks(db, [per_id]).get(per_id)
    if reason:
        raise HTTPException(409, reason)
    db.delete(m)
    from services.personnel_deployment import sync_rosters
    sync_rosters(db, team_id, _auth)
    db.commit()


def _member_value(value):
    return (value or '').strip().lower().replace('_', ' ')
