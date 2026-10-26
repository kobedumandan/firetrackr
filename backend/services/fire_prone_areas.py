"""Historical concentration rankings using the heatmap's incident population."""
from collections import Counter

from fastapi import HTTPException
from sqlalchemy import func, text

from models import BarangayBoundary, FireIncident, HeatmapData
from services.heatmap import severity_weight
from services.historical_incidents import attach_history, history


def historical_rows(db, start=None, end=None, kind='historical', known_only=False, source='all'):
    if any(at is not None and at.tzinfo is None for at in (start, end)) or (start and end and start >= end):
        raise HTTPException(422, 'Choose an increasing, timezone-aware historical date range.')
    if kind not in ('historical', 'operational', 'unknown', 'drill', 'test', 'all'):
        raise HTTPException(422, 'Unknown historical record kind.')
    if source not in ('all', 'imported', 'other'):
        raise HTTPException(422, 'Unknown incident source filter.')
    query = db.query(FireIncident).filter(FireIncident.fire_status == 'closed',
        db.query(HeatmapData.heatmap_id).filter(HeatmapData.fire_id == FireIncident.fire_id).exists())
    if kind == 'historical':
        query = query.filter(func.coalesce(FireIncident.record_kind, 'unknown').in_(['operational', 'unknown']))
    elif kind != 'all':
        query = query.filter(func.coalesce(FireIncident.record_kind, 'unknown') == kind)
    if source == 'imported':
        query = query.filter(FireIncident.fire_location_source == 'bfp_historical_import')
    elif source == 'other':
        query = query.filter(func.coalesce(FireIncident.fire_location_source, '') != 'bfp_historical_import')
    if start:
        query = query.filter(FireIncident.fire_incident_datetime >= start)
    if end:
        query = query.filter(FireIncident.fire_incident_datetime < end)
    # The same Panabo boundary gate is used for the map points and the report.
    query = query.filter(text('EXISTS (SELECT 1 FROM barangay_boundaries boundary WHERE ST_Covers(boundary.brgy_polygon, ST_SetSRID(ST_MakePoint(fire_incidents.fire_longitude, fire_incidents.fire_latitude),4326)))'))
    rows = attach_history(db, query.order_by(FireIncident.fire_id).all())
    return [r for r in rows if not known_only or (r.fire_severity or '').strip().lower() in ('minor', 'moderate', 'critical')]


def rank_rows(incidents, barangays, fallback=None):
    names = {b.brgy_id: b.brgy_name for b in barangays}
    grouped, unassigned = {}, 0
    for inc in incidents:
        brgy_id = inc.brgy_id
        if brgy_id is None and inc.fire_location_source != 'bfp_historical_import':
            brgy_id = (fallback or {}).get(inc.fire_id)
        if brgy_id not in names:
            unassigned += 1
            continue
        row = grouped.setdefault(brgy_id, {'brgy_id': brgy_id, 'barangay': names[brgy_id], 'incident_count': 0,
            'severity_counts': Counter(), 'weighted_score': 0, 'estimated_locations': 0, 'unknown_record_kind': 0})
        severity = (inc.fire_severity or '').strip().lower()
        severity = severity if severity in ('minor', 'moderate', 'critical') else 'unknown'
        row['incident_count'] += 1
        row['severity_counts'][severity] += 1
        row['weighted_score'] += severity_weight(inc.fire_severity)
        row['estimated_locations'] += bool(history(inc)) and not history(inc).get('pin_specification', {}).get('verified', False)
        row['unknown_record_kind'] += inc.record_kind in (None, 'unknown')
    rows = sorted(grouped.values(), key=lambda r: (-round(r['weighted_score'], 1), r['barangay']))
    prior, rank = None, 0
    for index, row in enumerate(rows, 1):
        row['weighted_score'] = round(row['weighted_score'], 1)
        if row['weighted_score'] != prior:
            rank = index
        row['rank'] = rank
        row['severity_counts'] = dict(row['severity_counts'])
        row['missing_severity_count'] = row['severity_counts'].get('unknown', 0)
        prior = row['weighted_score']
    return {'rows': rows, 'incident_count': len(incidents), 'unassigned_incidents': unassigned,
            'formula': 'Sum of incident weights: Minor 0.4, Moderate 0.7, Critical 1.0, unknown 0.5.',
            'notice': 'Historical concentration, not a prediction of future fire probability. Estimated locations and missing severity limit interpretation.'}


def report(db, start=None, end=None, kind='historical', known_only=False, source='all'):
    incidents = historical_rows(db, start, end, kind, known_only, source)
    fallback = {}
    ids = [r.fire_id for r in incidents if r.brgy_id is None and r.fire_location_source != 'bfp_historical_import']
    if ids:
        from sqlalchemy import bindparam
        rows = db.execute(text('''SELECT fi.fire_id, (SELECT b.brgy_id FROM barangay_boundaries b
          WHERE ST_Covers(b.brgy_polygon, ST_SetSRID(ST_MakePoint(fi.fire_longitude, fi.fire_latitude),4326))
          ORDER BY b.brgy_id LIMIT 1) AS brgy_id FROM fire_incidents fi WHERE fi.fire_id IN :ids''').bindparams(bindparam('ids', expanding=True)), {'ids': ids})
        fallback = {r.fire_id: r.brgy_id for r in rows}
    return {**rank_rows(incidents, db.query(BarangayBoundary).all(), fallback), 'record_kind': kind, 'known_only': known_only, 'source': source,
            'start': start.isoformat() if start else None, 'end': end.isoformat() if end else None}
