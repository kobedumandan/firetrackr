import { useEffect, useRef, useState } from 'react'
import DetailsLayout, { DetailsField, DetailsSection } from '../layout/DetailsLayout'
import AnalysisIcon from '../components/AnalysisIcon'
import AnalysisValue from '../components/AnalysisValue'
import KpiCard, { KPI_EMPTY } from '../components/KpiCard'
import DispatchDetailsPage from './DispatchDetailsPage'
import ResponseAnalysisContent from '../components/ResponseAnalysisContent'
import { StatusPill } from '../components/incidentUi'
import useResponseAnalysis from '../hooks/useResponseAnalysis'
import { dateTime, duration } from '../utils/operationalTimes'
import '../styles/IncidentDetailsPage.css'
import '../styles/ResponseAnalysisPage.css'
import '../styles/ResponseAnalysisOperations.css'

export default function ResponseAnalysisPage({ fireId, theme, onBack, onOpenIncident }) {
  const analysis = useResponseAnalysis(fireId)
  const { detail } = analysis
  const [dispatchId, setDispatchId] = useState(null)
  const headingRef = useRef(null)
  const dispatchTriggerRef = useRef(null)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [fireId])
  useEffect(() => {
    if (dispatchId == null && dispatchTriggerRef.current?.isConnected) {
      dispatchTriggerRef.current.focus({ preventScroll: true })
      dispatchTriggerRef.current = null
    }
  }, [dispatchId])
  function openDispatch(id) {
    dispatchTriggerRef.current = document.activeElement
    setDispatchId(id)
  }
  const demo = detail?.timing_basis === 'synthetic_demo'
  const stats = detail ? [
    ['Call-to-arrival', duration(detail.durations.cta, KPI_EMPTY), 'First valid unit arrival', 'response'],
    ['Overall operation', duration(detail.durations.operation, KPI_EMPTY), 'All units cleared', 'handling'],
    ['Dispatches', detail.dispatches?.length ?? 0, 'Responding teams', 'coverage'],
    ['Trucks', detail.units.length, 'Assigned vehicles', 'travel'],
  ] : []
  const aside = detail && <div className="idp-aside">
    <DetailsSection title="Incident context">
      <div className="rap-context">
        <DetailsField label="Address" value={<AnalysisValue value={detail.address} />} />
        <DetailsField label="Barangay" value={detail.barangay || 'Barangay unknown'} />
        <DetailsField label="Response classification" value={detail.response_kind || 'Unclassified response'} />
        <DetailsField label="Report received" value={<AnalysisValue value={dateTime(detail.reported_at)} />} />
        <DetailsField label="Operation completed" value={<AnalysisValue value={dateTime(detail.operation_completed_at)} />} />
      </div>
    </DetailsSection>
    <DetailsSection title="Timing reference">
      <p className="rap-timezone"><AnalysisIcon name="info" />All timestamps in Philippine time (UTC+8)</p>
      {demo && <p className="ota-note">Demonstration timing. No real truck, crew or driven route is assigned.</p>}
    </DetailsSection>
  </div>
  return <><main className="response-analysis-page" hidden={dispatchId != null} aria-label={`Response analysis for INC-${fireId}`}>
    <DetailsLayout onBack={onBack} backLabel="Incident records" aside={aside}>
      <section className="idp-hero idp-hero-fire" aria-label="Incident overview">
        <div className="idp-hero-top"><div className="idp-hero-left">
          <div className="idp-hero-icon idp-tile-fire"><AnalysisIcon name="response" className="idp-hero-svg" /></div>
          <div className="idp-hero-text">
            <div className="idp-eyebrow">INCIDENT REVIEW</div>
            <h1 ref={headingRef} tabIndex={-1} className="idp-title">Response Analysis</h1>
            <div className="rap-incident-code">INC-{fireId}</div>
            {detail && <div className="idp-chips"><StatusPill status={detail.status || 'Status unknown'} /></div>}
          </div>
        </div></div>
        {detail && <div className="idp-stats rt-personal-metrics">{stats.map(([label, value, sub, icon]) => <KpiCard key={label} icon={<AnalysisIcon name={icon} />} label={label} value={value} sub={sub} accent="muted" />)}</div>}
      </section>
      <ResponseAnalysisContent key={fireId} fireId={fireId} theme={theme} onOpenDispatch={openDispatch} pageLayout {...analysis} />
    </DetailsLayout>
  </main>
    {dispatchId != null && <DispatchDetailsPage key={dispatchId} id={dispatchId} theme={theme} backLabel="Response analysis" onBack={() => setDispatchId(null)} onOpenIncident={onOpenIncident} />}
  </>
}
