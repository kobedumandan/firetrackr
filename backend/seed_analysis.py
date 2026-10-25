"""Populate Analysis in the configured LOCAL database using existing incidents.

Preview: python seed_analysis.py
Apply:   python seed_analysis.py --apply

Generated incidents use the normal operational population for the local demo.
Synthetic provenance remains in the audit metadata. Application
handlers are deliberately not called: no notifications or live resource changes.
"""
import argparse
import copy
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
import random
import shutil
import subprocess
from zoneinfo import ZoneInfo

from dotenv import load_dotenv
from shapely import wkt
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, selectinload

BACKEND = Path(__file__).resolve().parent
load_dotenv(BACKEND / '.env')

from models import (DispatchRecord, DispatchTruck, FireIncident, HeatmapData,
                    IncidentEvent, IncidentReport, ResponseTeam, ResponseTeamMember,
                    Route, TruckLog)
from services.operational_times import distance_m, iso
from services.heatmap import severity_weight

SOURCE = 'analysis_seed_v1'
RECORD_KIND = 'operational'
MANILA = ZoneInfo('Asia/Manila')
LOCK = 9142031
SEED = 20261024
QUALITY_CASES = (
    'reinforcement_first', 'cancelled', 'recalled', 'missing_receipt',
    'missing_acknowledgement', 'missing_departure', 'missing_arrival',
    'gps_gap', 'no_gps', 'origin_mismatch', 'no_baseline', 'route_revision',
    'missing_roster', 'roster_change', 'missing_clearance', 'clock_error',
    'above_six_hours', 'medical', 'rescue', 'unknown_severity',
)
INCIDENT_FIELDS = ('record_kind', 'report_received_at', 'suppression_started_at',
                   'fire_out_at', 'operation_completed_at', 'response_kind',
                   'fire_units_assigned', 'brgy_id', 'fire_remarks')


def target_url():
    url = make_url(os.environ['DATABASE_URL'])
    if url.get_backend_name() != 'postgresql' or url.host not in ('localhost', '127.0.0.1', '::1'):
        raise RuntimeError('This demonstration seeder requires a local PostgreSQL database.')
    return url


def pg_tool(name):
    executable = shutil.which(name)
    if not executable:
        versions = sorted(Path('C:/Program Files/PostgreSQL').glob(f'*/bin/{name}.exe'), reverse=True)
        executable = str(versions[0]) if versions else None
    if not executable:
        raise RuntimeError(f'{name} is required for the database backup.')
    return executable


def pg_environment(url):
    return {**os.environ, 'PGHOST': url.host, 'PGPORT': str(url.port or 5432),
            'PGUSER': url.username or 'postgres', 'PGPASSWORD': url.password or ''}


def backup_database(url, folder):
    folder.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(MANILA).strftime('%Y%m%d-%H%M%S-%f')
    # Avoid interpolating a database name into a filesystem path or SQL identifier.
    path = folder / f'before-analysis-seed-{stamp}.dump'
    result = subprocess.run([pg_tool('pg_dump'), '--format=custom', '--no-owner', '--no-acl',
                             '--file', str(path), '--dbname', url.database],
                            env=pg_environment(url), capture_output=True)
    if result.returncode:
        raise RuntimeError('pg_dump failed; seeding was not started. Check local PostgreSQL access.')
    checked = subprocess.run([pg_tool('pg_restore'), '--list', str(path)], capture_output=True)
    if checked.returncode or path.stat().st_size == 0:
        raise RuntimeError('Backup verification failed; seeding was not started.')
    print(f'Backup: {path}')
    return path


def batch(db):
    manifest = db.query(IncidentEvent).filter_by(source=SOURCE, event_type='analysis_seed_manifest').first()
    if manifest:
        return manifest.event_metadata
    if db.query(IncidentEvent).filter_by(source=SOURCE).first():
        raise RuntimeError('A seed batch has no completion manifest. Preserve it and inspect before retrying.')
    return None


def seeded_incidents(db):
    return db.query(FireIncident).filter(FireIncident.fire_id.in_(
        db.query(IncidentEvent.fire_id).filter_by(source=SOURCE, event_type='analysis_seed')))


def normalize_existing_batch(db):
    """Move this seeder's earlier test batch into the normal local demo views."""
    changed = 0
    for inc in seeded_incidents(db).filter(FireIncident.record_kind == 'test').with_for_update():
        inc.record_kind = RECORD_KIND
        changed += 1
    manifest = db.query(IncidentEvent).filter_by(source=SOURCE, event_type='analysis_seed_manifest').one()
    result = {**manifest.event_metadata, 'record_kind': RECORD_KIND,
              'notice': 'Local demo incidents use normal operational views. Timings and GPS are simulated.'}
    if manifest.event_metadata != result:
        manifest.event_metadata = result
    return changed, result


def check_schema(db):
    revision = db.execute(text('SELECT version_num FROM alembic_version')).scalar_one()
    if revision != '0031':
        raise RuntimeError(f'Requires migration 0031; found {revision}. No migrations are run by this seeder.')


class Planner:
    """Read-only plan, including road geometry and a shared resource calendar."""

    def __init__(self, db, as_of, recent_count):
        from ai.config import Config
        from routing_setup import build_routing_engine

        if Config.REGION != 'panabo' or Config.GNN_INFERENCE_MODE != 'exported':
            raise RuntimeError('Use the Panabo exported routing configuration for these fixtures.')
        self.engine = build_routing_engine(register_gym=False)
        if self.engine is None:
            raise RuntimeError('Panabo road routing is unavailable; no invented straight-line routes will be saved.')
        self.as_of, self.recent_count = as_of, recent_count
        self.routes_cache, self.calendar = {}, defaultdict(list)
        self.skipped = Counter()
        self.teams = [team for team in db.query(ResponseTeam).options(
            selectinload(ResponseTeam.station), selectinload(ResponseTeam.shift),
            selectinload(ResponseTeam.truck), selectinload(ResponseTeam.members).selectinload(ResponseTeamMember.personnel),
        ).order_by(ResponseTeam.team_id) if team.station and team.truck and team.members
            and team.station.station_latitude is not None and team.station.station_longitude is not None
            and self.engine.graph.nodes_near(team.station.station_latitude, team.station.station_longitude, 2)]
        if len(self.teams) < 2:
            raise RuntimeError('Requires two road-connected teams with trucks and personnel.')
        # Reserve existing dispatches without modifying their current resource state.
        for dispatch in db.query(DispatchRecord):
            if dispatch.dispatch_at and dispatch.team:
                end = dispatch.cleared_at or dispatch.dispatch_completed_at
                # Legacy demo dispatches include months-old open records and
                # administrative closures months later. They cannot establish
                # continuous crew occupancy. Reserve four hours in this simulation;
                # preserve every original status and endpoint in the database.
                if end is None or end - dispatch.dispatch_at > timedelta(hours=10):
                    end = dispatch.dispatch_at + timedelta(hours=4)
                self.reserve(dispatch.team, dispatch.dispatch_at, end)

    @staticmethod
    def resources(team):
        return [('team', team.team_id), ('truck', team.truck_id),
                *(('person', member.per_id) for member in team.members)]

    def reserve(self, team, start, end):
        for key in self.resources(team):
            self.calendar[key].append((start, end))

    def available(self, team, start, end):
        return not any(start < b and a < end for key in self.resources(team) for a, b in self.calendar[key])

    def routes(self, team, inc, alternatives=False):
        key = (team.team_id, inc.fire_latitude, inc.fire_longitude, alternatives)
        if key not in self.routes_cache:
            station = team.station
            origins = self.engine.graph.nodes_near(station.station_latitude, station.station_longitude, 2)
            targets = self.engine.graph.nodes_near(inc.fire_latitude, inc.fire_longitude, 2)
            result = []
            if origins and targets and origins[0][0] != targets[0][0]:
                try:
                    if alternatives:
                        result = self.engine.compute_routes_multi_alpha(origins[0][0], targets[0][0])
                    else:
                        route = self.engine.compute_route(origins[0][0], targets[0][0])
                        coords = list(wkt.loads(route['route_wkt']).coords)
                        route['route_distance_meters'] = sum(distance_m([a[1], a[0]], [b[1], b[0]])
                                                              for a, b in zip(coords, coords[1:]))
                        result = [route]
                except ValueError:
                    pass  # A disconnected directed road graph is a legitimate no-path case.
            self.routes_cache[key] = [r for r in result if r['eta_seconds'] > 0
                                     and len(wkt.loads(r['route_wkt']).coords) >= 2]
        return self.routes_cache[key]

    def eligible(self, db):
        # Only untouched, closed synthetic legacy incidents. Keep existing operational
        # work, imported BFP history and personnel reports out of this backfill.
        query = db.query(FireIncident).filter(
            FireIncident.fire_status == 'closed', FireIncident.record_kind.is_(None),
            FireIncident.report_received_at.is_(None), FireIncident.response_kind.is_(None),
            FireIncident.suppression_started_at.is_(None), FireIncident.fire_out_at.is_(None),
            FireIncident.operation_completed_at.is_(None), ~FireIncident.dispatches.any(),
            ~db.query(IncidentReport.report_id).filter(IncidentReport.fire_id == FireIncident.fire_id).exists(),
            ~db.query(IncidentEvent.event_id).filter(IncidentEvent.fire_id == FireIncident.fire_id).exists(),
        ).order_by(FireIncident.fire_incident_datetime, FireIncident.fire_id)
        return [inc for inc in query if inc.fire_incident_datetime
                and inc.fire_incident_datetime < self.as_of - timedelta(days=1)
                and inc.fire_location_source != 'bfp_historical_import']

    def make(self, db):
        originals = self.eligible(db)
        if not originals:
            raise RuntimeError('No untouched closed incidents are available as synthetic source data.')
        jobs = [(inc, inc.fire_incident_datetime, f'existing:{inc.fire_id}', 'standard', inc.fire_id)
                for inc in originals]
        # Replays are explicitly new incidents. Original dates and locations stay intact.
        # Twenty-four months supplies both the default twelve months and its comparison.
        dates = [self.as_of - timedelta(hours=4), self.as_of - timedelta(hours=18)]
        for index in range(self.recent_count - 2):
            dates.append(self.as_of - timedelta(days=3 + index * 720 / max(1, self.recent_count - 3),
                                                hours=(index % 3) * 2))
        for index, at in enumerate(dates):
            template = originals[(index * 17) % len(originals)]
            jobs.append((template, at, f'replay:{index}', 'standard', None))
        # Missing endpoints model incomplete historical records, using terminal statuses
        # so synthetic crews never enter the live watchdog/notification workflow.
        for index, case in enumerate(QUALITY_CASES):
            template = originals[(index * 13) % len(originals)]
            jobs.append((template, self.as_of - timedelta(days=1 + index, hours=3),
                         f'quality:{case}', case, None))
        plans = []
        for index, (template, at, key, case, original_id) in enumerate(sorted(jobs, key=lambda j: j[1]), 1):
            plan = self.incident(db, template, at, key, case, original_id)
            if plan:
                plans.append(plan)
            if index % 50 == 0:
                print(f'Planned {index}/{len(jobs)} incidents...', flush=True)
        if not any(p['scenario'] == 'route_revision' and len(p['dispatches'][0]['routes']) > 1 for p in plans):
            raise RuntimeError('Route revision scenario needs a source location with alternative road routes.')
        missing = set(QUALITY_CASES) - {p['scenario'] for p in plans}
        if missing:
            raise RuntimeError(f'Quality scenarios could not be planned: {sorted(missing)}')
        return plans

    def incident(self, db, template, receipt, key, case, original_id):
        rng = random.Random(f'{SEED}:{key}')
        severity = template.fire_severity or rng.choice(['Minor', 'Moderate', 'Critical'])
        response = 'medical' if case == 'medical' else 'rescue' if case == 'rescue' else 'fire'
        cancelled = case in ('cancelled', 'recalled')
        count = 2 if case == 'reinforcement_first' else rng.choices([1, 2, 3], [65, 30, 5])[0]
        if severity == 'Minor' and case != 'reinforcement_first':
            count = 1
        if case != 'standard' and case != 'reinforcement_first':
            count = 1
        severity_minutes = {'Minor': (9, 24), 'Moderate': (22, 55), 'Critical': (45, 100)}
        low, high = severity_minutes.get(severity, (15, 40))
        suppression_seconds = rng.randint(low * 60, high * 60)
        provisional_end = receipt + timedelta(hours=10 if case == 'above_six_hours' else 4)
        candidates = sorted(self.teams, key=lambda team: distance_m(
            [team.station.station_latitude, team.station.station_longitude],
            [template.fire_latitude, template.fire_longitude]) * rng.uniform(.9, 1.1))
        dispatches = []
        for team in candidates:
            if not self.available(team, receipt, provisional_end):
                continue
            routes = self.routes(team, template, alternatives=case == 'route_revision')
            if not routes:
                continue
            if case == 'route_revision' and len(routes) < 2:
                continue
            if case == 'origin_mismatch' and routes[0]['route_distance_meters'] < 800:
                continue
            offset = len(dispatches)
            dispatched = receipt + timedelta(seconds=rng.randint(35, 120) + offset * rng.randint(90, 210))
            acknowledge = dispatched + timedelta(seconds=rng.randint(8, 35))
            depart = dispatched + timedelta(seconds=rng.randint(60, 165))
            selected = 1 if case == 'route_revision' else 0
            predicted = routes[selected]['eta_seconds']
            rush = receipt.hour in (7, 8, 16, 17, 18)
            travel = max(45, round(predicted * rng.uniform(.85, 1.25) * (1.2 if rush else 1) + rng.randint(0, 50)))
            if case == 'reinforcement_first':
                travel = 1200 if offset == 0 else 180
            if case == 'above_six_hours':
                travel = 6 * 3600 + 300  # Explicit corrupt-arrival validation case, not a realistic journey.
            if case == 'gps_gap':
                travel = max(360, travel)
            arrive = depart + timedelta(seconds=travel)
            dispatches.append(dict(team=team, routes=routes, selected=selected, dispatched=dispatched,
                                   acknowledge=acknowledge, depart=depart, arrive=arrive, travel=travel))
            if len(dispatches) >= count:
                break
        if not dispatches or (case == 'reinforcement_first' and len(dispatches) < 2):
            self.skipped['no_available_road_connected_crew'] += 1
            return None
        first = min(d['arrive'] for d in dispatches)
        suppression_guess = first + timedelta(seconds=rng.randint(35, 100))
        fire_out = suppression_guess + timedelta(seconds=suppression_seconds)
        service_end = fire_out if response == 'fire' else first + timedelta(minutes=rng.randint(18, 50))
        for d in dispatches:
            clear = max(service_end, d['arrive']) + timedelta(minutes=rng.randint(8, 22))
            d['clear'] = d['dispatched'] + timedelta(seconds=55) if cancelled else clear
            d['complete'] = d['clear'] + timedelta(minutes=rng.randint(5, 12))
            self.reserve(d['team'], d['dispatched'], d['complete'] + timedelta(minutes=20))
        operation_end = max(d['clear'] for d in dispatches) + timedelta(seconds=rng.randint(15, 60))
        brgy_id = db.execute(text('SELECT brgy_id FROM barangay_boundaries WHERE ST_Covers(brgy_polygon, '
            'ST_SetSRID(ST_MakePoint(:lon,:lat),4326)) ORDER BY brgy_id LIMIT 1'),
            {'lon': template.fire_longitude, 'lat': template.fire_latitude}).scalar()
        return dict(key=key, scenario=case, original_id=original_id, template_id=template.fire_id,
                    address=template.fire_address, location=template.fire_location_name,
                    latitude=template.fire_latitude, longitude=template.fire_longitude,
                    structure=template.fire_structure_type, severity=None if case == 'unknown_severity' else severity,
                    alarm=template.fire_alarm_level or '1st Alarm', brgy_id=brgy_id, receipt=receipt,
                    response=response, dispatches=dispatches, cancelled=cancelled,
                    suppression=suppression_guess if response == 'fire' and not cancelled else None,
                    fire_out=fire_out if response == 'fire' and not cancelled else None,
                    operation_end=None if cancelled or case == 'missing_clearance' else operation_end)


def add_event(db, inc, kind, at, key, metadata=None, dispatch=None, unit=None, to=None):
    db.add(IncidentEvent(fire_id=inc.fire_id, event_type=kind, occurred_at=at, created_at=at,
        event_to=to, source=SOURCE, verified=False, event_actor='Synthetic Analysis Seeder',
        dispatch_id=dispatch.dispatch_id if dispatch else None,
        dispatch_truck_id=unit.dispatch_truck_id if unit else None,
        idempotency_key=f'{SOURCE}:{key}', event_metadata={'synthetic': True, **(metadata or {})}))


def save_gps(db, inc, unit, dispatch, plan, d):
    case = plan['scenario']
    if plan['cancelled'] or case in ('no_gps', 'missing_departure', 'missing_arrival', 'clock_error', 'above_six_hours'):
        return 0
    line = wkt.loads(d['routes'][d['selected']]['route_wkt'])
    rng = random.Random(f'{SEED}:gps:{plan["key"]}:{d["team"].team_id}')
    travel = d['travel']
    samples = sorted({0, travel, *range(20, travel, 20)})
    # Ensure a gap is visible even on a short trip (normal profiles use 20s fixes).
    if case == 'gps_gap' and travel < 300:
        raise RuntimeError('GPS-gap scenario must have at least five minutes of travel.')
    count = 0
    for seconds in samples:
        if case == 'gps_gap' and 60 < seconds < 240:
            continue
        fraction = seconds / travel
        if case == 'origin_mismatch':
            fraction = .5 + fraction / 2
        # A short stop mid-trip simulates an intersection without leaving the road.
        fraction = min(1, fraction * 1.08) if fraction < .35 else max(.378, (fraction - .05) / .95)
        fraction = 0 if seconds == 0 and case != 'origin_mismatch' else 1 if seconds == travel else fraction
        point = line.interpolate(fraction, normalized=True)
        at = d['depart'] + timedelta(seconds=seconds)
        db.add(TruckLog(truck_id=unit.truck_id, dispatch_truck_id=unit.dispatch_truck_id,
            per_id=unit.manned_by_per_id, truck_log_lat=point.y, truck_log_long=point.x,
            truck_log_recorded=at, received_at=at + timedelta(seconds=rng.randint(1, 8)),
            accuracy_m=rng.randint(4, 16), source=SOURCE,
            sample_key=f'{SOURCE}:{plan["key"]}:{dispatch.dispatch_id}:{seconds}'))
        count += 1
    return count


def persist(db, plans, as_of):
    stats = Counter()
    examples = {}
    first_incident = None
    for plan in plans:
        case, key = plan['scenario'], plan['key']
        if plan['original_id']:
            inc = db.query(FireIncident).filter_by(fire_id=plan['original_id']).with_for_update().one()
            if (inc.dispatches or inc.fire_status != 'closed'
                    or inc.fire_incident_datetime != plan['receipt']
                    or inc.fire_latitude != plan['latitude'] or inc.fire_longitude != plan['longitude']
                    or db.query(IncidentEvent).filter_by(fire_id=inc.fire_id).first()
                    or db.query(IncidentReport).filter_by(fire_id=inc.fire_id).first()
                    or any(getattr(inc, field) is not None for field in (
                    'record_kind', 'report_received_at', 'suppression_started_at', 'fire_out_at',
                    'operation_completed_at', 'response_kind'))):
                raise RuntimeError('A source incident changed after planning. Transaction rolled back.')
            before = {field: iso(value) if isinstance(value, datetime) else value
                      for field in INCIDENT_FIELDS for value in [getattr(inc, field)]}
            stats['existing_incidents_enriched'] += 1
        else:
            inc = FireIncident(fire_location_source=SOURCE,
                fire_location_name=plan['location'], fire_address=f'[SYNTHETIC] {plan["address"] or plan["location"]}'[:255],
                fire_latitude=plan['latitude'], fire_longitude=plan['longitude'],
                fire_incident_datetime=plan['receipt'], created_at=plan['receipt'],
                fire_status='cancelled' if plan['cancelled'] else 'closed',
                fire_severity=plan['severity'], fire_alarm_level=plan['alarm'],
                fire_structure_type=plan['structure'], fire_casualties='None reported (synthetic)',
                fire_dispatch_type={'fire': 'Firefighting Operations', 'medical': 'Emergency Medical Services (EMS)',
                                    'rescue': 'Special Operations'}[plan['response']])
            db.add(inc)
            db.flush()
            before = None
            stats['recent_incidents_added'] += 1
        inc.record_kind = RECORD_KIND
        inc.response_kind = plan['response']
        inc.report_received_at = None if case == 'missing_receipt' else plan['receipt']
        inc.suppression_started_at, inc.fire_out_at = plan['suppression'], plan['fire_out']
        inc.operation_completed_at = plan['operation_end']
        inc.fire_units_assigned = len(plan['dispatches'])
        inc.brgy_id = inc.brgy_id or plan['brgy_id']
        inc.fire_remarks = ((inc.fire_remarks or '') + '\n[SYNTHETIC ANALYSIS] Invented dispatch evidence; '
                            'not measured BFP performance. Scenario: ' + case).strip()
        first_incident = first_incident or inc
        examples.setdefault(case, inc.fire_id)
        add_event(db, inc, 'analysis_seed', as_of, key, {
            'scenario': case, 'template_fire_id': plan['template_id'], 'original': before,
            'assumptions': 'Current roster/station and current exported Panabo roads reused as simulation inputs.',
        })
        if not db.query(HeatmapData).filter_by(fire_id=inc.fire_id).first():
            db.add(HeatmapData(fire_id=inc.fire_id, heatmap_latitude=inc.fire_latitude,
                heatmap_longitude=inc.fire_longitude, heatmap_severity_weight=severity_weight(inc.fire_severity),
                heatmap_generated_at=plan['receipt']))
            stats['heatmap_rows'] += 1
        if inc.report_received_at:
            add_event(db, inc, 'op_receipt', inc.report_received_at, f'{key}:receipt')
        for index, d in enumerate(plan['dispatches']):
            team = d['team']
            members = sorted(team.members, key=lambda m: m.members_id)
            driver = next((m for m in members if 'driver' in (m.member_role or '').lower()), members[0])
            leader = next((m for m in members if 'leader' in (m.member_role or '').lower()), members[0])
            dispatch_key = f'{key}:team:{team.team_id}'
            roster = [{'per_id': m.per_id, 'name': f'{m.personnel.per_firstname or ""} {m.personnel.per_lastname or ""}'.strip(),
                       'rank': m.personnel.per_rank, 'role': m.member_role,
                       'assigned_at': iso(d['dispatched']), 'released_at': iso(d['clear'])
                       if case != 'missing_clearance' else None} for m in members]
            if case == 'roster_change':
                change = d['dispatched'] + (d['clear'] - d['dispatched']) / 2
                roster[0]['released_at'] = iso(change)
                roster.append({**roster[0], 'role': 'Relief crew', 'assigned_at': iso(change), 'released_at': iso(d['clear'])})
            context = dict(provenance='assignment', synthetic=True, team_name=team.team_name,
                station_id=team.station_id, station_name=team.station.station_name,
                shift_name=team.shift.shift_name if team.shift else None, truck_id=team.truck_id,
                truck=team.truck.truck_platenum)
            if case != 'missing_roster':
                context['roster'] = roster
            dispatch = DispatchRecord(fire_id=inc.fire_id, team_id=team.team_id,
                dispatch_status=case if plan['cancelled'] else 'completed', dispatch_at=d['dispatched'],
                acknowledged_at=None if plan['cancelled'] or case == 'missing_acknowledgement' else d['acknowledge'],
                acknowledged_by=None if plan['cancelled'] or case == 'missing_acknowledgement' else leader.personnel.user_id,
                departed_at=None if plan['cancelled'] or case == 'missing_departure' else d['depart'],
                departed_by=None if plan['cancelled'] or case == 'missing_departure' else driver.personnel.user_id,
                dispatch_arrived_at=None if plan['cancelled'] or case == 'missing_arrival' else
                    d['depart'] - timedelta(seconds=30) if case == 'clock_error' else d['arrive'],
                dispatch_completed_at=d['complete'], cleared_at=None if case == 'missing_clearance' or plan['cancelled'] else d['clear'],
                dispatch_truck_count=1, context_snapshot=context)
            db.add(dispatch)
            db.flush()
            unit = DispatchTruck(dispatch_id=dispatch.dispatch_id, truck_id=team.truck_id,
                truck_assigned_at=d['dispatched'], manned_by_per_id=None if plan['cancelled'] else driver.per_id,
                manned_since=None if plan['cancelled'] else d['acknowledge'],
                departed_at=dispatch.departed_at, arrived_at=None if case == 'clock_error' else dispatch.dispatch_arrived_at)
            db.add(unit)
            db.flush()
            saved = []
            for rank, route in enumerate(d['routes'], 1):
                start = list(wkt.loads(route['route_wkt']).coords)[0]
                row = Route(fire_id=inc.fire_id, dispatch_id=dispatch.dispatch_id, route_rank=rank,
                    route_type=route.get('route_type', 'ai_optimized'), route_path_geojson=route['route_wkt'],
                    route_distance_meters=route['route_distance_meters'], route_est_minutes=route['eta_seconds'] / 60,
                    route_is_selected=rank - 1 == d['selected'], route_created_at=d['dispatched'],
                    route_origin_source='station', route_origin_lat=start[1], route_origin_lng=start[0])
                db.add(row)
                db.flush()
                saved.append(dict(route_id=row.route_id, rank=rank, wkt=row.route_path_geojson,
                    distance_meters=row.route_distance_meters, eta_seconds=route['eta_seconds'],
                    origin=[start[1], start[0]], origin_source='station'))
                stats['routes'] += 1
            dispatch.route_id = saved[d['selected']]['route_id']
            baseline = dict(selected_route_id=dispatch.route_id, routes=saved,
                            selection_reason='Synthetic departure choice on current Panabo road network')
            if case != 'no_baseline':
                add_event(db, inc, 'op_routes', d['dispatched'], f'{dispatch_key}:routes', baseline, dispatch)
            add_event(db, inc, 'op_dispatch', d['dispatched'], f'{dispatch_key}:dispatch', dispatch=dispatch)
            if case != 'missing_roster':
                add_event(db, inc, 'op_roster', d['dispatched'], f'{dispatch_key}:roster', {'roster': roster}, dispatch)
            if dispatch.acknowledged_at:
                add_event(db, inc, 'op_acknowledgement', dispatch.acknowledged_at, f'{dispatch_key}:ack', dispatch=dispatch)
            if unit.departed_at:
                add_event(db, inc, 'op_departure', unit.departed_at, f'{dispatch_key}:departure',
                          {'baseline': copy.deepcopy(baseline) if case != 'no_baseline' else None}, dispatch, unit)
            if unit.arrived_at:
                add_event(db, inc, 'op_arrival', unit.arrived_at, f'{dispatch_key}:arrival', dispatch=dispatch, unit=unit)
            if dispatch.cleared_at:
                add_event(db, inc, 'op_clearance', dispatch.cleared_at, f'{dispatch_key}:clearance', dispatch=dispatch)
            if case == 'route_revision':
                revised = {**baseline, 'selected_route_id': saved[0]['route_id'],
                           'selection_reason': 'Synthetic later route selection; departure baseline stays preserved'}
                add_event(db, inc, 'op_routes', d['depart'] + timedelta(seconds=40), f'{dispatch_key}:revision', revised, dispatch)
                dispatch.route_id = saved[0]['route_id']
                for row in db.query(Route).filter_by(dispatch_id=dispatch.dispatch_id):
                    row.route_is_selected = row.route_id == dispatch.route_id
            stats['gps_samples'] += save_gps(db, inc, unit, dispatch, plan, d)
            stats['dispatches'] += 1
            stats['dispatch_trucks'] += 1
            if index == 0 and not plan['cancelled']:
                cause = ('Electrical short circuit', 'Unattended cooking', 'Open flame near combustible materials')[inc.fire_id % 3]
                at = max(d['complete'], plan['operation_end'] or d['clear']) + timedelta(minutes=15)
                db.add(IncidentReport(fire_id=inc.fire_id, dispatch_id=dispatch.dispatch_id, per_id=leader.per_id,
                    report_cause=cause if plan['response'] == 'fire' else 'Medical assistance' if plan['response'] == 'medical' else 'Rescue assistance',
                    report_casualties='No fatalities; one minor injury treated' if inc.fire_id % 11 == 0 else 'No injuries reported',
                    report_damage_estimate={'Minor': 'PHP 35,000', 'Moderate': 'PHP 250,000', 'Critical': 'PHP 1,200,000'}.get(inc.fire_severity)
                        if plan['response'] == 'fire' else 'Not applicable',
                    report_narrative=f'[SYNTHETIC TEST] {team.team_name} responded to {inc.fire_address}. '
                        + ('Crew established a hose line, isolated the power supply, searched the affected area, '
                           'controlled the fire and checked for hot spots before clearance.' if plan['response'] == 'fire'
                           else 'Crew assessed the scene, assisted the patient and coordinated handover to the appropriate service.')
                        + f' Scenario: {case}. All times, observations and assignments are simulated.',
                    report_recommendations='Synthetic exercise: verify access, hydrant availability and crew communications.',
                    report_submitted_at=at, created_at=at))
                stats['after_action_reports'] += 1
        if inc.suppression_started_at:
            add_event(db, inc, 'op_suppression_start', inc.suppression_started_at, f'{key}:suppression')
            add_event(db, inc, 'status', inc.suppression_started_at + (inc.fire_out_at - inc.suppression_started_at) / 2,
                      f'{key}:contained', to='contained')
            add_event(db, inc, 'op_fire_out', inc.fire_out_at, f'{key}:fire_out')
        if inc.operation_completed_at:
            add_event(db, inc, 'op_operation_complete', inc.operation_completed_at, f'{key}:operation_complete')
    db.flush()
    result = dict(source=SOURCE, seed=SEED, record_kind=RECORD_KIND, as_of=iso(as_of), counts=dict(stats), examples=examples,
                  scenario_counts=dict(Counter(p['scenario'] for p in plans)),
                  notice='Local demo incidents use normal operational views. Timings and GPS are simulated.')
    add_event(db, first_incident, 'analysis_seed_manifest', as_of, 'manifest', result)
    db.flush()
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Back up, then write one atomic batch. Default is a read-only preview.')
    parser.add_argument('--recent-count', type=int, default=96, help='Recent replays across 24 months (default: 96), plus quality scenarios.')
    parser.add_argument('--as-of', type=datetime.fromisoformat, default=datetime.now(MANILA), help='Timezone-aware simulation cutoff.')
    parser.add_argument('--backup-dir', type=Path, default=BACKEND / 'seed-backups')
    args = parser.parse_args()
    if args.recent_count < 24 or args.recent_count > 500:
        parser.error('--recent-count must be between 24 and 500.')
    if args.as_of.tzinfo is None or args.as_of > datetime.now(MANILA):
        parser.error('--as-of must include a timezone and cannot be in the future.')
    url = target_url()
    print(f'Target: {url.host}:{url.port or 5432}/{url.database}; local operational demo data.')
    engine = create_engine(url)
    try:
        with Session(engine) as db:
            check_schema(db)
            existing = batch(db)
            if existing:
                pending = seeded_incidents(db).filter(FireIncident.record_kind == 'test').count()
                if not pending and existing.get('record_kind') == RECORD_KIND:
                    print('Batch already seeded; preserving all records without changes.')
                elif not args.apply:
                    print(f'Existing batch: {pending} incidents will enter normal operational views. Use --apply.')
                else:
                    backup_database(url, args.backup_dir)
                    db.rollback()
                    with db.begin():
                        db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': LOCK})
                        changed, existing = normalize_existing_batch(db)
                    print(f'Updated {changed} seeded incidents to the normal operational population.')
                print(json.dumps(existing, indent=2))
                return
            planner = Planner(db, args.as_of, args.recent_count)
            plans = planner.make(db)
            print(json.dumps({'existing_incidents_to_enrich': sum(p['original_id'] is not None for p in plans),
                'new_replays_and_scenarios': sum(p['original_id'] is None for p in plans),
                'dispatches': sum(len(p['dispatches']) for p in plans), 'skipped': dict(planner.skipped),
                'scenarios': dict(Counter(p['scenario'] for p in plans))}, indent=2))
            if not args.apply:
                print('Preview complete. No database rows or sequences changed. Use --apply to seed.')
                return
        backup_database(url, args.backup_dir)
        with Session(engine) as db, db.begin():
            db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': LOCK})
            if batch(db):
                print('Another seeder completed this batch; nothing added.')
                return
            result = persist(db, plans, args.as_of)
        print('Seed committed. Reload the dashboard; normal operational views include the demo data.')
        print(json.dumps(result, indent=2))
    finally:
        engine.dispose()


if __name__ == '__main__':
    main()
