"""User-drawn routing constraints layered onto the GAT predictions."""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import cast, text
from sqlalchemy.dialects.postgresql import JSONB

from database import get_db
from models import GnnConstraint, Users
from schemas import (VALID_CONSTRAINT_TYPES, ConstraintCreate, ConstraintUpdate,
                     ConstraintEdgeSelection, BaselineConstraintOverride)
from security import require_admin
from serializers import _constraint_to_dict
from state import manager
from services.constraint_segments import load_segment_index, validate_coordinates
from services.routing_reload import refresh_after_constraint_change


router = APIRouter(tags=["constraints"])
logger = logging.getLogger(__name__)


def _constraint_write_lock(db):
    db.execute(text('SELECT pg_advisory_xact_lock(912739)'))


def _road_edges():
    from services.road_edges import load_road_edges
    try:
        return load_road_edges()
    except FileNotFoundError as exc:
        raise HTTPException(503, 'The road network is unavailable. No edges were saved.') from exc


@router.get('/api/constraints/road-edges')
def get_road_edges(_auth: Users = Depends(require_admin)):
    return {'type': 'FeatureCollection', 'features': list(_road_edges().values())}


@router.post('/api/constraints/edge-selection', status_code=201)
async def create_edge_selection(body: ConstraintEdgeSelection, db: Session = Depends(get_db),
                                _auth: Users = Depends(require_admin)):
    edges = _road_edges()
    uids = list(dict.fromkeys(body.segment_uids))
    if any(uid not in edges for uid in uids):
        raise HTTPException(422, 'A selected road has changed. Reload the road network and select it again.')
    # Geometry is always taken from the authoritative road catalog, never from
    # client coordinates. All selected roads commit together or none do.
    rows = []
    schedule = body.traffic_schedule.model_dump() if body.traffic_schedule else None
    try:
        _constraint_write_lock(db)
        for uid in uids:
            edge = edges[uid]
            existing = db.query(GnnConstraint).filter(
                GnnConstraint.is_active.is_(True),
                cast(GnnConstraint.segment_uids, JSONB) == [uid]).first()
            if existing is not None:
                if (existing.constraint_type != body.constraint_type or existing.narrow_severity != body.narrow_severity
                        or existing.traffic_schedule != schedule or existing.name != (body.name or edge['properties']['name'])):
                    raise HTTPException(409, 'A selected edge already has a different saved constraint. Select that constraint and choose Edit constraint to update it.')
                rows.append(existing)
                continue
            row = GnnConstraint(constraint_type=body.constraint_type, name=body.name or edge['properties']['name'],
                                coordinates=json.dumps(edge['geometry']['coordinates']), segment_uids=[uid],
                                highway=body.highway or edge['properties']['highway'],
                                surface=body.surface or edge['properties']['surface'], maxspeed=body.maxspeed,
                                narrow_severity=body.narrow_severity, traffic_schedule=schedule,
                                created_by=_auth.user_id)
            db.add(row)
            rows.append(row)
        db.flush()
        records = [_constraint_to_dict(row) for row in rows]
        db.commit()
    except Exception:
        db.rollback()
        raise
    routing_applied = await refresh_after_constraint_change()
    # Persistence already succeeded: a disconnected listener must not make the
    # client believe the transaction failed and repeat the save.
    try:
        for record in records:
            await manager.broadcast({'type': 'constraint_created', 'data': record})
    except Exception:
        import logging
        logging.getLogger(__name__).exception('Saved road edges; notification delivery failed')
    return {'constraints': records, 'routing_applied': routing_applied}


def _snap(coordinates):
    try:
        validate_coordinates(coordinates)
        return load_segment_index().snap(coordinates)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except FileNotFoundError:
        from ai import Config

        if Config.PREDICTED_CONSTRAINTS_PATH is None:
            return []
        raise HTTPException(status_code=503, detail="Constraint segment export is missing; annotation was not saved.")


@router.post('/api/constraints/baseline-override')
async def save_baseline_override(body: BaselineConstraintOverride, db: Session = Depends(get_db),
                                 _auth: Users = Depends(require_admin)):
    try:
        index = load_segment_index()
    except FileNotFoundError as exc:
        raise HTTPException(503, 'The model road layer is unavailable; no override was saved.') from exc
    original = index.features.get(body.segment_uid)
    if original is None:
        raise HTTPException(404, 'This model road has changed. Refresh the map and select it again.')
    try:
        _constraint_write_lock(db)
        row = db.query(GnnConstraint).filter_by(baseline_segment_uid=body.segment_uid, is_active=True).first()
        created = row is None
        if row is None:
            row = GnnConstraint(baseline_segment_uid=body.segment_uid, created_by=_auth.user_id,
                                segment_uids=[body.segment_uid], coordinates=json.dumps(original['geometry']['coordinates']))
            db.add(row)
        row.name, row.constraint_type = body.name, body.constraint_type
        row.narrow_severity = body.narrow_severity
        row.traffic_schedule = body.traffic_schedule.model_dump() if body.traffic_schedule else None
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        raise
    data = _constraint_to_dict(row)
    data['routing_applied'] = await refresh_after_constraint_change()
    try:
        await manager.broadcast({'type': 'constraint_created' if created else 'constraint_updated', 'data': data})
    except Exception:
        logger.exception('Baseline override saved; notification delivery failed')
    return data


@router.get("/api/constraints")
def get_constraints(
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    rows = (
        db.query(GnnConstraint)
        .filter(GnnConstraint.is_active == True)
        .order_by(GnnConstraint.created_at.desc())
        .all()
    )
    return [_constraint_to_dict(r) for r in rows]


@router.post("/api/constraints", status_code=201)
async def create_constraint(
    body: ConstraintCreate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    if body.constraint_type not in VALID_CONSTRAINT_TYPES:
        raise HTTPException(status_code=422, detail=f"Invalid type. Must be one of: {VALID_CONSTRAINT_TYPES}")
    if not body.coordinates or len(body.coordinates) < 2:
        raise HTTPException(status_code=422, detail="At least 2 coordinate points required.")

    c = GnnConstraint(
        constraint_type=body.constraint_type,
        name=body.name,
        coordinates=json.dumps(body.coordinates),
        segment_uids=_snap(body.coordinates),
        highway=body.highway,
        surface=body.surface,
        maxspeed=body.maxspeed,
        created_by=_auth.user_id,
    )
    db.add(c)
    db.commit()
    db.refresh(c)

    routing_applied = await refresh_after_constraint_change()

    data = _constraint_to_dict(c)
    data["routing_applied"] = routing_applied
    await manager.broadcast({"type": "constraint_created", "data": data})
    return data


@router.patch("/api/constraints/{constraint_id}")
async def update_constraint(
    constraint_id: int,
    body: ConstraintUpdate,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    try:
        # Serialize with edge creation; refresh a row another request may have changed.
        _constraint_write_lock(db)
        c = db.get(GnnConstraint, constraint_id, with_for_update=True, populate_existing=True)
        if not c or not c.is_active:
            raise HTTPException(status_code=404, detail="Constraint not found.")
        changes = body.model_dump(exclude_unset=True)
        constraint_type = body.constraint_type or c.constraint_type
        changed_type = constraint_type != c.constraint_type
        severity = changes.get('narrow_severity', None if changed_type else c.narrow_severity)
        schedule = changes.get('traffic_schedule', None if changed_type else c.traffic_schedule)
        if c.baseline_segment_uid:
            from pydantic import ValidationError
            try:
                BaselineConstraintOverride(segment_uid=c.baseline_segment_uid, constraint_type=constraint_type,
                                           narrow_severity=severity, traffic_schedule=schedule)
            except ValidationError as exc:
                raise HTTPException(422, 'Severity or schedule does not apply to the selected road type.') from exc
        elif constraint_type not in VALID_CONSTRAINT_TYPES:
            raise HTTPException(422, 'Choose Narrow road or Traffic congestion for a saved road edge.')
        elif constraint_type == 'narrow_road':
            if schedule is not None or (changed_type and severity is None):
                raise HTTPException(422, 'Choose Slight or Severe when changing to a narrow road; traffic schedules do not apply.')
        elif severity is not None or (changed_type and schedule is None):
            raise HTTPException(422, 'A traffic constraint requires a schedule and cannot have narrow severity.')

        coordinates, segment_uids = c.coordinates, c.segment_uids
        if body.coordinates is not None:
            is_edge = bool(c.baseline_segment_uid) or any(uid.startswith('edge-v1-') for uid in (c.segment_uids or []))
            if is_edge and body.coordinates != json.loads(c.coordinates):
                raise HTTPException(422, 'Saved road-edge geometry cannot be changed. Select other roads to add a constraint.')
            if not is_edge:
                segment_uids = _snap(body.coordinates)
                coordinates = json.dumps(body.coordinates)
        elif segment_uids is None:
            segment_uids = _snap(json.loads(coordinates))

        # Validation completes before changing any row. Omitted fields retain
        # legacy defaults; explicitly supplied nulls can clear optional values.
        c.constraint_type, c.narrow_severity, c.traffic_schedule = constraint_type, severity, schedule
        c.coordinates, c.segment_uids = coordinates, segment_uids
        for key in ('name', 'highway', 'surface', 'maxspeed'):
            if key in changes:
                setattr(c, key, changes[key])
        db.commit()
        db.refresh(c)
    except Exception:
        db.rollback()
        raise

    routing_applied = await refresh_after_constraint_change()

    data = _constraint_to_dict(c)
    data["routing_applied"] = routing_applied
    try:
        await manager.broadcast({"type": "constraint_updated", "data": data})
    except Exception:
        logger.exception('Constraint updated; notification delivery failed')
    return data


@router.delete("/api/constraints/{constraint_id}", status_code=204)
async def delete_constraint(
    constraint_id: int,
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    c = db.get(GnnConstraint, constraint_id)
    if not c or not c.is_active:
        raise HTTPException(status_code=404, detail="Constraint not found.")
    c.is_active = False
    db.commit()

    await refresh_after_constraint_change()

    await manager.broadcast({"type": "constraint_deleted", "data": {"id": constraint_id}})
