import { useState } from 'react'
import ConfirmModal from './ConfirmModal'
import PhotoViewer from './PhotoViewer'
import { StatusPill } from './incidentUi'
import { dateTime } from '../utils/operationalTimes'
import '../styles/IncidentWorkflow.css'

function Icon({ name }) {
  return <span className="material-symbols-outlined wf-icon" aria-hidden="true">{name}</span>
}

function Badge({ children, tone = 'muted' }) {
  return <span className="wf-badge" data-tone={tone}>{children}</span>
}

function completionRequirements(blockers, dispatches) {
  return blockers.flatMap((blocker, index) => {
    const missingClearance = /^Team clearance missing:\s*([\d,\s]+)$/.exec(blocker)
    if (missingClearance) return missingClearance[1].split(',').map(value => value.trim()).filter(Boolean).map(id => {
      const dispatch = dispatches.find(item => String(item.dispatch_id) === id)
      return { key: `clearance-${id}`, icon: 'fire_truck', label: dispatch?.team || dispatch?.team_name || `Dispatch ${id}`, action: 'Release Clearance' }
    })
    if (blocker === 'Fire out is not recorded.') return { key: `blocker-${index}`, icon: 'local_fire_department', label: 'Fire Out', action: 'Record Fire Out' }
    if (blocker === 'No responding assignments are recorded.') return { key: `blocker-${index}`, icon: 'fire_truck', label: 'Responding Teams', action: 'Assign a Team' }
    return { key: `blocker-${index}`, icon: 'info', label: blocker }
  })
}

export default function IncidentWorkflowPanel({ fireId, workflow, onPrepare }) {
  const [closeReview, setCloseReview] = useState(null)
  const [completionReview, setCompletionReview] = useState(null)
  const [photoViewer, setPhotoViewer] = useState(null)
  const { data, error, busy } = workflow
  const dispatches = data?.dispatches || []
  const fieldReports = data?.field_reports || []
  const viewedReport = photoViewer?.fireId === fireId
    ? fieldReports.find(report => report.report_id === photoViewer.reportId) : null
  const startingReport = fieldReports.length === 1 ? fieldReports[0] : null
  const returns = dispatches.flatMap(dispatch => dispatch.returns || [])
  const onScene = dispatches.filter(dispatch => dispatch.dispatch_status === 'on_scene' && !dispatch.cleared_at).length
  const cleared = dispatches.filter(dispatch => dispatch.cleared_at).length
  const pendingReturns = returns.filter(unit => !unit.ready_at).length
  const complete = !!data?.incident.operation_completed_at
  const closed = data?.incident.status === 'closed'
  const canPrepareReport = !!onPrepare && !['closed', 'cancelled', 'canceled', 'recalled'].includes(data?.incident.status)
  const requirements = completionRequirements(data?.completion_blockers || [], dispatches)
  const closeReviewCurrent = !!closeReview && closeReview.fireId === fireId
    && closeReview.reportId === data?.report?.report_id
    && closeReview.revision === data?.report?.revision
    && (complete || closed) && (!data?.report?.reviewed_at || !closed)
  const completionReviewCurrent = !!completionReview && completionReview.fireId === fireId
    && data?.incident.fire_id === fireId && !complete && !closed && !data.completion_blockers.length

  async function confirmCompletion() {
    if (!completionReviewCurrent) throw new Error('The operation status changed. Cancel and reopen operation completion to review the latest status.')
    await workflow.submit(`/api/workflow/incidents/${completionReview.fireId}/complete`, {})
  }

  async function confirmClose() {
    if (!closeReviewCurrent) throw new Error('The incident or report changed. Reopen Review & Close Incident to review the latest revision.')
    await workflow.submit(`/api/workflow/incidents/${closeReview.fireId}/close`, {
      report_id: closeReview.reportId,
      revision: closeReview.revision,
    })
  }

  return <section className="wf-panel" aria-label="Incident operational workflow" aria-busy={busy || (!data && !error)}>
    {error && <div role="alert" className="wf-error"><Icon name="error" /><p>{error}</p></div>}
    {busy && <p className="wf-saving" role="status">Saving update…</p>}
    {!data && !error && <div className="wf-loading" role="status" aria-label="Loading response workflow"><span className="wf-loading-circle" aria-hidden="true" /></div>}

    {data && <>
      <div className="wf-overview">
        <div className="wf-current-stage"><span className="wf-eyebrow">Incident Status</span><StatusPill status={data.incident.status} incident={data.incident} /></div>
        <dl className="wf-stats">
          <div><dt>Teams On Scene</dt><dd>{onScene}<span className="wf-stat-caption"> / {dispatches.length}</span></dd></div>
          <div><dt>Teams Cleared</dt><dd>{cleared}<span className="wf-stat-caption"> / {dispatches.length}</span></dd></div>
          <div><dt>Awaiting Truck Readiness</dt><dd>{pendingReturns}</dd></div>
        </dl>
      </div>

      <div className="wf-workspace">
        <div className="wf-next-steps">
          <div className="wf-section-heading"><h3>Completion & Reporting</h3></div>
          <article className="wf-task">
            <header className="wf-task-heading">
              <div className="wf-task-title"><span className="wf-step"><Icon name={complete ? 'check' : 'flag'} /></span><h4 className="idp-unit-name">Operation Completion</h4></div>
              <Badge tone={complete ? 'complete' : closed ? 'muted' : data.completion_blockers.length ? 'waiting' : 'ready'}>{complete ? 'Recorded' : closed ? 'Closed record' : data.completion_blockers.length ? 'Awaiting prerequisites' : 'Ready to confirm'}</Badge>
            </header>
            <p className="wf-help idp-unit-note">{complete ? 'Operational work is complete and responding teams are accounted for.' : closed ? 'This incident is closed. No operation completion time is recorded.' : 'Confirm when operational work is finished and all responding teams are accounted for.'}</p>
            {complete && <p className="wf-recorded"><Icon name="schedule" />{dateTime(data.incident.operation_completed_at)}</p>}
            {!complete && !closed && <>
              {!!data.completion_blockers.length && <div className="wf-blockers"><span className="wf-eyebrow">Before Completion</span><div className="wf-requirements" role="list">{requirements.map(requirement => <span className="wf-requirement" role="listitem" key={requirement.key}>
                <Icon name={requirement.icon} /><span>{requirement.label}{requirement.action && <><span className="wf-requirement-divider"> | </span>{requirement.action}</>}</span>
              </span>)}</div></div>}
              <button type="button" className="act-btn block" disabled={busy || !!data.completion_blockers.length} onClick={() => setCompletionReview({ fireId })}>Confirm Operation Complete</button>
            </>}
          </article>

          <article className="wf-task">
            <header className="wf-task-heading">
              <div className="wf-task-title"><span className="wf-step"><Icon name={data.report?.reviewed_at ? 'check' : 'description'} /></span><h4 className="idp-unit-name">Incident Report</h4></div>
              <Badge tone={data.report?.reviewed_at ? 'complete' : data.report ? 'waiting' : 'muted'}>{data.report?.reviewed_at ? 'Reviewed' : data.report ? 'Pending review' : 'Not prepared'}</Badge>
            </header>
            <p className="wf-help idp-unit-note">{data.report ? (closed && data.report.reviewed_at ? 'The incident report is reviewed and the incident is closed.' : complete || closed ? 'Verify the incident report, then review and close the incident.' : 'Save the incident report now. Complete the operation before reviewing and closing.') : closed ? 'No incident report is recorded for this incident.' : startingReport ? 'Start with the field report below. Verify its findings and add any confirmed information before saving.' : fieldReports.length > 1 ? 'Choose a field report below as your starting point and reconcile the other teams’ findings, or prepare a report from confirmed information.' : 'Prepare the incident report from confirmed field information. A team submission is not required to start.'}</p>
            {data.report && <div className="wf-blockers wf-report-details">
              <span className="wf-eyebrow">Report Reference</span>
              <div className="wf-requirements"><span className="wf-requirement wf-report-reference"><Icon name="description" /><span>Report #{data.report.report_id}</span></span></div>
            </div>}
            {data.report?.reviewed_at && <p className="wf-recorded"><Icon name="schedule" />Reviewed {dateTime(data.report.reviewed_at)}</p>}
            {data.report && (!data.report.reviewed_at || !closed) && <button type="button" className="act-btn block" disabled={busy || (!complete && !closed)} onClick={() => setCloseReview({ fireId, reportId: data.report.report_id, revision: data.report.revision })}>Review & Close Incident</button>}
            {!data.report && canPrepareReport && <button type="button" className="act-btn block" disabled={busy} onClick={() => onPrepare(startingReport)}><Icon name="edit_document" />{startingReport ? 'Review Field Report' : 'Prepare Incident Report'}</button>}
          </article>
        </div>
      </div>

      <details className="wf-field-reports" open={!data.report && fieldReports.length > 0}>
        <summary><span className="wf-submissions-icon"><Icon name="description" /></span><span className="wf-submissions-title"><strong>Field Reports <span className="ci-count">{fieldReports.length}</span></strong><span>Original team findings and photos for the incident report</span></span><Icon name="expand_more" /></summary>
        <div className="wf-submissions-body">
          {!fieldReports.length && <div className="wf-empty wf-empty-reports"><Icon name="inbox" /><h4>No field information submitted yet.</h4><p>Personnel submissions will appear here when a team files its report.</p></div>}
          {fieldReports.map(report => <div key={report.report_id} className="wf-field-report">
            <header className="wf-field-report-heading"><div><span className="wf-reference">Field report #{report.report_id}</span><h4>{report.author || 'Legacy author unknown'}</h4></div><span className="wf-timestamp">{dateTime(report.submitted_at)}</span></header>
            <dl className="wf-report-observation"><dt>Casualty observation</dt><dd>{report.casualties || 'Unconfirmed'}</dd></dl>
            <p className="wf-prose">{report.narrative}</p>
            {!!report.recommendations && <div className="wf-recommendations"><span className="wf-eyebrow">Recommendations</span><p className="wf-prose">{report.recommendations}</p></div>}
            {!!report.photos?.length && <div className="wf-photos">{report.photos.map((url, index) => <button type="button" key={url} onClick={() => setPhotoViewer({ fireId, reportId: report.report_id, index })} aria-label={`Open field report ${report.report_id} scene photo ${index + 1}`}><img src={url} alt={`Field report ${report.report_id} scene photo ${index + 1}`} loading="lazy" /></button>)}</div>}
            {!data.report && canPrepareReport && fieldReports.length > 1 && <button type="button" className="act-btn block" disabled={busy} onClick={() => onPrepare(report)}>Use for Incident Report</button>}
          </div>)}
        </div>
      </details>
    </>}
    {viewedReport?.photos?.[photoViewer.index] && <PhotoViewer
      photos={viewedReport.photos}
      index={photoViewer.index}
      onIndexChange={index => setPhotoViewer(current => ({ ...current, index }))}
      onClose={() => setPhotoViewer(null)}
      caption={`Field report #${viewedReport.report_id}${viewedReport.author ? ` · ${viewedReport.author}` : ''}`}
    />}
    {completionReview && <ConfirmModal
      eyebrow="OPERATION COMPLETION"
      icon="release"
      title="Confirm operation complete?"
      details={[{ label: 'Incident', value: data?.incident.id || String(completionReview.fireId) }]}
      message={completionReviewCurrent
        ? 'Confirm operational work is finished and all responding teams are accounted for. This records operation completion now. Incident report review and truck readiness remain separate tasks.'
        : 'The operation status changed. Cancel and reopen operation completion to review the latest status.'}
      confirmLabel="Confirm Operation Complete"
      confirmDisabled={busy || !completionReviewCurrent}
      onConfirm={confirmCompletion}
      onClose={() => setCompletionReview(null)}
    />}
    {closeReview && <ConfirmModal
      eyebrow="REVIEW & CLOSE INCIDENT"
      title="Review and close this incident?"
      icon="release"
      details={[
        { label: 'Incident', value: data?.incident.id || String(closeReview.fireId) },
        { label: 'Report', value: `#${closeReview.reportId}` },
        { label: 'Revision', value: String(closeReview.revision) },
      ]}
      message={closeReviewCurrent
        ? 'Confirm you have reviewed this report revision. This marks the report as reviewed and closes the incident. Returning trucks retain their readiness tasks.'
        : 'The incident or report changed. Cancel and reopen Review & Close Incident to review the latest revision.'}
      confirmLabel="Review & Close Incident"
      confirmDisabled={busy || !closeReviewCurrent}
      onConfirm={confirmClose}
      onClose={() => setCloseReview(null)}
    />}
  </section>
}
