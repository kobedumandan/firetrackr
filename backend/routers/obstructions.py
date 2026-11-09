"""Dispatcher-placed road obstructions."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import state
from database import get_db
from models import RoadObstruction, Users
from routers.routing import SNAP_RADIUS_M
from schemas import ObstructionCreate
from security import require_admin
from state import manager


router = APIRouter(tags=["obstructions"])


def _serialise(r: RoadObstruction) -> dict:
    return {
        "id":          r.obstruction_id,
        "type":        r.type,
        "latitude":    r.latitude,
        "longitude":   r.longitude,
        "bearing_deg": r.bearing_deg,
        "description": r.description or "",
        "is_active":   r.is_active,
        "created_at":  r.created_at.isoformat() if r.created_at else None,
        "expires_at":  r.expires_at.isoformat() if r.expires_at else None,
        'resolved_at': r.resolved_at.isoformat() if r.resolved_at else None,
        'resolved_by': r.resolved_by,
        'resolution_note': r.resolution_note,
        'name': f'{r.type}: {r.description or "Road obstruction"}',
    }


def _snap(lat: float, lon: float) -> dict | None:
    """Snap to the road network, or None when the engine is down or nothing is near."""
    if state.routing_engine is None:
        return None
    return state.routing_engine.graph.snap_point(
        lat, lon, radius_km=SNAP_RADIUS_M / 1000.0
    )


@router.get("/api/obstructions")
def get_obstructions(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    rows = (
        db.query(RoadObstruction)
        .filter(RoadObstruction.is_active == True)
        .filter((RoadObstruction.expires_at.is_(None)) | (RoadObstruction.expires_at > datetime.now(timezone.utc)))
        .order_by(RoadObstruction.created_at.desc())
        .all()
    )
    # Rows predating the snapping behaviour carry no bearing, so the map has no
    # angle to draw them at. Fill it in once, here, rather than leaving them
    # permanently undrawable or forcing a one-off migration script.
    dirty = False
    for r in rows:
        if r.bearing_deg is None:
            hit = _snap(r.latitude, r.longitude)
            if hit:
                r.bearing_deg = hit["bearing_deg"]
                dirty = True
    if dirty:
        db.commit()

    return [_serialise(r) for r in rows]


@router.post("/api/obstructions", status_code=201)
async def create_obstruction(
    body: ObstructionCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    if body.type not in ("repair", "blockade", "flood", "accident"):
        raise HTTPException(status_code=422, detail="Invalid obstruction type.")

    exp = None
    if body.expires_at:
        try:
            exp = datetime.fromisoformat(body.expires_at)
        except ValueError:
            raise HTTPException(status_code=422, detail="expires_at must be ISO 8601.")

    # An obstruction only means something if it sits on an edge the router
    # actually traverses -- one placed in a field costs nothing and silently
    # does nothing -- so it is snapped to the network here and refused when
    # there is no road to snap to. The client previews the same snap while
    # placing, so a rejection should already be visible before saving.
    hit = _snap(body.latitude, body.longitude)
    if hit is None:
        raise HTTPException(
            status_code=422,
            detail=f"No road within {SNAP_RADIUS_M:.0f} m of that point.",
        )

    obs = RoadObstruction(
        type=body.type,
        latitude=hit["latitude"],
        longitude=hit["longitude"],
        bearing_deg=hit["bearing_deg"],
        description=body.description,
        expires_at=exp,
        created_by=_auth.user_id,
    )
    db.add(obs)
    db.commit()
    db.refresh(obs)

    data = _serialise(obs)
    await manager.broadcast({"type": "obstruction_created", "data": data})
    return data


@router.delete("/api/obstructions/{obstruction_id}", status_code=204)
async def delete_obstruction(
    obstruction_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    obs = db.query(RoadObstruction).filter_by(obstruction_id=obstruction_id).with_for_update().first()
    if not obs:
        raise HTTPException(status_code=404, detail="Obstruction not found.")
    if not obs.is_active:
        return
    obs.is_active = False
    obs.resolved_at = datetime.now(timezone.utc)
    obs.resolved_by = _auth.user_id if _auth else None
    obs.resolution_note = 'Marked resolved by dispatcher.'
    db.commit()
    await manager.broadcast({
        "type": "obstruction_deleted",
        "data": {"id": obstruction_id},
    })
