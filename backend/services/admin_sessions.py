"""Signed-in token lifetimes, merged across devices and split by Manila date."""
from datetime import datetime, timedelta, timezone

from jose import jwt

from config import JWT_ALGORITHM, JWT_SECRET
from models import AdminSession


def record_admin_session(db, user, token, login_id=None):
    if user.user_role != 'admin':
        return
    claims = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    db.add(AdminSession(
        user_id=user.user_id, login_id=login_id, jti=claims['jti'],
        started_at=datetime.fromtimestamp(claims['iat'], tz=timezone.utc),
        expires_at=datetime.fromtimestamp(claims['exp'], tz=timezone.utc),
    ))


def close_admin_session(db, jti):
    db.query(AdminSession).filter(
        AdminSession.jti == jti, AdminSession.ended_at.is_(None),
    ).update({'ended_at': datetime.now(timezone.utc)}, synchronize_session=False)


def daily_session_seconds(sessions, start_at, end_at, now, revoked_at=None):
    """Union overlapping signed-in intervals; cap open sessions at now or expiry."""
    intervals = []
    for session in sessions:
        # PostgreSQL stores aware values; this also supports isolated SQLite checks.
        def aware(value):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

        started = aware(session.started_at)
        ends = [aware(session.expires_at), now, end_at]
        if session.ended_at:
            ends.append(aware(session.ended_at))
        if revoked_at and started <= aware(revoked_at):
            ends.append(aware(revoked_at))
        begin, finish = max(started, start_at), min(ends)
        if finish > begin:
            intervals.append((begin, finish))

    merged = []
    for begin, finish in sorted(intervals):
        if merged and begin <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(finish, merged[-1][1]))
        else:
            merged.append((begin, finish))

    totals = {}
    for begin, finish in merged:
        begin, finish = begin.astimezone(start_at.tzinfo), finish.astimezone(start_at.tzinfo)
        while begin < finish:
            midnight = datetime.combine(begin.date() + timedelta(days=1), datetime.min.time(), tzinfo=start_at.tzinfo)
            stop = min(finish, midnight)
            key = begin.date().isoformat()
            totals[key] = totals.get(key, 0) + (stop - begin).total_seconds()
            begin = stop
    return {day: int(seconds) for day, seconds in totals.items()}
