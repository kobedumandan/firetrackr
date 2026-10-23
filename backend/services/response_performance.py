"""Dispatch observations and first-arrival cohorts shared by cards, rows and export.

p90 uses nearest rank (ceil(0.9*n)); means aggregate raw seconds, never team means.
All windows are half-open. Team selection never changes the overall cohort.
"""
from collections import Counter
from datetime import datetime, timedelta, timezone
from math import ceil
from statistics import mean, median
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from models import DispatchRecord, FireIncident, ResponseTeam, IncidentEvent, Station, BarangayBoundary
from services.operational_times import EXCLUDED, detail, iso
from serializers import _incident_dict

MANILA = ZoneInfo("Asia/Manila")
KINDS = {"operational", "drill", "test", "unknown"}
MEASURES = {
    "response": "Arrival minus dispatch",
    "handling": "Dispatch minus report receipt",
    "acknowledgement": "Acknowledgement minus dispatch (part of turnout)",
    "turnout": "Departure minus dispatch",
    "travel": "Arrival minus departure",
}
MAX_SECONDS = 6 * 3600


def window(start=None, end=None):
    now = datetime.now(timezone.utc)
    end = end or now
    if end.tzinfo is None or (start is not None and start.tzinfo is None):
        raise HTTPException(422, "Use timezone-aware start and end timestamps.")
    local = end.astimezone(MANILA)
    month = local.year * 12 + local.month - 1 - 11
    if start is None and month // 12 < 1:
        raise HTTPException(422, "The requested date range is outside supported dates.")
    start = start or datetime(month // 12, month % 12 + 1, 1, tzinfo=MANILA)
    if start >= end or end - start > timedelta(days=3660):
        raise HTTPException(422, "Choose an increasing date range of at most ten years.")
    try:
        start - (end - start)
    except OverflowError:
        raise HTTPException(422, "The preceding comparison range is outside supported dates.")
    return start, end


def measure(start, end, excluded=False):
    if excluded:
        return {"seconds": None, "quality": "excluded", "reason": "cancelled_or_recalled"}
    if start is None:
        return {"seconds": None, "quality": "missing", "reason": "missing_start"}
    if end is None:
        return {"seconds": None, "quality": "pending", "reason": "missing_end"}
    value = (end - start).total_seconds()
    if value < 0 or value > MAX_SECONDS:
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
    # New team-level actions take precedence. Existing unit evidence is labeled.
    return dispatch.departed_at or (dispatch.dispatch_trucks[0].departed_at if len(dispatch.dispatch_trucks) == 1 else None)


def context(dispatch):
    if dispatch.context_snapshot:
        return dispatch.context_snapshot
    team = dispatch.team
    return {"provenance": "legacy_current_metadata", "team_name": team.team_name if team else None,
            "station_id": team.station_id if team else None,
            "station_name": team.station.station_name if team and team.station else None,
            "shift_name": team.shift.shift_name if team and team.shift else None,
            "truck": team.truck.truck_platenum if team and team.truck else None}


def observation(dispatch):
    inc = dispatch.fire_incident
    arrived, departed = arrival(dispatch), departure(dispatch)
    excluded = dispatch.dispatch_status in EXCLUDED or inc.fire_status in EXCLUDED
    pairs = {"response": (dispatch.dispatch_at, arrived),
             "handling": (inc.report_received_at, dispatch.dispatch_at),
             "acknowledgement": (dispatch.dispatch_at, dispatch.acknowledged_at),
             "turnout": (dispatch.dispatch_at, departed), "travel": (departed, arrived)}
    metrics = {key: measure(*pair, excluded=excluded) for key, pair in pairs.items()}
    if not excluded and arrived and departed and departed > arrived:
        for key in ("response", "turnout", "travel"):
            metrics[key] = {"seconds": None, "quality": "invalid", "reason": "invalid_chronology"}
    if not excluded and dispatch.acknowledged_at and departed and dispatch.acknowledged_at > departed:
        for key in ("acknowledgement", "turnout"):
            metrics[key] = {"seconds": None, "quality": "invalid", "reason": "invalid_chronology"}
    return {"dispatch_id": dispatch.dispatch_id, "fire_id": inc.fire_id, "team_id": dispatch.team_id,
            "context": context(dispatch), "record_kind": inc.record_kind or "unknown",
            "status": dispatch.dispatch_status, "location": inc.fire_address or inc.fire_location_name,
            "severity": inc.fire_severity, "barangay_id": inc.brgy_id,
            "report_received_at": iso(inc.report_received_at), "occurred_at": iso(inc.fire_incident_datetime),
            "dispatch_at": iso(dispatch.dispatch_at), "acknowledged_at": iso(dispatch.acknowledged_at),
            "acknowledged_by": dispatch.acknowledged_by, "departed_at": iso(departed),
            "departed_by": dispatch.departed_by, "arrived_at": iso(arrived),
            "departure_basis": "dispatch_action" if dispatch.departed_at else "unit_evidence" if departed else None,
            "reinforcement": any(d.dispatch_at and dispatch.dispatch_at and d.dispatch_at < dispatch.dispatch_at
                                 and d.dispatch_status not in EXCLUDED for d in inc.dispatches),
            "metrics": metrics}


def load(db, start, end, kind="operational", team_ids=None, station_id=None, barangay_id=None, severity=None):
    if kind not in KINDS | {"all"}:
        raise HTTPException(422, "Unknown record kind.")
    query = db.query(DispatchRecord).options(
        selectinload(DispatchRecord.dispatch_trucks),
        selectinload(DispatchRecord.team).selectinload(ResponseTeam.station),
        selectinload(DispatchRecord.team).selectinload(ResponseTeam.shift),
        selectinload(DispatchRecord.team).selectinload(ResponseTeam.truck),
        selectinload(DispatchRecord.fire_incident).selectinload(FireIncident.dispatches),
    ).join(FireIncident).filter(DispatchRecord.dispatch_at >= start, DispatchRecord.dispatch_at < end)
    if kind != "all":
        query = query.filter(func.coalesce(FireIncident.record_kind, "unknown") == kind)
    if team_ids:
        query = query.filter(DispatchRecord.team_id.in_(team_ids))
    if barangay_id:
        query = query.filter(FireIncident.brgy_id == barangay_id)
    if severity:
        query = query.filter(FireIncident.fire_severity == severity)
    dispatches = query.order_by(DispatchRecord.dispatch_at.desc(), DispatchRecord.dispatch_id.desc()).all()
    if station_id:
        dispatches = [d for d in dispatches if context(d).get("station_id") == station_id]
    return [observation(d) for d in dispatches]


def overall(db, start, end, kind="operational", station_id=None, barangay_id=None, severity=None):
    query = db.query(FireIncident).options(
        selectinload(FireIncident.dispatches).selectinload(DispatchRecord.dispatch_trucks),
        selectinload(FireIncident.dispatches).selectinload(DispatchRecord.team),
    ).filter(func.coalesce(FireIncident.report_received_at, FireIncident.fire_incident_datetime) >= start,
             func.coalesce(FireIncident.report_received_at, FireIncident.fire_incident_datetime) < end)
    if kind != "all":
        query = query.filter(func.coalesce(FireIncident.record_kind, "unknown") == kind)
    if barangay_id:
        query = query.filter(FireIncident.brgy_id == barangay_id)
    if severity:
        query = query.filter(FireIncident.fire_severity == severity)
    observations = []
    for inc in query.all():
        # Station affects the incident cohort, never which of its crews arrives first.
        if station_id and not any(context(d).get("station_id") == station_id for d in inc.dispatches):
            continue
        eligible = [d for d in inc.dispatches if d.dispatch_status not in EXCLUDED]
        times = [arrival(d) for d in eligible if arrival(d) is not None and d.dispatch_at
                 and arrival(d) >= d.dispatch_at]
        excluded = inc.fire_status in EXCLUDED or (bool(inc.dispatches) and not eligible)
        value = measure(inc.report_received_at, min(times, default=None), excluded=excluded)
        if not excluded and inc.report_received_at and not times and any(arrival(d) is not None for d in eligible):
            value = {"seconds": None, "quality": "invalid", "reason": "invalid_chronology"}
        observations.append(value)
    return summarize(observations)


def summaries(rows):
    return {metric: summarize([row["metrics"][metric] for row in rows]) for metric in MEASURES}


def team_options(db):
    options = {}
    for dispatch in db.query(DispatchRecord).options(selectinload(DispatchRecord.team)).order_by(DispatchRecord.dispatch_at):
        options[dispatch.team_id] = context(dispatch).get("team_name") or f"Team {dispatch.team_id}"
    return [{"id": key, "name": value} for key, value in sorted(options.items())]


def analytics(db, start=None, end=None, kind="operational", team_ids=None, station_id=None, barangay_id=None, severity=None):
    start, end = window(start, end)
    filters = dict(kind=kind, team_ids=team_ids, station_id=station_id, barangay_id=barangay_id, severity=severity)
    rows = load(db, start, end, **filters)
    prior = load(db, start - (end-start), start, **filters)
    stats, previous = summaries(rows), summaries(prior)
    for key, stat in stats.items():
        before = previous[key]["mean_seconds"]
        stat["previous_mean_seconds"] = before
        stat["previous_valid"] = previous[key]["valid"]
        stat["change_percent"] = (stat["mean_seconds"]-before)/before*100 if before and stat["mean_seconds"] is not None else None
    overall_filters = {key: value for key, value in filters.items() if key != "team_ids"}
    service = overall(db, start, end, **overall_filters)
    preceding = overall(db, start-(end-start), start, **overall_filters)
    before = preceding["mean_seconds"]
    service["previous_valid"] = preceding["valid"]
    service["change_percent"] = (service["mean_seconds"]-before)/before*100 if before and service["mean_seconds"] is not None else None
    cursor = start.astimezone(MANILA).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    months = []
    while cursor < end:
        following = (cursor.replace(day=28)+timedelta(days=4)).replace(day=1)
        cohort = [r for r in rows if cursor <= datetime.fromisoformat(r["dispatch_at"]) < following]
        ids = sorted({r["team_id"] for r in rows})
        months.append({"month": cursor.strftime("%Y-%m"), "teams": [
            {"team_id": tid, "team_name": next(r["context"]["team_name"] for r in rows if r["team_id"] == tid),
             **summarize([r["metrics"]["response"] for r in cohort if r["team_id"] == tid])} for tid in ids]})
        cursor = following
    return {"start": iso(start), "end": iso(end), "timezone": "Asia/Manila", "record_kind": kind,
            "overall": service, "summary": stats, "monthly": months, "teams": team_options(db),
            "definitions": MEASURES, "candidate_dispatches": len(rows),
            "stations": [{"id": s.station_id, "name": s.station_name} for s in db.query(Station).order_by(Station.station_name)],
            "barangays": [{"id": b.brgy_id, "name": b.brgy_name} for b in db.query(BarangayBoundary).order_by(BarangayBoundary.brgy_name)],
            "comparison": "Equal-length preceding date window",
            "notice": "Descriptive results; case mix, location and reinforcement differ. Small samples do not establish performance or causation."}


def dispatch_detail(db, dispatch_id):
    dispatch = db.get(DispatchRecord, dispatch_id)
    if not dispatch:
        raise HTTPException(404, "Dispatch not found.")
    result = observation(dispatch)
    result["incident_record"] = _incident_dict(dispatch.fire_incident)
    result["incident"] = detail(db, dispatch.fire_incident)
    events = db.query(IncidentEvent).filter_by(dispatch_id=dispatch_id, event_type="op_routes").order_by(IncidentEvent.event_id).all()
    result["route_revisions"] = [{"id": e.event_id, "at": iso(e.occurred_at), **(e.event_metadata or {})} for e in events]
    return result
