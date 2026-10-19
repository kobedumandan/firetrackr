"""Endpoints the responder mobile app calls: session context and the
GPS stream that drives deviation detection."""
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from config import _REROUTE_INLINE
from database import get_db
from models import (
    CurrentLocation, DispatchRecord, LocationLog, PushToken, ResponseTeamMember,
    Route, Users,
)
from schemas import LocationUpdateBody, PushTokenBody, PushTokenRef
from security import _home_station, get_current_user
from services.dispatch import (
    _is_driver, _is_manning_truck, _normalize_role, _race_condition_winner,
    _sync_truck,
)
from services.push import push_message, send_expo_push
from services.routing import _check_deviation, _recompute_deviation_routing_bg
from state import manager


router = APIRouter(tags=["mobile"])


@router.get("/api/mobile/me/station")
def mobile_me_station(current_user: Users = Depends(get_current_user)):
    """Re-read the cached home station (e.g. on app foreground) so a long-lived
    session picks up a corrected coordinate without forcing a re-login."""
    if current_user.user_role != "personnel" or not current_user.personnel:
        raise HTTPException(status_code=403, detail="Only personnel accounts can use this endpoint.")
    return {"station": _home_station(current_user)}


def _require_personnel(user: Users):
    if user.user_role != "personnel" or not user.personnel:
        raise HTTPException(status_code=403, detail="Only personnel accounts can use this endpoint.")
    return user.personnel


def _valid_expo_token(token: str) -> bool:
    return token.startswith(("ExponentPushToken[", "ExpoPushToken[")) and token.endswith("]")


@router.put("/api/mobile/push-token")
def register_push_token(
    body: PushTokenBody,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    """Register (or refresh) this phone's Expo push token for dispatch alerts.
    Called on every login/app start, so it doubles as a heartbeat."""
    p = _require_personnel(current_user)
    if not _valid_expo_token(body.token):
        raise HTTPException(status_code=422, detail="Not an Expo push token.")
    row = db.get(PushToken, body.token)
    if row is None:
        row = PushToken(token=body.token)
        db.add(row)
    # Reassign on a shared phone: the token follows whoever signed in last.
    row.per_id        = p.per_id
    row.platform      = body.platform
    row.sound_enabled = body.sound_enabled
    row.last_seen_at  = datetime.now(timezone.utc)
    db.commit()
    return {"status": "registered"}


@router.post("/api/mobile/push-token/unregister")
def unregister_push_token(
    body: PushTokenRef,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    """Stop alerts to this phone (push switched off, or signing out)."""
    p = _require_personnel(current_user)
    db.query(PushToken).filter(
        PushToken.token == body.token, PushToken.per_id == p.per_id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"status": "unregistered"}


@router.post("/api/mobile/push-token/test")
async def test_push(
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    """Send a test alert to the caller's own phones, so a responder can confirm
    the whole chain (Expo, FCM, channel, permission) before a real dispatch."""
    p = _require_personnel(current_user)
    tokens = [(t.token, bool(t.sound_enabled)) for t in p.push_tokens]
    if not tokens:
        raise HTTPException(status_code=409, detail="No phone is registered for alerts.")
    messages = [
        push_message(tok, snd, "Test alert",
                     "Dispatch alerts are working on this phone.", {"type": "test"})
        for tok, snd in tokens
    ]
    accepted, dead = await send_expo_push(messages)
    if dead:
        db.query(PushToken).filter(PushToken.token.in_(dead)).delete(synchronize_session=False)
        db.commit()
    if not accepted:
        raise HTTPException(
            status_code=502,
            detail="The push service did not accept the alert. Check the backend log.",
        )
    return {"sent": accepted, "unregistered": len(dead)}


@router.get("/api/mobile/me/status")
def mobile_me_status(
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    """Single endpoint for the mobile app to get the authenticated personnel's
    team, active dispatch, and assigned incident in one call."""
    if current_user.user_role != "personnel" or not current_user.personnel:
        raise HTTPException(status_code=403, detail="Only personnel accounts can use this endpoint.")

    p = current_user.personnel

    # Resolve team membership (a personnel can be in multiple teams; pick the first active one)
    team_data = None
    dispatch_data = None

    for membership in p.team_memberships:
        team = membership.team
        if not team:
            continue

        # Look for an active dispatch for this team (anything not completed/cancelled)
        active_dispatch = (
            db.query(DispatchRecord)
            .filter(
                DispatchRecord.team_id == team.team_id,
                DispatchRecord.dispatch_status.in_(["dispatched", "en_route", "on_scene"]),
            )
            .order_by(DispatchRecord.dispatch_at.desc())
            .first()
        )

        team_data = {
            "team_id":   team.team_id,
            "team_name": team.team_name,
            "team_code": team.team_code,
            "member_role": membership.member_role,
        }

        if active_dispatch:
            inc = active_dispatch.fire_incident
            # Include the selected route WKT so the mobile app can render it
            selected_route = None
            if active_dispatch.route_id:
                selected_route = db.get(Route, active_dispatch.route_id)
            dt = active_dispatch.dispatch_trucks[0] if active_dispatch.dispatch_trucks else None
            truck_data = None
            if dt and dt.truck:
                truck_data = {
                    "truck_id":         dt.truck.truck_id,
                    "truck_platenum":   dt.truck.truck_platenum,
                    "manned_by_per_id": dt.manned_by_per_id,
                    "is_manning":       dt.manned_by_per_id == p.per_id,
                }
            dispatch_data = {
                "dispatch_id":     active_dispatch.dispatch_id,
                "dispatch_status": active_dispatch.dispatch_status,
                "dispatch_at":     active_dispatch.dispatch_at.isoformat() if active_dispatch.dispatch_at else None,
                "route_wkt":       selected_route.route_path_geojson if selected_route else None,
                "is_driver":       _is_driver(db, active_dispatch, p.per_id),
                "is_team_leader":  _normalize_role(membership.member_role) == "team leader",
                "truck":           truck_data,
                "incident": {
                    "fire_id":            inc.fire_id,
                    "fire_address":       inc.fire_address,
                    "fire_location_name": inc.fire_location_name,
                    "fire_latitude":      inc.fire_latitude,
                    "fire_longitude":     inc.fire_longitude,
                    "fire_level":         inc.fire_alarm_level,
                    "fire_severity":      inc.fire_severity,
                    "fire_structure_type": inc.fire_structure_type,
                    "fire_status":        inc.fire_status,
                    "fire_incident_datetime": inc.fire_incident_datetime.isoformat() if inc.fire_incident_datetime else None,
                } if inc else None,
            }
            break  # found team with active dispatch — stop here

        # No active dispatch on this team; keep looking but save first team found
        if team_data and dispatch_data is None:
            break

    return {
        "per_id":     p.per_id,
        "first_name": p.per_firstname,
        "last_name":  p.per_lastname,
        "rank":       p.per_rank,
        "designation": p.per_designation,
        "station": {
            "station_id":        p.station.station_id,
            "station_name":      p.station.station_name,
            "station_latitude":  p.station.station_latitude,
            "station_longitude": p.station.station_longitude,
        } if p.station else None,
        "shift": {
            "shift_id":   p.shift.shift_id,
            "shift_name": p.shift.shift_name,
        } if p.shift else None,
        "team":     team_data,
        "dispatch": dispatch_data,
    }


@router.post("/api/location/update")
def location_update(
    body: LocationUpdateBody,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    if current_user.user_role != "personnel" or not current_user.personnel:
        raise HTTPException(status_code=403, detail="Only personnel accounts can update location.")

    per_id = current_user.personnel.per_id

    dispatch = db.get(DispatchRecord, body.dispatch_id)
    if dispatch is None or dispatch.dispatch_status not in ("dispatched", "en_route", "on_scene"):
        return {"status": "dispatch_ended"}

    membership = (
        db.query(ResponseTeamMember)
        .filter(
            ResponseTeamMember.team_id == dispatch.team_id,
            ResponseTeamMember.per_id  == per_id,
        )
        .first()
    )
    if not membership:
        return {"status": "dispatch_ended"}

    now = datetime.now(timezone.utc)
    try:
        recorded_at = datetime.fromisoformat(body.recorded_at)
        if recorded_at.tzinfo is None:
            recorded_at = recorded_at.replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=422, detail="recorded_at must be an ISO 8601 timestamp.")

    # Always preserve history
    from services.operational_times import collect_telemetry
    milestone_changed = collect_telemetry(db, dispatch, current_user, body.latitude, body.longitude,
                                         recorded_at, body.accuracy_m, body.sample_id)
    if milestone_changed:
        background_tasks.add_task(manager.broadcast, {"type": "operational_times_updated", "data": {"fire_id": dispatch.fire_id}})

    db.add(LocationLog(
        device_id=None,
        log_latitude=body.latitude,
        log_longitude=body.longitude,
        log_receive_at=now,
    ))

    existing = db.get(CurrentLocation, per_id)
    position_changed = False
    if _race_condition_winner(existing, "mobile_app", recorded_at, now):
        if existing:
            existing.latitude    = body.latitude
            existing.longitude   = body.longitude
            existing.source      = "mobile_app"
            existing.recorded_at = recorded_at
            existing.received_at = now
            existing.battery     = body.battery
        else:
            db.add(CurrentLocation(
                per_id=per_id,
                latitude=body.latitude,
                longitude=body.longitude,
                source="mobile_app",
                recorded_at=recorded_at,
                received_at=now,
                battery=body.battery,
            ))
        db.commit()
        position_changed = True

        _sync_truck(db, dispatch, per_id, body.latitude, body.longitude, now)

        # Cheap deviation DETECTION (PostGIS distance) stays inline; the
        # EXPENSIVE routing a deviation triggers — a connector to the fire, or
        # a full route rebuild if this person mans the truck — is deferred to a
        # background task so the GNN/graph compute never blocks this request
        # thread. The rebuilt route / connector reaches dashboards over WS and
        # is reflected on the mobile side at the next status poll.
        is_deviated, _ = _check_deviation(
            db, dispatch, body.latitude, body.longitude, compute_connector=False
        )
        manning = is_deviated and _is_manning_truck(dispatch, per_id)

        schedule_routing = False
        if is_deviated and not dispatch.is_deviated:
            dispatch.is_deviated           = True
            dispatch.deviation_detected_at = now
            db.commit()
            schedule_routing = True
        elif is_deviated and dispatch.is_deviated:
            schedule_routing = True   # refresh connector / rebuild from new position
        elif not is_deviated and dispatch.is_deviated:
            dispatch.is_deviated                 = False
            dispatch.deviation_connector_geojson = None
            dispatch.deviation_detected_at       = None
            db.commit()

        if schedule_routing:
            if _REROUTE_INLINE:
                _recompute_deviation_routing_bg(
                    dispatch.dispatch_id, per_id, body.latitude, body.longitude, manning
                )
            else:
                background_tasks.add_task(
                    _recompute_deviation_routing_bg,
                    dispatch.dispatch_id, per_id, body.latitude, body.longitude, manning,
                )
    else:
        db.commit()  # location_log only

    if position_changed:
        per = current_user.personnel
        payload = {
            "type": "personnel_location",
            "data": {
                "per_id":      per_id,
                "name":        f"{per.per_firstname or ''} {per.per_lastname or ''}".strip(),
                "latitude":    body.latitude,
                "longitude":   body.longitude,
                "source":      "mobile_app",
                "recorded_at": recorded_at.isoformat(),
                "age_minutes": 0.0,
                "is_stale":    False,
                "is_deviated": dispatch.is_deviated,
                "dispatch_id": dispatch.dispatch_id,
                "connector_geojson":     dispatch.deviation_connector_geojson if dispatch.is_deviated else None,
                "deviation_detected_at": dispatch.deviation_detected_at.isoformat() if dispatch.deviation_detected_at else None,
            },
        }
        background_tasks.add_task(manager.broadcast, payload)

    # TODO: replace polling with WebSocket push when scaling requires it
    if dispatch.is_deviated:
        return {
            "status": "ok",
            "deviation": True,
            "connector_geojson": dispatch.deviation_connector_geojson,
        }
    return {"status": "ok"}
