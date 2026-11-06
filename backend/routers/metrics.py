"""Aggregates behind the Metrics dashboard."""
from datetime import datetime, timedelta, timezone
from collections import Counter
import re
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session

from database import get_db
from models import DispatchRecord, FireIncident, IncidentReport, Users
from security import require_admin
from services.reporting_periods import custom_reporting_window, reporting_window
from services.historical_incidents import attach_history, history
from services.response_performance import overall
from routers.response_performance import router as performance_router
from services.incident_scope import FIRE_OPERATION, fire_incident_filter


router = APIRouter(tags=["metrics"])
router.include_router(performance_router)


# ── Metrics summary (real aggregates for the Metrics dashboard) ───────────────
_MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_METRICS_PERIOD_DAYS = {"1d": 1, "1w": 7, "1m": 30, "6m": 182, "1y": 365}


def _pct_delta(cur: int, prev: int) -> float | None:
    """Percent change vs the previous window; None when there's no baseline."""
    if not prev:
        return None
    return round((cur - prev) / prev * 100, 1)


def _incident_causes(db, incidents):
    """One latest nonempty report cause per incident; workbook cause wins."""
    report_causes = {}
    if incidents:
        for fire_id, cause in db.query(IncidentReport.fire_id, IncidentReport.report_cause).filter(
            IncidentReport.fire_id.in_([i.fire_id for i in incidents]),
            IncidentReport.report_cause.isnot(None),
        ).order_by(IncidentReport.report_submitted_at, IncidentReport.report_id):
            if cause.strip():
                report_causes[fire_id] = cause.strip()
    return {i.fire_id: history(i).get("cause_clean") or report_causes.get(i.fire_id) or "Not recorded"
            for i in incidents}


def _top_causes(counts, limit):
    return [{"cause": cause, "count": count}
            for cause, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]]


@router.get("/api/metrics/summary")
def metrics_summary(
    period: str = "1m",
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
    month: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    """One count per incident, source causes and explicitly labeled demo alarms.

    Both response metrics require an actual report receipt. The separate
    recorded metric also accepts per-unit arrivals.
    Synthesized historical metadata never supplies measured response timestamps.
    Optional month selects the alarm/cause/barangay breakdowns independently
    of the reporting-period KPIs. Custom calendar ranges also limit chart history
    and intersect any selected month.
    """
    now = datetime.now(timezone.utc)
    if period == "custom" or date_from is not None or date_to is not None:
        try:
            start, now = custom_reporting_window(date_from, date_to, now)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from None
        period = "custom"
    else:
        earliest = db.query(func.min(FireIncident.fire_incident_datetime)).filter(fire_incident_filter()).scalar() if period == "all" else None
        start, now = reporting_window(period, now, earliest)
    breakdown_start, breakdown_end = start, now
    if month is not None:
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", month):
            raise HTTPException(422, 'Use a month in YYYY-MM format.')
        year, month_number = map(int, month.split('-'))
        try:
            breakdown_start = datetime(year, month_number, 1, tzinfo=ZoneInfo('Asia/Manila'))
            following_month = datetime(year + (month_number == 12), month_number % 12 + 1, 1,
                                       tzinfo=ZoneInfo('Asia/Manila'))
        except ValueError:
            raise HTTPException(422, 'Use a valid calendar month.') from None
        breakdown_end = min(following_month, now)
        if period == "custom":
            breakdown_start = max(breakdown_start, start)
    prev_start = start if period == "all" else start - (now - start)

    current_window = and_(FireIncident.fire_incident_datetime >= start,
                          FireIncident.fire_incident_datetime < now)
    prior_window = and_(FireIncident.fire_incident_datetime >= prev_start,
                        FireIncident.fire_incident_datetime < start)
    is_contained = FireIncident.fire_status.in_(["contained", "closed"])
    is_critical = FireIncident.fire_severity == "Critical"
    count = func.count(FireIncident.fire_id)
    totals = db.query(
        count.filter(current_window).label('total'),
        count.filter(prior_window).label('previous'),
        count.filter(current_window, is_contained).label('contained'),
        count.filter(prior_window, is_contained).label('previous_contained'),
        count.filter(prior_window, is_critical).label('previous_critical'),
        *(count.filter(current_window, FireIncident.fire_severity == name).label(name)
          for name in ('Critical', 'Moderate', 'Minor')),
    ).filter(fire_incident_filter(), FireIncident.fire_incident_datetime >= prev_start,
             FireIncident.fire_incident_datetime < now).one()
    total, prev_total = totals.total, totals.previous
    contained, prev_contained, prev_critical = totals.contained, totals.previous_contained, totals.previous_critical

    def _avg_response(since, until):
        # First dispatch arrival per incident, so a second team arriving later doesn't
        # drag the average up. Durations outside (0, 6h] are clock skew or a
        # forgotten "arrived" tap, not a response, and are excluded.
        first_arrival = (
            db.query(
                FireIncident.report_received_at.label("called_at"),
                func.min(DispatchRecord.dispatch_arrived_at).label("arrived_at"),
            )
            .join(DispatchRecord, DispatchRecord.fire_id == FireIncident.fire_id)
            .filter(
                fire_incident_filter(),
                FireIncident.fire_incident_datetime >= since,
                FireIncident.fire_incident_datetime < until,
                DispatchRecord.dispatch_arrived_at.isnot(None),
                FireIncident.report_received_at.isnot(None),
            )
            .group_by(FireIncident.fire_id, FireIncident.report_received_at)
            .subquery()
        )
        seconds = func.extract("epoch", first_arrival.c.arrived_at - first_arrival.c.called_at)
        avg_s = (
            db.query(func.avg(seconds))
              .filter(seconds > 0, seconds <= 6 * 3600)
              .scalar()
        )
        return round(float(avg_s) / 60, 1) if avg_s is not None else None

    avg_response = _avg_response(start, now)
    prev_avg_response = _avg_response(prev_start, start)
    # Preserve the branch's receipt-based response key. New dashboard consumers
    # explicitly select the verified-receipt metric, including unit arrivals.
    recorded = overall(db, start, now, kind="all", fire_only=True)
    prior_recorded = overall(db, prev_start, start, kind="all", fire_only=True) if prev_start < start else {"mean_seconds": None}
    recorded_minutes = recorded["mean_seconds"] / 60 if recorded["mean_seconds"] is not None else None

    # Severity breakdown for the current window.
    severity = {name: totals._mapping[name] for name in ('Critical', 'Moderate', 'Minor')}

    # Prefer the known barangay. Only legacy non-imported rows use spatial
    # fallback, with one polygon chosen to prevent boundary-overlap duplication.
    by_barangay = {
        row.name: row.cnt
        for row in db.execute(
            text(
                """
                SELECT bb.brgy_name AS name, COUNT(fi.fire_id) AS cnt
                FROM barangay_boundaries bb
                JOIN fire_incidents fi
                  ON fi.brgy_id = bb.brgy_id OR (fi.brgy_id IS NULL AND fi.fire_location_source IS DISTINCT FROM 'bfp_historical_import' AND bb.brgy_id = (
                    SELECT fallback.brgy_id FROM barangay_boundaries fallback WHERE ST_Covers(
                       fallback.brgy_polygon,
                       ST_SetSRID(ST_MakePoint(fi.fire_longitude, fi.fire_latitude), 4326)
                     ) ORDER BY fallback.brgy_id LIMIT 1))
                WHERE fi.fire_incident_datetime >= :start
                  AND fi.fire_incident_datetime < :end
                  AND (TRIM(COALESCE(fi.fire_dispatch_type, '')) = :fire_operation
                       OR (TRIM(COALESCE(fi.fire_dispatch_type, '')) = '' AND fi.response_kind = 'fire'))
                GROUP BY bb.brgy_name
                """
            ),
            {"start": breakdown_start, "end": breakdown_end, "fire_operation": FIRE_OPERATION},
        ).all()
    }

    # Presets retain twelve-month context; all/custom span their reporting window.
    end_month = ((now - timedelta(microseconds=1)) if period in ("2023-2024", "custom") else now).astimezone(ZoneInfo("Asia/Manila"))
    y, m = end_month.year, end_month.month
    seq: list[tuple[int, int]] = []
    first_month = start.astimezone(ZoneInfo("Asia/Manila"))
    months_back = (y - first_month.year) * 12 + m - first_month.month if period in ("all", "custom") else (23 if period == "2023-2024" else 11)
    for i in range(months_back, -1, -1):
        mm, yy = m - i, y
        while mm <= 0:
            mm += 12
            yy -= 1
        seq.append((yy, mm))
    window_start = datetime(seq[0][0], seq[0][1], 1, tzinfo=ZoneInfo("Asia/Manila"))
    if period == "custom":
        window_start = start
    # Read chart/breakdown incidents together so each source history and report
    # cause is looked up once, including a selected month outside chart history.
    chart_and_breakdown = attach_history(db, db.query(FireIncident).filter(fire_incident_filter(), or_(
        and_(FireIncident.fire_incident_datetime >= window_start,
             FireIncident.fire_incident_datetime < now),
        and_(FireIncident.fire_incident_datetime >= breakdown_start,
             FireIncident.fire_incident_datetime < breakdown_end),
    )).all())
    incident_causes = _incident_causes(db, chart_and_breakdown)
    month_counts = {key: 0 for key in seq}
    month_causes = {key: Counter() for key in seq}
    for inc in chart_and_breakdown:
        if not window_start <= inc.fire_incident_datetime < now:
            continue
        at = inc.fire_incident_datetime.astimezone(ZoneInfo("Asia/Manila"))
        key = (at.year, at.month)
        if key in month_counts:
            month_counts[key] += 1
            cause = incident_causes[inc.fire_id]
            # Tooltips list reported causes only; unknowns still contribute to
            # incident totals and the existing summary cause breakdown.
            if cause and cause.strip() not in ("", "Not recorded"):
                month_causes[key][cause] += 1
    monthly = [
        {"month": f"{_MONTH_ABBR[mm - 1]} {str(yy)[2:]}" if period in ("2023-2024", "all", "custom") else _MONTH_ABBR[mm - 1],
         "month_key": f"{yy:04d}-{mm:02d}", "count": month_counts[(yy, mm)],
         "top_causes": _top_causes(month_causes[(yy, mm)], 5)}
        for (yy, mm) in seq
    ]

    incidents = [inc for inc in chart_and_breakdown if breakdown_start <= inc.fire_incident_datetime < breakdown_end]
    alarms = Counter(i.fire_alarm_level or "Not recorded" for i in incidents)
    causes = Counter(incident_causes[i.fire_id] for i in incidents)
    return {
        "scope": "fire",
        "period": period,
        "date_from": date_from,
        "date_to": date_to,
        "breakdown_month": month,
        "breakdown_total": len(incidents),
        "total": total,
        "severity": severity,
        "contained": contained,
        "by_barangay": by_barangay,
        "monthly": monthly,
        "alarm_levels": dict(sorted(alarms.items())),
        "top_causes": _top_causes(causes, 10),
        "synthetic_alarm_count": sum(history(i).get("alarm_basis") == "synthetic_demo" for i in incidents),
        "historical_import_count": sum(bool(history(i)) for i in incidents),
        "approximate_location_count": sum(bool(history(i)) and not history(i).get("pin_specification", {}).get("verified", False) for i in incidents),
        "unresolved_barangay_count": sum(bool(history(i)) and i.brgy_id is None for i in incidents),
        "unknown_severity_count": sum(not i.fire_severity for i in incidents),
        "deltas": {
            "total": _pct_delta(total, prev_total),
            "critical": _pct_delta(severity["Critical"], prev_critical),
            "contained": _pct_delta(contained, prev_contained),
            "response": (
                _pct_delta(avg_response, prev_avg_response)
                if avg_response is not None else None
            ),
        },
        "avg_response_minutes": avg_response,
        "avg_response_basis": "legacy_incident_time_proxy",
        "recorded_response_minutes": round(recorded_minutes, 1) if recorded_minutes is not None else None,
        "recorded_response_quality": recorded,
        "recorded_response_change": _pct_delta(recorded["mean_seconds"], prior_recorded["mean_seconds"])
            if recorded["mean_seconds"] is not None and prior_recorded["mean_seconds"] is not None else None,
    }
