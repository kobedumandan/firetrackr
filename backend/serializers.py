"""Row → dict converters shared by the routers and services.

These define the JSON shape the dashboard and mobile app consume, so they live
in one place rather than being duplicated per router.
"""
import json

from config import PUBLIC_BASE_URL
from models import (
    FireIncident, GnnConstraint, IncidentReport, ResponseTeam, Station, Truck,
)


def _constraint_to_dict(c: GnnConstraint) -> dict:
    return {
        "id":              c.constraint_id,
        "constraint_type": c.constraint_type,
        "name":            c.name or "",
        "coordinates":     json.loads(c.coordinates),
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


def _team_dict(t: ResponseTeam) -> dict:
    members = []
    for m in t.members:
        p = m.personnel
        if not p:
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
            "member_status": m.member_status   or "",
            "shift_id":      p.shift_id,
            "shift_name":    p.shift.shift_name if p.shift else "—",
        })
    return {
        "team_id":           t.team_id,
        "team_name":         t.team_name   or "",
        "team_code":         t.team_code   or "",
        "team_status":       t.team_status or "standby",
        "station_id":        t.station_id,
        "station_name":      t.station.station_name      if t.station else "—",
        "station_latitude":  t.station.station_latitude  if t.station else None,
        "station_longitude": t.station.station_longitude if t.station else None,
        "station_status":    (t.station.station_status or "operational") if t.station else None,
        "shift_id":          t.shift_id,
        "shift_name":        t.shift.shift_name if t.shift else "—",
        "truck_id":          t.truck_id,
        "truck_platenum":    t.truck.truck_platenum if t.truck else None,
        "member_count": len(t.members),
        "members":      members,
        "created_at":   t.team_created_at.isoformat() if t.team_created_at else None,
    }


def _incident_dict(r: FireIncident) -> dict:
    return {
        "id":             f"INC-{r.fire_incident_datetime.year}-{r.fire_id:03d}" if r.fire_incident_datetime else f"INC-{r.fire_id:03d}",
        "fire_id":        r.fire_id,
        "loc":            r.fire_location_name  or f"{r.fire_latitude:.4f}, {r.fire_longitude:.4f}",
        "addr":           r.fire_address        or "",
        "sev":            r.fire_severity       or "Minor",
        "status":         r.fire_status         or "pending",
        "alarm":          r.fire_alarm_level    or "1st Alarm",
        "dispatch_type":  r.fire_dispatch_type or "",
        "structure":      r.fire_structure_type or "",
        "casualties":     r.fire_casualties     or "None",
        "units":          r.fire_units_assigned or 0,
        "reporter":       r.fire_reporter_name  or r.fire_reporter_contact or "—",
        "latitude":       r.fire_latitude,
        "longitude":      r.fire_longitude,
        "reported_at":    r.fire_incident_datetime.isoformat() if r.fire_incident_datetime else None,
        "remarks":        r.fire_remarks or "",
    }


def _report_photo_url(file_name: str) -> str:
    """Public URL the mobile app / dashboard can load a stored photo from."""
    return f"{PUBLIC_BASE_URL}/uploads/report_photos/{file_name}"


def _report_dict(r: IncidentReport) -> dict:
    author = r.author
    author_name = (
        f"{author.per_firstname or ''} {author.per_lastname or ''}".strip()
        if author else None
    ) or None
    return {
        "report_id":       r.report_id,
        "fire_id":         r.fire_id,
        "dispatch_id":     r.dispatch_id,
        "author":          author_name,
        "author_rank":     author.per_rank if author else None,
        "cause":           r.report_cause,
        "casualties":      r.report_casualties,
        "damage_estimate": r.report_damage_estimate,
        "narrative":       r.report_narrative,
        "recommendations": r.report_recommendations,
        "submitted_at":    r.report_submitted_at.isoformat() if r.report_submitted_at else None,
        "photos":          [_report_photo_url(p.file_name) for p in r.photos],
    }


def _truck_dict(t: Truck) -> dict:
    return {
        "truck_id":           t.truck_id,
        "truck_platenum":     t.truck_platenum,
        "truck_status":       t.truck_status or "available",
        "truck_latitude":     t.truck_latitude,
        "truck_longitude":    t.truck_longitude,
        "truck_last_updated": t.truck_last_updated.isoformat() if t.truck_last_updated else None,
        "station_id":         t.station_id,
        "station_name":       t.station.station_name if t.station else None,
    }
