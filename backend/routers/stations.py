"""Fire station CRUD."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

import state
from database import get_db
from services.resource_lifecycle import archive_resource, require_unarchived, active_reference, archive_dict
from models import Personnel, ResponseTeam, Station, Truck, Users
from schemas import StationCreate, StationUpdate
from security import require_admin
from serializers import _station_dict


router = APIRouter(tags=["stations"])


def _invalidate_coverage():
    """Coverage is computed from station positions and status, and cached per
    process; any station write makes that cache stale."""
    state.invalidate_coverage()


@router.get("/api/stations")
def get_stations(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    rows = (db.query(Station).filter(Station.archived_at.is_(None)).options(joinedload(Station.commander))
            .order_by(Station.station_id).all())
    return [_station_dict(r) for r in rows]


@router.post("/api/stations", status_code=201)
def create_station(
    body: StationCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    if db.query(Station).filter(Station.station_name == body.station_name).first():
        raise HTTPException(status_code=409, detail="A station with that name already exists.")
    if body.station_type == "sub" and body.parent_station_id is None:
        raise HTTPException(status_code=422, detail="A sub-station must have a parent station.")
    if body.parent_station_id is not None:
        active_reference(db, Station, body.parent_station_id, "Parent station")
    if body.parent_station_id and not db.get(Station, body.parent_station_id):
        raise HTTPException(status_code=404, detail="Parent station not found.")
    station = Station(
        station_name=body.station_name,
        station_type=body.station_type,
        parent_station_id=body.parent_station_id,
        station_address=body.station_address,
        station_barangay=body.station_barangay,
        station_latitude=body.station_latitude,
        station_longitude=body.station_longitude,
        station_contact=body.station_contact,
        station_status=body.station_status,
    )
    db.add(station)
    db.commit()
    db.refresh(station)
    _invalidate_coverage()
    return _station_dict(station)


@router.patch("/api/stations/{station_id}")
def update_station(
    station_id: int,
    body: StationUpdate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    station = db.query(Station).filter_by(station_id=station_id).populate_existing().with_for_update().first()
    if not station:
        raise HTTPException(status_code=404, detail="Station not found.")
    require_unarchived(station)
    if body.station_name is not None:
        conflict = db.query(Station).filter(
            Station.station_name == body.station_name,
            Station.station_id != station_id,
        ).first()
        if conflict:
            raise HTTPException(status_code=409, detail="A station with that name already exists.")
        station.station_name = body.station_name
    if body.station_type is not None:
        station.station_type = body.station_type
    if "parent_station_id" in body.model_fields_set:
        if body.parent_station_id is not None:
            active_reference(db, Station, body.parent_station_id, "Parent station")
        if body.parent_station_id is not None and not db.get(Station, body.parent_station_id):
            raise HTTPException(status_code=404, detail="Parent station not found.")
        station.parent_station_id = body.parent_station_id
    if body.station_address is not None:
        station.station_address = body.station_address
    if body.station_barangay is not None:
        station.station_barangay = body.station_barangay
    if body.station_latitude is not None:
        station.station_latitude = body.station_latitude
    if body.station_longitude is not None:
        station.station_longitude = body.station_longitude
    if body.station_contact is not None:
        station.station_contact = body.station_contact
    if body.station_status is not None:
        station.station_status = body.station_status
    if "station_commander_id" in body.model_fields_set:
        if body.station_commander_id is not None:
            from models import Personnel as _Personnel
            active_reference(db, _Personnel, body.station_commander_id, "Commander")
            if not db.get(_Personnel, body.station_commander_id):
                raise HTTPException(status_code=404, detail="Personnel not found.")
        station.station_commander_id = body.station_commander_id
    db.commit()
    db.refresh(station)
    _invalidate_coverage()
    return _station_dict(station)


@router.delete("/api/stations/{station_id}", status_code=204)
def delete_station(
    station_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    archive_resource(db, "stations", station_id, _auth)
    db.commit()
