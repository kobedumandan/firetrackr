"""Assignment evidence preserved independently of the current team roster."""
from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy.orm import selectinload

from models import DispatchRecord, FireIncident, ResponseTeamMember
from services.operational_times import EXCLUDED, audit, iso
from services.response_performance import window


def member_snapshot(member, at):
    person = member.personnel
    return {'per_id': member.per_id, 'name': f'{person.per_firstname or ""} {person.per_lastname or ""}'.strip(),
            'rank': person.per_rank, 'role': member.member_role,
            'assigned_at': iso(at), 'released_at': None}


def sync_rosters(db, team_id, user):
    """Call after membership mutations, in the same transaction. Never backfill legacy."""
    db.flush()
    members = [m for m in db.query(ResponseTeamMember).filter_by(team_id=team_id).all()
               if (m.member_status or '').lower().replace('_', '') not in ('offduty', 'inactive')]
    now = datetime.now(timezone.utc)
    for dispatch in db.query(DispatchRecord).filter(
        DispatchRecord.team_id == team_id, DispatchRecord.dispatch_status.in_(['dispatched', 'en_route', 'on_scene']),
    ).with_for_update().all():
        snapshot = dispatch.context_snapshot or {}
        if 'roster' not in snapshot:
            continue
        roster = [dict(r) for r in snapshot['roster']]
        current = {m.per_id: m for m in members}
        open_ids = set()
        changed = False
        for row in roster:
            if row['released_at'] is not None:
                continue
            member = current.get(row['per_id'])
            if member is None or member.member_role != row['role']:
                row['released_at'] = iso(now)
                changed = True
            else:
                open_ids.add(row['per_id'])
        for member in members:
            if member.per_id not in open_ids:
                roster.append(member_snapshot(member, now))
                changed = True
        if changed:
            dispatch.context_snapshot = {**snapshot, 'roster': roster}
            audit(db, dispatch.fire_incident, 'op_roster', now, user, dispatch=dispatch,
                  metadata={'roster': roster}, source='admin_roster')


def parse(value):
    at = datetime.fromisoformat(value) if isinstance(value, str) else value
    return at.replace(tzinfo=timezone.utc) if at and at.tzinfo is None else at


def merged_seconds(intervals):
    merged = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return sum((end-start).total_seconds() for start, end in merged)


def report(db, start=None, end=None, kind='operational', per_id=None, team_id=None, station_id=None, shift=None):
    start, end = window(start, end)
    query = db.query(DispatchRecord).options(selectinload(DispatchRecord.fire_incident)).filter(DispatchRecord.dispatch_at < end)
    if team_id:
        query = query.filter(DispatchRecord.team_id == team_id)
    rows, missing_rosters = [], 0
    for dispatch in query.order_by(DispatchRecord.dispatch_at.desc(), DispatchRecord.dispatch_id.desc()):
        inc = dispatch.fire_incident
        if kind != 'all' and (inc.record_kind or 'unknown') != kind:
            continue
        snapshot = dispatch.context_snapshot or {}
        if station_id and snapshot.get('station_id') != station_id:
            continue
        if shift and snapshot.get('shift_name') != shift:
            continue
        if 'roster' not in snapshot:
            if parse(dispatch.dispatch_at) >= start:
                missing_rosters += 1
            continue
        for index, member in enumerate(snapshot['roster']):
            if per_id and member['per_id'] != per_id:
                continue
            assigned = parse(member['assigned_at'])
            # Administrative completion does not prove physical clearance.
            released = parse(member.get('released_at')) or parse(dispatch.cleared_at)
            if assigned >= end or (released and released <= start):
                continue
            excluded = dispatch.dispatch_status in EXCLUDED or inc.fire_status in EXCLUDED
            valid = bool(released and released >= assigned and not excluded)
            duration = (min(end, released)-max(start, assigned)).total_seconds() if valid else None
            rows.append({'dispatch_id': dispatch.dispatch_id, 'fire_id': dispatch.fire_id, 'team_id': dispatch.team_id,
                         'per_id': member['per_id'], 'name': member['name'], 'rank': member['rank'], 'role': member['role'],
                         'team': snapshot.get('team_name'), 'station': snapshot.get('station_name'), 'shift': snapshot.get('shift_name'),
                         'record_kind': inc.record_kind or 'unknown', 'assigned_at': iso(assigned), 'released_at': iso(released),
                         'status': dispatch.dispatch_status, 'assignment_segment': index, 'excluded': excluded,
                         'acknowledged_at': iso(dispatch.acknowledged_at), 'acknowledgement_basis': 'team_dispatch_action',
                         'duration_seconds': duration,
                         'duration_quality': 'excluded' if excluded else 'recorded' if valid else 'invalid' if released else 'clearance_not_recorded',
                         '_interval': (max(start, assigned), min(end, released)) if valid else None})
    people = defaultdict(list)
    for row in rows:
        people[row['per_id']].append(row)
    summaries = []
    for person, entries in people.items():
        eligible = [r for r in entries if not r['excluded']]
        summaries.append({'per_id': person, 'name': entries[0]['name'],
                          'assignments': len({r['dispatch_id'] for r in eligible}),
                          'unique_incidents': len({r['fire_id'] for r in eligible}),
                          'completed_assignments': len({r['dispatch_id'] for r in eligible if r['released_at']}),
                          'cancelled_assignments': len({r['dispatch_id'] for r in entries if r['excluded']}),
                          'duration_coverage': sum(r['_interval'] is not None for r in eligible),
                          'deployment_seconds': merged_seconds([r['_interval'] for r in eligible if r['_interval']]),
                          'roles': dict(Counter(r['role'] or 'Unknown' for r in eligible))})
    for row in rows:
        del row['_interval']
    return {'start': iso(start), 'end': iso(end), 'record_kind': kind, 'rows': rows,
            'personnel': sorted(summaries, key=lambda p: (p['name'], p['per_id'])), 'unknown_roster_dispatches': missing_rosters,
            'notice': 'Assignments describe recorded roster membership, not verified attendance. Duration requires recorded release or clearance; overlapping intervals are merged per person.'}
