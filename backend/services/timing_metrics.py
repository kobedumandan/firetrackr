"""Shared timing quality rules for incident, dispatch and unit reporting."""
from collections import Counter
from math import ceil
from statistics import mean, median

EXCLUDED = {"cancelled", "canceled", "recalled"}
MAX_SECONDS = 6 * 3600


def measure(start, end, excluded=False, max_seconds=MAX_SECONDS):
    if excluded:
        return {"seconds": None, "quality": "excluded", "reason": "cancelled_or_recalled"}
    if start is None:
        return {"seconds": None, "quality": "missing", "reason": "missing_start"}
    if end is None:
        return {"seconds": None, "quality": "pending", "reason": "missing_end"}
    value = (end - start).total_seconds()
    if value < 0 or (max_seconds is not None and value > max_seconds):
        return {"seconds": None, "raw_seconds": value, "quality": "invalid",
                "reason": "invalid_chronology" if value < 0 else "above_six_hour_review_guard"}
    return {"seconds": value, "quality": "valid", "reason": None}


def summarize(observations):
    counts = Counter(o["quality"] for o in observations)
    values = [o["seconds"] for o in observations if o["quality"] == "valid"]
    return {"candidate": len(observations), "valid": len(values),
            **{key: counts[key] for key in ("pending", "missing", "invalid", "excluded")},
            "mean_seconds": mean(values) if values else None,
            "median_seconds": median(values) if values else None,
            "p90_seconds": sorted(values)[ceil(.9 * len(values)) - 1] if values else None,
            "p90_method": "nearest_rank", "small_sample": 0 < len(values) < 10,
            "reasons": dict(Counter(o["reason"] for o in observations if o["reason"]))}


def arrival(dispatch):
    values = [dispatch.dispatch_arrived_at, *(u.arrived_at for u in dispatch.dispatch_trucks)]
    return min((v for v in values if v is not None), default=None)


def departure(dispatch):
    return dispatch.departed_at or (dispatch.dispatch_trucks[0].departed_at if len(dispatch.dispatch_trucks) == 1 else None)


def first_arrival(inc):
    """One incident observation, including legacy crew arrivals without truck identity."""
    eligible = [d for d in inc.dispatches if d.dispatch_status not in EXCLUDED]
    excluded = inc.fire_status in EXCLUDED or (bool(inc.dispatches) and not eligible)
    times, invalid = [], []
    for dispatch in eligible:
        at, left = arrival(dispatch), departure(dispatch)
        if at is None:
            continue
        if dispatch.dispatch_at and at >= dispatch.dispatch_at and (left is None or at >= left):
            times.append(at)
        else:
            invalid.append(at)
    result = measure(inc.report_received_at, min(times, default=None), excluded=excluded)
    if not excluded and inc.report_received_at and not times and invalid:
        return {"seconds": None, "quality": "invalid", "reason": "invalid_chronology"}
    return result
