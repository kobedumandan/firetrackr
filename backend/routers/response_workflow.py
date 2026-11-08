"""Two-account workflow actions and owned personnel response history."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, selectinload

from database import get_db
from models import DispatchRecord, DispatchTruck, FireIncident, IncidentReport, ResponseTeamMember
from security import get_current_user, require_admin
from serializers import _incident_dict, _report_dict
from services.response_workflow import (
    ACTIVE, EXCLUDED, WORKFLOW_VERSION, authorize_release, close_incident,
    confirm_readiness, consolidated_report, is_leader, own_dispatch, owned_query,
    return_payload, release_confirmations, release_state, record_fire_milestone,
    field_report_blocker,
)
from state import manager

router = APIRouter(tags=['response-workflow'])


class ReadinessBody(BaseModel):
    ready: bool
    reason: str | None = Field(default=None, max_length=255)


class ReviewCloseBody(BaseModel):
    report_id: int = Field(ge=1)
    revision: int = Field(ge=1)


class ReleaseBody(BaseModel):
    work_finished: bool = False


class FireMilestoneBody(BaseModel):
    kind: Literal['suppression_start', 'fire_out']
    occurred_at: datetime
    idempotency_key: str = Field(min_length=8, max_length=80)


def dispatch_payload(dispatch):
    return {
        'dispatch_id': dispatch.dispatch_id, 'fire_id': dispatch.fire_id,
        'team': (dispatch.context_snapshot or {}).get('team_name') or (dispatch.team.team_name if dispatch.team else 'Team'),
        'dispatch_status': dispatch.dispatch_status,
        'dispatch_at': dispatch.dispatch_at.isoformat() if dispatch.dispatch_at else None,
        'release_authorized_at': dispatch.release_authorized_at.isoformat() if dispatch.release_authorized_at else None,
        'cleared_at': dispatch.cleared_at.isoformat() if dispatch.cleared_at else None,
        'returns': [return_payload(unit) for unit in dispatch.dispatch_trucks if unit.return_started_at],
    }


async def notify(db, kind, inc, dispatch=None):
    from services.push import notify_workflow
    assignments = [dispatch] if dispatch else list(inc.dispatches)
    per_ids = {row['per_id'] for assignment in assignments for row in (assignment.context_snapshot or {}).get('roster', [])}
    for assignment in assignments:
        if not (assignment.context_snapshot or {}).get('roster'):
            per_ids.update(member.per_id for member in (assignment.team.members if assignment.team else []))
    data = {'kind': kind, 'fire_id': inc.fire_id, 'dispatch_id': dispatch.dispatch_id if dispatch else None,
            'per_ids': sorted(per_ids), 'incident': _incident_dict(inc)}
    await manager.broadcast({'type': 'workflow_updated', 'data': data})
    notify_workflow(db, per_ids, kind, data)


@router.get('/api/workflow/incidents/{fire_id}')
def workflow_detail(fire_id: int, db: Session = Depends(get_db), user=Depends(require_admin)):
    inc = db.get(FireIncident, fire_id)
    if not inc:
        raise HTTPException(404, 'Incident not found.')
    reports = db.query(IncidentReport).filter_by(fire_id=fire_id).order_by(IncidentReport.report_id.desc()).all()
    final = next((report for report in reports if report.report_kind == 'consolidated'), None)
    pending = [d.dispatch_id for d in inc.dispatches if d.dispatch_at and d.dispatch_status not in EXCLUDED and not d.cleared_at]
    from services.incident_scope import effective_response_kind
    blockers = ([f'Team clearance missing: {", ".join(map(str, pending))}'] if pending else [])
    if effective_response_kind(inc) == 'fire' and not inc.fire_out_at:
        blockers.append('Fire out is not recorded.')
    if not inc.dispatches:
        blockers.append('No responding assignments are recorded.')
    dispatches = list(inc.dispatches)
    confirmed = release_confirmations(db, dispatches)
    return {'workflow_version': WORKFLOW_VERSION, 'incident': _incident_dict(inc),
            'dispatches': [{**dispatch_payload(d), 'release': release_state(inc, d, dispatches, confirmed)} for d in dispatches],
            'field_reports': [_report_dict(report) for report in reports if report.report_kind != 'consolidated'],
            'report': _report_dict(final) if final else None, 'completion_blockers': blockers}


@router.post('/api/workflow/dispatch/{dispatch_id}/release')
async def release(dispatch_id: int, body: ReleaseBody, db: Session = Depends(get_db), user=Depends(require_admin)):
    dispatch = authorize_release(db, dispatch_id, user, work_finished=body.work_finished)
    changed = dispatch._workflow_changed
    db.commit()
    if changed:
        await notify(db, 'release_authorized', dispatch.fire_incident, dispatch)
    return dispatch_payload(dispatch)


@router.post('/api/workflow/dispatch/{dispatch_id}/fire-milestones')
async def fire_milestone(dispatch_id: int, body: FireMilestoneBody, db: Session = Depends(get_db), user=Depends(get_current_user)):
    dispatch, changed = record_fire_milestone(db, dispatch_id, user, body.kind, body.occurred_at, body.idempotency_key)
    db.commit()
    if changed:
        await manager.broadcast({'type': 'operational_times_updated', 'data': {'fire_id': dispatch.fire_id}})
        await notify(db, body.kind, dispatch.fire_incident)
    from services.report_timing import timeline
    return {'incident': _incident_dict(dispatch.fire_incident), 'operational_timing': timeline(db, dispatch.fire_incident)}


@router.post('/api/workflow/returns/{unit_id}/readiness')
async def readiness(unit_id: int, body: ReadinessBody, db: Session = Depends(get_db), user=Depends(get_current_user)):
    unit = confirm_readiness(db, unit_id, user, ready=body.ready, reason=body.reason)
    changed = unit._workflow_changed
    db.commit()
    if changed:
        await notify(db, 'truck_ready' if body.ready else 'truck_not_ready', unit.dispatch_record.fire_incident, unit.dispatch_record)
    return return_payload(unit)


@router.post('/api/workflow/incidents/{fire_id}/complete')
async def complete(fire_id: int, db: Session = Depends(get_db), user=Depends(require_admin)):
    inc = db.query(FireIncident).filter_by(fire_id=fire_id).with_for_update().first()
    if inc is None:
        raise HTTPException(404, 'Incident not found.')
    changed = inc.operation_completed_at is None
    if changed:
        from services.operational_times import record_milestone
        record_milestone(db, inc, 'operation_complete', datetime.now(timezone.utc), user,
                         source='dispatcher_confirmation', key=f'operation-complete:{fire_id}')
    db.commit()
    if changed:
        await notify(db, 'operation_complete', inc)
    return _incident_dict(inc)


@router.post('/api/workflow/incidents/{fire_id}/close')
async def review_close(fire_id: int, body: ReviewCloseBody, db: Session = Depends(get_db), user=Depends(require_admin)):
    inc = db.query(FireIncident).filter_by(fire_id=fire_id).with_for_update().first()
    if inc is None:
        raise HTTPException(404, 'Incident not found.')
    changed = inc.fire_status != 'closed'
    previous_report = consolidated_report(db, fire_id)
    needs_review = previous_report is not None and previous_report.reviewed_at is None
    report = close_incident(db, inc, user, body.report_id, body.revision)
    if changed:
        from services.dispatch import _add_incident_to_heatmap
        _add_incident_to_heatmap(db, inc, datetime.now(timezone.utc))
    db.commit()
    if changed or needs_review:
        await notify(db, 'incident_closed' if changed else 'report_reviewed', inc)
        await manager.broadcast({'type': 'incident_updated', 'data': _incident_dict(inc)})
    return {'incident': _incident_dict(inc), 'report': _report_dict(report)}


def history_entry(db, dispatch, user, *, include_reports=False):
    inc = dispatch.fire_incident
    report = db.query(IncidentReport).filter(IncidentReport.dispatch_id == dispatch.dispatch_id,
        IncidentReport.per_id == user.personnel.per_id, IncidentReport.report_kind.in_(('field', 'legacy'))
    ).order_by(IncidentReport.report_id.desc()).first()
    leader = is_leader(db, dispatch, user, historical=True)
    allowed = leader and not report and inc.fire_status not in ('closed', *EXCLUDED)
    blocker = field_report_blocker(db, dispatch, user) if allowed else None
    result = {**dispatch_payload(dispatch), 'incident': _incident_dict(inc),
              'can_submit_report': allowed and not blocker, 'is_team_leader': leader,
              'report_blocker': blocker,
              'report_status': 'submitted' if report else 'closed' if inc.fire_status == 'closed' else 'pending' if leader else 'not_required'}
    if include_reports:
        result['report'] = _report_dict(report) if report else None
        from services.report_timing import timeline
        result['incident']['operational_timing'] = timeline(db, inc)
    return result


def pending_query(db, user):
    query = owned_query(db, user)
    per_id = user.personnel.per_id
    leader_snapshot = or_(*[DispatchRecord.context_snapshot.contains({'roster': [{'per_id': per_id, 'role': role}]})
                           for role in ('team leader', 'Team Leader', 'Team leader', 'TEAM LEADER', 'team_leader', 'Team_Leader', 'Team_leader', 'TEAM_LEADER')])
    current_leader = db.query(ResponseTeamMember.members_id).filter(
        ResponseTeamMember.team_id == DispatchRecord.team_id, ResponseTeamMember.per_id == per_id,
        func.lower(func.replace(ResponseTeamMember.member_role, '_', ' ')) == 'team leader',
        DispatchRecord.dispatch_status.in_(ACTIVE),
    ).exists()
    submitted = db.query(IncidentReport.report_id).filter(
        IncidentReport.dispatch_id == DispatchRecord.dispatch_id, IncidentReport.per_id == per_id,
        IncidentReport.report_kind.in_(('field', 'legacy'))).exists()
    return query.filter(or_(leader_snapshot, current_leader), ~submitted,
                        DispatchRecord.fire_incident.has(FireIncident.fire_status.notin_(('closed', *EXCLUDED))))


@router.get('/api/mobile/me/incidents')
def my_incidents(page: int = Query(1, ge=1), page_size: int = Query(15, ge=1, le=50),
                 pending: bool = False, db: Session = Depends(get_db), user=Depends(get_current_user)):
    query = (pending_query(db, user) if pending else owned_query(db, user)).options(
        selectinload(DispatchRecord.fire_incident), selectinload(DispatchRecord.dispatch_trucks))
    # Apply pending-report predicates before pagination, including historical
    # leader evidence. The ordinary list remains a database-paginated history.
    total = query.count()
    rows = query.order_by(DispatchRecord.dispatch_at.desc(), DispatchRecord.dispatch_id.desc()).offset((page-1)*page_size).limit(page_size).all()
    return {'items': [history_entry(db, dispatch, user) for dispatch in rows], 'total': total,
            'page': page, 'page_size': page_size, 'workflow_version': WORKFLOW_VERSION}


@router.get('/api/mobile/me/incidents/{dispatch_id}')
def my_incident(dispatch_id: int, db: Session = Depends(get_db), user=Depends(get_current_user)):
    dispatch = own_dispatch(db, dispatch_id, user)
    return history_entry(db, dispatch, user, include_reports=True)
