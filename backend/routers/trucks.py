"""Fire truck CRUD."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models import Station, Truck, Users
from schemas import TruckCreate, TruckUpdate
from security import get_current_user, require_admin
from serializers import _truck_dict


router = APIRouter(tags=["trucks"])


@router.get("/api/trucks")
def get_trucks(
    db: Session = Depends(get_db),
    _auth: Users = Depends(get_current_user),
):
    rows = (db.query(Truck).options(joinedload(Truck.station))
            .order_by(Truck.truck_id).all())
    return [_truck_dict(r) for r in rows]


@router.post("/api/trucks", status_code=201)
def create_truck(
    body: TruckCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    if db.query(Truck).filter(Truck.truck_platenum == body.truck_platenum).first():
        raise HTTPException(status_code=409, detail="A truck with that plate number already exists.")
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
    truck = db.get(Truck, truck_id)
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found.")
    if body.truck_platenum is not None:
        conflict = db.query(Truck).filter(
            Truck.truck_platenum == body.truck_platenum,
            Truck.truck_id != truck_id,
        ).first()
        if conflict:
            raise HTTPException(status_code=409, detail="A truck with that plate number already exists.")
        truck.truck_platenum = body.truck_platenum
    if body.truck_status is not None:
        truck.truck_status = body.truck_status
    if "station_id" in body.model_fields_set:
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
    truck = db.get(Truck, truck_id)
    if not truck:
        raise HTTPException(status_code=404, detail="Truck not found.")
    db.delete(truck)
    db.commit()
