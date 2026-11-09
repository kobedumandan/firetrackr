"""Personnel roster CRUD and their live map positions."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload

from config import STALE_MINUTES
from database import get_db
from services.resource_lifecycle import archive_resource, require_unarchived, active_reference, archive_dict
from models import (
    CurrentLocation, Device, DispatchRecord, DispatchTruck, LocationLog,
    Personnel, ResponseTeamMember, Shift, Station, Users,
)
from schemas import PersonnelCreate, PersonnelUpdate
from security import _hash_password, require_admin
from serializers import _manned_truck_dict
from services.personnel_navigation import navigation_for
from services.personnel_arrival import arrivals_for, personnel_status
from services.tracking_policy import duty, policy as tracking_policy


router = APIRouter(tags=["personnel"])


def _member_readiness(person, return_context=None):
    """Prefer an existing response over a second idle membership."""
    normalize = lambda value: (value or '').strip().lower().replace('_', '')
    memberships = [m for m in person.team_memberships if not m.team.archived_at]
    def member_status(member):
        status = normalize(member.member_status)
        progress = (return_context or {}).get('teams', {}).get(member.team_id)
        return progress['status'] if progress and status not in ('onscene', 'dispatched', 'offduty', 'inactive') else status
    for status in ('onscene', 'dispatched', 'returning', 'standby', 'offduty'):
        match = next((member for member in memberships if member_status(member) == status), None)
        if match:
            return status, match
    legacy = normalize(person.per_designation)
    return (legacy if legacy in ('dispatched', 'onscene', 'returning', 'standby', 'offduty') else 'standby',
            memberships[0] if memberships else None)


@router.get("/api/personnel")
def get_personnel(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    # Keep the base roster query intact; batch relationships without reordering it.
    rows = db.query(Personnel).filter(Personnel.archived_at.is_(None)).options(
        selectinload(Personnel.user),
        selectinload(Personnel.station),
        selectinload(Personnel.shift),
        selectinload(Personnel.devices),
        selectinload(Personnel.team_memberships).joinedload(ResponseTeamMember.team),
    ).all()
    from services.resource_availability import pending_return_context
    return_context = pending_return_context(db, per_ids=[person.per_id for person in rows],
        team_ids=[member.team_id for person in rows for member in person.team_memberships])
    return_locks = {per_id: row['assignment_reason'] for per_id, row in return_context['drivers'].items()}

    # Map each team with an active dispatch to its incident reference, so a
    # dispatched/on-scene member can show which incident they're assigned to.
    # Ordered newest-first; first write per team_id wins (the latest dispatch).
    team_incident = {}
    active_dispatches = (
        db.query(DispatchRecord)
        .options(joinedload(DispatchRecord.fire_incident))
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

        status, membership = _member_readiness(p, return_context)
        if p.per_id in return_locks and status not in ('dispatched', 'onscene'):
            team_progress = return_context['teams'].get(membership.team_id if membership else None, {})
            status = 'returning' if team_progress.get('status') == 'returning' else return_context['drivers'][p.per_id]['status']
        progress = return_context['drivers'].get(p.per_id) or return_context['teams'].get(membership.team_id if membership else None)
        on_duty = duty(p)[0]
        # Duty controls GPS collection. It does not declare an unfinished crew ready.
        visible_status = status if on_duty or status in ('dispatched', 'onscene', 'returning') else 'offduty'

        joined = None
        if p.user and p.user.created_at:
            joined = p.user.created_at.strftime("%b %Y")

        team_id = membership.team_id if membership else None
        # Only surface the incident for members who are actually deployed.
        incident = (
            team_incident.get(team_id, "—")
            if status in ("dispatched", "onscene")
            else "—"
        )

        result.append({
            "id":          f"FU-{p.per_id:03d}",
            "per_id":      p.per_id,
            "user_id": p.user_id,
            "account_disabled": bool(p.user and p.user.disabled_at),
            **archive_dict(p),
            "name":        f"{first} {last}".strip(),
            "initials":    initials or "??",
            "rank":        p.per_rank        or "—",
            "designation": p.per_designation or "",
            "status":      visible_status,
            'on_duty': on_duty,
            'return_assignment_locked': p.per_id in return_locks,
            'return_assignment_reason': return_locks.get(p.per_id, ''),
            'dispatch_blocker': progress['blocker'] if progress else '',
            "station":     p.station.station_name if p.station else "—",
            "station_id":  p.station_id,
            "team_id":     team_id,
            "team_name":   membership.team.team_name if membership and membership.team else "—",
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

    rows = db.query(CurrentLocation).join(Personnel).filter(Personnel.archived_at.is_(None)).options(
        selectinload(CurrentLocation.personnel).joinedload(Personnel.shift),
        selectinload(CurrentLocation.personnel).selectinload(Personnel.team_memberships),
    ).all()
    per_ids = [loc.per_id for loc in rows if loc.personnel]
    assignments = {}
    if per_ids:
        for per_id, dispatch in (
            db.query(ResponseTeamMember.per_id, DispatchRecord)
            .join(DispatchRecord, DispatchRecord.team_id == ResponseTeamMember.team_id)
            .options(selectinload(DispatchRecord.dispatch_trucks).joinedload(DispatchTruck.truck))
            .filter(ResponseTeamMember.per_id.in_(per_ids),
                    DispatchRecord.dispatch_status.in_(['dispatched', 'en_route', 'on_scene']))
            .order_by(DispatchRecord.dispatch_at.desc())
            .all()
        ):
            # Duplicate membership rows must not imply multiple deployments.
            assignments.setdefault(per_id, {})[dispatch.dispatch_id] = dispatch
    assignments = {per_id: list(dispatches.values()) for per_id, dispatches in assignments.items()}
    latest = {per_id: dispatches[0] for per_id, dispatches in assignments.items()}
    arrivals = arrivals_for(db, latest)
    from services.resource_availability import pending_return_context
    return_context = pending_return_context(db, per_ids=[loc.per_id for loc in rows],
        team_ids=[member.team_id for loc in rows if loc.personnel for member in loc.personnel.team_memberships])
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

        active_dispatch = latest.get(per.per_id)
        tracking = tracking_policy(db, per, now, dispatches=assignments.get(per.per_id, []), arrivals=arrivals)
        if tracking['mode'] == 'returning':
            active_dispatch = db.get(DispatchRecord, tracking['dispatch_id'])

        own_navigation = navigation_for(active_dispatch, per.per_id) if tracking['mode'] != 'returning' else {}
        own_arrival = arrivals.get((active_dispatch.dispatch_id, per.per_id)) if active_dispatch else None
        result.append({
            "per_id":           per.per_id,
            "name":             f"{per.per_firstname or ''} {per.per_lastname or ''}".strip(),
            "latitude":         float(loc.latitude),
            "longitude":        float(loc.longitude),
            "source":           loc.source,
            "recorded_at":      rec_at.isoformat(),
            "age_minutes":      age_minutes,
            "is_stale":         is_stale,
            'tracking': tracking,
            "is_deviated":      bool(own_navigation.get('is_deviated')),
            "personnel_status": 'returning' if tracking['mode'] == 'returning' or (active_dispatch is None and _member_readiness(per, return_context)[0] == 'returning') else personnel_status(active_dispatch, own_arrival),
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
    require_unarchived(p)

    if body.per_firstname   is not None: p.per_firstname   = body.per_firstname
    if body.per_lastname    is not None: p.per_lastname    = body.per_lastname
    if body.per_contact     is not None: p.per_contact     = body.per_contact
    if body.per_rank        is not None: p.per_rank        = body.per_rank
    if body.per_designation is not None: p.per_designation = body.per_designation
    if "station_id" in body.model_fields_set:
        if body.station_id is not None:
            active_reference(db, Station, body.station_id, "Station")
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
            "user_id": p.user_id,
            "account_disabled": bool(p.user and p.user.disabled_at),
            **archive_dict(p),
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

    if body.station_id is not None:
        active_reference(db, Station, body.station_id, "Station")
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
            "user_id": p.user_id,
            "account_disabled": bool(p.user and p.user.disabled_at),
            **archive_dict(p),
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
    archive_resource(db, "personnel", per_id, _auth)
    db.commit()
