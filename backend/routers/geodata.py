"""Barangay boundaries and the fire-density heatmap."""
from fastapi import APIRouter, Depends
from datetime import datetime
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from models import Users
from security import require_admin
from services.heatmap import severity_weight
from serializers import _incident_dict
from services.historical_incidents import history


router = APIRouter(tags=["geodata"])


@router.get("/api/barangays")
def get_barangays(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    rows = db.execute(
        text(
            """
            SELECT brgy_id, brgy_name, brgy_estpopulation,
                   ST_AsGeoJSON(brgy_polygon)::json AS geom
            FROM barangay_boundaries
            ORDER BY brgy_name
            """
        )
    ).all()
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "brgy_id": r.brgy_id,
                    "brgy_name": r.brgy_name,
                    "brgy_estpopulation": r.brgy_estpopulation,
                },
                "geometry": r.geom,
            }
            for r in rows
        ],
    }


@router.get("/api/heatmap")
def get_heatmap(
    start: datetime | None = None, end: datetime | None = None,
    kind: str = 'historical', known_only: bool = False, source: str = 'all',
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    # Derive one consistent severity weight from the incident, including old
    # seeded rows. Do not mix their synthetic density values with live weights.
    from services.fire_prone_areas import historical_rows
    rows = historical_rows(db, start, end, kind, known_only, source)
    return [
        {
            "lat": incident.fire_latitude,
            "lng": incident.fire_longitude,
            "weight": severity_weight(incident.fire_severity),
            "fire_id": incident.fire_id,
            "occurred_at": incident.fire_incident_datetime,
            "location_specification": history(incident).get("pin_specification"),
            "occurrence_precision": history(incident).get("occurrence_precision"),
            "alarm_basis": history(incident).get("alarm_basis"),
            "incident": {key: value for key, value in _incident_dict(incident).items()
                         if key in {"id", "loc", "addr", "sev", "status", "alarm", "structure", "casualties"}},
        }
        for incident in rows
    ]
