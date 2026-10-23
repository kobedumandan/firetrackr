"""Exact recurring admin traffic windows, evaluated in Philippine local time."""
from datetime import datetime
from zoneinfo import ZoneInfo

MANILA = ZoneInfo('Asia/Manila')


def schedule_active(schedule, now=None):
    now = now or datetime.now(MANILA)
    local = now.replace(tzinfo=MANILA) if now.tzinfo is None else now.astimezone(MANILA)
    day = local.weekday()
    days = schedule['days']
    if schedule['all_day']:
        return day in days
    minute = local.hour * 60 + local.minute
    for window in schedule['windows']:
        start = sum(int(v) * factor for v, factor in zip(window['start'].split(':'), (60, 1)))
        end = sum(int(v) * factor for v, factor in zip(window['end'].split(':'), (60, 1)))
        if start < end and day in days and start <= minute < end:
            return True
        if start > end and ((day in days and minute >= start) or ((day - 1) % 7 in days and minute < end)):
            return True
    return False


def constraint_style_key(row):
    if row.constraint_type == 'traffic_area':
        return 'traffic_general'
    severity = getattr(row, 'narrow_severity', None)
    return {'slight': 'narrow_road_slight', 'severe': 'narrow_road_severe'}.get(severity, 'narrow_road')
