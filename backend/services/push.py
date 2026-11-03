"""Dispatch alerts to responders' phones: Expo push first, SMS as a fallback.

The mobile app only learns about a dispatch by polling and over the WebSocket,
and both stop when the phone sleeps. A push is what wakes it. Members who have
never registered a phone (or have push switched off in the app) get a PhilSMS
text instead, so nobody on the team is left relying on the app being open.

Sending runs as a fire-and-forget task after the dispatch has been committed:
a slow or failing push/SMS provider must never delay or fail the dispatch.
"""
import asyncio
import logging

import httpx
from sqlalchemy.orm import Session

from config import (
    DISPATCH_SMS_FALLBACK, EXPO_ACCESS_TOKEN, EXPO_PUSH_URL, SEND_SMS,
)
from database import SessionLocal
from models import PushToken
from services.sms import _normalize_ph_number, _send_philsms


logger = logging.getLogger(__name__)

# Expo accepts at most 100 messages per request.
_EXPO_BATCH = 100
# A dispatch alert that arrives 10 minutes late is worse than none: by then the
# dispatcher has already chased the crew by radio.
_DISPATCH_TTL_S = 600

# Strong references to in-flight sends; asyncio only keeps weak ones, so an
# un-referenced task can be garbage-collected mid-send.
_pending: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def send_expo_push(messages: list[dict]) -> tuple[int, list[str]]:
    """POST messages to Expo. Returns (accepted, dead): how many Expo accepted,
    and the tokens it reports as no longer registered (app uninstalled / token
    rotated) so the caller can prune them."""
    if not messages:
        return 0, []
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {EXPO_ACCESS_TOKEN}"

    accepted, dead = 0, []
    async with httpx.AsyncClient(timeout=15) as client:
        for i in range(0, len(messages), _EXPO_BATCH):
            batch = messages[i:i + _EXPO_BATCH]
            try:
                resp = await client.post(EXPO_PUSH_URL, headers=headers, json=batch)
                tickets = resp.json().get("data") or []
            except Exception as exc:
                logger.warning("Expo push request failed: %s", exc)
                continue
            # Tickets come back in the same order as the messages.
            for msg, ticket in zip(batch, tickets):
                if ticket.get("status") == "ok":
                    accepted += 1
                    continue
                err = (ticket.get("details") or {}).get("error")
                if err == "DeviceNotRegistered":
                    dead.append(msg["to"])
                else:
                    logger.warning("Expo push to %s failed: %s", msg["to"], ticket.get("message"))
    return accepted, dead


def _prune_tokens(tokens: list[str]) -> None:
    if not tokens:
        return
    db = SessionLocal()
    try:
        db.query(PushToken).filter(PushToken.token.in_(tokens)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def push_message(token: str, sound: bool, title: str, body: str, data: dict) -> dict:
    return {
        "to":        token,
        "title":     title,
        "body":      body,
        "data":      data,
        "priority":  "high",
        "ttl":       _DISPATCH_TTL_S,
        # Channels are created by the app (see bfp_capstone_mobile/utils/notifications.js).
        # On Android 8+ the channel, not this payload, decides sound and importance.
        "channelId": "dispatch" if sound else "dispatch-silent",
        "sound":     "default" if sound else None,
    }


def collect_team_recipients(db: Session, team) -> list[dict]:
    """Snapshot everything the send needs while the session is still open;
    the background task must not touch ORM objects from a closed session."""
    out = []
    for m in team.members or []:
        p = m.personnel
        if not p:
            continue
        out.append({
            "per_id":  p.per_id,
            "contact": p.per_contact,
            "tokens":  [(t.token, bool(t.sound_enabled)) for t in p.push_tokens],
        })
    return out


async def _deliver(recipients: list[dict], title: str, body: str, sms: str, data: dict) -> None:
    messages, sms_to = [], []
    for r in recipients:
        if r["tokens"]:
            messages.extend(push_message(tok, snd, title, body, data) for tok, snd in r["tokens"])
        elif r["contact"]:
            sms_to.append(r["contact"])

    accepted, dead = await send_expo_push(messages)
    _prune_tokens(dead)

    if sms_to and DISPATCH_SMS_FALLBACK and SEND_SMS:
        for raw in sms_to:
            try:
                await _send_philsms(_normalize_ph_number(raw), sms)
            except Exception as exc:  # bad number or provider error: log, keep going
                logger.warning("Dispatch SMS to %s failed: %s", raw, exc)

    logger.info(
        "Dispatch alert %s: %d/%d push accepted, %d sms%s",
        data.get("dispatch_id"), accepted, len(messages), len(sms_to),
        "" if (DISPATCH_SMS_FALLBACK and SEND_SMS) else " (sms disabled)",
    )


def notify_dispatch_assigned(db: Session, dispatch, incident, team) -> None:
    """Queue the "you've been dispatched" alert to every member of `team`."""
    where = incident.fire_location_name or incident.fire_address or "the incident"
    detail = " · ".join(x for x in (incident.fire_alarm_level, incident.fire_severity) if x)
    title = f"DISPATCH · {detail}" if detail else "DISPATCH"
    body = f"{team.team_name or 'Your team'} to {where}. Open FireTrackr for your route."
    sms = (
        f"BFP DISPATCH: {team.team_name or 'Your team'} to {where}"
        f"{f' ({detail})' if detail else ''}. Open the FireTrackr app for your route."
    )
    data = {
        "type":        "dispatch_assigned",
        "dispatch_id": dispatch.dispatch_id,
        "fire_id":     incident.fire_id,
    }
    _spawn(_deliver(collect_team_recipients(db, team), title, body, sms, data))
