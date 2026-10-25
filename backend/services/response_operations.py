"""Incident lifecycle analysis for the combined Response & Operations workspace.

Incident cohorts use receipt (occurrence fallback for missing receipt). Team
selection applies only to the separate dispatch comparison, never first arrival.
"""
from datetime import timedelta

from services import operational_times as operational
from services.historical_incidents import demo_times
from services.response_performance import context, MANILA
from services.timing_metrics import EXCLUDED, summarize

STAGES = ("processing", "preparation", "travel", "suppression")
METRICS = (*STAGES, "cta", "operation")


def incidents(db, start, end, kind="operational", team_ids=None, station_id=None,
              barangay_id=None, severity=None, source="recorded"):
    result = []
    for inc in operational.load_incidents(db, start, end):
        if bool(demo_times(inc)) != (source == "demo"):
            continue
        if kind != "all" and (inc.record_kind or "unknown") != kind:
            continue
        if barangay_id and inc.brgy_id != barangay_id:
            continue
        if severity and inc.fire_severity != severity:
            continue
        if station_id and not any(context(d).get("station_id") == station_id for d in inc.dispatches):
            continue
        result.append(inc)
    return result


def metric_samples(cohort, source):
    values = {key: [] for key in METRICS}
    for inc in cohort:
        demo = demo_times(inc) if source == "demo" else None
        if demo:
            for key in METRICS:
                seconds = demo.get(key)
                excluded = inc.fire_status in EXCLUDED
                values[key].append({"seconds": None if excluded else seconds,
                                    "quality": "excluded" if excluded else "valid" if seconds is not None else "missing",
                                    "reason": "cancelled_or_recalled" if excluded else None if seconds is not None else "not_recorded_in_demo"})
            continue
        for key, metric in operational.incident_metrics(inc).items():
            if key == 'suppression' and inc.response_kind != 'fire':
                continue
            values[key].append(metric)
        for dispatch in inc.dispatches:
            for unit in dispatch.dispatch_trucks:
                metrics = operational.unit_metrics(unit, inc)
                for key in ("preparation", "travel"):
                    values[key].append(metrics[key])
    return values


def record(inc, source="recorded"):
    result = operational.record_dict(inc)
    if source == "demo":
        result["metrics"] = {key: values[0] for key, values in metric_samples([inc], source).items()}
        result["durations"].update({key: value["seconds"] for key, value in result["metrics"].items()})
    # Processing here describes the first dispatch, rather than the winning unit.
    if source != "demo":
        result["durations"]["processing"] = result["metrics"]["processing"]["seconds"]
        _, _, first, _ = operational.incident_times(inc)
        for key in ("preparation", "travel"):
            result["metrics"][key] = operational.unit_metrics(first, inc)[key] if first else {
                "seconds": None, "quality": "missing", "reason": "no_identifiable_arriving_truck"}
    result["dispatch_count"] = len(inc.dispatches)
    result["location"] = inc.fire_address or inc.fire_location_name
    return result


def records(db, page=1, page_size=10, **filters):
    cohort = incidents(db, **filters)
    pages = max(1, (len(cohort) + page_size - 1) // page_size)
    page = min(max(1, page), pages)
    return {"records": [record(i, filters.get("source", "recorded")) for i in cohort[(page-1)*page_size:page*page_size]],
            "total": len(cohort), "page": page, "page_size": page_size, "total_pages": pages}


def analytics(db, **filters):
    start, end, source = filters["start"], filters["end"], filters.get("source", "recorded")
    current = incidents(db, **filters)
    previous = incidents(db, **{**filters, "start": start-(end-start), "end": start})
    samples = metric_samples(current, source)
    prior = metric_samples(previous, source)
    stats = {key: summarize(values) for key, values in samples.items()}
    for key, stat in stats.items():
        before = summarize(prior[key])
        stat["previous_valid"] = before["valid"]
        avg = before["mean_seconds"]
        stat["change_percent"] = (stat["mean_seconds"]-avg)/avg*100 if avg and stat["mean_seconds"] is not None else None
    trends = []
    span = end - start
    trend_period = '1d' if span <= timedelta(days=2) else '1m' if span <= timedelta(days=62) else 'all'
    cursor = start.astimezone(MANILA).replace(minute=0, second=0, microsecond=0)
    if trend_period != '1d':
        cursor = cursor.replace(hour=0)
    if trend_period == 'all':
        cursor = cursor.replace(day=1)
    while cursor < end:
        following = ((cursor.replace(day=28)+timedelta(days=4)).replace(day=1) if trend_period == 'all'
                     else cursor + (timedelta(hours=1) if trend_period == '1d' else timedelta(days=1)))
        subset = [i for i in current if cursor <= (i.report_received_at or i.fire_incident_datetime) < following]
        summaries = {key: summarize(values) for key, values in metric_samples(subset, source).items()}
        trends.append({"at": operational.iso(cursor), "values": {key: s["mean_seconds"] for key, s in summaries.items()},
                       "counts": {key: s["valid"] for key, s in summaries.items()}})
        cursor = following
    _, common = operational.samples(current, include_demo=source == "demo")
    return {"summary": stats, "trends": trends, "trend_period": trend_period, "total": len(current), "source": source,
            "breakdown": {"count": len(common), "seconds": {
                key: sum(r[key] for r in common)/len(common) if common else None for key in STAGES}},
            "start": operational.iso(start), "end": operational.iso(end)}
