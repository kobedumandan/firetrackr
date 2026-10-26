"""Endpoints the responder mobile app calls: session context and the
GPS stream that drives deviation detection."""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from config import _REROUTE_INLINE
from database import get_db
from models import (
    CurrentLocation, DispatchRecord, FireIncident, LocationLog, Personnel, PushToken, ResponseTeamMember,
    Route, Users,
)
from schemas import LocationUpdateBody, PushTokenBody, PushTokenRef
from security import _home_station, get_current_user
from serializers import _manned_truck_dict
from services.dispatch import (
    _is_driver, _is_manning_truck, _normalize_role, _race_condition_winner,
    _sync_truck,
)
from services.push import push_message, send_expo_push
from services.routing import _check_deviation, _recompute_deviation_routing_bg
from services.tracking_policy import policy as tracking_policy
from services.personnel_navigation import navigation_for, save_navigation
from services.personnel_arrival import arrival_for, personnel_status
from services.report_timing import timeline as report_timeline
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
                    "arrived_at":       dt.arrived_at.isoformat() if dt.arrived_at else None,
                    "truck_status":     dt.truck.truck_status,
                }
            own_arrival = arrival_for(db, active_dispatch, p.per_id)
            dispatch_data = {
                "dispatch_id":     active_dispatch.dispatch_id,
                "dispatch_status": active_dispatch.dispatch_status,
                "personnel_status": personnel_status(active_dispatch, own_arrival),
                "personnel_arrived_at": own_arrival.isoformat() if own_arrival else None,
                "dispatch_at":     active_dispatch.dispatch_at.isoformat() if active_dispatch.dispatch_at else None,
                "acknowledged_at": active_dispatch.acknowledged_at.isoformat() if active_dispatch.acknowledged_at else None,
                "departed_at": active_dispatch.departed_at.isoformat() if active_dispatch.departed_at else None,
                'cleared_at': active_dispatch.cleared_at.isoformat() if active_dispatch.cleared_at else None,
                "arrived_at": active_dispatch.dispatch_arrived_at.isoformat() if active_dispatch.dispatch_arrived_at else None,
                "milestone_timestamp_basis": "server_received_action",
                "route_wkt":       selected_route.route_path_geojson if selected_route else None,
                "personnel_route_wkt": navigation_for(active_dispatch, p.per_id).get('route_wkt'),
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
                    "operational_timing": report_timeline(db, inc),
                    "fire_incident_datetime": inc.fire_incident_datetime.isoformat() if inc.fire_incident_datetime else None,
                } if inc else None,
            }
            break  # found team with active dispatch — stop here

        # No active dispatch on this team; keep looking but save first team found
        # Continue through every membership: a later team may own the response.

    location = db.get(CurrentLocation, p.per_id)
    return {
        "per_id":     p.per_id,
        "location": {'latitude': float(location.latitude), 'longitude': float(location.longitude),
                     'recorded_at': location.recorded_at.isoformat()} if location else None,
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
        "tracking": tracking_policy(db, p),
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

    # Serialize fixes for a person, including their first current-location insert.
    person = db.query(Personnel).filter_by(per_id=per_id).populate_existing().with_for_update().one()

    now = datetime.now(timezone.utc)
    tracking = tracking_policy(db, person, now)
    if tracking['mode'] == 'off':
        return {'status': 'tracking_stopped', 'tracking': tracking}

    dispatch = db.get(DispatchRecord, body.dispatch_id) if body.dispatch_id is not None else None
    if body.dispatch_id is not None and (dispatch is None or dispatch.dispatch_status not in ("dispatched", "en_route", "on_scene")):
        return {"status": "dispatch_ended", 'tracking': tracking}

    membership = (
        db.query(ResponseTeamMember)
        .filter(
            ResponseTeamMember.team_id == dispatch.team_id,
            ResponseTeamMember.per_id  == per_id,
        )
        .first()
    ) if dispatch else None
    if dispatch and not membership:
        raise HTTPException(403, 'Not assigned to this dispatch.')
    if tracking['dispatch_id'] != body.dispatch_id:
        return {'status': 'tracking_changed', 'tracking': tracking}

    now = datetime.now(timezone.utc)
    try:
        recorded_at = datetime.fromisoformat(body.recorded_at)
        if recorded_at.tzinfo is None:
            raise ValueError('Timezone required')
    except ValueError:
        raise HTTPException(status_code=422, detail="recorded_at must be an ISO 8601 timestamp.")
    if (recorded_at > now + timedelta(seconds=30) or recorded_at < now-timedelta(minutes=2)
            or recorded_at < datetime.fromisoformat(tracking['duty_starts_at'])):
        raise HTTPException(422, 'Sample must be a recent fix from the current duty period (at most two minutes old), and cannot be in the future.')
    if dispatch and (not dispatch.dispatch_at or recorded_at < dispatch.dispatch_at):
        raise HTTPException(422, 'Sample cannot precede this dispatch.')

    if dispatch:
        # Match milestone actions: lock the incident before inserting evidence
        # that takes foreign-key locks on the dispatch/truck. Otherwise concurrent
        # GPS and arrival can deadlock while telemetry upgrades the incident lock.
        db.query(FireIncident).filter_by(fire_id=dispatch.fire_id).with_for_update().one()
        db.refresh(dispatch)
        if dispatch.dispatch_status not in ('dispatched', 'en_route', 'on_scene'):
            return {'status': 'dispatch_ended', 'tracking': tracking_policy(db, person, datetime.now(timezone.utc))}

    # Atomically deduplicate attributed phone history before any vehicle effects.
    from sqlalchemy.dialects.postgresql import insert
    sample_key = f"mobile:{per_id}:{body.sample_id or recorded_at.astimezone(timezone.utc).isoformat()}"
    saved = db.execute(insert(LocationLog).values(
        per_id=per_id, device_id=None, log_latitude=body.latitude, log_longitude=body.longitude,
        log_receive_at=now, recorded_at=recorded_at, accuracy_m=body.accuracy_m,
        collection_mode=tracking['mode'], sample_key=sample_key,
    ).on_conflict_do_nothing(index_elements=['sample_key']).returning(LocationLog.log_id)).scalar()
    if saved is None:
        db.commit()
        return {'status': 'duplicate', 'tracking': tracking}

    # Always preserve history
    from services.dispatch_locations import collect
    if dispatch:
        collect(db, dispatch, per_id, body.latitude, body.longitude, recorded_at, body.accuracy_m, body.sample_id)
    from services.operational_times import collect_telemetry
    milestone_changed = dispatch and collect_telemetry(db, dispatch, current_user, body.latitude, body.longitude,
                                         recorded_at, body.accuracy_m, body.sample_id)
    if milestone_changed:
        background_tasks.add_task(manager.broadcast, {"type": "operational_times_updated", "data": {"fire_id": dispatch.fire_id}})

    existing = db.get(CurrentLocation, per_id)
    refresh_driver_plan = False
    expected_route_id = dispatch.route_id if dispatch else None
    if dispatch and _is_manning_truck(dispatch, per_id):
        selected_route = db.get(Route, dispatch.route_id) if dispatch.route_id else None
        previous_at = existing.recorded_at if existing else None
        if previous_at is not None and previous_at.tzinfo is None:
            previous_at = previous_at.replace(tzinfo=timezone.utc)
        driver_resumed = previous_at is None or previous_at < now-timedelta(minutes=2) or (
            dispatch.dispatch_at is not None and previous_at < dispatch.dispatch_at)
        refresh_driver_plan = bool(selected_route and (
            selected_route.route_origin_source != 'driver_location' or driver_resumed))
    position_changed = False
    routing_tasks = []
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

        if dispatch:
            _sync_truck(db, dispatch, per_id, body.latitude, body.longitude, now)
        if refresh_driver_plan:
            from services.dispatch_routing import refresh_returning_driver
            routing_tasks.append((refresh_returning_driver, (dispatch.dispatch_id, per_id, expected_route_id)))

        # Cheap deviation DETECTION (PostGIS distance) stays inline; the
        # EXPENSIVE routing a deviation triggers — a connector to the fire, or
        # a full route rebuild if this person mans the truck — is deferred to a
        # background task so the GNN/graph compute never blocks this request
        # thread. The rebuilt route / connector reaches dashboards over WS and
        # is reflected on the mobile side at the next status poll.
        previous_navigation = navigation_for(dispatch, per_id)
        was_deviated = previous_navigation.get('is_deviated', False)
        is_deviated, _ = _check_deviation(
            db, dispatch, body.latitude, body.longitude, compute_connector=False, was_deviated=was_deviated
        ) if dispatch else (False, None)
        manning = is_deviated and _is_manning_truck(dispatch, per_id)

        schedule_routing = False
        if is_deviated and not was_deviated:
            save_navigation(db, dispatch, per_id, expected_route_id=expected_route_id,
                            is_deviated=True, detected_at=now.isoformat())
            schedule_routing = True
        elif is_deviated and was_deviated:
            schedule_routing = True   # refresh connector / rebuild from new position
        elif dispatch and not is_deviated and was_deviated:
            save_navigation(db, dispatch, per_id, expected_route_id=expected_route_id, is_deviated=False)

        if schedule_routing and not refresh_driver_plan:
            if _REROUTE_INLINE:
                _recompute_deviation_routing_bg(
                    dispatch.dispatch_id, per_id, body.latitude, body.longitude, manning
                )
                db.refresh(dispatch)
            else:
                routing_tasks.append((_recompute_deviation_routing_bg,
                    (dispatch.dispatch_id, per_id, body.latitude, body.longitude, manning)))
    else:
        db.commit()  # location_log only

    if position_changed:
        per = current_user.personnel
        own_navigation = navigation_for(dispatch, per_id)
        own_arrival = arrival_for(db, dispatch, per_id)
        payload = {
            "type": "personnel_location",
            "data": {
                "per_id":      per_id,
                "name":        f"{per.per_firstname or ''} {per.per_lastname or ''}".strip(),
                "latitude":    body.latitude,
                "longitude":   body.longitude,
                "source":      "mobile_app",
                "recorded_at": recorded_at.isoformat(),
                "age_minutes": round(max(0, (now-recorded_at).total_seconds()) / 60, 1),
                "is_stale":    False,
                "is_deviated": bool(own_navigation.get('is_deviated')),
                "personnel_status": personnel_status(dispatch, own_arrival),
                "personnel_arrived_at": own_arrival.isoformat() if own_arrival else None,
                "dispatch_id": dispatch.dispatch_id if dispatch else None,
                "manned_truck": _manned_truck_dict(dispatch, per_id),
                "tracking": tracking,
                "connector_geojson":     own_navigation.get('connector_geojson'),
                "deviation_detected_at": own_navigation.get('deviation_detected_at'),
            },
        }
        background_tasks.add_task(manager.broadcast, payload)

    # Publish the fix before its routing result. Reversing these broadcasts lets
    # an older GPS payload erase the newly calculated branch in the dashboard.
    for task, args in routing_tasks:
        background_tasks.add_task(task, *args)

    # TODO: replace polling with WebSocket push when scaling requires it
    own_navigation = navigation_for(dispatch, per_id)
    if own_navigation.get('is_deviated'):
        return {
            "status": "ok",
            "deviation": True,
            "connector_geojson": own_navigation.get('connector_geojson'),
            "tracking": tracking,
        }
    return {"status": "ok", "tracking": tracking}
