"""Fire station CRUD."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

import state
from database import get_db
from models import Personnel, ResponseTeam, Station, Truck, Users
from schemas import StationCreate, StationUpdate
from security import require_admin
from serializers import _station_dict


router = APIRouter(tags=["stations"])


def _invalidate_coverage():
    """Coverage is computed from station positions and status, and cached per
    process; any station write makes that cache stale."""
    state.coverage_cache = None


@router.get("/api/stations")
def get_stations(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    rows = (db.query(Station).options(joinedload(Station.commander))
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
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found.")
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
    station = db.get(Station, station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found.")

    # Block deletion while other records still reference this station, so we
    # never orphan personnel / trucks / teams or violate FK constraints.
    blockers = []
    n_personnel = db.query(Personnel).filter(Personnel.station_id == station_id).count()
    if n_personnel:
        blockers.append(f"{n_personnel} personnel")
    n_trucks = db.query(Truck).filter(Truck.station_id == station_id).count()
    if n_trucks:
        blockers.append(f"{n_trucks} truck{'s' if n_trucks != 1 else ''}")
    n_teams = db.query(ResponseTeam).filter(ResponseTeam.station_id == station_id).count()
    if n_teams:
        blockers.append(f"{n_teams} team{'s' if n_teams != 1 else ''}")
    n_subs = db.query(Station).filter(Station.parent_station_id == station_id).count()
    if n_subs:
        blockers.append(f"{n_subs} sub-station{'s' if n_subs != 1 else ''}")

    if blockers:
        raise HTTPException(
            status_code=409,
            detail=(
                "Cannot delete this station while it still has "
                + ", ".join(blockers)
                + " assigned. Reassign or remove them first."
            ),
        )

    db.delete(station)
    db.commit()
    _invalidate_coverage()
