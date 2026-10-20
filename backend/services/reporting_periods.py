"""Shared reporting windows; historical source dates are never shifted to today."""
from datetime import datetime, timedelta, timezone

PERIOD_DAYS = {"1d": 1, "1w": 7, "1m": 30, "6m": 182, "1y": 365}
PHT = timezone(timedelta(hours=8))


def reporting_window(period, now, earliest=None):
    if period == "all":
        return min(earliest, now) if earliest else now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), now
    if period == "2023-2024":
        return datetime(2023, 1, 1, tzinfo=PHT), datetime(2025, 1, 1, tzinfo=PHT)
    return now - timedelta(days=PERIOD_DAYS.get(period, 30)), now
