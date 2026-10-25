"""Personnel roster CRUD and their live map positions."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from config import STALE_MINUTES
from database import get_db
from models import (
    CurrentLocation, Device, DispatchRecord, DispatchTruck, LocationLog,
    Personnel, ResponseTeamMember, Shift, Station, Users,
)
from schemas import PersonnelCreate, PersonnelUpdate
from security import _hash_password, require_admin
from serializers import _manned_truck_dict
from services.personnel_navigation import navigation_for
from services.personnel_arrival import arrival_for, personnel_status
from services.tracking_policy import duty, policy as tracking_policy


router = APIRouter(tags=["personnel"])


@router.get("/api/personnel")
def get_personnel(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    rows = db.query(Personnel).all()

    # Map each team with an active dispatch to its incident reference, so a
    # dispatched/on-scene member can show which incident they're assigned to.
    # Ordered newest-first; first write per team_id wins (the latest dispatch).
    team_incident = {}
    active_dispatches = (
        db.query(DispatchRecord)
        .filter(DispatchRecord.dispatch_status.in_(["dispatched", "en_route", "on_scene"]))
        .order_by(DispatchRecord.dispatch_at.desc())
        .all()
    )
    for d in active_dispatches:
        if d.team_id in team_incident:
            continue
        fi = d.fire_incident
        if not fi:
            continue
        year = fi.fire_incident_datetime.year if fi.fire_incident_datetime else None
        team_incident[d.team_id] = (
            f"INC-{year}-{fi.fire_id:03d}" if year else f"INC-{fi.fire_id:03d}"
        )

    result = []
    for p in rows:
        first = p.per_firstname or ""
        last  = p.per_lastname  or ""
        initials = ((first[0] if first else "") + (last[0] if last else "")).upper()

        device = p.devices[0] if p.devices else None
        if device and device.device_status == "active":
            iot = "active"
        elif device and device.device_status == "sms":
            iot = "sms"
        else:
            iot = "offline"

        # Personnel status comes from their team membership's member_status
        # (cascaded by the dispatch path and the team-status PATCH endpoint).
        # Fall back to per_designation for legacy rows, then "standby".
        valid_statuses = {"dispatched", "onscene", "standby", "offduty"}
        member_status = (
            (p.team_memberships[0].member_status or "").lower()
            if p.team_memberships else ""
        )
        if member_status in valid_statuses:
            status = member_status
        else:
            designation = (p.per_designation or "standby").lower()
            status = designation if designation in valid_statuses else "standby"

        joined = None
        if p.user and p.user.created_at:
            joined = p.user.created_at.strftime("%b %Y")

        team_id = p.team_memberships[0].team_id if p.team_memberships else None
        # Only surface the incident for members who are actually deployed.
        incident = (
            team_incident.get(team_id, "—")
            if status in ("dispatched", "onscene")
            else "—"
        )

        result.append({
            "id":          f"FU-{p.per_id:03d}",
            "per_id":      p.per_id,
            "name":        f"{first} {last}".strip(),
            "initials":    initials or "??",
            "rank":        p.per_rank        or "—",
            "designation": p.per_designation or "",
            "status":      status if duty(p)[0] else 'offduty',
            'on_duty': duty(p)[0],
            "station":     p.station.station_name if p.station else "—",
            "station_id":  p.station_id,
            "team_id":     p.team_memberships[0].team_id   if p.team_memberships else None,
            "team_name":   p.team_memberships[0].team.team_name if p.team_memberships else "—",
            "shift_id":    p.shift_id,
            "shift_name":  p.shift.shift_name if p.shift else "—",
            "incident":    incident,
            "iot":         iot,
            "phone":       p.per_contact or "—",
            "email":       p.user.user_email if p.user else "",
            "joined":      joined or "—",
        })
    return result


@router.get("/api/personnel/locations")
def get_personnel_locations(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """Dashboard polls this every 10 seconds to refresh personnel markers on the map."""
    now = datetime.now(timezone.utc)

    rows = db.query(CurrentLocation).all()
    result = []
    for loc in rows:
        per = loc.personnel
        if not per:
            continue

        rec_at = loc.recorded_at
        if rec_at.tzinfo is None:
            rec_at = rec_at.replace(tzinfo=timezone.utc)
        age_s       = (now - rec_at).total_seconds()
        age_minutes = round(age_s / 60, 1)
        is_stale    = age_s > STALE_MINUTES * 60 or not duty(per, now)[0]

        active_dispatch = (
            db.query(DispatchRecord)
            .join(ResponseTeamMember,
                  ResponseTeamMember.team_id == DispatchRecord.team_id)
            .filter(
                ResponseTeamMember.per_id == per.per_id,
                DispatchRecord.dispatch_status.in_(["dispatched", "en_route", "on_scene"]),
            )
            .order_by(DispatchRecord.dispatch_at.desc())
            .first()
        )

        own_navigation = navigation_for(active_dispatch, per.per_id)
        own_arrival = arrival_for(db, active_dispatch, per.per_id)
        result.append({
            "per_id":           per.per_id,
            "name":             f"{per.per_firstname or ''} {per.per_lastname or ''}".strip(),
            "latitude":         float(loc.latitude),
            "longitude":        float(loc.longitude),
            "source":           loc.source,
            "recorded_at":      rec_at.isoformat(),
            "age_minutes":      age_minutes,
            "is_stale":         is_stale,
            'tracking': tracking_policy(db, per, now),
            "is_deviated":      bool(own_navigation.get('is_deviated')),
            "personnel_status": personnel_status(active_dispatch, own_arrival),
            "personnel_arrived_at": own_arrival.isoformat() if own_arrival else None,
            "dispatch_id":      active_dispatch.dispatch_id if active_dispatch else None,
            "manned_truck":     _manned_truck_dict(active_dispatch, per.per_id),
            "connector_geojson": own_navigation.get('connector_geojson'),
            "deviation_detected_at": own_navigation.get('deviation_detected_at'),
        })

    return result


@router.patch("/api/personnel/{per_id}")
def update_personnel(
    per_id: int,
    body: PersonnelUpdate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    p = db.get(Personnel, per_id)
    if not p:
        raise HTTPException(status_code=404, detail="Personnel not found.")

    if body.per_firstname   is not None: p.per_firstname   = body.per_firstname
    if body.per_lastname    is not None: p.per_lastname    = body.per_lastname
    if body.per_contact     is not None: p.per_contact     = body.per_contact
    if body.per_rank        is not None: p.per_rank        = body.per_rank
    if body.per_designation is not None: p.per_designation = body.per_designation
    if "station_id" in body.model_fields_set:
        if body.station_id is not None and not db.get(Station, body.station_id):
            raise HTTPException(status_code=404, detail="Station not found.")
        p.station_id = body.station_id
    if "shift_id" in body.model_fields_set:
        if body.shift_id is not None and not db.get(Shift, body.shift_id):
            raise HTTPException(status_code=404, detail="Shift not found.")
        p.shift_id = body.shift_id

    if p.user:
        if body.user_email is not None:
            conflict = db.query(Users).filter(
                Users.user_email == body.user_email,
                Users.user_id != p.user.user_id,
            ).first()
            if conflict:
                raise HTTPException(status_code=409, detail="Email already in use.")
            p.user.user_email = body.user_email
        if body.user_password is not None:
            p.user.user_password = _hash_password(body.user_password)

    db.commit()
    db.refresh(p)

    first = p.per_firstname or ""
    last  = p.per_lastname  or ""
    team_mem = p.team_memberships[0] if p.team_memberships else None
    return {
        "id":          f"FU-{p.per_id:03d}",
        "per_id":      p.per_id,
        "name":        f"{first} {last}".strip(),
        "rank":        p.per_rank        or "—",
        "designation": p.per_designation or "",
        "station":     p.station.station_name if p.station else "—",
        "station_id":  p.station_id,
        "team_id":     team_mem.team_id        if team_mem else None,
        "team_name":   team_mem.team.team_name if team_mem else "—",
        "phone":       p.per_contact or "—",
        "email":       p.user.user_email if p.user else "",
    }


@router.post("/api/personnel", status_code=201)
def create_personnel(
    body: PersonnelCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    conflict = db.query(Users).filter(Users.user_email == body.user_email).first()
    if conflict:
        raise HTTPException(status_code=409, detail="Email already in use.")

    if body.station_id is not None and not db.get(Station, body.station_id):
        raise HTTPException(status_code=404, detail="Station not found.")

    user = Users(
        user_email=body.user_email,
        user_password=_hash_password(body.user_password),
        user_role="personnel",
    )
    db.add(user)
    db.flush()

    p = Personnel(
        per_firstname=body.per_firstname,
        per_lastname=body.per_lastname,
        per_contact=body.per_contact or "",
        per_rank=body.per_rank,
        per_designation=body.per_designation or "",
        station_id=body.station_id,
        user_id=user.user_id,
    )
    db.add(p)
    db.commit()
    db.refresh(p)

    first = p.per_firstname or ""
    last  = p.per_lastname  or ""
    initials = ((first[0] if first else "") + (last[0] if last else "")).upper()
    return {
        "id":          f"FU-{p.per_id:03d}",
        "per_id":      p.per_id,
        "name":        f"{first} {last}".strip(),
        "initials":    initials or "??",
        "rank":        p.per_rank        or "—",
        "designation": p.per_designation or "",
        "status":      "standby",
        "station":     p.station.station_name if p.station else "—",
        "station_id":  p.station_id,
        "team_id":     None,
        "team_name":   "—",
        "shift_id":    None,
        "shift_name":  "—",
        "incident":    "—",
        "iot":         "offline",
        "phone":       p.per_contact or "—",
        "email":       user.user_email,
        "joined":      user.created_at.strftime("%b %Y") if user.created_at else "—",
    }


@router.delete("/api/personnel/{per_id}", status_code=204)
def delete_personnel(
    per_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    p = db.get(Personnel, per_id)
    if not p:
        raise HTTPException(status_code=404, detail="Personnel not found.")

    user_id = p.user_id
    previous_teams = [m.team_id for m in p.team_memberships]

    # Detach optional references that would otherwise block the delete.
    db.query(Station).filter(Station.station_commander_id == per_id).update(
        {"station_commander_id": None}, synchronize_session=False
    )
    db.query(DispatchTruck).filter(DispatchTruck.manned_by_per_id == per_id).update(
        {"manned_by_per_id": None}, synchronize_session=False
    )

    # Remove owned child rows: team memberships, live location, devices + logs.
    db.query(ResponseTeamMember).filter(ResponseTeamMember.per_id == per_id).delete(
        synchronize_session=False
    )
    from services.personnel_deployment import sync_rosters
    for team_id in previous_teams:
        sync_rosters(db, team_id, _auth)
    db.query(CurrentLocation).filter(CurrentLocation.per_id == per_id).delete(
        synchronize_session=False
    )
    device_ids = [
        d.device_id for d in db.query(Device).filter(Device.per_id == per_id).all()
    ]
    if device_ids:
        db.query(LocationLog).filter(LocationLog.device_id.in_(device_ids)).delete(
            synchronize_session=False
        )
        db.query(Device).filter(Device.per_id == per_id).delete(
            synchronize_session=False
        )

    db.delete(p)
    db.flush()

    # The login account is created alongside the personnel record — remove it too.
    if user_id is not None:
        user = db.get(Users, user_id)
        if user:
            db.delete(user)

    db.commit()
