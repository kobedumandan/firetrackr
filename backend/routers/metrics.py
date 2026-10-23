"""Aggregates behind the Metrics dashboard."""
from datetime import datetime, timedelta, timezone
from collections import Counter
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from database import get_db
from models import DispatchRecord, FireIncident, IncidentReport, Users
from security import require_admin
from services.reporting_periods import reporting_window
from services.historical_incidents import attach_history, history
from services.response_performance import overall
from routers.response_performance import router as performance_router


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


@router.get("/api/metrics/summary")
def metrics_summary(
    period: str = "1m",
    db: Session = Depends(get_db),
    _auth: Users = Depends(require_admin),
):
    """One count per incident, source causes and explicitly labeled demo alarms.

    Both response metrics require an actual report receipt. The separate
    recorded metric also accepts per-unit arrivals.
    Synthesized historical metadata never supplies measured response timestamps.
    """
    now = datetime.now(timezone.utc)
    earliest = db.query(func.min(FireIncident.fire_incident_datetime)).scalar() if period == "all" else None
    start, now = reporting_window(period, now, earliest)
    prev_start = start if period == "all" else start - (now - start)

    def _count(*filters, since, until):
        q = db.query(func.count(FireIncident.fire_id)).filter(
            FireIncident.fire_incident_datetime >= since,
            FireIncident.fire_incident_datetime < until,
            *filters,
        )
        return q.scalar() or 0

    _contained = (FireIncident.fire_status.in_(["contained", "closed"]),)
    _critical = (FireIncident.fire_severity == "Critical",)

    total = _count(since=start, until=now)
    prev_total = _count(since=prev_start, until=start)
    contained = _count(*_contained, since=start, until=now)
    prev_contained = _count(*_contained, since=prev_start, until=start)
    prev_critical = _count(*_critical, since=prev_start, until=start)

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
    recorded = overall(db, start, now, kind="all")
    prior_recorded = overall(db, prev_start, start, kind="all") if prev_start < start else {"mean_seconds": None}
    recorded_minutes = recorded["mean_seconds"] / 60 if recorded["mean_seconds"] is not None else None

    # Severity breakdown for the current window.
    severity = {"Critical": 0, "Moderate": 0, "Minor": 0}
    for name, c in (
        db.query(FireIncident.fire_severity, func.count(FireIncident.fire_id))
          .filter(FireIncident.fire_incident_datetime >= start,
                  FireIncident.fire_incident_datetime < now)
          .group_by(FireIncident.fire_severity)
          .all()
    ):
        if name in severity:
            severity[name] = c

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
                GROUP BY bb.brgy_name
                """
            ),
            {"start": start, "end": now},
        ).all()
    }

    # Incidents per month over the last 12 months (independent of `period`).
    end_month = (now - timedelta(seconds=1)) if period == "2023-2024" else now
    y, m = end_month.year, end_month.month
    seq: list[tuple[int, int]] = []
    first_month = start.astimezone(ZoneInfo("Asia/Manila"))
    months_back = (y - first_month.year) * 12 + m - first_month.month if period == "all" else (23 if period == "2023-2024" else 11)
    for i in range(months_back, -1, -1):
        mm, yy = m - i, y
        while mm <= 0:
            mm += 12
            yy -= 1
        seq.append((yy, mm))
    window_start = datetime(seq[0][0], seq[0][1], 1, tzinfo=ZoneInfo("Asia/Manila"))
    month_counts = {key: 0 for key in seq}
    m_bucket = func.date_trunc("month", func.timezone("Asia/Manila", FireIncident.fire_incident_datetime)).label("m")
    for bucket, c in (
        db.query(m_bucket, func.count(FireIncident.fire_id))
          .filter(FireIncident.fire_incident_datetime >= window_start,
                  FireIncident.fire_incident_datetime < now)
          .group_by(m_bucket)
          .all()
    ):
        if bucket is not None and (bucket.year, bucket.month) in month_counts:
            month_counts[(bucket.year, bucket.month)] = c
    monthly = [
        {"month": f"{_MONTH_ABBR[mm - 1]} {str(yy)[2:]}" if period in ("2023-2024", "all") else _MONTH_ABBR[mm - 1], "count": month_counts[(yy, mm)]}
        for (yy, mm) in seq
    ]

    incidents = attach_history(db, db.query(FireIncident).filter(
        FireIncident.fire_incident_datetime >= start, FireIncident.fire_incident_datetime < now).all())
    alarms = Counter(i.fire_alarm_level or "Not recorded" for i in incidents)
    # One latest non-empty report cause per incident; workbook cause has precedence.
    report_causes = {}
    if incidents:
        for report in db.query(IncidentReport).filter(
            IncidentReport.fire_id.in_([i.fire_id for i in incidents]),
            IncidentReport.report_cause.isnot(None),
        ).order_by(IncidentReport.report_submitted_at, IncidentReport.report_id):
            if report.report_cause.strip():
                report_causes[report.fire_id] = report.report_cause.strip()
    causes = Counter(history(i).get("cause_clean") or report_causes.get(i.fire_id) or "Not recorded" for i in incidents)
    return {
        "period": period,
        "total": total,
        "severity": severity,
        "contained": contained,
        "by_barangay": by_barangay,
        "monthly": monthly,
        "alarm_levels": dict(sorted(alarms.items())),
        "top_causes": [{"cause": name, "count": count} for name, count in sorted(causes.items(), key=lambda item: (-item[1], item[0]))[:10]],
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
