"""Response team CRUD and team membership."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Personnel, ResponseTeam, ResponseTeamMember, Shift, Station, Truck, Users,
)
from schemas import TeamCreate, TeamMemberBody, TeamMemberRoleUpdate, TeamUpdate
from security import require_admin
from serializers import _team_dict


router = APIRouter(tags=["teams"])


@router.get("/api/teams")
def get_teams(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    rows = db.query(ResponseTeam).order_by(ResponseTeam.team_id).all()
    return [_team_dict(r) for r in rows]


@router.post("/api/teams", status_code=201)
def create_team(
    body: TeamCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
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
    team = db.get(ResponseTeam, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")
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
    team = db.get(ResponseTeam, team_id)
    if not team:
        raise HTTPException(status_code=404, detail="Team not found.")
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
        raise HTTPException(status_code=409, detail="Already a member of this team.")
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
    m = db.query(ResponseTeamMember).filter(
        ResponseTeamMember.team_id == team_id,
        ResponseTeamMember.per_id  == per_id,
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found.")
    if body.member_role   is not None: m.member_role   = body.member_role
    if body.member_status is not None: m.member_status = body.member_status
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
    m = db.query(ResponseTeamMember).filter(
        ResponseTeamMember.team_id == team_id,
        ResponseTeamMember.per_id  == per_id,
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Member not found.")
    db.delete(m)
    from services.personnel_deployment import sync_rosters
    sync_rosters(db, team_id, _auth)
    db.commit()
