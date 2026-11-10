"""Import real BFP history without synthesizing missing operational evidence.

Preview is read-only. Apply requires the exact preview plan and a verified backup.
Coordinates and barangay names come directly from the CSV, never spatial inference.
"""
import argparse
import csv
import hashlib
import json
import math
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text

PHT = timezone(timedelta(hours=8))
SOURCE = 'bfp_operational_csv'
TIMING_FIELDS = ('report_received_at', 'suppression_started_at', 'fire_out_at', 'operation_completed_at')


def read_rows(path):
    with open(path, encoding='utf-8-sig', newline='') as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise ValueError('The CSV is empty.')
    seen, facts = set(), set()
    for row in rows:
        key = row['record_id']
        date = datetime.strptime(row['incident_date'], '%Y-%m-%d').date()
        if key in seen:
            raise ValueError(f'Duplicate record ID: {key}')
        seen.add(key)
        fact = tuple(row[k] for k in ('incident_date', 'raw_location', 'general_category_raw', 'sub_category_raw', 'cause_raw'))
        if fact in facts:
            raise ValueError(f'Duplicate source incident: {key}')
        facts.add(fact)
        if date.year != int(row['incident_year']):
            raise ValueError(f'Inconsistent year: {key}')
        lat, lng = float(row['latitude']), float(row['longitude'])
        if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValueError(f'Invalid coordinates: {key}')
        if len(row['raw_location']) > 255 or len(row['barangay_clean']) > 255:
            raise ValueError(f'Location exceeds the database field length: {key}')
        # This import contract covers the supplied date-only history. Refuse to
        # silently discard newly supplied measurements in a future source file.
        for field in ('incident_time', 'official_alarm_level', 'official_severity',
                      'casualties', 'estimated_damage_php', 'units_responded'):
            if row[field] != 'Not recorded':
                raise ValueError(f'{field} contains source evidence requiring a reviewed mapping: {key}')
        if row['synthetic_alarm_level'] not in ('1st Alarm', '2nd Alarm', '3rd Alarm', '4th Alarm', '5th Alarm', 'Task Force Alpha', 'Task Force Bravo', 'General Alarm'):
            raise ValueError(f'Unrecognized annotated alarm level: {key}')
    return rows


def fingerprint(row):
    fact = [row[k] for k in ('raw_location', 'incident_date', 'general_category_raw', 'sub_category_raw', 'cause_raw')]
    return 'bfp-panabo-2023-2024:' + hashlib.sha256(json.dumps(fact, ensure_ascii=False).encode()).hexdigest()


def replacement_plan(conn, rows):
    seeds = conn.execute(text("""SELECT f.fire_id, f.fire_status, e.event_metadata
        FROM fire_incidents f JOIN incident_events e USING(fire_id)
        WHERE e.source='analysis_seed_v1' AND e.event_type='analysis_seed'
        ORDER BY f.fire_id""")).mappings().all()
    ids = [s['fire_id'] for s in seeds]
    if len(set(ids)) != len(ids) or any(not s['event_metadata'].get('synthetic') for s in seeds):
        raise ValueError('Synthetic provenance is ambiguous; no replacement is allowed.')
    if any(s['fire_status'] not in ('closed', 'cancelled', 'canceled', 'recalled') for s in seeds):
        raise ValueError('A synthetic incident is active; stop and review its live assignments.')
    params = {'ids': ids}
    changed = conn.execute(text("""SELECT DISTINCT fire_id FROM incident_events
        WHERE fire_id=ANY(:ids) AND source IS DISTINCT FROM 'analysis_seed_v1'
        AND source IS DISTINCT FROM 'admin_archive'"""), params).scalars().all()
    if changed:
        raise ValueError(f'Seeded incidents have later operational edits: {changed}')
    photos = conn.execute(text("""SELECT count(*) FROM report_photos p JOIN incident_reports r USING(report_id)
        WHERE r.fire_id=ANY(:ids)"""), params).scalar_one()
    if photos:
        raise ValueError('Seeded incidents have attached photos; review before replacing.')
    imports = conn.execute(text("""SELECT f.fire_id, e.event_metadata->>'record_id' AS record_id
        FROM fire_incidents f JOIN incident_events e USING(fire_id)
        WHERE e.event_type='bfp_import'""")).mappings().all()
    source_ids = {r['record_id'] for r in rows}
    by_record = {}
    for item in imports:
        if item['record_id'] in source_ids:
            if item['record_id'] in by_record:
                raise ValueError('Multiple imports of one source record require manual review.')
            by_record[item['record_id']] = item['fire_id']
    boundaries = dict(conn.execute(text('SELECT brgy_name, brgy_id FROM barangay_boundaries')).all())
    for row in rows:
        if row['barangay_clean'] != 'Not identified' and row['barangay_clean'] not in boundaries:
            raise ValueError(f"Unmatched source barangay: {row['barangay_clean']}")
    linked = {}
    for table in ('dispatch_records', 'routes', 'incident_reports', 'heatmap_data', 'incident_events'):
        linked[table] = conn.execute(text(f'SELECT count(*) FROM {table} WHERE fire_id=ANY(:ids)'), params).scalar_one()
    plan = {'synthetic_ids': ids, 'existing_imports': by_record, 'source_record_ids': sorted(source_ids),
            'source_sha256': hashlib.sha256(json.dumps(rows, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
            'related_synthetic_rows': linked,
            'preserved_incidents': conn.execute(text('SELECT count(*) FROM fire_incidents WHERE NOT(fire_id=ANY(:ids))'), params).scalar_one()}
    plan['plan_sha256'] = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()
    return plan


def table_digest(conn, table, where='', params=None):
    return conn.execute(text(f"""SELECT md5(COALESCE(string_agg(row_to_json(t)::text, ''
        ORDER BY row_to_json(t)::text), '')) FROM (SELECT * FROM {table} {where}) t"""), params or {}).scalar_one()


def preserved_digests(conn, ids):
    result = {}
    excluded = ('fire_incidents', 'dispatch_records', 'dispatch_trucks', 'dispatch_locations',
                'routes', 'incident_reports', 'report_photos', 'incident_events', 'heatmap_data', 'truck_logs')
    tables = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).scalars()
    for table in tables:
        if table not in excluded:
            # Names come from PostgreSQL's catalog, never from the source file.
            quoted = conn.dialect.identifier_preparer.quote(table)
            result[table] = table_digest(conn, quoted)
    params = {'ids': ids}
    conditions = {
        'fire_incidents': 'fire_id=ANY(:ids)',
        'dispatch_records': 'fire_id=ANY(:ids)',
        'routes': 'fire_id=ANY(:ids)',
        'incident_reports': 'fire_id=ANY(:ids)',
        'incident_events': 'fire_id=ANY(:ids)',
        'heatmap_data': 'fire_id=ANY(:ids)',
        'dispatch_trucks': 'dispatch_id IN (SELECT dispatch_id FROM dispatch_records WHERE fire_id=ANY(:ids))',
        'dispatch_locations': 'dispatch_id IN (SELECT dispatch_id FROM dispatch_records WHERE fire_id=ANY(:ids))',
        'report_photos': 'report_id IN (SELECT report_id FROM incident_reports WHERE fire_id=ANY(:ids))',
        'truck_logs': 'dispatch_truck_id IN (SELECT dt.dispatch_truck_id FROM dispatch_trucks dt JOIN dispatch_records d USING(dispatch_id) WHERE d.fire_id=ANY(:ids))',
    }
    for table, condition in conditions.items():
        result[table] = table_digest(conn, table, f'WHERE NOT COALESCE(({condition}),false)', params)
    return result


def source_metadata(row):
    meta = {k: v for k, v in row.items() if not k.startswith('synthetic_')}
    meta.update(source_file='fire_incidents_2023_2024_cleaned_geocoded_review.csv',
                occurrence_precision='date_only', timing_basis='not_recorded', alarm_basis='user_annotation',
                alarm_annotation={'level': row['synthetic_alarm_level'], 'source_column': 'synthetic_alarm_level',
                                  'basis': row['synthetic_alarm_basis'], 'confidence': row['synthetic_alarm_confidence']},
                point_heatmap_eligible='Yes', import_latitude=float(row['latitude']), import_longitude=float(row['longitude']),
                pin_specification={'basis': 'source_csv', 'label': 'BFP CSV coordinates',
                    'specification': 'Coordinates and barangay retained exactly from the supplied CSV. Source geocode review flags are preserved; no boundary-based relocation or reassignment was applied.',
                    'latitude': float(row['latitude']), 'longitude': float(row['longitude']), 'verified': False,
                    'source_address': row['raw_location']})
    return meta


def apply_import(conn, rows, reviewed_plan):
    conn.execute(text("SET LOCAL lock_timeout='10s'"))
    conn.execute(text("SET LOCAL statement_timeout='120s'"))
    conn.execute(text('''LOCK TABLE fire_incidents,dispatch_records,dispatch_trucks,dispatch_locations,
        routes,incident_reports,report_photos,incident_events,heatmap_data,truck_logs IN SHARE ROW EXCLUSIVE MODE'''))
    current = replacement_plan(conn, rows)
    if current != reviewed_plan:
        raise ValueError('The source or database changed after preview. Regenerate the plan.')
    ids = current['synthetic_ids']
    # Never erase existing imported history or create duplicate source records.
    existing = list(current['existing_imports'].values())
    if existing:
        raise ValueError('BFP imports already exist. Use validation for this completed batch; review corrections separately.')
    before = preserved_digests(conn, ids)
    params = {'ids': ids}
    for statement in (
        'DELETE FROM truck_logs WHERE dispatch_truck_id IN (SELECT dt.dispatch_truck_id FROM dispatch_trucks dt JOIN dispatch_records d USING(dispatch_id) WHERE d.fire_id=ANY(:ids))',
        'DELETE FROM incident_events WHERE fire_id=ANY(:ids)',
        'DELETE FROM incident_reports WHERE fire_id=ANY(:ids)',
        'UPDATE dispatch_records SET route_id=NULL WHERE fire_id=ANY(:ids)',
        'DELETE FROM dispatch_trucks WHERE dispatch_id IN (SELECT dispatch_id FROM dispatch_records WHERE fire_id=ANY(:ids))',
        'DELETE FROM routes WHERE fire_id=ANY(:ids)',
        'DELETE FROM dispatch_records WHERE fire_id=ANY(:ids)',
        'DELETE FROM heatmap_data WHERE fire_id=ANY(:ids)',
        'DELETE FROM fire_incidents WHERE fire_id=ANY(:ids)',
    ):
        conn.execute(text(statement), params)
    if before != preserved_digests(conn, []):
        raise RuntimeError('Deletion changed unrelated data; transaction must roll back.')
    boundaries = dict(conn.execute(text('SELECT brgy_name,brgy_id FROM barangay_boundaries')).all())
    inserted = []
    for row in rows:
        meta = source_metadata(row)
        values = {'barangay': row['barangay_clean'], 'address': row['raw_location'],
                  'alarm': row['synthetic_alarm_level'],
                  'lat': float(row['latitude']), 'lng': float(row['longitude']),
                  'property': row['general_category_clean'], 'brgy_id': boundaries.get(row['barangay_clean']),
                  'date': datetime.fromisoformat(row['incident_date']).replace(tzinfo=PHT),
                  'remarks': f"BFP Panabo station historical incident {row['record_id']}. Incident date only; time, official alarm, severity, casualties, damage and responding units were not recorded. Coordinates and barangay preserved from supplied CSV. Cause: {row['cause_clean']}."}
        fire_id = conn.execute(text("""INSERT INTO fire_incidents
            (fire_location_source,fire_location_name,fire_address,fire_latitude,fire_longitude,
             fire_severity,fire_status,fire_alarm_level,fire_dispatch_type,fire_structure_type,
             fire_casualties,fire_units_assigned,fire_remarks,fire_incident_datetime,response_kind,record_kind,brgy_id)
            VALUES ('bfp_historical_import',:barangay,:address,:lat,:lng,NULL,'closed',:alarm,
             'Firefighting Operations',:property,NULL,NULL,:remarks,:date,'fire','operational',:brgy_id)
            RETURNING fire_id"""), values).scalar_one()
        conn.execute(text("""INSERT INTO incident_events
            (fire_id,event_type,event_actor,created_at,occurred_at,source,verified,idempotency_key,event_metadata)
            VALUES (:id,'bfp_import','BFP Panabo CSV import',now(),:date,:source,false,:key,CAST(:meta AS jsonb))"""),
            {'id': fire_id, 'date': values['date'], 'source': SOURCE, 'key': fingerprint(row), 'meta': json.dumps(meta)})
        conn.execute(text("""INSERT INTO heatmap_data
            (fire_id,heatmap_latitude,heatmap_longitude,heatmap_severity_weight,heatmap_density_value,heatmap_generated_at)
            VALUES (:id,:lat,:lng,0.5,NULL,now())"""), {'id': fire_id, 'lat': values['lat'], 'lng': values['lng']})
        inserted.append(fire_id)
    # Compare everything outside the new imported IDs with the post-deletion baseline.
    if before != preserved_digests(conn, inserted):
        raise RuntimeError('Import changed unrelated data; transaction must roll back.')
    validation = validate_import(conn, rows)
    return {'deleted_synthetic_incidents': len(ids), 'imported_incidents': len(inserted),
            'preserved_incidents': current['preserved_incidents'], 'protected_data_unchanged': True,
            'validation': validation}


def validate_import(conn, rows):
    imported = conn.execute(text("""SELECT f.*,e.event_metadata,
        (SELECT count(*) FROM heatmap_data h WHERE h.fire_id=f.fire_id) AS heatmap_count,
        (SELECT count(*) FROM dispatch_records d WHERE d.fire_id=f.fire_id) AS dispatch_count,
        (SELECT count(*) FROM incident_reports r WHERE r.fire_id=f.fire_id) AS report_count,
        (SELECT count(*) FROM routes r WHERE r.fire_id=f.fire_id) AS route_count,
        (SELECT count(*) FROM heatmap_data h WHERE h.fire_id=f.fire_id AND
         h.heatmap_latitude=f.fire_latitude AND h.heatmap_longitude=f.fire_longitude) AS matching_heatmap_count
        FROM fire_incidents f JOIN incident_events e USING(fire_id)
        WHERE e.event_type='bfp_import' AND e.source=:source"""), {'source': SOURCE}).mappings().all()
    by_record = {r['event_metadata']['record_id']: r for r in imported}
    if len(imported) != len(rows) or len(by_record) != len(rows):
        raise AssertionError('Imported source-record count mismatch.')
    for row in rows:
        inc = by_record[row['record_id']]
        assert inc['fire_latitude'] == float(row['latitude']) and inc['fire_longitude'] == float(row['longitude'])
        assert inc['fire_location_name'] == row['barangay_clean']
        assert inc['fire_address'] == row['raw_location']
        assert inc['fire_incident_datetime'].astimezone(PHT).date().isoformat() == row['incident_date']
        assert all(inc[field] is None for field in (*TIMING_FIELDS, 'fire_severity', 'fire_casualties', 'fire_units_assigned'))
        assert inc['fire_alarm_level'] == row['synthetic_alarm_level']
        assert inc['record_kind'] == 'operational' and inc['response_kind'] == 'fire'
        assert inc['heatmap_count'] == inc['matching_heatmap_count'] == 1
        assert inc['dispatch_count'] == inc['report_count'] == inc['route_count'] == 0
        assert inc['event_metadata'] == source_metadata(row)
    return {'records': len(rows), 'coordinates_exact': True, 'barangays_exact': True,
            'missing_operational_details_unknown': True, 'alarms_match_user_annotations': True,
            'heatmap_rows': len(rows), 'fabricated_assignments': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('csv', type=Path)
    parser.add_argument('--plan', type=Path)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--backup', type=Path)
    parser.add_argument('--validate', action='store_true')
    args = parser.parse_args()
    from database import engine
    rows = read_rows(args.csv)
    if args.validate:
        with engine.connect() as conn:
            conn.execute(text('SET TRANSACTION READ ONLY'))
            print(json.dumps(validate_import(conn, rows), indent=2))
        return
    if args.apply:
        if not args.plan or not args.backup or not args.backup.is_file() or args.backup.stat().st_size == 0:
            parser.error('Apply requires a reviewed --plan and a nonempty --backup.')
        reviewed = json.loads(args.plan.read_text(encoding='utf-8'))
        restore = shutil.which('pg_restore')
        if not restore:
            paths = sorted(Path('C:/Program Files/PostgreSQL').glob('*/bin/pg_restore.exe'), reverse=True)
            restore = str(paths[0]) if paths else None
        if not restore or subprocess.run([restore, '--list', str(args.backup)], capture_output=True).returncode:
            raise RuntimeError('The database backup cannot be listed; no changes were made.')
        with engine.begin() as conn:
            result = apply_import(conn, rows, reviewed)
        print(json.dumps(result, indent=2))
    else:
        with engine.connect() as conn:
            conn.execute(text('SET TRANSACTION READ ONLY'))
            plan = replacement_plan(conn, rows)
        if args.plan:
            args.plan.parent.mkdir(parents=True, exist_ok=True)
            args.plan.write_text(json.dumps(plan, indent=2), encoding='utf-8')
        print(json.dumps(plan, indent=2))


if __name__ == '__main__':
    main()
