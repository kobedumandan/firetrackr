"""Administrator reports: one source for screen rows and full filtered CSV."""
import csv
import io
import json
from datetime import datetime
from statistics import mean, median
from typing import Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import get_db
from security import require_admin
from services import personnel_deployment, fire_prone_areas
from services.operational_times import load_incidents, record_dict, detail, METRICS, EXCLUDED
from services.response_performance import window
from routers.response_performance import csv_cell

router = APIRouter(prefix='/api/reports', tags=['reports'], dependencies=[Depends(require_admin)])
Kind = Literal['operational', 'drill', 'test', 'unknown', 'all']


def csv_response(rows, columns, filename):
    def generate():
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(columns)
        yield '\ufeff' + buffer.getvalue()
        for row in rows:
            buffer.seek(0)
            buffer.truncate()
            writer.writerow([csv_cell(json.dumps(row.get(c)) if isinstance(row.get(c), (dict, list)) else row.get(c)) for c in columns])
            yield buffer.getvalue()
    return StreamingResponse(generate(), media_type='text/csv', headers={'Content-Disposition': f'attachment; filename="{filename}"'})


def deployment_filters(start: datetime | None = None, end: datetime | None = None, kind: Kind = 'operational',
                       per_id: int | None = None, team_id: int | None = None, station_id: int | None = None, shift: str | None = None):
    return dict(start=start, end=end, kind=kind, per_id=per_id, team_id=team_id, station_id=station_id, shift=shift)


@router.get('/personnel-deployment')
def deployment(params: dict = Depends(deployment_filters), db: Session = Depends(get_db)):
    return personnel_deployment.report(db, **params)


@router.get('/personnel-deployment.csv')
def deployment_csv(params: dict = Depends(deployment_filters), db: Session = Depends(get_db)):
    report = personnel_deployment.report(db, **params)
    return csv_response(report['rows'], ['per_id', 'name', 'rank', 'role', 'dispatch_id', 'fire_id', 'team', 'station', 'shift',
        'record_kind', 'assigned_at', 'released_at', 'status', 'duration_seconds', 'duration_quality', 'acknowledgement_basis'], 'personnel-deployment.csv')


@router.get('/personnel-deployment-summary.csv')
def deployment_summary_csv(params: dict = Depends(deployment_filters), db: Session = Depends(get_db)):
    report = personnel_deployment.report(db, **params)
    return csv_response(report['personnel'], ['per_id', 'name', 'assignments', 'unique_incidents', 'completed_assignments',
        'cancelled_assignments', 'deployment_seconds', 'duration_coverage', 'roles'], 'personnel-deployment-summary.csv')


def historical_filters(start: datetime | None = None, end: datetime | None = None,
                       kind: Literal['historical', 'operational', 'unknown', 'drill', 'test', 'all'] = 'historical', known_only: bool = False,
                       source: Literal['all', 'imported', 'other'] = 'all'):
    return dict(start=start, end=end, kind=kind, known_only=known_only, source=source)


@router.get('/fire-prone-areas')
def fire_areas(params: dict = Depends(historical_filters), db: Session = Depends(get_db)):
    return fire_prone_areas.report(db, **params)


@router.get('/fire-prone-areas.csv')
def fire_areas_csv(params: dict = Depends(historical_filters), db: Session = Depends(get_db)):
    report = fire_prone_areas.report(db, **params)
    rows = [{**row, **{s: row['severity_counts'].get(s, 0) for s in ('minor', 'moderate', 'critical')}} for row in report['rows']]
    return csv_response(rows, ['rank', 'barangay', 'incident_count', 'weighted_score', 'minor', 'moderate', 'critical',
        'missing_severity_count', 'estimated_locations', 'unknown_record_kind'], 'fire-prone-areas.csv')


def timing_filters(start: datetime | None = None, end: datetime | None = None, kind: Kind = 'operational'):
    start, end = window(start, end)
    return dict(start=start, end=end, kind=kind)


def timing_incidents(db, start, end, kind):
    return [inc for inc in load_incidents(db, start, end) if kind == 'all' or (inc.record_kind or 'unknown') == kind]


def eta_report(db, start, end, kind):
    rows = []
    for inc in timing_incidents(db, start, end, kind):
        for unit in detail(db, inc)['units']:
            eligible = bool(unit['eta_comparable'] and unit['difference_seconds'] is not None
                and unit['eta_seconds'] is not None and unit['eta_seconds'] > 0
                and unit['status'] not in EXCLUDED and inc.fire_status not in EXCLUDED)
            rows.append({'fire_id': inc.fire_id, 'unit_id': unit['id'], 'dispatch_id': unit['dispatch_id'], 'truck': unit['truck'],
                'predicted_seconds': unit['eta_seconds'], 'actual_seconds': unit['durations']['travel'],
                'error_seconds': unit['difference_seconds'] if eligible else None,
                'absolute_error_seconds': abs(unit['difference_seconds']) if eligible else None,
                'error_percent': unit['difference_seconds'] / unit['eta_seconds'] * 100 if eligible else None,
                'eligible': eligible, 'reason': None if eligible else unit['eta_comparison_note'] or 'Missing or excluded timing evidence.'})
    valid = [r for r in rows if r['eligible']]
    return {'rows': rows, 'eligible_count': len(valid), 'excluded_count': len(rows)-len(valid),
        'mean_error_seconds': mean(r['error_seconds'] for r in valid) if valid else None,
        'mae_seconds': mean(r['absolute_error_seconds'] for r in valid) if valid else None,
        'median_absolute_error_seconds': median(r['absolute_error_seconds'] for r in valid) if valid else None,
        'notice': 'Error = actual travel minus saved predicted travel. Percentage denominator is predicted travel. Only comparable recorded trips enter summaries.'}


@router.get('/eta-accuracy')
def eta_accuracy(params: dict = Depends(timing_filters), db: Session = Depends(get_db)):
    return eta_report(db, **params)


@router.get('/eta-accuracy.csv')
def eta_csv(params: dict = Depends(timing_filters), db: Session = Depends(get_db)):
    return csv_response(eta_report(db, **params)['rows'], ['fire_id', 'unit_id', 'dispatch_id', 'truck',
        'predicted_seconds', 'actual_seconds', 'error_seconds', 'absolute_error_seconds', 'error_percent', 'eligible', 'reason'], 'eta-accuracy.csv')


@router.get('/operational-times.csv')
def operational_csv(source: Literal['recorded', 'demo'] = 'recorded', params: dict = Depends(timing_filters), db: Session = Depends(get_db)):
    from services.historical_incidents import demo_times
    rows = []
    for inc in timing_incidents(db, **params):
        if bool(demo_times(inc)) != (source == 'demo'):
            continue
        record = record_dict(inc)
        rows.append({**record, **{f'{key}_seconds': record['durations'].get(key) for key in METRICS}})
    return csv_response(rows, ['fire_id', 'record_kind', 'reported_at', 'occurred_at', 'status', 'timing_basis', 'operation_completed_at',
        *[f'{key}_seconds' for key in METRICS]], 'operational-times.csv')
