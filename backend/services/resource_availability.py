"""Shared dispatch eligibility and responsibility for unfinished truck returns."""
from fastapi import HTTPException
from sqlalchemy import or_, text

from models import DispatchRecord, DispatchTruck, FireIncident, ResponseTeam, ResponseTeamMember, Truck


ACTIVE = ('dispatched', 'en_route', 'on_scene')
_ASSIGNMENT_LOCK_NAMESPACE = 1179927634


def lock_personnel_assignments(db, per_ids):
    """Serialize roster/dispatch writers without locking GPS's Personnel rows.

    Call after incident/team locks, before reserving a truck. Sorted advisory
    locks also serialize two different teams which share a crew member.
    """
    for per_id in sorted(set(per_ids)):
        db.execute(text('SELECT pg_advisory_xact_lock(:namespace, :per_id)'),
                   {'namespace': _ASSIGNMENT_LOCK_NAMESPACE, 'per_id': per_id})


def lock_membership_team(db, team_id):
    """Match incident -> team lock order before sync_rosters changes evidence."""
    fire_ids = [row[0] for row in db.query(DispatchRecord.fire_id).filter(
        DispatchRecord.team_id == team_id, DispatchRecord.dispatch_status.in_(ACTIVE),
    ).distinct().all()]
    if fire_ids:
        db.query(FireIncident).filter(FireIncident.fire_id.in_(fire_ids)).order_by(
            FireIncident.fire_id).with_for_update().all()
    team = db.query(ResponseTeam).filter_by(team_id=team_id).populate_existing().with_for_update().first()
    if team:
        # Dispatch can commit between the first snapshot and the team lock.
        # Never acquire that new incident/dispatch under Team: clearance takes
        # them in the opposite order. Retry the request with a fresh snapshot.
        active_fire_ids = {row[0] for row in db.query(DispatchRecord.fire_id).filter(
            DispatchRecord.team_id == team_id, DispatchRecord.dispatch_status.in_(ACTIVE),
        ).distinct().all()}
        if active_fire_ids.difference(fire_ids):
            raise HTTPException(409, 'This team received a new dispatch while editing. Reload and try again.')
    return team


def pending_return_context(db, *, team_ids=(), per_ids=()):
    """Separate physical return progress from the readiness responsibility lock."""
    team_ids, per_ids = set(team_ids), set(per_ids)
    context = {'teams': {}, 'drivers': {}}
    if not team_ids and not per_ids:
        return context
    rows = db.query(DispatchRecord.team_id, DispatchTruck.return_driver_per_id,
        DispatchTruck.returned_at, DispatchTruck.not_ready_reason, Truck.truck_platenum).select_from(
        DispatchTruck).join(DispatchRecord).outerjoin(Truck, Truck.truck_id == DispatchTruck.truck_id).filter(
        or_(DispatchRecord.team_id.in_(team_ids), DispatchTruck.return_driver_per_id.in_(per_ids)),
        DispatchTruck.return_started_at.is_not(None), DispatchTruck.ready_at.is_(None),
    ).order_by(DispatchTruck.dispatch_truck_id).all()
    for team_id, per_id, returned_at, reason, plate in rows:
        blocker = (f'Truck not ready: {plate or "assigned truck"}. {reason or "Readiness confirmation pending."}'
                   if returned_at else f'Truck returning: {plate or "assigned truck"}. Confirm station arrival and readiness.')
        for key, value in (('teams', team_id), ('drivers', per_id)):
            if value is None:
                continue
            progress = context[key].setdefault(value, {'status': 'standby', 'blocker': '', 'assignment_reason': ''})
            if not returned_at:
                progress['status'] = 'returning'
            progress['blocker'] = ' '.join(filter(None, (progress['blocker'], blocker)))
            progress['assignment_reason'] = (f'Responsible Driver for {plate or "a returning truck"}. '
                'Complete Back at Station / Ready before changing this assignment.')
    return context


def return_assignment_locks(db, per_ids):
    """Batch UI reasons for captured Drivers, including a Not Ready return."""
    context = pending_return_context(db, per_ids=per_ids)
    return {per_id: row['assignment_reason'] for per_id, row in context['drivers'].items()}


def active_personnel_assignments(db, per_ids, *, exclude_team_id=None):
    """People in an active roster or still manning an actively dispatched truck."""
    per_ids = set(per_ids)
    if not per_ids:
        return set()
    memberships = db.query(ResponseTeamMember.per_id).join(
        DispatchRecord, DispatchRecord.team_id == ResponseTeamMember.team_id).filter(
        ResponseTeamMember.per_id.in_(per_ids), DispatchRecord.dispatch_status.in_(ACTIVE),
    )
    manning = db.query(DispatchTruck.manned_by_per_id).join(DispatchRecord).filter(
        DispatchTruck.manned_by_per_id.in_(per_ids), DispatchRecord.dispatch_status.in_(ACTIVE),
    )
    if exclude_team_id is not None:
        memberships = memberships.filter(DispatchRecord.team_id != exclude_team_id)
        manning = manning.filter(or_(DispatchRecord.team_id.is_(None), DispatchRecord.team_id != exclude_team_id))
    return {row[0] for row in memberships.all()} | {row[0] for row in manning.all()}


def personnel_assignment_reason(db, per_id, *, exclude_team_id=None):
    reason = return_assignment_locks(db, [per_id]).get(per_id)
    if reason:
        return reason
    if active_personnel_assignments(db, [per_id], exclude_team_id=exclude_team_id):
        return 'This personnel is already assigned to another active dispatch.'
    return None


def availability_snapshot(db, teams):
    """Batch recommendation reads; assignment writers always recheck under locks."""
    team_ids = {team.team_id for team in teams}
    truck_ids = {team.truck_id for team in teams if team.truck_id is not None}
    per_ids = {member.per_id for team in teams for member in team.members}
    state = {'active_teams': set(), 'returning_teams': set(), 'busy_trucks': set(),
             'return_drivers': set(), 'person_teams': {}}
    if not team_ids:
        return state
    state['active_teams'] = {row[0] for row in db.query(DispatchRecord.team_id).filter(
        DispatchRecord.team_id.in_(team_ids), DispatchRecord.dispatch_status.in_(ACTIVE)).all()}
    units = db.query(DispatchRecord.team_id, DispatchRecord.dispatch_status, DispatchTruck.truck_id,
        DispatchTruck.return_started_at, DispatchTruck.ready_at, DispatchTruck.return_driver_per_id,
        DispatchTruck.manned_by_per_id).join(DispatchRecord).filter(
            or_(DispatchRecord.team_id.in_(team_ids), DispatchTruck.truck_id.in_(truck_ids),
                DispatchTruck.return_driver_per_id.in_(per_ids), DispatchTruck.manned_by_per_id.in_(per_ids)),
            or_(DispatchRecord.dispatch_status.in_(ACTIVE),
                DispatchTruck.return_started_at.is_not(None) & DispatchTruck.ready_at.is_(None)),
        ).all()
    for team_id, status, truck_id, started, ready, driver_id, manning_id in units:
        state['busy_trucks'].add(truck_id)
        if started is not None and ready is None:
            state['returning_teams'].add(team_id)
            if driver_id is not None:
                state['return_drivers'].add(driver_id)
        if status in ACTIVE and manning_id is not None:
            state['person_teams'].setdefault(manning_id, set()).add(team_id)
    if per_ids:
        for per_id, team_id in db.query(ResponseTeamMember.per_id, ResponseTeamMember.team_id).join(
            DispatchRecord, DispatchRecord.team_id == ResponseTeamMember.team_id).filter(
                ResponseTeamMember.per_id.in_(per_ids), DispatchRecord.dispatch_status.in_(ACTIVE)).all():
            state['person_teams'].setdefault(per_id, set()).add(team_id)
    return state


def team_unavailability(db, team, *, members=None, truck=None, require_truck=False, require_members=False,
                        availability=None):
    """Return (diagnostic stage, reason), or None when dispatch can reserve it.

    Recommendations require a truck and crew. Manual dispatch retains the legacy
    ability to send a team without either; every existing resource still has to
    be available. The write caller holds the team/personnel/truck locks.
    """
    if team.station and (team.station.station_status or '').strip().lower() == 'inactive':
        return 'station_operational', 'This team belongs to an inactive station.'
    if (team.team_status or '').strip().lower() not in ('', 'standby'):
        return 'not_active', 'This team is not on standby.'
    active = team.team_id in availability['active_teams'] if availability is not None else db.query(DispatchRecord.dispatch_id).filter(
        DispatchRecord.team_id == team.team_id, DispatchRecord.dispatch_status.in_(ACTIVE),
    ).first()
    if active:
        return 'not_active', 'This team is already assigned to an active dispatch.'
    returning = team.team_id in availability['returning_teams'] if availability is not None else db.query(DispatchTruck.dispatch_truck_id).join(DispatchRecord).filter(
        DispatchRecord.team_id == team.team_id, DispatchTruck.return_started_at.is_not(None),
        DispatchTruck.ready_at.is_(None),
    ).first()
    if returning:
        return 'not_active', 'Complete this team\'s truck return/readiness before dispatching it again.'
    truck = truck if truck is not None else team.truck
    if require_truck and truck is None:
        return 'has_truck', 'This team has no assigned truck.'
    if truck is not None:
        busy = truck.truck_id in availability['busy_trucks'] if availability is not None else db.query(DispatchTruck.dispatch_truck_id).join(DispatchRecord).filter(
            DispatchTruck.truck_id == truck.truck_id,
            or_(DispatchRecord.dispatch_status.in_(ACTIVE),
                DispatchTruck.return_started_at.is_not(None) & DispatchTruck.ready_at.is_(None)),
        ).first()
        if (truck.truck_status or '').strip().lower() != 'available' or busy:
            return 'has_truck', 'This team\'s truck is unavailable or already dispatched.'
    members = list(team.members if members is None else members)
    if require_members and not members:
        return 'members_standby', 'This team has no assigned personnel.'
    if any((member.member_status or '').strip().lower() not in ('', 'standby') for member in members):
        return 'members_standby', 'This team has members who are not on standby.'
    per_ids = [member.per_id for member in members]
    return_held = any(per_id in availability['return_drivers'] for per_id in per_ids) if availability is not None else return_assignment_locks(db, per_ids)
    if return_held:
        return 'members_standby', 'This team has a Driver responsible for an unfinished truck return/readiness.'
    active_elsewhere = any(assigned_team != team.team_id for per_id in per_ids
                          for assigned_team in availability['person_teams'].get(per_id, ())) if availability is not None else active_personnel_assignments(db, per_ids, exclude_team_id=team.team_id)
    if active_elsewhere:
        return 'members_standby', 'This team has personnel already assigned to another active dispatch.'
    return None
