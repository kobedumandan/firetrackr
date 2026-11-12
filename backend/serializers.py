"""Row → dict converters shared by the routers and services.

These define the JSON shape the dashboard and mobile app consume, so they live
in one place rather than being duplicated per router.
"""
import json

from services.resource_lifecycle import archive_dict

from services.report_photos import report_photo_urls
from models import (
    FireIncident, GnnConstraint, IncidentReport, ResponseTeam, Station, Truck,
)


def _constraint_to_dict(c: GnnConstraint) -> dict:
    return {
        "id":              c.constraint_id,
        "constraint_type": c.constraint_type,
        "name":            c.name or "",
        "coordinates":     json.loads(c.coordinates),
        "segment_uids":    c.segment_uids,
          "baseline_segment_uid": c.baseline_segment_uid,
        "narrow_severity": c.narrow_severity,
        "traffic_schedule": c.traffic_schedule,
        "highway":         c.highway or "",
        "surface":         c.surface or "",
        "maxspeed":        c.maxspeed or "",
        "is_active":       c.is_active,
        "created_at":      c.created_at.isoformat() if c.created_at else None,
        "updated_at":      c.updated_at.isoformat() if c.updated_at else None,
    }


def _station_dict(r: Station) -> dict:
    cmd = r.commander
    return {
        **archive_dict(r),
        "station_id":          r.station_id,
        "station_name":        r.station_name,
        "station_type":        r.station_type or "main",
        "parent_station_id":   r.parent_station_id,
        "station_address":     r.station_address  or "",
        "station_barangay":    r.station_barangay or "",
        "station_latitude":    r.station_latitude,
        "station_longitude":   r.station_longitude,
        "station_contact":     r.station_contact  or "",
        "station_status":      r.station_status   or "operational",
        "station_commander_id": r.station_commander_id,
        "commander_name":      f"{cmd.per_firstname or ''} {cmd.per_lastname or ''}".strip() if cmd else None,
        "commander_rank":      cmd.per_rank if cmd else None,
        "created_at":          r.created_at.isoformat() if r.created_at else None,
    }


def _manned_truck_dict(dispatch, per_id: int) -> dict | None:
    """Map display metadata from the confirmed manning assignment, never GPS proximity."""
    if not dispatch:
        return None
    unit = next((unit for unit in dispatch.dispatch_trucks
                 if unit.manned_by_per_id == per_id and unit.truck
                 and (dispatch.dispatch_status in ('dispatched', 'en_route', 'on_scene')
                      or (unit.return_driver_per_id == per_id and unit.return_started_at and not unit.returned_at and not unit.ready_at))), None)
    return {'truck_id': unit.truck.truck_id, 'truck_platenum': unit.truck.truck_platenum} if unit else None


def _team_dict(t: ResponseTeam, *, return_locks=None, return_context=None) -> dict:
    if return_context is None:
        from sqlalchemy.orm import object_session
        from services.resource_availability import pending_return_context
        db = object_session(t)
        return_context = pending_return_context(db, team_ids=[t.team_id],
            per_ids=[m.per_id for m in t.members]) if db else {'teams': {}, 'drivers': {}}
    if return_locks is None:
        return_locks = {per_id: row['assignment_reason'] for per_id, row in return_context['drivers'].items()}
    active = any(d.dispatch_status in ('dispatched', 'en_route', 'on_scene') for d in t.dispatches)
    progress = return_context['teams'].get(t.team_id) if not active else None
    members = []
    for m in t.members:
        p = m.personnel
        if not p or p.archived_at:
            continue
        first = p.per_firstname or ""
        last  = p.per_lastname  or ""
        members.append({
            "per_id":        p.per_id,
            "name":          f"{first} {last}".strip() or "—",
            "initials":      ((first[0] if first else "") + (last[0] if last else "")).upper() or "??",
            "rank":          p.per_rank        or "—",
            "designation":   p.per_designation or "—",
            "member_role":   m.member_role     or "",
            "member_status": 'inactive' if p.user and p.user.disabled_at else progress['status'] if progress and (m.member_status or '').lower().replace('_', '') not in ('offduty', 'inactive') else m.member_status or "",
            "shift_id":      p.shift_id,
            "shift_name":    p.shift.shift_name if p.shift else "—",
            "return_assignment_locked": p.per_id in return_locks,
            "return_assignment_reason": return_locks.get(p.per_id, ''),
        })
    return {
        **archive_dict(t),
        "team_id":           t.team_id,
        "team_name":         t.team_name   or "",
        "team_code":         t.team_code   or "",
        "team_status":       progress['status'] if progress else t.team_status or "standby",
        "dispatch_blocker":  progress['blocker'] if progress else '',
        "station_id":        t.station_id,
        "station_name":      t.station.station_name      if t.station else "—",
        "station_latitude":  t.station.station_latitude  if t.station else None,
        "station_longitude": t.station.station_longitude if t.station else None,
        "station_status":    (t.station.station_status or "operational") if t.station else None,
        "shift_id":          t.shift_id,
        "shift_name":        t.shift.shift_name if t.shift else "—",
        "truck_id":          t.truck_id,
        "truck_platenum":    t.truck.truck_platenum if t.truck else None,
        "truck_status":      ('unavailable' if t.truck.archived_at else t.truck.truck_status) if t.truck else None,
        "has_active_dispatch": active,
        "member_count": len(members),
        "members":      members,
        "created_at":   t.team_created_at.isoformat() if t.team_created_at else None,
    }


def _incident_dict(r: FireIncident) -> dict:
    from services.response_workflow import stage, WORKFLOW_VERSION
    from services.incident_scope import effective_response_kind
    from services.historical_incidents import history
    from datetime import timedelta, timezone
    imported = r.fire_location_source == 'bfp_historical_import'
    source = history(r)
    date_only = source.get('occurrence_precision') == 'date_only'
    cancellation = None
    if r.fire_status == 'cancelled':
        from sqlalchemy.orm import object_session
        from models import IncidentEvent
        from services.incident_events import event_dict
        db = object_session(r)
        event = (
            db.query(IncidentEvent)
            .filter_by(fire_id=r.fire_id, event_type='status', event_to='cancelled')
            .order_by(IncidentEvent.event_id.desc()).first()
        ) if db else None
        cancellation = event_dict(event) if event else None
    occurred = r.fire_incident_datetime
    reported_at = occurred.isoformat() if occurred else None
    if occurred and date_only:
        reported_at = occurred.astimezone(timezone(timedelta(hours=8))).date().isoformat()
    return {
        **archive_dict(r),
        "id":             f"INC-{r.fire_incident_datetime.year}-{r.fire_id:03d}" if r.fire_incident_datetime else f"INC-{r.fire_id:03d}",
        "fire_id":        r.fire_id,
        "loc":            r.fire_location_name  or f"{r.fire_latitude:.4f}, {r.fire_longitude:.4f}",
        "addr":           r.fire_address        or "",
        "sev":            r.fire_severity or ("Not recorded" if r.fire_location_source == "bfp_historical_import" else "Minor"),
        "status":         r.fire_status         or "pending",
        "cancellation":   cancellation,
        "lifecycle_stage": stage(r),
        "workflow_version": WORKFLOW_VERSION,
        "operation_completed_at": r.operation_completed_at.isoformat() if r.operation_completed_at else None,
        "effective_response_kind": effective_response_kind(r),
        "alarm":          "Not applicable" if r.fire_dispatch_type and r.fire_dispatch_type != "Firefighting Operations" else r.fire_alarm_level or ("Not recorded" if imported else "1st Alarm"),
        "dispatch_type":  r.fire_dispatch_type or "",
        "response_kind":  r.response_kind,
        "structure":      "Not applicable" if r.fire_dispatch_type and r.fire_dispatch_type != "Firefighting Operations" else r.fire_structure_type or "",
        "casualties":     r.fire_casualties     or ("Not recorded" if imported else "Unconfirmed"),
        "casualties_reviewed_at": r.casualties_reviewed_at.isoformat() if r.casualties_reviewed_at else None,
        "units":          r.fire_units_assigned if imported else r.fire_units_assigned or 0,
        "reporter":       r.fire_reporter_name  or r.fire_reporter_contact or "—",
        "reporter_name":  r.fire_reporter_name or "",
        "reporter_contact": r.fire_reporter_contact or "",
        "latitude":       r.fire_latitude,
        "longitude":      r.fire_longitude,
        "reported_at":    reported_at,
        "occurrence_precision": source.get('occurrence_precision'),
        "source_record_id": source.get('record_id'),
        "alarm_basis": source.get('alarm_basis'),
        "data_source": "BFP Panabo station historical record" if imported else None,
        "remarks":        r.fire_remarks or "",
        "record_kind":    r.record_kind or "unknown",
        "report_received_at": r.report_received_at.isoformat() if r.report_received_at else None,
    }


def _report_photo_url(file_name: str) -> str:
    """A local URL or temporary private-storage URL, after report authorization."""
    return report_photo_urls([file_name])[0]


def _report_dict(r: IncidentReport) -> dict:
    photo_urls = report_photo_urls([p.file_name for p in r.photos])
    author = r.author
    author_name = (
        f"{author.per_firstname or ''} {author.per_lastname or ''}".strip()
        if author else None
    ) or None
    if not author and r.admin_author:
        from services.incident_events import actor_name
        author_name = actor_name(r.admin_author)
    saved_author = r.author_snapshot
    if saved_author is not None:
        author_name = saved_author.get('name')
    return {
        "report_id":       r.report_id,
        "report_kind":     r.report_kind,
        "revision":        r.revision,
        "reviewed_at":     r.reviewed_at.isoformat() if r.reviewed_at else None,
        "reviewed_by_user_id": r.reviewed_by_user_id,
        "fire_id":         r.fire_id,
        "dispatch_id":     r.dispatch_id,
        "author":          author_name,
        "author_rank":     saved_author.get('rank') if saved_author is not None else (author.per_rank if author else ("Administrator" if r.author_user_id else None)),
        "author_role":     saved_author.get('role') if saved_author is not None else ("personnel" if author else ("admin" if r.author_user_id else None)),
        "author_user_id":  r.author_user_id,
        "cause":           r.report_cause,
        "casualties":      r.report_casualties,
        "damage_estimate": r.report_damage_estimate,
        "narrative":       r.report_narrative,
        "recommendations": r.report_recommendations,
        "submitted_at":    r.report_submitted_at.isoformat() if r.report_submitted_at else None,
        "photos":          photo_urls,
        "photo_attachments": [
            {"photo_id": photo.photo_id, "file_name": photo.file_name,
             "original_name": photo.original_name, "url": url}
            for photo, url in zip(r.photos, photo_urls)
        ],
    }


def _truck_dict(t: Truck) -> dict:
    pending_return = next((unit for unit in t.dispatch_trucks if unit.return_started_at and not unit.ready_at), None)
    return_details = None
    if pending_return:
        from services.response_workflow import return_payload
        return_details = return_payload(pending_return)
        return_details.pop('driver_per_id', None)
        dispatch = pending_return.dispatch_record
        return_details['team'] = (dispatch.context_snapshot or {}).get('team_name') or (dispatch.team.team_name if dispatch.team else 'Team')
    return {
        **archive_dict(t),
        "truck_id":           t.truck_id,
        "truck_platenum":     t.truck_platenum,
        "truck_status":       t.truck_status or "available",
        "truck_latitude":     t.truck_latitude,
        "truck_longitude":    t.truck_longitude,
        "truck_last_updated": t.truck_last_updated.isoformat() if t.truck_last_updated else None,
        'readiness_note': t.readiness_note,
        'readiness_confirmed_at': t.readiness_confirmed_at.isoformat() if t.readiness_confirmed_at else None,
        'not_ready_reason': pending_return.not_ready_reason if pending_return else None,
        'pending_return': return_details,
        "station_id":         t.station_id,
        "station_name":       t.station.station_name if t.station else None,
    }
