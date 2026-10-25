"""Admin-only response analytics. Query dependencies are shared by rows and CSV."""
import csv
import io
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func

from database import get_db
from models import Users, ResponseTeam, FireIncident
from security import require_admin
from services import response_performance as performance
from services import response_operations as operations

router = APIRouter(prefix="/api/metrics/response-performance", tags=["metrics"], dependencies=[Depends(require_admin)])


def filters(start: datetime | None = None, end: datetime | None = None,
            record_kind: Literal['operational', 'drill', 'test', 'unknown', 'all'] = 'operational',
            team_id: list[int] = Query(default=[]), station_id: int | None = Query(None, ge=1),
            barangay_id: int | None = Query(None, ge=1), severity: Literal['Minor', 'Moderate', 'Critical'] | None = None,
            all_dates: bool = False, db: Session = Depends(get_db)):
    if all_dates:
        start = db.query(func.min(func.coalesce(FireIncident.report_received_at, FireIncident.fire_incident_datetime))).scalar()
    start, end = performance.window(start, end)
    if len(team_id) > 50 or any(t < 1 for t in team_id):
        raise HTTPException(422, "Select up to 50 valid team IDs.")
    if team_id and db.query(ResponseTeam).filter(ResponseTeam.team_id.in_(team_id)).count() != len(set(team_id)):
        raise HTTPException(422, "Unknown team ID.")
    return dict(start=start, end=end, kind=record_kind, team_ids=team_id,
                station_id=station_id, barangay_id=barangay_id, severity=severity)


@router.get("")
def summary(params: dict = Depends(filters), db: Session = Depends(get_db), user: Users = Depends(require_admin)):
    return performance.analytics(db, **params)


@router.get("/dispatches")
def dispatches(params: dict = Depends(filters), page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
               db: Session = Depends(get_db), user: Users = Depends(require_admin)):
    rows = performance.load(db, **params)
    page = min(page, max(1, (len(rows)+page_size-1)//page_size))
    return {"records": rows[(page-1)*page_size:page*page_size], "total": len(rows), "page": page,
            "page_size": page_size, "total_pages": max(1, (len(rows)+page_size-1)//page_size)}


def operation_filters(params: dict = Depends(filters), source: Literal['recorded', 'demo'] = 'recorded'):
    return {**params, "source": source}


@router.get("/operations")
def operation_summary(params: dict = Depends(operation_filters), db: Session = Depends(get_db)):
    return operations.analytics(db, **params)


@router.get("/incidents")
def incidents(params: dict = Depends(operation_filters), page: int = Query(1, ge=1),
              page_size: int = Query(10, ge=1, le=100), db: Session = Depends(get_db)):
    return operations.records(db, page=page, page_size=page_size, **params)


def csv_cell(value):
    value = "" if value is None else str(value)
    return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value


@router.get("/incidents.csv")
def incident_export(params: dict = Depends(operation_filters), db: Session = Depends(get_db)):
    rows = [operations.record(i, params["source"]) for i in operations.incidents(db, **params)]
    columns = ["fire_id", "record_kind", "reported_at", "occurred_at", "location", "status", "timing_basis",
               "dispatch_count", "unit_count", "operation_completed_at"]
    columns += [f"{key}_{suffix}" for key in operations.METRICS for suffix in ("seconds", "quality", "reason")]

    def generate():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(columns)
        yield "\ufeff" + buffer.getvalue()
        for row in rows:
            buffer.seek(0)
            buffer.truncate()
            flattened = dict(row)
            for key in operations.METRICS:
                flattened[f"{key}_seconds"] = row["durations"].get(key)
                metric = row["metrics"].get(key, {})
                flattened[f"{key}_quality"] = metric.get("quality")
                flattened[f"{key}_reason"] = metric.get("reason")
            writer.writerow([csv_cell(flattened.get(column)) for column in columns])
            yield buffer.getvalue()
    return StreamingResponse(generate(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="response-operations-incidents.csv"'})


@router.get("/export.csv")
def export(params: dict = Depends(filters), db: Session = Depends(get_db), user: Users = Depends(require_admin)):
    rows = performance.load(db, **params)
    columns = ["dispatch_id", "fire_id", "team_id", "team_name", "station_name", "shift_name", "truck",
               "context_provenance", "record_kind", "location", "severity", "reinforcement", "status",
               "report_received_at", "dispatch_at", "acknowledged_at", "departed_at", "arrived_at"]
    columns += [f"{key}_{suffix}" for key in performance.MEASURES for suffix in ("seconds", "raw_seconds", "quality", "reason")]

    def generate():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(columns)
        yield "\ufeff" + buffer.getvalue()
        for row in rows:
            buffer.seek(0); buffer.truncate()
            flattened = {**row, **row["context"], "context_provenance": row["context"]["provenance"]}
            for key, metric in row["metrics"].items():
                flattened.update({f"{key}_{suffix}": metric.get(suffix) for suffix in ("seconds", "raw_seconds", "quality", "reason")})
            writer.writerow([csv_cell(flattened.get(column)) for column in columns])
            yield buffer.getvalue()
    return StreamingResponse(generate(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="response-performance.csv"'})


@router.get("/dispatches/{dispatch_id}")
def detail(dispatch_id: int, db: Session = Depends(get_db), user: Users = Depends(require_admin)):
    return performance.dispatch_detail(db, dispatch_id)
