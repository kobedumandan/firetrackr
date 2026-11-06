"""Shared reporting windows; historical source dates are never shifted to today."""
from datetime import date, datetime, time, timedelta, timezone
import re

PERIOD_DAYS = {"1d": 1, "1w": 7, "1m": 30, "6m": 182, "1y": 365}
PHT = timezone(timedelta(hours=8))


def custom_reporting_window(date_from, date_to, now):
    """Inclusive Philippine calendar dates represented as a half-open window."""
    if not all(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value)
               for value in (date_from, date_to)):
        raise ValueError("Choose both dates in YYYY-MM-DD format.")
    try:
        first, last = date.fromisoformat(date_from), date.fromisoformat(date_to)
    except ValueError:
        raise ValueError("Choose valid calendar dates.") from None
    if first > last:
        raise ValueError("The start date must be on or before the end date.")
    if last > now.astimezone(PHT).date():
        raise ValueError("Reporting dates cannot be in the future.")
    start = datetime.combine(first, time.min, tzinfo=PHT)
    end = min(datetime.combine(last + timedelta(days=1), time.min, tzinfo=PHT), now)
    return start, end


def reporting_window(period, now, earliest=None):
    if period == "all":
        return min(earliest, now) if earliest else now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), now
    if period == "2023-2024":
        return datetime(2023, 1, 1, tzinfo=PHT), datetime(2025, 1, 1, tzinfo=PHT)
    return now - timedelta(days=PERIOD_DAYS.get(period, 30)), now
