"""Measured response intervals. Never substitute ETA or incident occurrence for events."""
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt, isfinite
from statistics import mean
from zoneinfo import ZoneInfo
from config import OPERATIONAL_GPS_AUTOMATION

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from models import DispatchRecord, FireIncident, IncidentEvent, Route, TruckLog
from services.incident_events import actor_name
from services.historical_incidents import attach_history, history, demo_times
from services.reporting_periods import reporting_window

UTC = timezone.utc
MANILA = ZoneInfo("Asia/Manila")
PERIOD_DAYS = {"1d": 1, "1w": 7, "1m": 30, "6m": 182, "1y": 365}
STAGES = ("processing", "preparation", "travel", "suppression", "cta")
EXCLUDED = {"cancelled", "canceled", "recalled"}


def iso(value):
    return value.astimezone(UTC).isoformat() if value is not None else None


def seconds(start, end):
    if start is None or end is None or end < start:
        return None
    return (end - start).total_seconds()


def valid_time(value):
    if value.tzinfo is None:
        raise HTTPException(422, "Include a timezone in the event timestamp.")
    value = value.astimezone(UTC)
    if value > datetime.now(UTC) + timedelta(seconds=30):
        raise HTTPException(422, "An operational event cannot be in the future.")
    return value


def audit(db, inc, kind, at, user=None, unit=None, dispatch=None, source="manual", key=None, metadata=None):
    event = IncidentEvent(
        fire_id=inc.fire_id, event_type=kind, occurred_at=at, created_at=datetime.now(UTC),
        source=source, verified=True, user_id=user.user_id if user else None,
        event_actor=actor_name(user), dispatch_id=unit.dispatch_id if unit else (dispatch.dispatch_id if dispatch else None),
        dispatch_truck_id=unit.dispatch_truck_id if unit else None,
        idempotency_key=key, event_metadata=metadata or {},
    )
    db.add(event)
    return event


def snapshot_routes(db, dispatch, reason="selection_or_rebuild"):
    """Audit route choice at write time; route algorithms and live rows are unchanged."""
    with db.no_autoflush:
        db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).with_for_update().one()
    db.flush()
    routes = db.query(Route).filter(Route.dispatch_id == dispatch.dispatch_id).order_by(Route.route_rank).all()
    if not routes or dispatch.route_id is None:
        return
    from ai.config import Config
    payload = {"selected_route_id": dispatch.route_id,
               "region": Config.REGION, "inference_mode": Config.GNN_INFERENCE_MODE, "routes": [
        {"route_id": r.route_id, "rank": r.route_rank, "wkt": r.route_path_geojson,
         "distance_meters": r.route_distance_meters, "eta_seconds": r.route_est_minutes * 60 if r.route_est_minutes is not None else None,
         "origin": [float(r.route_origin_lat), float(r.route_origin_lng)] if r.route_origin_lat is not None and r.route_origin_lng is not None else None,
         "origin_source": r.route_origin_source}
        for r in routes
    ]}
    previous = db.query(IncidentEvent).filter_by(dispatch_id=dispatch.dispatch_id, event_type="op_routes").order_by(IncidentEvent.event_id.desc()).first()
    if previous and {k: v for k, v in previous.event_metadata.items() if k != "selection_reason"} == payload:
        return
    audit(db, dispatch.fire_incident, "op_routes", datetime.now(UTC), dispatch=dispatch,
          source="routing", metadata={**payload, "selection_reason": reason})


def record_milestone(db, inc, kind, at, user, unit=None, key=None, response_kind=None, source="manual", metadata=None):
    """Caller holds the incident lock. First verified timestamp wins; retries are safe."""
    at = valid_time(at)
    signature = {"kind": kind, "at": iso(at), "unit_id": unit.dispatch_truck_id if unit else None, "response_kind": response_kind}
    if key:
        previous = db.query(IncidentEvent).filter_by(idempotency_key=key).first()
        if previous:
            if previous.fire_id != inc.fire_id or (previous.event_metadata or {}).get("submission") != signature:
                raise HTTPException(409, "This submission key was already used for a different event.")
            return previous
    if response_kind:
        if inc.response_kind and inc.response_kind != response_kind:
            raise HTTPException(409, "Response classification is already verified.")
        inc.response_kind = response_kind
    if kind == "classification":
        if not response_kind:
            raise HTTPException(422, "Select a response classification.")
        return audit(db, inc, "op_classification", at, user, source=source, key=key, metadata={"submission": signature})
    field = {"receipt": "report_received_at", "departure": "departed_at", "arrival": "arrived_at",
             "suppression_start": "suppression_started_at", "fire_out": "fire_out_at"}.get(kind)
    if not field:
        raise HTTPException(422, "Unknown operational event.")
    target = unit if kind in ("departure", "arrival") else inc
    if target is None:
        raise HTTPException(422, "Choose the responding truck.")
    existing = getattr(target, field)
    if kind == "arrival" and unit and unit.arrived_at is None and unit_arrival(unit) and at != unit_arrival(unit):
        raise HTTPException(409, "An arrival is already recorded for this single-truck dispatch. Preserve its original timestamp.")
    if existing is not None:
        if existing != at:
            raise HTTPException(409, "This milestone is already recorded. Its original timestamp is preserved.")
        return None
    dispatches = [d for d in inc.dispatches if d.dispatch_status not in EXCLUDED and d.dispatch_at]
    if kind == "receipt":
        later = [d.dispatch_at for d in dispatches] + [v for v in (inc.suppression_started_at, inc.fire_out_at) if v]
        if later and at > min(later):
            raise HTTPException(422, "Report receipt must be at or before dispatch and suppression.")
    if unit:
        dispatch = unit.dispatch_record
        if dispatch.fire_id != inc.fire_id or dispatch.dispatch_status in EXCLUDED:
            raise HTTPException(422, "This unit is not an eligible response.")
        if dispatch.dispatch_at is None or at < dispatch.dispatch_at or (unit.truck_assigned_at and at < unit.truck_assigned_at):
            raise HTTPException(422, "A unit milestone cannot precede its dispatch or assignment.")
        if dispatch.dispatch_completed_at and at > dispatch.dispatch_completed_at:
            raise HTTPException(422, "A unit milestone cannot follow dispatch completion.")
        if kind == "departure" and unit_arrival(unit) and at > unit_arrival(unit):
            raise HTTPException(422, "Departure must precede arrival.")
        if kind == "arrival" and unit.departed_at and at < unit.departed_at:
            raise HTTPException(422, "Arrival must follow departure.")
        if kind == "arrival" and inc.suppression_started_at:
            arrivals = [unit_arrival(u) for d in dispatches for u in d.dispatch_trucks
                        if u is not unit and unit_arrival(u)]
            arrivals += [d.dispatch_arrived_at for d in dispatches if d.dispatch_arrived_at
                         and d.dispatch_arrived_at >= d.dispatch_at]
            if min([at, *arrivals]) > inc.suppression_started_at:
                raise HTTPException(422, "The first arrival must precede recorded suppression.")
    if kind in ("suppression_start", "fire_out"):
        if inc.response_kind != "fire":
            raise HTTPException(422, "Verify that this is a fire response before recording suppression.")
        arrivals = [unit_arrival(u) for d in dispatches for u in d.dispatch_trucks if unit_arrival(u)]
        arrivals += [d.dispatch_arrived_at for d in dispatches if d.dispatch_arrived_at
                     and d.dispatch_arrived_at >= d.dispatch_at]
        if inc.report_received_at and at < inc.report_received_at:
            raise HTTPException(422, "Suppression cannot precede report receipt.")
        if arrivals and at < min(arrivals):
            raise HTTPException(422, "Suppression cannot precede the first responding unit's arrival.")
        if kind == "suppression_start" and inc.fire_out_at and at > inc.fire_out_at:
            raise HTTPException(422, "Suppression start must precede fire out.")
        if kind == "fire_out" and (inc.suppression_started_at is None or at < inc.suppression_started_at):
            raise HTTPException(422, "Record suppression start before fire out.")
    payload = {**(metadata or {}), "submission": signature}
    if kind == "departure":
        # Offline events use the route choice known at departure, not today's route.
        route_event = db.query(IncidentEvent).filter(
            IncidentEvent.dispatch_id == unit.dispatch_id, IncidentEvent.event_type == "op_routes",
            IncidentEvent.occurred_at <= at,
        ).order_by(IncidentEvent.occurred_at.desc(), IncidentEvent.event_id.desc()).first()
        payload["baseline"] = route_event.event_metadata if route_event else None
    setattr(target, field, at)
    return audit(db, inc, f"op_{kind}", at, user, unit=unit, source=source, key=key, metadata=payload)


def unit_arrival(unit):
    """Reuse a legacy dispatch arrival only when exactly one assigned truck qualifies.

    This is a read-time interpretation of existing data, not a timestamp backfill.
    Multi-truck dispatch-level arrivals cannot identify an individual vehicle.
    """
    if unit.arrived_at is not None:
        return unit.arrived_at
    dispatch = unit.dispatch_record
    at = dispatch.dispatch_arrived_at
    if (len(dispatch.dispatch_trucks) == 1 and at and dispatch.dispatch_at
            and at >= dispatch.dispatch_at and (not unit.truck_assigned_at or at >= unit.truck_assigned_at)):
        return at
    return None


def unit_times(unit, inc):
    dispatch = unit.dispatch_record
    eligible = dispatch.dispatch_status not in EXCLUDED and inc.fire_status not in EXCLUDED
    return {
        "processing": seconds(inc.report_received_at, dispatch.dispatch_at) if eligible else None,
        "preparation": seconds(dispatch.dispatch_at, unit.departed_at) if eligible else None,
        "travel": seconds(unit.departed_at, unit_arrival(unit)) if eligible else None,
        "cta": seconds(inc.report_received_at, unit_arrival(unit)) if eligible else None,
    }


def incident_times(inc):
    dispatches = [d for d in inc.dispatches if d.dispatch_status not in EXCLUDED and d.dispatch_at]
    units = [u for d in dispatches for u in d.dispatch_trucks]
    arrivals = [u for u in units if unit_arrival(u) and seconds(u.dispatch_record.dispatch_at, unit_arrival(u)) is not None]
    first = min(arrivals, key=lambda u: (unit_arrival(u), u.dispatch_truck_id), default=None)
    times = unit_times(first, inc) if first else {s: None for s in ("processing", "preparation", "travel", "cta")}
    # For the table/breakdown, intervals belong to the first arriving unit. The
    # processing card uses first dispatch per incident; unit cards retain all units.
    times["suppression"] = seconds(inc.suppression_started_at, inc.fire_out_at) if inc.response_kind == "fire" else None
    if inc.fire_status in EXCLUDED:
        times = {s: None for s in STAGES}
    first_dispatch = min((d.dispatch_at for d in dispatches), default=None)
    if first is None and inc.fire_status not in EXCLUDED:
        times["processing"] = seconds(inc.report_received_at, first_dispatch)
    return times, units, first, seconds(inc.report_received_at, first_dispatch) if inc.fire_status not in EXCLUDED else None


def record_dict(inc):
    durations, units, first, _ = incident_times(inc)
    demo = demo_times(inc)
    source = history(inc)
    return {"fire_id": inc.fire_id, "reported_at": iso(inc.report_received_at),
            "occurred_at": iso(inc.fire_incident_datetime), "response_kind": inc.response_kind,
            "status": inc.fire_status, "durations": demo or durations, "unit_count": len(units),
            "timing_basis": "synthetic_demo" if demo else "recorded",
            "source_record_id": source.get("record_id"),
            "location_specification": source.get("pin_specification"),
            "synthetic_timeline": source.get("synthetic_timeline") if demo else None,
            "first_unit_id": first.dispatch_truck_id if first else None,
            "barangay": inc.barangay.brgy_name if inc.barangay else inc.fire_location_name}


def load_incidents(db, start, end):
    incidents = db.query(FireIncident).options(
        selectinload(FireIncident.dispatches).selectinload(DispatchRecord.dispatch_trucks),
        selectinload(FireIncident.barangay),
    ).filter(func.coalesce(FireIncident.report_received_at, FireIncident.fire_incident_datetime) >= start,
             func.coalesce(FireIncident.report_received_at, FireIncident.fire_incident_datetime) < end
    ).order_by(func.coalesce(FireIncident.report_received_at, FireIncident.fire_incident_datetime).desc(), FireIncident.fire_id.desc()).all()
    return attach_history(db, incidents)


def samples(incidents, include_demo=False):
    data = {s: [] for s in STAGES}
    common = []
    for inc in incidents:
        demo = demo_times(inc) if include_demo and inc.fire_status not in EXCLUDED else None
        if demo:
            for stage in STAGES:
                data[stage].append(demo[stage])
            common.append(demo)
            continue
        if inc.report_received_at is None or inc.fire_status in EXCLUDED:
            continue
        durations, units, first, processing = incident_times(inc)
        if processing is not None:
            data["processing"].append(processing)
        for unit in units:
            values = unit_times(unit, inc)
            for stage in ("preparation", "travel"):
                if values[stage] is not None:
                    data[stage].append(values[stage])
        for stage in ("suppression", "cta"):
            if durations[stage] is not None:
                data[stage].append(durations[stage])
        if first and all(durations[s] is not None for s in STAGES):
            common.append(durations)
    return data, common


def analytics(db, period, page=1, now=None, source="recorded"):
    now = now or datetime.now(UTC)
    earliest = db.query(func.min(func.coalesce(FireIncident.report_received_at, FireIncident.fire_incident_datetime))).scalar() if period == "all" else None
    start, now = reporting_window(period, now, earliest)
    span = now - start
    current = load_incidents(db, start, now)
    previous = [] if period == "all" else load_incidents(db, start - span, start)
    # Demo mode is a separate population, never silently blended into real KPIs.
    is_demo = source == "demo"
    current = [i for i in current if bool(demo_times(i)) == is_demo]
    previous = [i for i in previous if bool(demo_times(i)) == is_demo]
    data, common = samples(current, include_demo=is_demo)
    prior, _ = samples(previous, include_demo=is_demo)
    summary = {}
    for stage in STAGES:
        avg = mean(data[stage]) if data[stage] else None
        prev = mean(prior[stage]) if prior[stage] else None
        summary[stage] = {"seconds": avg, "count": len(data[stage]), "previous_count": len(prior[stage]),
                          "change_percent": (avg - prev) / prev * 100 if avg is not None and prev is not None and prev > 0 else None}
    # Calendar buckets in Philippine time, clipped to the same rolling window.
    local_start = start.astimezone(MANILA)
    cursor = local_start.replace(minute=0, second=0, microsecond=0) if period == "1d" else local_start.replace(hour=0, minute=0, second=0, microsecond=0)
    if period in ("6m", "1y", "2023-2024", "all"):
        cursor = cursor.replace(day=1)
    buckets = []
    while cursor < now:
        if period in ("6m", "1y", "2023-2024", "all"):
            following = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
        else:
            following = cursor + (timedelta(hours=1) if period == "1d" else timedelta(days=1))
        subset = [i for i in current if (i.report_received_at or (i.fire_incident_datetime if is_demo else None))
                  and cursor <= (i.report_received_at or i.fire_incident_datetime) < following]
        values, _ = samples(subset, include_demo=is_demo)
        buckets.append({"at": iso(cursor), "values": {s: mean(values[s]) if values[s] else None for s in STAGES},
                        "counts": {s: len(values[s]) for s in STAGES}})
        cursor = following
    breakdown = {s: mean([r[s] for r in common]) if common else None for s in STAGES[:-1]}
    page_size = 5
    total_pages = max(1, (len(current) + page_size - 1) // page_size)
    page = min(max(1, page), total_pages)
    return {"period": period, "start": iso(start), "end": iso(now), "timezone": "Asia/Manila",
            "summary": summary, "breakdown": {"count": len(common), "seconds": breakdown}, "trends": buckets,
            "records": [record_dict(i) for i in current[(page-1)*page_size:page*page_size]], "total": len(current), "page": page,
            "page_size": page_size, "total_pages": total_pages, "source": source,
            "synthetic_count": len(current) if is_demo else 0,
            "missing_receipt_count": sum(i.report_received_at is None for i in current) if not is_demo else 0}


def detail(db, inc):
    attach_history(db, [inc])
    result = record_dict(inc)
    events = db.query(IncidentEvent).filter_by(fire_id=inc.fire_id).order_by(IncidentEvent.created_at, IncidentEvent.event_id).all()
    result.update({"location": [inc.fire_latitude, inc.fire_longitude], "address": inc.fire_address,
                   "suppression_started_at": iso(inc.suppression_started_at), "fire_out_at": iso(inc.fire_out_at),
                   "controlled_at": next((iso(e.occurred_at or e.created_at) for e in events if e.event_type == "status" and e.event_to == "contained"), None),
                   "events": [{"type": e.event_type, "at": iso(e.occurred_at or e.created_at), "received_at": iso(e.created_at),
                               "source": e.source, "verified": e.verified, "actor": e.event_actor, "unit_id": e.dispatch_truck_id}
                              for e in events if e.event_type != "op_routes"], "units": []})
    for dispatch in inc.dispatches:
        for unit in dispatch.dispatch_trucks:
            departure = next((e for e in events if e.event_type == "op_departure" and e.dispatch_truck_id == unit.dispatch_truck_id), None)
            baseline = (departure.event_metadata or {}).get("baseline") if departure else None
            selected = next((r for r in (baseline or {}).get("routes", []) if r["route_id"] == baseline["selected_route_id"]), None)
            values = unit_times(unit, inc)
            eta = selected.get("eta_seconds") if selected else None
            # A saved prediction alone does not establish the actual departure
            # origin. Only a reliable departure fix can make it comparable.
            origin = selected.get("origin") if selected else None
            departure_fix = db.query(TruckLog).filter(
                TruckLog.dispatch_truck_id == unit.dispatch_truck_id,
                TruckLog.truck_log_recorded >= unit.departed_at - timedelta(seconds=30),
                TruckLog.truck_log_recorded <= unit.departed_at + timedelta(seconds=30),
                TruckLog.accuracy_m <= 35,
            ).order_by(TruckLog.truck_log_recorded).first() if unit.departed_at else None
            comparable = bool(origin and departure_fix and distance_m(
                origin, [departure_fix.truck_log_lat, departure_fix.truck_log_long]
            ) + departure_fix.accuracy_m <= 150)
            difference = values["travel"] - eta if comparable and values["travel"] is not None and eta is not None else None
            station = dispatch.team.station if dispatch.team else None
            # Historical samples must carry explicit dispatch-unit association.
            logs = []
            arrival = unit_arrival(unit)
            if unit.departed_at and arrival:
                logs = db.query(TruckLog).filter(TruckLog.dispatch_truck_id == unit.dispatch_truck_id,
                    TruckLog.truck_log_recorded >= unit.departed_at, TruckLog.truck_log_recorded <= arrival,
                    TruckLog.accuracy_m <= 35).order_by(TruckLog.truck_log_recorded).all()
            segments, segment, last = [], [], None
            for log in logs:
                if last and (log.truck_log_recorded - last).total_seconds() > 120:
                    if len(segment) > 1:
                        segments.append(segment)
                    segment = []
                segment.append([log.truck_log_lat, log.truck_log_long])
                last = log.truck_log_recorded
            if len(segment) > 1:
                segments.append(segment)
            # Bound response size while retaining gap boundaries and endpoints.
            segments = [[*seg[::max(1, len(seg)//1000)], seg[-1]] for seg in segments]
            current_routes = [{"route_id": r.route_id, "rank": r.route_rank, "wkt": r.route_path_geojson,
                               "eta_seconds": r.route_est_minutes * 60 if r.route_est_minutes is not None else None}
                              for r in db.query(Route).filter_by(dispatch_id=dispatch.dispatch_id).all()]
            result["units"].append({"id": unit.dispatch_truck_id, "dispatch_id": dispatch.dispatch_id,
                "truck": unit.truck.truck_platenum if unit.truck else str(unit.truck_id),
                "team": dispatch.team.team_name if dispatch.team else None, "status": dispatch.dispatch_status,
                "station": station.station_name if station else None,
                "station_location": [station.station_latitude, station.station_longitude] if station and station.station_latitude is not None and station.station_longitude is not None else None,
                "dispatch_at": iso(dispatch.dispatch_at), "departed_at": iso(unit.departed_at), "arrived_at": iso(arrival),
                "arrival_source": "legacy_single_truck_dispatch" if arrival and unit.arrived_at is None else None,
                "durations": values, "baseline_available": baseline is not None,
                "routes": baseline["routes"] if baseline else current_routes,
                "selected_route_id": baseline["selected_route_id"] if baseline else dispatch.route_id,
                "eta_seconds": eta, "difference_seconds": difference,
                "eta_comparable": comparable,
                "eta_comparison_note": None if comparable else "A reliable departure fix matching the planned origin is unavailable.",
                "error_percent": difference / eta * 100 if difference is not None and eta is not None and eta > 0 else None,
                "gps_segments": segments, "gps_sample_count": len(logs)})
    return result


def distance_m(a, b):
    lat1, lon1, lat2, lon2 = map(radians, (*a, *b))
    value = sin((lat2-lat1)/2)**2 + cos(lat1)*cos(lat2)*sin((lon2-lon1)/2)**2
    return 6371000 * 2 * asin(sqrt(min(1, value)))


def collect_telemetry(db, dispatch, user, latitude, longitude, recorded_at, accuracy, sample_id=None):
    """Conservative vehicle-only detection. Old mobile payloads remain accepted.

    Missing accuracy, ambiguous manning, and unverified historical samples cannot
    create vehicle milestones. Offline points within a continuing manning session
    are sorted by device time; committed events are never moved by later packets.
    """
    if accuracy is None or not all(isfinite(x) for x in (latitude, longitude, accuracy)) or not 0 <= accuracy <= 35:
        return False
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        return False
    at = valid_time(recorded_at)
    per_id = user.personnel.per_id
    units = [u for u in dispatch.dispatch_trucks if u.manned_by_per_id == per_id and u.manned_since and at >= u.manned_since]
    if len(units) != 1 or dispatch.dispatch_status in EXCLUDED or not dispatch.dispatch_at or at < dispatch.dispatch_at:
        return False
    unit = units[0]
    if dispatch.dispatch_completed_at and at > dispatch.dispatch_completed_at:
        return False
    inc = db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).populate_existing().with_for_update().one()
    db.flush()
    db.refresh(unit)
    if unit.manned_by_per_id != per_id or not unit.manned_since or at < unit.manned_since:
        return False
    key = f"gps:{unit.dispatch_truck_id}:{sample_id or iso(at)}"
    if db.query(TruckLog).filter_by(sample_key=key).first():
        return False
    db.add(TruckLog(truck_id=unit.truck_id, dispatch_truck_id=unit.dispatch_truck_id,
        per_id=per_id,
        truck_log_lat=latitude, truck_log_long=longitude, truck_log_recorded=at,
        accuracy_m=accuracy, received_at=datetime.now(UTC), source="manned_mobile", sample_key=key))
    db.flush()
    if not OPERATIONAL_GPS_AUTOMATION:
        return False
    logs = db.query(TruckLog).filter(TruckLog.dispatch_truck_id == unit.dispatch_truck_id,
        TruckLog.truck_log_recorded >= unit.manned_since, TruckLog.accuracy_m <= 35
    ).order_by(TruckLog.truck_log_recorded.desc()).limit(500).all()[::-1]
    station = dispatch.team.station if dispatch.team else None
    station_point = [station.station_latitude, station.station_longitude] if station and station.station_latitude is not None and station.station_longitude is not None else None
    seen_inside, outside, near = False, [], []
    previous = None
    changed = False
    for log in logs:
        point = [log.truck_log_lat, log.truck_log_long]
        if previous and (log.truck_log_recorded - previous).total_seconds() > 120:
            seen_inside, outside, near = False, [], []
        previous = log.truck_log_recorded
        if unit.departed_at is None and station_point:
            dist = distance_m(point, station_point)
            if dist + log.accuracy_m <= 100:
                seen_inside, outside = True, []
            elif dist - log.accuracy_m >= 150 and seen_inside:
                outside.append(log)
                if len(outside) >= 2 and 5 <= (log.truck_log_recorded-outside[0].truck_log_recorded).total_seconds() <= 120:
                    record_milestone(db, inc, "departure", outside[0].truck_log_recorded, user, unit, source="gps_geofence", metadata={"accuracy_limit_m": 35, "exit_radius_m": 150})
                    changed = True
            else:
                outside = []
        if unit.departed_at and log.truck_log_recorded >= unit.departed_at and unit_arrival(unit) is None:
            if distance_m(point, [inc.fire_latitude, inc.fire_longitude]) + log.accuracy_m <= 100:
                near.append(log)
                if len(near) >= 2 and 5 <= (log.truck_log_recorded-near[0].truck_log_recorded).total_seconds() <= 120:
                    record_milestone(db, inc, "arrival", near[0].truck_log_recorded, user, unit, source="gps_geofence", metadata={"accuracy_limit_m": 35, "arrival_radius_m": 100})
                    changed = True
            else:
                near = []
    return changed
