"""Administrator analytics and verified operational confirmations."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models import DispatchTruck, FireIncident, Users
from schemas import OperationalMilestoneBody
from security import require_admin
from services.operational_times import analytics, detail, record_milestone
from state import manager

router = APIRouter(prefix="/api/operational-times", tags=["operational-times"])


@router.get("")
def summary(period: Literal['1d', '1w', '1m', '6m', '1y', '2023-2024', 'all'] = '1y', page: int = Query(1, ge=1),
            source: Literal['recorded', 'demo'] = 'recorded',
            kind: Literal['operational', 'drill', 'test', 'unknown', 'all'] = 'all',
            db: Session = Depends(get_db), _user: Users = Depends(require_admin)):
    return analytics(db, period, page, source=source, kind=kind)


@router.get("/{fire_id}")
def incident_detail(fire_id: int, db: Session = Depends(get_db), _user: Users = Depends(require_admin)):
    inc = db.get(FireIncident, fire_id)
    if not inc:
        raise HTTPException(404, "Incident not found.")
    return detail(db, inc)


@router.get("/{fire_id}/responder-tracks")
def responder_tracks(fire_id: int, db: Session = Depends(get_db), _user: Users = Depends(require_admin)):
    from services.responder_tracks import incident_tracks
    inc = db.get(FireIncident, fire_id)
    if not inc:
        raise HTTPException(404, "Incident not found.")
    return incident_tracks(db, inc)


@router.post("/{fire_id}/milestones")
async def confirm_milestone(fire_id: int, body: OperationalMilestoneBody, db: Session = Depends(get_db),
                            user: Users = Depends(require_admin)):
    inc = db.query(FireIncident).filter_by(fire_id=fire_id).with_for_update().first()
    if not inc:
        raise HTTPException(404, "Incident not found.")
    unit = db.get(DispatchTruck, body.dispatch_truck_id) if body.dispatch_truck_id else None
    if body.dispatch_truck_id and (unit is None or unit.dispatch_record.fire_id != fire_id):
        raise HTTPException(404, "Truck assignment not found for this incident.")
    if body.kind not in ('departure', 'arrival') and unit:
        raise HTTPException(422, "This milestone belongs to the incident, not an individual unit.")
    record_milestone(db, inc, body.kind, body.occurred_at, user, unit,
                     key=f"manual:{user.user_id}:{body.idempotency_key}", response_kind=body.response_kind)
    db.commit()
    await manager.broadcast({"type": "operational_times_updated", "data": {"fire_id": fire_id}})
    return detail(db, inc)
