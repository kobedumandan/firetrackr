"""Build a sparse, complete operational demonstration history on Panabo roads.

Display text uses natural incident descriptions. Generation provenance remains
in the batch audit events and local manifest; these are not station observations.
The caller owns backup, restored-copy rehearsal and the write transaction.
"""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import copy
import csv
import hashlib
import json
import random
from bisect import bisect_right
from types import SimpleNamespace

from sqlalchemy import text
from shapely import wkt

from models import (FireIncident, DispatchRecord, DispatchTruck, DispatchLocation,
                    Route, IncidentEvent, IncidentReport, HeatmapData, Users, TruckLog)
from services.incident_events import actor_name
from services.heatmap import severity_weight
from services.operational_times import iso, distance_m
from import_bfp_operational import preserved_digests, table_digest
import seed_analysis as shared

PHT = timezone(timedelta(hours=8))
SOURCE = 'history_population_20261110'
SEED = 20261110
START = datetime(2025, 12, 1, tzinfo=PHT)
END = datetime(2026, 11, 2, tzinfo=PHT)
MONTH_COUNTS = {'2025-12':3, '2026-01':4, '2026-02':2, '2026-03':5,
                '2026-04':3, '2026-05':0, '2026-06':4, '2026-07':2,
                '2026-08':6, '2026-09':3, '2026-10':4, '2026-11':1}


def read_source(path):
    with open(path, encoding='utf-8-sig', newline='') as handle:
        return list(csv.DictReader(handle))


def route_samples(route_wkt, departed_at, arrived_at, interval=10):
    """Sample road geometry densely, preserving corners and exact trip endpoints."""
    coords=list(wkt.loads(route_wkt).coords)
    duration=(arrived_at-departed_at).total_seconds()
    cumulative=[0.0]
    for a,b in zip(coords,coords[1:]):
        cumulative.append(cumulative[-1]+distance_m([a[1],a[0]],[b[1],b[0]]))
    length=cumulative[-1]
    if duration<=0 or length<=0:raise ValueError('A route track requires positive distance and duration.')
    offsets=sorted({0.0,duration,*map(float,range(interval,int(duration),interval)),
                    *(round(value/length*duration,6) for value in cumulative)})
    for seconds in offsets:
        position=length*seconds/duration
        index=min(len(coords)-2,max(0,bisect_right(cumulative,position)-1))
        a,b=coords[index],coords[index+1]
        span=cumulative[index+1]-cumulative[index]
        fraction=(position-cumulative[index])/span if span>0 else 0
        lng=a[0]+(b[0]-a[0])*fraction;lat=a[1]+(b[1]-a[1])*fraction
        yield departed_at+timedelta(seconds=seconds),lat,lng


def save_response_tracks(db,dispatch,unit,roster,route_wkt):
    """Persist separate generated vehicle and attributed member histories."""
    count=0
    for index,(at,lat,lng) in enumerate(route_samples(route_wkt,unit.departed_at,unit.arrived_at)):
        db.add(TruckLog(truck_id=unit.truck_id,dispatch_truck_id=unit.dispatch_truck_id,
            per_id=unit.manned_by_per_id,truck_log_lat=lat,truck_log_long=lng,truck_log_recorded=at,
            received_at=at+timedelta(seconds=2),accuracy_m=7,source=SOURCE,
            sample_key=f'{SOURCE}:{dispatch.dispatch_id}:truck:{index}'))
        for member in roster:
            db.add(DispatchLocation(dispatch_id=dispatch.dispatch_id,per_id=member['per_id'],truck_id=unit.truck_id,
                recorded_at=at,received_at=at+timedelta(seconds=3),latitude=lat,longitude=lng,
                accuracy_m=8,source=SOURCE,sample_key=f'{SOURCE}:{dispatch.dispatch_id}:{member["per_id"]}:track:{index}'))
        count+=1
    return count


def purge_plan(conn):
    ids = conn.execute(text("""SELECT fire_id FROM fire_incidents
        WHERE fire_incident_datetime >= '2026-01-01T00:00:00+08:00'
          AND fire_incident_datetime < '2027-01-01T00:00:00+08:00' ORDER BY fire_id""")).scalars().all()
    digest = table_digest(conn, 'fire_incidents', 'WHERE fire_id=ANY(:ids)', {'ids':ids})
    photos = conn.execute(text('''SELECT p.file_name FROM report_photos p JOIN incident_reports r USING(report_id)
        WHERE r.fire_id=ANY(:ids) ORDER BY p.photo_id'''), {'ids':ids}).scalars().all()
    return {'remove_2026_ids':ids, 'incident_digest':digest, 'report_photo_names':photos}


def make_plan(db, source_rows):
    if db.query(IncidentEvent).filter_by(source=SOURCE, event_type='history_manifest').first():
        raise RuntimeError('This history batch already exists; do not recreate it.')
    planner = shared.Planner(db, END, 37)
    # Panabo stations only, with actual crews and a distinct assigned truck.
    panabo_stations = set(db.execute(text('''SELECT station_id FROM stations s WHERE EXISTS
        (SELECT 1 FROM barangay_boundaries b WHERE ST_Covers(b.brgy_polygon,
        ST_SetSRID(ST_MakePoint(s.station_longitude,s.station_latitude),4326)))''')).scalars())
    planner.teams = [t for t in planner.teams if t.station_id in panabo_stations
        and not t.archived_at and not t.truck.archived_at
        and all(not m.personnel.archived_at for m in t.members)]
    if len(planner.teams) < 2:
        raise RuntimeError('Not enough road-connected Panabo crews.')
    planner.calendar = defaultdict(list)
    # Existing 2026 activity is being replaced; keep only other-year resource reservations.
    for dispatch in db.query(DispatchRecord).join(FireIncident).filter(
            FireIncident.fire_incident_datetime < datetime(2026,1,1,tzinfo=PHT)):
        if dispatch.dispatch_at and dispatch.team:
            end = dispatch.cleared_at or dispatch.dispatch_completed_at or dispatch.dispatch_at+timedelta(hours=4)
            planner.reserve(dispatch.team, dispatch.dispatch_at, end)
    selected = [r for r in source_rows if r['geocode_review_required']=='No'
                and r['inside_expected_barangay']=='Yes' and r['inside_panabo']=='Yes'
                and r['geocode_precision'] in ('exact_or_building','street_or_area')]
    # Use source area/street addresses, rather than repeating identifiable house lots.
    def address(row):
        value = row['normalized_location'].replace(', Philippines','')
        if 'Champaca' in value:
            value = 'Champaca Street, Northern Plains, Barangay New Visayas, Panabo City, Davao del Norte'
        if 'Gaisano' in value:
            value = 'Commercial area, Barangay Santo Niño, Panabo City, Davao del Norte'
        if 'City Hall' in value:
            value = 'Km. 31, Barangay J.P. Laurel, Panabo City, Davao del Norte'
        return value[:255]
    rng = random.Random(SEED)
    boundaries=dict(db.execute(text('SELECT brgy_name,brgy_id FROM barangay_boundaries')).all())
    jobs = []
    for month, count in MONTH_COUNTS.items():
        year, number = map(int, month.split('-'))
        days = [1] if month=='2026-11' else sorted(rng.sample(range(2,28),count))
        for day in days:
            hour = rng.choice([5,7,9,11,13,15,17,19,21,23])
            if month=='2026-11': hour=9
            jobs.append(datetime(year,number,day,hour,rng.randrange(60),rng.randrange(60),tzinfo=PHT))
    plans = []
    for index, at in enumerate(jobs):
        severity = 'Critical' if index in (9,23,34) else 'Moderate' if index%3==1 else 'Minor'
        case = 'route_revision' if index in (5,26) else 'standard'
        for retry in range(len(selected)):
            calendar_before=copy.deepcopy(planner.calendar)
            row = selected[(index*5+retry)%len(selected)]
            lat,lng = float(row['latitude']),float(row['longitude'])
            template = SimpleNamespace(fire_id=None,fire_severity=severity,
                fire_alarm_level={'Minor':'1st Alarm','Moderate':'2nd Alarm','Critical':'3rd Alarm'}[severity],
                fire_address=address(row),fire_location_name=row['barangay_clean'],
                fire_latitude=lat,fire_longitude=lng,fire_structure_type=row['general_category_clean'])
            plan = planner.incident(db,template,at,f'incident:{index+1:02d}',case,None)
            if not plan:
                planner.calendar=calendar_before
                continue
            # Refuse remote pins that cannot be reached near the incident itself.
            if any(distance_m([lat,lng], list(reversed(wkt.loads(d['routes'][d['selected']]['route_wkt']).coords[-1]))) > 300 for d in plan['dispatches']):
                planner.calendar=calendar_before
                continue
            if row['occupancy_class_clean']=='NON-STRUCTURAL' and severity=='Critical':
                planner.calendar=calendar_before
                continue
            if severity=='Critical' and len(plan['dispatches'])<2:
                all_teams=planner.teams
                used={d['team'].truck_id for d in plan['dispatches']}
                planner.teams=[t for t in all_teams if t.truck_id not in used]
                try:
                    reinforcement=planner.incident(db,template,at+timedelta(seconds=100),
                        f'incident:{index+1:02d}:reinforcement','standard',None)
                finally:
                    planner.teams=all_teams
                if not reinforcement:
                    planner.calendar=calendar_before
                    continue
                extra=reinforcement['dispatches'][0]
                extra['clear']=max(plan['fire_out'],extra['arrive'])+timedelta(minutes=12)
                extra['complete']=extra['clear']+timedelta(minutes=8)
                plan['dispatches'].append(extra)
                plan['operation_end']=max(d['clear'] for d in plan['dispatches'])+timedelta(seconds=45)
            plan['alarm']='2nd Alarm' if len(plan['dispatches'])>1 else '1st Alarm'
            try:
                for d in plan['dispatches']:
                    line=wkt.loads(d['routes'][d['selected']]['route_wkt'])
                    origin=planner.engine.graph.nodes_near(line.coords[-1][1],line.coords[-1][0],radius_km=0.2)[0][0]
                    destination=planner.engine.graph.nodes_near(d['team'].station.station_latitude,d['team'].station.station_longitude,radius_km=2)[0][0]
                    d['return_route']=planner.engine.compute_route(origin,destination)
            except (ValueError,IndexError):
                planner.calendar=calendar_before
                continue
            plan['brgy_id']=boundaries[row['barangay_clean']]
            plan.update(source_record_id=row['record_id'], source_cause=row['cause_clean'],
                        cause_family=row['cause_family'], occupancy=row['occupancy_class_clean'],
                        source_address=row['raw_location'], source_coordinates=[lat,lng])
            # Rotate primary crews when more than one road-connected crew is nearby.
            # Planner already checks shared team/truck/personnel occupancy.
            plans.append(plan)
            break
        else:
            raise RuntimeError(f'No believable road-connected location for {at.isoformat()}')
        print(f'Planned {index+1}/{len(jobs)}: {at.date()} · {plan["location"]} · {len(plan["dispatches"])} crew(s)',flush=True)
    manifest = {'purge':purge_plan(db.connection()),'monthly_counts':MONTH_COUNTS,
                'incidents':[{k:v for k,v in p.items() if k not in ('dispatches',)} for p in plans],
                'routes':[{ 'key':p['key'], 'dispatches':[{
                    'team_id':d['team'].team_id, 'route_count':len(d['routes']),
                    'route_wkt':[r['route_wkt'] for r in d['routes']],
                    'dispatch_at':iso(d['dispatched']), 'departed_at':iso(d['depart']),
                    'arrived_at':iso(d['arrive']), 'cleared_at':iso(d['clear'])} for d in p['dispatches']]} for p in plans]}
    manifest['digest'] = hashlib.sha256(json.dumps(manifest,sort_keys=True,default=str).encode()).hexdigest()
    return plans, manifest, planner.engine


def purge_2026(conn, expected):
    if purge_plan(conn) != expected:
        raise RuntimeError('2026 incident rows changed after preview. Re-plan before applying.')
    ids = expected['remove_2026_ids']
    params={'ids':ids}
    busy_teams=conn.execute(text('''SELECT DISTINCT team_id FROM dispatch_records WHERE fire_id=ANY(:ids)'''),params).scalars().all()
    busy_trucks=conn.execute(text('''SELECT DISTINCT dt.truck_id FROM dispatch_trucks dt JOIN dispatch_records d USING(dispatch_id)
        WHERE d.fire_id=ANY(:ids)'''),params).scalars().all()
    for statement in (
        'DELETE FROM truck_logs WHERE dispatch_truck_id IN (SELECT dt.dispatch_truck_id FROM dispatch_trucks dt JOIN dispatch_records d USING(dispatch_id) WHERE d.fire_id=ANY(:ids))',
        'DELETE FROM incident_events WHERE fire_id=ANY(:ids)',
        'DELETE FROM report_photos WHERE report_id IN (SELECT report_id FROM incident_reports WHERE fire_id=ANY(:ids))',
        'DELETE FROM incident_reports WHERE fire_id=ANY(:ids)',
        'UPDATE dispatch_records SET route_id=NULL WHERE fire_id=ANY(:ids)',
        'DELETE FROM dispatch_trucks WHERE dispatch_id IN (SELECT dispatch_id FROM dispatch_records WHERE fire_id=ANY(:ids))',
        'DELETE FROM routes WHERE fire_id=ANY(:ids)',
        'DELETE FROM dispatch_records WHERE fire_id=ANY(:ids)',
        'DELETE FROM heatmap_data WHERE fire_id=ANY(:ids)',
        'DELETE FROM fire_incidents WHERE fire_id=ANY(:ids)',
    ): conn.execute(text(statement),params)
    released_teams=conn.execute(text("""UPDATE response_teams SET team_status='standby'
        WHERE team_id=ANY(:teams) AND team_status IN ('dispatched','en_route','on_scene')
        AND NOT EXISTS(SELECT 1 FROM dispatch_records d WHERE d.team_id=response_teams.team_id
        AND d.dispatch_status IN ('dispatched','en_route','on_scene')) RETURNING team_id"""),{'teams':busy_teams}).scalars().all()
    conn.execute(text("""UPDATE response_team_members SET member_status='standby'
        WHERE team_id=ANY(:teams) AND member_status IN ('dispatched','en_route','on_scene')"""),{'teams':released_teams})
    released_trucks=conn.execute(text("""UPDATE truck SET truck_status='available'
        WHERE truck_id=ANY(:trucks) AND truck_status IN ('dispatched','en_route','on_scene')
        AND NOT EXISTS(SELECT 1 FROM dispatch_trucks dt JOIN dispatch_records d USING(dispatch_id)
        WHERE dt.truck_id=truck.truck_id AND d.dispatch_status IN ('dispatched','en_route','on_scene'))
        RETURNING truck_id"""),{'trucks':busy_trucks}).scalars().all()
    return {'removed_2026_incidents':len(ids),'released_team_ids':released_teams,'released_truck_ids':released_trucks}


def add_event(db, inc, kind, at, key, metadata=None, dispatch=None, unit=None, to=None, actor='Station operations'):
    db.add(IncidentEvent(fire_id=inc.fire_id,event_type=kind,occurred_at=at,created_at=at,
        event_to=to,event_actor=actor,source=SOURCE,verified=False,
        dispatch_id=dispatch.dispatch_id if dispatch else None,
        dispatch_truck_id=unit.dispatch_truck_id if unit else None,
        idempotency_key=f'{SOURCE}:{key}',event_metadata={'batch_id':SOURCE,**(metadata or {})}))


def narrative(plan, team, d, casualties, damage):
    at=lambda value:value.astimezone(PHT).strftime('%H:%M')
    kind=plan['occupancy']
    action=('Crews advanced an attack line, isolated the electrical supply and checked adjoining rooms for occupants.'
        if kind=='STRUCTURAL' else 'Crews established a perimeter and applied water to the burning grass and nearby combustible material.'
        if kind=='NON-STRUCTURAL' else 'Crews secured the vehicle, isolated the battery and used a hose line to extinguish the engine-compartment fire.')
    follow=('The affected rooms and roof void were checked for residual heat before the scene was handed over.'
        if kind=='STRUCTURAL' else 'The perimeter was wetted down and monitored for rekindling before release.'
        if kind=='NON-STRUCTURAL' else 'The vehicle was checked for fuel leakage and residual heat before handover.')
    return (f'{team.team_name} received the assignment at {at(d["dispatched"])} for a fire at {plan["address"]}. '
        f'The crew departed at {at(d["depart"])} and reached the access point at {at(d["arrive"])}. '
        f'{action} Fire out was recorded at {at(plan["fire_out"])}. {follow} '
        f'Initial cause assessment: {plan["source_cause"].lower()}. {casualties}. '
        f'Estimated damage: {damage}. The crew cleared the scene at {at(d["clear"])}.')


def persist(db, plans):
    stats=Counter()
    admin=db.query(Users).filter(Users.user_role=='admin',Users.disabled_at.is_(None)).order_by(Users.user_id).first()
    if not admin: raise RuntimeError('A current administrator is required for consolidated report attribution.')
    for index,p in enumerate(plans):
        rng=random.Random(f'{SEED}:outcome:{index}')
        injury=index in (9,23)
        casualties='One minor smoke-inhalation case assessed on scene; no fatalities' if injury else 'No injuries or fatalities reported'
        low,high={'Minor':(8_000,65_000),'Moderate':(90_000,380_000),'Critical':(550_000,1_250_000)}[p['severity']]
        if p['occupancy']=='NON-STRUCTURAL':low,high=2_000,18_000
        damage=f'PHP {rng.randrange(low//1000,high//1000+1)*1000:,}'
        close_at=max(d['complete'] for d in p['dispatches'])+timedelta(minutes=25)
        inc=FireIncident(fire_location_source='manual',fire_location_name=p['location'],fire_address=p['address'],
            fire_latitude=p['latitude'],fire_longitude=p['longitude'],fire_severity=p['severity'],
            fire_status='closed',fire_alarm_level=p['alarm'],fire_dispatch_type='Firefighting Operations',
            fire_structure_type=p['structure'],fire_casualties=casualties,
            fire_units_assigned=len(p['dispatches']),fire_incident_datetime=p['receipt']-timedelta(minutes=rng.randint(1,4)),
            report_received_at=p['receipt'],created_at=p['receipt'],record_kind='operational',response_kind='fire',
            suppression_started_at=p['suppression'],fire_out_at=p['fire_out'],operation_completed_at=p['operation_end'],
            casualties_reviewed_at=close_at,brgy_id=p['brgy_id'],
            fire_remarks='Fire extinguished; overhaul and safety inspection completed before scene handover.')
        db.add(inc);db.flush();stats['incidents']+=1
        db.add(HeatmapData(fire_id=inc.fire_id,heatmap_latitude=p['latitude'],heatmap_longitude=p['longitude'],
            heatmap_severity_weight=severity_weight(p['severity']),heatmap_generated_at=close_at))
        add_event(db,inc,'history_entry',p['receipt'],p['key'],{
            'data_origin':'generated_for_demonstration','generator':'seed_operational_history.py',
            'generation_seed':SEED,'source_location_record':p['source_record_id'],
            'cause_reference':p['source_cause'],'source_area_address':p['source_address']})
        add_event(db,inc,'op_receipt',p['receipt'],p['key']+':receipt')
        add_event(db,inc,'alarm',p['receipt'],p['key']+':alarm',to=p['alarm'])
        for j,d in enumerate(p['dispatches']):
            team=d['team'];members=sorted(team.members,key=lambda m:m.members_id)
            driver=next((m for m in members if 'driver' in (m.member_role or '').lower()),None)
            leader=next((m for m in members if 'leader' in (m.member_role or '').lower()),None)
            if not driver or not leader: raise RuntimeError('Crew is missing a designated leader or driver.')
            actor=f'{leader.personnel.per_firstname} {leader.personnel.per_lastname}'
            key=f'{p["key"]}:team:{team.team_id}'
            roster=[{'per_id':m.per_id,'name':f'{m.personnel.per_firstname or ""} {m.personnel.per_lastname or ""}'.strip(),
                'rank':m.personnel.per_rank,'role':m.member_role,'assigned_at':iso(d['dispatched']),
                'released_at':iso(d['clear'])} for m in members]
            ctx={'provenance':'assignment','batch_id':SOURCE,'team_name':team.team_name,
                'station_id':team.station_id,'station_name':team.station.station_name,
                'shift_name':team.shift.shift_name if team.shift else None,
                'truck_id':team.truck_id,'truck':team.truck.truck_platenum,'roster':roster}
            dispatch=DispatchRecord(fire_id=inc.fire_id,team_id=team.team_id,dispatch_status='completed',
                dispatch_at=d['dispatched'],acknowledged_at=d['acknowledge'],acknowledged_by=leader.personnel.user_id,
                departed_at=d['depart'],departed_by=driver.personnel.user_id,dispatch_arrived_at=d['arrive'],
                cleared_at=d['clear'],release_authorized_at=d['clear']-timedelta(seconds=35),
                release_authorized_by=admin.user_id,dispatch_completed_at=d['complete'],
                dispatch_truck_count=1,context_snapshot=ctx)
            db.add(dispatch);db.flush()
            # A separately computed directed return route supplies believable return times.
            return_seconds=max(60,int(d['return_route']['eta_seconds']*rng.uniform(1.0,1.18)))
            returned=d['clear']+timedelta(seconds=return_seconds)
            ready=returned+timedelta(minutes=rng.randint(8,18))
            unit=DispatchTruck(dispatch_id=dispatch.dispatch_id,truck_id=team.truck_id,
                truck_assigned_at=d['dispatched'],manned_by_per_id=driver.per_id,manned_since=d['acknowledge'],
                departed_at=d['depart'],arrived_at=d['arrive'],return_driver_per_id=driver.per_id,
                return_station_id=team.station_id,return_started_at=d['clear'],returned_at=returned,ready_at=ready)
            db.add(unit);db.flush()
            saved=[]
            for rank,r in enumerate(d['routes'],1):
                origin=list(wkt.loads(r['route_wkt']).coords)[0]
                route=Route(fire_id=inc.fire_id,dispatch_id=dispatch.dispatch_id,route_rank=rank,
                    route_type=r.get('route_type','ai_optimized'),route_path_geojson=r['route_wkt'],
                    route_distance_meters=r['route_distance_meters'],route_est_minutes=r['eta_seconds']/60,
                    route_is_selected=rank-1==d['selected'],route_created_at=d['dispatched'],
                    route_origin_source='station',route_origin_lat=origin[1],route_origin_lng=origin[0])
                db.add(route);db.flush();stats['routes']+=1
                saved.append({'route_id':route.route_id,'rank':rank,'wkt':r['route_wkt'],
                    'distance_meters':r['route_distance_meters'],'eta_seconds':r['eta_seconds'],
                    'origin':[origin[1],origin[0]],'origin_source':'station'})
            dispatch.route_id=saved[d['selected']]['route_id']
            baseline={'selected_route_id':dispatch.route_id,'routes':saved,
                      'selection_reason':'Road-connected station response route'}
            add_event(db,inc,'op_routes',d['dispatched'],key+':routes',baseline,dispatch,actor=actor)
            add_event(db,inc,'op_roster',d['dispatched'],key+':roster',{'roster':roster},dispatch,actor=actor)
            for kind,at in [('dispatch',d['dispatched']),('acknowledgement',d['acknowledge']),
                ('departure',d['depart']),('arrival',d['arrive']),('clearance',d['clear'])]:
                meta={'baseline':copy.deepcopy(baseline)} if kind=='departure' else None
                add_event(db,inc,'op_'+kind,at,key+':'+kind,meta,dispatch,unit,actor=actor)
            if p['scenario']=='route_revision':
                revised={**baseline,'selected_route_id':saved[0]['route_id'],'selection_reason':'Dispatcher selected an alternate road approach'}
                add_event(db,inc,'op_routes',d['depart']+timedelta(seconds=30),key+':revision',revised,dispatch,actor=actor)
                dispatch.route_id=saved[0]['route_id']
                for route in db.query(Route).filter_by(dispatch_id=dispatch.dispatch_id):route.route_is_selected=route.route_id==dispatch.route_id
            stats['truck_gps_samples']+=save_response_tracks(db,dispatch,unit,roster,d['routes'][d['selected']]['route_wkt'])
            for kind,at in [('release_authorized',dispatch.release_authorized_at),('return_started',d['clear']),
                            ('truck_returned',returned),('truck_ready',ready)]:
                metadata={'return_route_wkt':d['return_route']['route_wkt'], 'eta_seconds':d['return_route']['eta_seconds']} if kind=='return_started' else None
                add_event(db,inc,'op_'+kind,at,key+':'+kind,metadata,dispatch=dispatch,unit=unit,actor=actor)
            report=IncidentReport(fire_id=inc.fire_id,dispatch_id=dispatch.dispatch_id,per_id=leader.per_id,
                report_kind='field',report_cause=p['source_cause'],report_casualties=casualties,
                report_damage_estimate=damage,report_narrative=narrative(p,team,d,casualties,damage),
                report_recommendations='Inspect electrical connections and ignition sources; maintain clear access and keep extinguishers serviceable.'
                    if p['occupancy']=='STRUCTURAL' else 'Keep combustible vegetation clear of structures; avoid open burning and maintain a firebreak.',
                report_submitted_at=d['clear']-timedelta(minutes=2),created_at=d['clear']-timedelta(minutes=2))
            db.add(report);db.flush();stats['field_reports']+=1
            add_event(db,inc,'report_field_submitted',report.report_submitted_at,key+':report',{'report_id':report.report_id},dispatch,actor=actor)
            stats['dispatches']+=1
        controlled=p['suppression']+(p['fire_out']-p['suppression'])*0.62
        for kind,at in [('suppression_start',p['suppression']),('fire_out',p['fire_out']),('operation_complete',p['operation_end'])]:
            add_event(db,inc,'op_'+kind,at,p['key']+':'+kind)
        add_event(db,inc,'status',controlled,p['key']+':contained',to='contained')
        add_event(db,inc,'status',close_at,p['key']+':closed',to='closed',actor=actor_name(admin))
        first=p['dispatches'][0]
        consolidated=IncidentReport(fire_id=inc.fire_id,report_kind='consolidated',author_user_id=admin.user_id,
            report_cause=p['source_cause'],report_casualties=casualties,report_damage_estimate=damage,
            report_narrative=narrative(p,first['team'],first,casualties,damage)+
                f' A total of {len(p["dispatches"])} response team(s) attended. All crews completed accountability and scene handover.',
            report_recommendations='Review the identified ignition source with the occupants and schedule a follow-up fire safety inspection.',
            report_submitted_at=close_at,created_at=close_at,reviewed_at=close_at,reviewed_by_user_id=admin.user_id)
        db.add(consolidated);db.flush();stats['consolidated_reports']+=1
        from services.report_timing import capture_consolidated_timing
        db.flush()
        capture_consolidated_timing(db,inc,consolidated,admin,close_at,phase='reviewed')
    db.flush()
    return dict(stats)


def apply(db, plans, manifest):
    conn=db.connection()
    conn.execute(text("SET LOCAL lock_timeout='10s'"))
    conn.execute(text('''LOCK TABLE fire_incidents,dispatch_records,dispatch_trucks,dispatch_locations,
        routes,incident_reports,report_photos,incident_events,heatmap_data,truck_logs,
        response_teams,response_team_members,truck IN SHARE ROW EXCLUSIVE MODE'''))
    before=preserved_digests(conn,manifest['purge']['remove_2026_ids'])
    result=purge_2026(conn,manifest['purge'])
    # Resource states released above are the only allowed changes outside incident history.
    after_purge=preserved_digests(conn,[])
    for table in before:
        if table not in ('response_teams','response_team_members','truck'):
            assert before[table]==after_purge[table],f'Unrelated {table} changed during deletion.'
    result.update(persist(db,plans))
    new_ids=db.execute(text("SELECT fire_id FROM incident_events WHERE source=:source AND event_type='history_entry'"),{'source':SOURCE}).scalars().all()
    after=preserved_digests(conn,new_ids)
    assert after_purge==after,'Unrelated records changed while creating history.'
    first=db.get(FireIncident,new_ids[0])
    add_event(db,first,'history_manifest',datetime.now(PHT),'manifest',{
        'data_origin':'generated_for_demonstration','monthly_counts':MONTH_COUNTS,'digest':manifest['digest'],
        'counts':result,'date_range':[iso(START),iso(END)]})
    db.flush()
    return result
