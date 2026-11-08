"""Server-owned duty eligibility; standby fixes never imply vehicle occupancy."""
from datetime import datetime, timedelta, timezone

from models import DispatchRecord, DispatchTruck, ResponseTeamMember
from services.personnel_arrival import arrival_for
from shift_utils import SHIFT_TZ, SHIFT_CUTOVER_HOUR, current_shift_name

ACTIVE = ('dispatched', 'en_route', 'on_scene')


def duty_window(now):
    local = now.astimezone(SHIFT_TZ)
    start = local.replace(hour=SHIFT_CUTOVER_HOUR, minute=0, second=0, microsecond=0)
    if local < start:
        start -= timedelta(days=1)
    return start, start + timedelta(days=1)


def duty(person, now=None):
    now = now or datetime.now(timezone.utc)
    start, end = duty_window(now)
    name = (person.shift.shift_name if person.shift else '').strip().lower().replace('_', ' ')
    if name not in (current_shift_name(now).lower(), f'shift {current_shift_name(now).lower()}'):
        return False, 'off_duty' if name else 'shift_unassigned', start, end
    if any((m.member_status or '').lower().replace('_', '') in ('offduty', 'inactive')
           for m in person.team_memberships):
        return False, 'marked_off_duty', start, end
    return True, None, start, end


def active_dispatches(db, per_id):
    return db.query(DispatchRecord).join(
        ResponseTeamMember, ResponseTeamMember.team_id == DispatchRecord.team_id,
    ).filter(ResponseTeamMember.per_id == per_id, DispatchRecord.dispatch_status.in_(ACTIVE)).order_by(
        DispatchRecord.dispatch_at.desc(), DispatchRecord.dispatch_id.desc()).all()


def policy(db, person, now=None, *, dispatches=None, arrivals=None):
    """Derive tracking policy, optionally reusing a roster's server-side reads."""
    now = now or datetime.now(timezone.utc)
    allowed, reason, start, end = duty(person, now)
    if allowed:
        dispatches = active_dispatches(db, person.per_id) if dispatches is None else dispatches
    else:
        dispatches = []
    if len(dispatches) > 1:
        allowed, reason = False, 'ambiguous_dispatch_assignment'
    dispatch = dispatches[0] if allowed and dispatches else None
    returning = None
    if allowed and dispatch is None:
        returning = db.query(DispatchTruck).filter(
            DispatchTruck.return_driver_per_id == person.per_id,
            DispatchTruck.return_started_at.is_not(None), DispatchTruck.returned_at.is_(None),
            DispatchTruck.ready_at.is_(None),
        ).order_by(DispatchTruck.return_started_at.desc()).first()
        if returning:
            dispatch = returning.dispatch_record
    arrived = (arrival_for(db, dispatch, person.per_id) if arrivals is None
               else arrivals.get((dispatch.dispatch_id, person.per_id))) if dispatch else None
    mode = 'returning' if returning else ('on_scene' if arrived else 'dispatch') if dispatch else 'standby'
    return {'mode': mode if allowed else 'off', 'on_duty': allowed, 'reason': reason,
            'interval_ms': (10000 if mode == 'returning' else 20000 if mode == 'on_scene' else 3000 if mode == 'dispatch' else 30000) if allowed else None,
            'dispatch_id': dispatch.dispatch_id if dispatch else None,
            'server_time': now.isoformat(), 'duty_starts_at': start.isoformat(), 'duty_ends_at': end.isoformat(),
            'policy_expires_at': min(now + timedelta(minutes=2), end).isoformat()}
