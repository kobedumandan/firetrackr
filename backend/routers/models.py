"""Admin-only model history, retrain jobs and candidate review."""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from models import ModelVersion, Users
from security import require_admin
from services import model_registry as registry

logger = logging.getLogger(__name__)
router = APIRouter(tags=["models"])


class PromoteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_champion: str = Field(pattern=r"^v[1-9][0-9]*$", max_length=64)


def _operation(db, function, *args):
    try:
        return function(db, *args)
    except registry.RegistryError as exc:
        db.rollback()
        raise HTTPException(exc.status_code, str(exc)) from exc
    except (ValueError, OSError, KeyError, ImportError) as exc:
        db.rollback()
        logger.exception("Model artifacts or snapshot unavailable")
        raise HTTPException(503, "Model artifacts or labels are unavailable; inspect the server log.") from exc
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("Model registry database operation failed")
        raise HTTPException(503, "Model registry unavailable; check database migration 0026.") from exc


@router.get("/api/models")
def list_versions(limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                  db: Session = Depends(get_db), _auth: Users = Depends(require_admin)):
    def read(db):
        rows = db.query(ModelVersion).order_by(ModelVersion.created_at.desc(), ModelVersion.version.desc()).offset(offset).limit(limit).all()
        return [registry.serialize_version(row) for row in rows]
    return _operation(db, read)


@router.post("/api/models/initialize")
def initialize(db: Session = Depends(get_db), actor: Users = Depends(require_admin)):
    return registry.serialize_version(_operation(db, registry.initialize_registry, actor.user_id))


@router.get("/api/models/summary")
def model_summary(db: Session = Depends(get_db), _auth: Users = Depends(require_admin)):
    return _operation(db, registry.registry_summary)


@router.post("/api/models/retrain", status_code=202)
def retrain(db: Session = Depends(get_db), actor: Users = Depends(require_admin)):
    return registry.serialize_version(_operation(db, registry.start_retrain, actor.user_id))


@router.get("/api/models/{version}")
def model_status(version: str, db: Session = Depends(get_db), _auth: Users = Depends(require_admin)):
    return registry.serialize_version(_operation(db, registry.get_version, version))


@router.get("/api/models/{version}/report")
def model_report(version: str, db: Session = Depends(get_db), _auth: Users = Depends(require_admin)):
    from services.model_promoter import promotion_readiness
    row = _operation(db, registry.get_version, version)
    return {"version": row.version, "status": row.status, "report": row.report,
            "error": row.error, **_operation(db, promotion_readiness, row)}


@router.get("/api/models/{version}/preview")
def model_preview(version: str, db: Session = Depends(get_db), _auth: Users = Depends(require_admin)):
    return _operation(db, registry.preview_version, version)


@router.post("/api/models/{version}/reject")
def reject(version: str, db: Session = Depends(get_db), actor: Users = Depends(require_admin)):
    return registry.serialize_version(_operation(db, registry.reject_version, version, actor.user_id))


@router.post("/api/models/{version}/promote")
async def promote(version: str, body: PromoteRequest, actor: Users = Depends(require_admin)):
    from services.model_promoter import promote_and_reload
    try:
        return await promote_and_reload(version, actor.user_id, body.expected_champion)
    except registry.RegistryError as exc:
        raise HTTPException(exc.status_code, str(exc)) from exc
    except (SQLAlchemyError, ValueError, OSError, KeyError, RuntimeError) as exc:
        logger.exception("Model promotion failed; inspect registry and routing state")
        raise HTTPException(503, "Model promotion could not complete; inspect model status and the server log.") from exc
