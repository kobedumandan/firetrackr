import { useEffect, useRef, useState } from 'react'
import DetailsLayout from '../layout/DetailsLayout'
import AnalysisIcon from '../components/AnalysisIcon'
import AnalysisValue from '../components/AnalysisValue'
import AnalysisDateTime from '../components/AnalysisDateTime'
import DispatchPicker from '../components/DispatchPicker'
import KpiCard, { KPI_EMPTY } from '../components/KpiCard'
import DispatchResponseReview, { ResponseEvidenceEvents, ResponseMilestones } from '../components/DispatchResponseReview'
import { MilestoneForm } from '../components/ResponseAnalysisContent'
import { SeverityBadge, StatusPill } from '../components/incidentUi'
import useResponseAnalysis from '../hooks/useResponseAnalysis'
import useDispatchDetail from '../hooks/useDispatchDetail'
import { duration } from '../utils/operationalTimes'
import { incidentControl, isFireOperation } from '../utils/incidentOperations'
import '../styles/IncidentDetailsPage.css'
import '../styles/ResponseAnalysisPage.css'

export default function ResponseAnalysisPage({ fireId, theme, onBack, onOpenIncident, initialDispatchId = null, initialDispatchDetail = null, backLabel = 'Incident records', section = null, sectionFocusNonce = 0 }) {
  const { detail, error, onRetry, onSaved } = useResponseAnalysis(fireId)
  const [selection, setSelection] = useState(null)
  const headingRef = useRef(null)
  const milestonesRef = useRef(null)
  const milestonesReady = Boolean(detail)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [fireId])
  useEffect(() => {
    if (!milestonesReady || section !== 'incident-milestones') return
    const target = milestonesRef.current
    if (!target) return
    target.open = true
    target.scrollIntoView?.({ block: 'start', behavior: 'auto' })
    target.querySelector('summary')?.focus({ preventScroll: true })
  }, [fireId, milestonesReady, section, sectionFocusNonce])

  const demo = detail?.timing_basis === 'synthetic_demo'
  const dispatches = demo ? [] : detail?.dispatches || []
  const requestedId = selection?.fireId === fireId ? selection.dispatchId : initialDispatchId
  const firstDispatchId = detail?.units?.find(unit => unit.id === detail.first_unit_id)?.dispatch_id
  const dispatch = dispatches.find(item => item.dispatch_id === requestedId)
    || dispatches.find(item => item.dispatch_id === firstDispatchId) || dispatches[0]
  const dispatchId = dispatch?.dispatch_id ?? (!detail ? initialDispatchId : null)
  const saveReview = updated => {
    if (dispatchId != null) setSelection({ fireId, dispatchId })
    onSaved(updated)
  }
  const dispatchAnalysis = useDispatchDetail(demo ? null : dispatchId, initialDispatchDetail)
  const incidentRecord = detail?.incident_record || dispatchAnalysis.data?.incident_record
  const incidentFields = detail ? [
    ['Incident occurred', <AnalysisDateTime value={detail.occurred_at || incidentRecord?.reported_at} />],
    ['Report received', <AnalysisDateTime value={detail.reported_at || incidentRecord?.report_received_at} />],
    ['Dispatch type', incidentRecord?.dispatch_type], ['Alarm level', incidentRecord?.alarm],
    ['Severity', ['Minor', 'Moderate', 'Critical'].includes(incidentRecord?.sev) ? <SeverityBadge sev={incidentRecord.sev} /> : incidentRecord?.sev], ['Structure type', incidentRecord?.structure],
    ['Reported by', incidentRecord?.reporter], ['Casualties', incidentRecord?.casualties],
  ] : []
  const timeline = demo ? detail.synthetic_timeline : null
  const fireOperation = isFireOperation(detail)
  const incidentMilestones = detail ? [
    ['Report received', timeline?.report_received_at || detail.reported_at],
    ...(fireOperation ? [['Suppression started', timeline?.suppression_started_at || detail.suppression_started_at]] : []),
    [incidentControl(detail).label, detail.controlled_at],
    ...(fireOperation ? [['Fire out', timeline?.fire_out_at || detail.fire_out_at]] : []),
    ['Operation completed', detail.operation_completed_at],
  ] : []
  const incidentEvents = detail?.events?.filter(event => !event.unit_id && event.type.startsWith('op_')) || []

  return <main className="response-analysis-page" aria-label={'Response analysis for INC-' + fireId}>
    <DetailsLayout onBack={onBack} backLabel={backLabel}>
      <header className="rar-heading">
        <div>
          <span className="rar-eyebrow">Incident review</span>
          <h1 ref={headingRef} tabIndex={-1}>Response Analysis</h1>
          <p>Incident response times, dispatch activity and recorded evidence.</p>
        </div>
      </header>

      {error && <div className="rar-notice rar-error" role="alert"><AnalysisIcon name="info" /><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></div>}
      {!detail && !error && <div className="rar-loading" role="status"><span>Loading response analysis…</span><div className="rar-summary">{['Call-to-arrival', 'Overall operation', 'Suppression'].map(label => <KpiCard key={label} label={label} loading />)}</div></div>}
      {detail && <>
        {demo && <p className="rar-notice">Synthesized demonstration timeline · {detail.source_record_id}. The source workbook records a date, not response timestamps. No real truck, crew or driven route is assigned to this simulation.</p>}
        <section className="rar-incident-summary" aria-label="Incident overview">
          <header className="rp-section-heading rar-section-heading">
            <div className="rar-section-heading-copy"><span className="rar-section-heading-icon"><AnalysisIcon name="response" /></span><div><h2>{demo ? 'Demonstration Summary' : 'Incident Summary'}</h2><p>Across all responding units</p></div></div>
          </header>
          <div className="rar-summary">
            <KpiCard icon={<AnalysisIcon name="response" />} label="Call-to-arrival" value={duration(detail.durations?.cta, KPI_EMPTY)} sub="Report received to first valid unit arrival" accent="fire" />
            <KpiCard icon={<AnalysisIcon name="handling" />} label="Overall operation" value={duration(detail.durations?.operation, KPI_EMPTY)} sub="Report received to confirmed operation completion" accent="muted" />
            <KpiCard icon={<AnalysisIcon name="suppression" />} label="Suppression" value={fireOperation ? duration(detail.durations?.suppression, KPI_EMPTY) : 'N/A'} sub={fireOperation ? 'Suppression started to fire out' : 'Applies to fire responses'} accent="muted" />
          </div>
          <section className="rar-incident-details" aria-label="Incident details">
            <header className="idp-hero-top rar-incident-details-header">
              <div className="idp-hero-left">
                <div className="idp-hero-icon idp-tile-fire"><AnalysisIcon name="handling" className="idp-hero-svg" /></div>
                <div className="idp-hero-text">
                  <div className="idp-eyebrow">INC-{fireId}</div>
                  <h3 className="idp-title">{detail.barangay || 'Barangay unknown'}</h3>
                  <p className="idp-addr">{detail.address || incidentRecord?.addr || 'Address unavailable'}</p>
                </div>
              </div>
              {onOpenIncident && incidentRecord && <button type="button" className="rar-register-button" aria-label="Open incident register" title="Open incident register" onClick={() => onOpenIncident(incidentRecord)}><AnalysisIcon name="view" /><span>View</span></button>}
            </header>
            <div className="rar-incident-details-body">
              <div className="rar-incident-context">
                <StatusPill status={detail.status || 'Status unknown'} incident={detail} />
                <span>{detail.response_kind ? detail.response_kind.replace(/^./, first => first.toUpperCase()) + ' response' : 'Unclassified response'}</span>
                <div className="rar-counts"><span><strong>{dispatches.length}</strong> Dispatches</span><span><strong>{detail.units?.length || 0}</strong> Trucks</span></div>
              </div>
              <dl className="rar-incident-location">
                <div><dt>Address</dt><dd><AnalysisValue value={detail.address || incidentRecord?.addr} /></dd></div>
                <div><dt>Barangay</dt><dd><AnalysisValue value={detail.barangay} /></dd></div>
              </dl>
              <dl className="rar-incident-fields">{incidentFields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><AnalysisValue value={value} /></dd></div>)}</dl>
              {incidentRecord?.remarks && <details className="rar-incident-remarks"><summary>Incident remarks<AnalysisIcon name="chevron" className="rar-chevron" /></summary><p>{incidentRecord.remarks}</p></details>}
            </div>
          </section>
          <details id="incident-milestones" ref={milestonesRef} className="rar-disclosure rar-incident-milestones">
            <summary className="rp-section-heading rar-section-heading"><div className="rar-section-heading-copy"><span className="rar-section-heading-icon"><AnalysisIcon name="acknowledgement" /></span><div><h2>Incident Milestones</h2><p>Report, situation control and completion</p></div></div><AnalysisIcon name="chevron" className="rar-chevron" /></summary>
            <div className="rar-disclosure-body">
              <ResponseMilestones milestones={incidentMilestones} />
              <ResponseEvidenceEvents events={incidentEvents} incident={detail} />
              {detail.location_specification && <p className="rar-note">{detail.location_specification.label}: {detail.location_specification.specification}</p>}
            </div>
          </details>
        </section>

        {!demo && (dispatch ? <>
          <section className="rar-dispatch-selection" aria-label="Dispatch selection">
            <div><h2>Dispatch response</h2><p>Review one assignment’s timing, routes and evidence.</p></div>
            <DispatchPicker dispatches={dispatches} value={dispatchId} onChange={id => setSelection({ fireId, dispatchId: id })} />
          </section>
          <DispatchResponseReview key={fireId} fireId={fireId} detail={detail} dispatch={dispatch} theme={theme} onSaved={saveReview} {...dispatchAnalysis} />
        </> : <>
          <section className="rar-empty"><AnalysisIcon name="coverage" /><h2>No dispatch assignments recorded</h2><p>Incident milestones remain available for review.</p></section>
          <MilestoneForm data={detail} onSaved={onSaved} pageLayout />
        </>)}
        <p className="rar-timezone"><AnalysisIcon name="info" />All timestamps use Philippine time (UTC+8). Mobile action times reflect server receipt.</p>
      </>}
    </DetailsLayout>
  </main>
}
