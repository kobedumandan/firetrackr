"""Dispatch-attributed GPS history; never infer a person's path from a truck route."""
from collections import defaultdict
from datetime import datetime, timezone
from math import asin, cos, isfinite, radians, sin, sqrt

from models import DispatchLocation, IncidentEvent, Personnel, Route

MAX_GAP_SECONDS = 120
MAX_ACCURACY_M = 35
MAX_SPEED_MPS = 200 / 3.6
MAX_DISPLAY_POINTS = 1500


def utc(value):
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def stamp(value):
    return utc(value).astimezone(timezone.utc).isoformat() if value else None


def distance(a, b):
    lat1, lon1, lat2, lon2 = map(radians, (*a, *b))
    h = sin((lat2-lat1)/2)**2 + cos(lat1)*cos(lat2)*sin((lon2-lon1)/2)**2
    return 6371000 * 2 * asin(sqrt(min(1, h)))


def display_segments(segments):
    """Retain endpoints and gap boundaries when reducing large histories."""
    if sum(map(len, segments)) <= MAX_DISPLAY_POINTS:
        return segments
    if len(segments) > MAX_DISPLAY_POINTS // 2:
        count = MAX_DISPLAY_POINTS // 2
        segments = [segments[round(i * (len(segments)-1) / (count-1))] for i in range(count)]
    budget = max(2, MAX_DISPLAY_POINTS // len(segments))
    return [segment if len(segment) <= budget else
            [segment[round(i * (len(segment)-1) / (budget-1))] for i in range(budget)]
            for segment in segments]


def trace(samples):
    segments, segment = [], []
    previous = None
    excluded = unknown_accuracy = gaps = accepted = 0
    first = last = None
    for sample in samples:
        point = [sample.latitude, sample.longitude]
        accuracy = sample.accuracy_m
        if (not all(isfinite(v) for v in point) or not -90 <= point[0] <= 90 or not -180 <= point[1] <= 180
                or (accuracy is not None and (not isfinite(accuracy) or not 0 <= accuracy <= MAX_ACCURACY_M))):
            excluded += 1
            if segment:
                segments.append(segment)
                segment = []
            previous = None
            continue
        at = utc(sample.recorded_at)
        if previous:
            elapsed = (at - previous[0]).total_seconds()
            moved = distance(previous[1], point)
            if elapsed == 0 and moved < .01:
                continue
            if elapsed > MAX_GAP_SECONDS or elapsed <= 0 or moved / elapsed > MAX_SPEED_MPS:
                segments.append(segment)
                segment = []
                gaps += 1
        item = {"position": point, "at": stamp(at), "accuracy_m": accuracy, "truck_id": sample.truck_id}
        segment.append(item)
        accepted += 1
        unknown_accuracy += accuracy is None
        first = first or at
        last = at
        previous = (at, point)
    if segment:
        segments.append(segment)
    shown = display_segments(segments)
    return {"segments": shown, "sample_count": accepted, "displayed_sample_count": sum(map(len, shown)),
            "excluded_sample_count": excluded, "unknown_accuracy_count": unknown_accuracy,
            "gap_count": gaps, "simplified": sum(map(len, shown)) < accepted,
            "first_recorded_at": stamp(first), "last_recorded_at": stamp(last)}


def incident_tracks(db, incident):
    dispatches = sorted(incident.dispatches, key=lambda d: (utc(d.dispatch_at) or datetime.min.replace(tzinfo=timezone.utc), d.dispatch_id))
    ids = [d.dispatch_id for d in dispatches]
    grouped = defaultdict(lambda: defaultdict(list))
    unattributed = defaultdict(int)
    names = {}
    if ids:
        samples = db.query(DispatchLocation, Personnel).outerjoin(Personnel, Personnel.per_id == DispatchLocation.per_id).filter(
            DispatchLocation.dispatch_id.in_(ids),
        ).order_by(DispatchLocation.dispatch_id, DispatchLocation.per_id, DispatchLocation.recorded_at, DispatchLocation.sample_id)
        for sample, person in samples.yield_per(1000):
            if sample.per_id is None:
                unattributed[sample.dispatch_id] += 1
                continue
            grouped[sample.dispatch_id][sample.per_id].append(sample)
            if person:
                names[sample.per_id] = {"name": f"{person.per_firstname or ''} {person.per_lastname or ''}".strip(), "rank": person.per_rank}
    events = db.query(IncidentEvent).filter(IncidentEvent.fire_id == incident.fire_id,
        IncidentEvent.event_type.in_(["op_routes", "op_departure"])).order_by(IncidentEvent.event_id).all() if ids else []
    plans = {}
    for event in events:
        metadata = event.event_metadata or {}
        plan = metadata.get("baseline") if event.event_type == "op_departure" else metadata
        if plan:
            plans[event.dispatch_id] = plan
    result = []
    for dispatch in dispatches:
        snapshot = dispatch.context_snapshot or {}
        roster = {}
        for member in snapshot.get("roster", []):
            person_id = member.get("per_id")
            if person_id is not None:
                entry = roster.setdefault(person_id, {**member, "roles": []})
                if member.get("role") and member["role"] not in entry["roles"]:
                    entry["roles"].append(member["role"])
        start = utc(dispatch.dispatch_at)
        ends = [utc(t) for t in (dispatch.cleared_at, dispatch.dispatch_completed_at, incident.operation_completed_at) if t]
        end = min(ends) if ends else datetime.now(timezone.utc)
        members = []
        for person_id in sorted(set(roster) | set(grouped[dispatch.dispatch_id])):
            member = roster.get(person_id, names.get(person_id, {}))
            samples = [s for s in grouped[dispatch.dispatch_id].get(person_id, []) if start and start <= utc(s.recorded_at) <= end]
            members.append({"per_id": person_id, "name": member.get("name") or f"Responder #{person_id}",
                            "rank": member.get("rank"), "roles": member.get("roles", []),
                            "identity_source": "assignment_snapshot" if person_id in roster else "recorded_dispatch_locations",
                            **trace(samples)})
        plan = plans.get(dispatch.dispatch_id)
        generated = next((r for r in plan.get("routes", []) if r.get("route_id") == plan.get("selected_route_id")), None) if plan else None
        if generated is None and dispatch.route_id:
            route = db.query(Route).filter(Route.dispatch_id == dispatch.dispatch_id, Route.route_id == dispatch.route_id).first()
            if route:
                generated = {"route_id": route.route_id, "wkt": route.route_path_geojson}
        result.append({"dispatch_id": dispatch.dispatch_id, "team": snapshot.get("team_name") or (dispatch.team.team_name if dispatch.team else None),
                       "status": dispatch.dispatch_status, "dispatch_at": stamp(start), "ended_at": stamp(min(ends)) if ends else None,
                       "roster_available": "roster" in snapshot, "members": members,
                       "unattributed_sample_count": unattributed[dispatch.dispatch_id],
                       "generated_route": {"wkt": generated.get("wkt"), "route_id": generated.get("route_id")} if generated else None})
    location = [incident.fire_latitude, incident.fire_longitude]
    return {"fire_id": incident.fire_id,
            "location": location if all(v is not None and isfinite(v) for v in location) and -90 <= location[0] <= 90 and -180 <= location[1] <= 180 else None,
            "dispatches": result, "max_gap_seconds": MAX_GAP_SECONDS, "max_accuracy_m": MAX_ACCURACY_M,
            "updated_at": stamp(datetime.now(timezone.utc))}
