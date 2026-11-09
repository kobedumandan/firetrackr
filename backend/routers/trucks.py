"""Fire truck CRUD."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload

from database import get_db
from services.resource_lifecycle import archive_resource, require_unarchived, active_reference, archive_dict
from models import DispatchRecord, DispatchTruck, Station, Truck, Users
from schemas import TruckCreate, TruckUpdate
from security import get_current_user, require_admin
from serializers import _truck_dict


router = APIRouter(tags=["trucks"])


@router.get("/api/trucks")
def get_trucks(
    db: Session = Depends(get_db),
    _auth: Users = Depends(get_current_user),
):
    pending_returns = selectinload(Truck.dispatch_trucks.and_(
        DispatchTruck.return_started_at.is_not(None), DispatchTruck.ready_at.is_(None)))
    rows = (db.query(Truck).filter(Truck.archived_at.is_(None)).options(
                joinedload(Truck.station),
                pending_returns.joinedload(DispatchTruck.return_station),
                pending_returns.joinedload(DispatchTruck.dispatch_record).joinedload(DispatchRecord.team))
            .order_by(Truck.truck_id).all())
    return [_truck_dict(r) for r in rows]


@router.post("/api/trucks", status_code=201)
def create_truck(
    body: TruckCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    if body.truck_status in ('dispatched', 'on_scene', 'returning'):
        raise HTTPException(422, 'Create a truck with an availability state; dispatch actions establish response states.')
    if db.query(Truck).filter(Truck.truck_platenum == body.truck_platenum).first():
        raise HTTPException(status_code=409, detail="A truck with that plate number already exists.")
    if body.station_id is not None:
        active_reference(db, Station, body.station_id, "Station")
    if body.station_id and not db.get(Station, body.station_id):
        raise HTTPException(status_code=404, detail="Station not found.")
    truck = Truck(
        truck_platenum=body.truck_platenum,
        truck_status=body.truck_status,
        station_id=body.station_id,
    )
    db.add(truck)
    db.commit()
    db.refresh(truck)
    return _truck_dict(truck)


@router.patch("/api/trucks/{truck_id}")
def update_truck(
    truck_id: int,
    body: TruckUpdate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    truck = db.query(Truck).filter_by(truck_id=truck_id).populate_existing().with_for_update().first()
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found.")
    require_unarchived(truck)
    if body.truck_platenum is not None:
        conflict = db.query(Truck).filter(
            Truck.truck_platenum == body.truck_platenum,
            Truck.truck_id != truck_id,
        ).first()
        if conflict:
            raise HTTPException(status_code=409, detail="A truck with that plate number already exists.")
        truck.truck_platenum = body.truck_platenum
    if body.truck_status is not None:
        if body.truck_status != truck.truck_status:
            assigned = db.query(DispatchTruck).join(DispatchRecord).filter(
                DispatchTruck.truck_id == truck_id,
                DispatchRecord.dispatch_status.in_(('dispatched', 'en_route', 'on_scene')),
            ).first()
            returning = db.query(DispatchTruck).filter(
                DispatchTruck.truck_id == truck_id, DispatchTruck.return_started_at.is_not(None),
                DispatchTruck.ready_at.is_(None),
            ).first()
            if assigned or returning:
                raise HTTPException(409, 'Use the response clearance and return/readiness actions before making this truck available.')
            if body.truck_status in ('dispatched', 'on_scene', 'returning'):
                raise HTTPException(409, 'Response truck states are recorded by dispatch and clearance actions.')
            if body.truck_status == 'available' and truck.truck_status in ('unavailable', 'maintenance'):
                if not (body.readiness_note or '').strip():
                    raise HTTPException(422, 'Record the resolution/readiness reason before restoring this truck to available.')
                truck.readiness_note = body.readiness_note.strip()
                truck.readiness_confirmed_at = datetime.now(timezone.utc)
                truck.readiness_confirmed_by = _auth.user_id
        truck.truck_status = body.truck_status
    if "station_id" in body.model_fields_set:
        if body.station_id != truck.station_id and db.query(DispatchTruck.dispatch_truck_id).join(DispatchRecord).filter(
            DispatchTruck.truck_id == truck_id,
            (DispatchRecord.dispatch_status.in_(('dispatched', 'en_route', 'on_scene')) |
             (DispatchTruck.return_started_at.is_not(None) & DispatchTruck.ready_at.is_(None))),
        ).first():
            raise HTTPException(409, 'Preserve the home station until the active response and return are complete.')
        if body.station_id is not None:
            active_reference(db, Station, body.station_id, "Station")
        if body.station_id is not None and not db.get(Station, body.station_id):
            raise HTTPException(status_code=404, detail="Station not found.")
        truck.station_id = body.station_id
    db.commit()
    db.refresh(truck)
    return _truck_dict(truck)


@router.delete("/api/trucks/{truck_id}", status_code=204)
def delete_truck(
    truck_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    archive_resource(db, "trucks", truck_id, _auth)
    db.commit()
