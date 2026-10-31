import { useEffect, useRef } from 'react'
import DetailsLayout, { DetailsField, DetailsSection } from '../layout/DetailsLayout'
import AnalysisIcon from '../components/AnalysisIcon'
import AnalysisValue from '../components/AnalysisValue'
import DispatchRouteHistory from '../components/DispatchRouteHistory'
import KpiCard, { KPI_EMPTY } from '../components/KpiCard'
import ResponderRouteHistory from '../components/ResponderRouteHistory'
import SettingsLoading from '../components/SettingsLoading'
import useDispatchDetail from '../hooks/useDispatchDetail'
import { dateTime, duration } from '../utils/operationalTimes'
import '../styles/IncidentDetailsPage.css'
import '../styles/DispatchDetailsPage.css'

const MEASURES = [
  { key: 'response', label: 'After dispatch', sub: 'Dispatch to arrival', icon: 'response' },
  { key: 'handling', label: 'Dispatch handling', sub: 'Report received to dispatch', icon: 'handling' },
  { key: 'acknowledgement', label: 'Acknowledgement', sub: 'Dispatch to acknowledgement', icon: 'acknowledgement' },
  { key: 'turnout', label: 'Turnout', sub: 'Dispatch to departure', icon: 'turnout' },
  { key: 'travel', label: 'Travel', sub: 'Departure to arrival', icon: 'travel' },
]
const STATUS_TONES = { dispatched: 'amber', en_route: 'amber', on_scene: 'blue', completed: 'green' }
const readable = value => typeof value === 'string' && value ? value.replaceAll('_', ' ').replace(/^./, first => first.toUpperCase()) : null

export default function DispatchDetailsPage({ id, theme, onBack, onOpenIncident, backLabel = 'Dispatch observations' }) {
  const { data, error, onRetry } = useDispatchDetail(id)
  const headingRef = useRef(null)
  useEffect(() => { headingRef.current?.focus({ preventScroll: true }) }, [id])
  const context = data?.context || {}
  const milestones = data ? [
    ['Report received', data.report_received_at], ['Dispatched', data.dispatch_at],
    ['Acknowledged', data.acknowledged_at], ['Departed', data.departed_at], ['Arrived', data.arrived_at],
  ] : []
  const aside = data && <div className="idp-aside">
    <DetailsSection title="Assigned resources">
      <div className="ddp-context">
        <DetailsField label="Team" value={<AnalysisValue value={context.team_name} />} />
        <DetailsField label="Truck" value={<AnalysisValue value={context.truck} />} />
        <DetailsField label="Station" value={<AnalysisValue value={context.station_name} />} />
        <DetailsField label="Shift" value={<AnalysisValue value={context.shift_name} />} />
      </div>
      <p className="ddp-note"><AnalysisIcon name="info" /><span>{context.provenance === 'assignment' ? 'Context preserved at assignment.' : 'Current metadata; historical context unknown.'}</span></p>
    </DetailsSection>
    <DetailsSection title="Incident context">
      <div className="ddp-context">
        <DetailsField label="Incident" value={<AnalysisValue value={data.fire_id == null ? null : `INC-${data.fire_id}`} />} />
        <DetailsField label="Address" value={<AnalysisValue value={data.location} />} />
        <DetailsField label="Record kind" value={<AnalysisValue value={readable(data.record_kind)} />} />
        <DetailsField label="Assignment" value={data.reinforcement ? 'Later reinforcement' : 'Initial dispatch'} />
      </div>
      {onOpenIncident && data.incident_record && <button type="button" className="ddp-button" onClick={() => onOpenIncident(data.incident_record)}>Open incident register details<AnalysisIcon name="chevron" /></button>}
    </DetailsSection>
    <DetailsSection title="Timing reference">
      <p className="ddp-note"><AnalysisIcon name="info" /><span>All timestamps in Philippine time (UTC+8). Mobile action times reflect server receipt.</span></p>
    </DetailsSection>
  </div>
  return <main className="dispatch-details-page" aria-label={`Dispatch details for DISP-${id}`}>
    <DetailsLayout onBack={onBack} backLabel={backLabel} aside={aside}>
      <section className="idp-hero idp-hero-fire" aria-label="Dispatch overview">
        <div className="idp-hero-top"><div className="idp-hero-left">
          <div className="idp-hero-icon idp-tile-fire"><AnalysisIcon name="handling" className="idp-hero-svg" /></div>
          <div className="idp-hero-text">
            <div className="idp-eyebrow">DISPATCH REVIEW</div>
            <h1 ref={headingRef} tabIndex={-1} className="idp-title">Dispatch Details</h1>
            <div className="ddp-record-code">DISP-{id}</div>
            {data && <div className="idp-chips"><span className={`idp-pill idp-tone-${STATUS_TONES[data.status] || 'muted'}`}><AnalysisValue value={readable(data.status)} /></span>{data.reinforcement && <span className="idp-pill idp-tone-amber">Later reinforcement</span>}</div>}
          </div>
        </div></div>
        {data && <div className="idp-stats rt-personal-metrics">{MEASURES.filter(metric => metric.key !== 'acknowledgement').map(metric => <KpiCard key={metric.key} icon={<AnalysisIcon name={metric.icon} />} label={metric.label} value={duration(data.metrics?.[metric.key]?.seconds, KPI_EMPTY)} sub={metric.sub} accent="muted" />)}</div>}
      </section>
      {error && <div className="ddp-error" role="alert"><AnalysisIcon name="info" /><span>{error}</span><button type="button" className="ddp-button" onClick={onRetry}>Retry</button></div>}
      {!data && !error && <SettingsLoading message="Loading dispatch history…" compact />}
      {data && <>
        <DetailsSection title="Responder Route History"><ResponderRouteHistory key={`${data.fire_id}:${id}`} fireId={data.fire_id} initialDispatchId={id} theme={theme} vehicleUnits={data.incident?.units} /></DetailsSection>
        <DetailsSection title="Dispatch timing">
          <div className="ddp-panel-heading"><span className="ddp-section-icon"><AnalysisIcon name="response" /></span><div><h2>Dispatch milestones and intervals</h2><p>Review recorded timestamps, response durations and measurement quality.</p></div></div>
          <div className="ddp-timing-grid">
            <section className="ddp-timing-panel" aria-label="Dispatch milestones"><h3>Recorded milestones</h3>
              <dl className="ddp-milestones">{milestones.map(([label, at]) => <div key={label} data-recorded={Boolean(at)}><dt><i aria-hidden="true" />{label}</dt><dd>{at ? <time dateTime={at}>{dateTime(at)}</time> : <AnalysisValue value={null} />}</dd></div>)}</dl>
              <div className="ddp-actors"><DetailsField label="Acknowledgement actor" value={data.acknowledged_by || 'Unknown'} /><DetailsField label="Departure actor" value={data.departed_by || 'Unknown'} /></div>
            </section>
            <section className="ddp-timing-panel" aria-label="Response intervals"><h3>Response intervals</h3>
              <div className="ddp-table-scroll"><table><thead><tr><th scope="col">Measure</th><th scope="col">Duration</th><th scope="col">Data quality</th></tr></thead><tbody>{MEASURES.map(metric => {
                const measurement = data.metrics?.[metric.key]
                return <tr key={metric.key}><th scope="row">{metric.label}</th><td><AnalysisValue value={duration(measurement?.seconds)} /></td><td><span className="ddp-quality" data-quality={measurement?.quality || 'unknown'}><AnalysisValue value={readable(measurement?.quality)} /></span>{measurement?.reason && <small>{measurement.reason.replaceAll('_', ' ')}</small>}</td></tr>
              })}</tbody></table></div>
            </section>
          </div>
        </DetailsSection>
        <DetailsSection title="Generated Route History"><DispatchRouteHistory key={id} data={data} theme={theme} pageLayout /></DetailsSection>
      </>}
    </DetailsLayout>
  </main>
}
