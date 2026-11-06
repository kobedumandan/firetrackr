import { useId, useState } from 'react'
import AnalysisIcon from './AnalysisIcon'
import AnalysisValue from './AnalysisValue'
import AnalysisDateTime from './AnalysisDateTime'
import DispatchEvidenceContent from './DispatchEvidenceContent'
import KpiCard, { KPI_EMPTY } from './KpiCard'
import ResponderRouteHistory from './ResponderRouteHistory'
import SettingsLoading from './SettingsLoading'
import { MilestoneForm } from './ResponseAnalysisContent'
import { dateTime, duration } from '../utils/operationalTimes'

const readable = value => value ? String(value).replaceAll('_', ' ').replace(/^./, first => first.toUpperCase()) : null
const EVIDENCE_TYPES = {
  op_receipt: ['Report received', 'handling'],
  op_departure: ['Truck departed', 'turnout'],
  op_arrival: ['Truck arrived', 'travel'],
  op_suppression_start: ['Suppression started', 'suppression'],
  op_fire_control: ['Fire contained', 'suppression'],
  op_fire_out: ['Fire out', 'suppression'],
  op_operation_complete: ['Operation completed', 'acknowledgement'],
  op_clearance: ['Dispatch cleared', 'acknowledgement'],
  op_classification: ['Response classified', 'handling'],
}

export function ResponseMilestones({ milestones }) {
  return <ol className="rar-milestones">{milestones.map(([label, at]) => <li key={label} data-recorded={Boolean(at)}>
    <span className="rar-milestone-marker" aria-hidden="true" /><span>{label}</span>
    <AnalysisDateTime value={at} />
  </li>)}</ol>
}

export function ResponseEvidenceEvents({ events }) {
  if (!events.length) return null
  return <section className="rar-event-list" aria-label="Recorded evidence">
    <div className="rar-evidence-heading"><div><h3>Recorded evidence</h3><p>Who recorded each milestone and when.</p></div><span className="rar-evidence-count">{events.length} {events.length === 1 ? 'record' : 'records'}</span></div>
    <ol className="rar-evidence-feed">{events.map((event, index) => {
      const [label, icon] = EVIDENCE_TYPES[event.type] || [readable(event.type.replace('op_', '')), 'handling']
      return <li key={index} className="rar-evidence-event">
        <span className="rar-evidence-icon"><AnalysisIcon name={icon} /></span>
        <div className="rar-evidence-content">
          <div className="rar-evidence-title"><h4>{label}</h4><span className="rar-verification" data-verified={Boolean(event.verified)}><AnalysisIcon name={event.verified ? 'acknowledgement' : 'info'} />{event.verified ? 'Verified' : 'Unverified'}</span></div>
          <div className="rar-evidence-origin"><span className="rar-evidence-actor"><span>By</span><strong>{event.actor || 'Unknown actor'}</strong></span><span className="rar-evidence-source">{readable(event.source) || 'Unknown source'}</span></div>
        </div>
        <dl className="rar-evidence-times">
          <div><dt>Occurred</dt><dd><AnalysisDateTime value={event.at} /></dd></div>
          <div><dt>Received</dt><dd><AnalysisDateTime value={event.received_at} /></dd></div>
          {event.correction?.previous_at && <div className="rar-evidence-previous"><dt>Previous occurrence</dt><dd><AnalysisDateTime value={event.correction.previous_at} /></dd></div>}
        </dl>
      </li>
    })}</ol>
  </section>
}

export default function DispatchResponseReview({ fireId, detail, dispatch, data, error, onRetry, onSaved, theme }) {
  const truckFieldId = useId()
  const [unitId, setUnitId] = useState(null)
  const units = (detail.units || []).filter(unit => unit.dispatch_id === dispatch.dispatch_id)
  const unit = units.find(item => item.id === unitId) || units.find(item => item.id === detail.first_unit_id) || units[0]
  const context = data?.context || {}
  const route = unit?.routes?.find(item => item.route_id === unit.selected_route_id)
  const unitEvents = (detail.events || []).filter(event => event.unit_id === unit?.id && ['op_departure', 'op_arrival'].includes(event.type))
  const milestones = data ? [
    ['Report received', data.report_received_at], ['Dispatched', data.dispatch_at],
    ['Acknowledged', data.acknowledged_at], ['Departed', data.departed_at], ['Arrived', data.arrived_at],
  ] : []
  const fields = [
    ['Team', context.team_name || dispatch.team], ['Station', context.station_name || unit?.station],
    ['Shift', context.shift_name], ['Assignment', data ? data.reinforcement ? 'Later reinforcement' : 'Initial dispatch' : null],
  ]

  return <div className="rar-dispatch-review" aria-label={`Dispatch response for DISP-${dispatch.dispatch_id}`}>
    <div className="rar-assignment">
      <div className="rar-dispatch-code"><AnalysisIcon name="coverage" /><span>DISP-{dispatch.dispatch_id}</span><span className="rar-dispatch-status">{readable(data?.status || dispatch.status) || 'Status unknown'}</span></div>
      <dl className="rar-context">{fields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd><AnalysisValue value={value} /></dd></div>)}</dl>
    </div>
    {error && <div className="rar-notice rar-error" role="alert"><AnalysisIcon name="info" /><span>{error}</span><button type="button" onClick={onRetry}>Retry dispatch evidence</button></div>}

    <div className="rar-response-grid">
      <section className="rar-panel rar-dispatch-timing" aria-label="Dispatch timing">
        <div className="rar-panel-heading"><div><h3>Dispatch Timeline</h3><p>Recorded assignment milestones</p></div>{data && <div className="rar-dispatch-total"><strong><AnalysisValue value={duration(data.metrics?.response?.seconds)} /></strong><span>Dispatch to arrival</span></div>}</div>
        {!data && !error && <SettingsLoading message="Loading dispatch evidence…" compact />}
        {data && <>
          <ResponseMilestones milestones={milestones} />
          <dl className="rar-intervals">{[['handling', 'Handling'], ['turnout', 'Turnout'], ['travel', 'Travel']].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><AnalysisValue value={duration(data.metrics?.[key]?.seconds)} /></dd></div>)}</dl>
        </>}
        {!data && error && <p className="rar-note">Dispatch timestamps are unavailable. Truck timing and responder routes can still be reviewed below.</p>}
      </section>

      <section className="rar-panel rar-travel" aria-label="Vehicle travel comparison">
        <div className="rar-panel-heading"><div className="rar-section-heading-copy"><span className="rar-section-heading-icon"><AnalysisIcon name="route" /></span><div><h3>Travel vs. Route Estimate</h3><p>Vehicle timing for the selected assignment</p></div></div></div>
        {unit ? <>
          <div className="rar-travel-kpis">
            <KpiCard label="Actual Travel" value={duration(unit.durations?.travel, KPI_EMPTY)} sub="Departure to arrival" accent="muted" />
            <KpiCard label="Estimated Travel" value={duration(unit.eta_seconds, KPI_EMPTY)} sub="Saved selected route" accent="muted" />
          </div>
          {unit.difference_seconds != null ? <div className="rar-travel-insight-panel">
            <p className="rar-travel-insight ota-chart-note"><span className="rar-travel-insight-icon"><AnalysisIcon name="chart" /></span><span>{unit.difference_seconds === 0 ? 'Actual travel matched the route estimate.' : <>Actual travel took <strong>{duration(Math.abs(unit.difference_seconds))} {unit.difference_seconds > 0 ? 'longer' : 'less'}</strong> than estimated.</>}{unit.error_percent != null && <small>{Math.abs(unit.error_percent).toFixed(1)}% {unit.error_percent >= 0 ? 'above' : 'below'} the estimate</small>}</span></p>
          </div> : <p className="rar-travel-insight ota-chart-note"><AnalysisIcon name="info" /><span>A comparison needs recorded departure, arrival and a saved route estimate.</span></p>}
          <dl className="rar-route-facts">
            <div className="rar-truck-field"><dt>{units.length > 1 ? <label htmlFor={truckFieldId}>Responding truck</label> : 'Responding truck'}</dt><dd>
              {units.length > 1 ? <select id={truckFieldId} value={unit.id} onChange={event => setUnitId(Number(event.target.value))}>{units.map(item => <option key={item.id} value={item.id}>{item.truck || `Truck ${item.id}`}</option>)}</select> : <strong>{unit.truck || 'Truck unknown'}</strong>}
            </dd></div>
            <div><dt>Departure</dt><dd><AnalysisValue value={dateTime(unit.departed_at)} /></dd></div>
            <div><dt>Arrival</dt><dd><AnalysisValue value={dateTime(unit.arrived_at)} /></dd></div>
            <div><dt>Selected route</dt><dd>{unit.baseline_available && route ? `Route ${route.rank}` : 'Original selection unavailable'}</dd></div>
          </dl>
          {unit.eta_comparison_note && <p className="rar-note">{unit.eta_comparison_note}</p>}
          {unit.metrics?.travel?.reason && <p className="rar-note">Measurement quality: {readable(unit.metrics.travel.reason)}. Recorded timestamps remain visible.</p>}
        </> : <div className="rar-empty rar-empty-inline"><AnalysisIcon name="travel" /><h4>No truck timing recorded</h4><p>This dispatch has no assigned vehicle evidence. Incident and dispatch milestones remain available.</p></div>}
      </section>
    </div>

    <section className="rar-panel rar-route-panel" aria-label="Responder route history">
      <ResponderRouteHistory fireId={fireId} dispatchId={dispatch.dispatch_id} theme={theme} vehicleUnits={units} />
    </section>

    <section className="rar-supporting" aria-label="Supporting evidence">
      <div className="rar-supporting-heading"><h2>Supporting evidence</h2><p>Assignment records, measurement quality and verified milestones.</p></div>
      <details className="rar-disclosure rar-dispatch-evidence">
        <summary className="rp-section-heading rar-section-heading"><div className="rar-section-heading-copy"><span className="rar-section-heading-icon"><AnalysisIcon name="handling" /></span><div><h3>Dispatch Evidence &amp; Data Quality</h3><p>Attribution and interval checks</p></div></div><AnalysisIcon name="chevron" className="rar-chevron" /></summary>
        <div className="rar-disclosure-body">
          {data ? <DispatchEvidenceContent data={data} unit={unit}><ResponseEvidenceEvents events={unitEvents} /></DispatchEvidenceContent> : <p className="rar-note">{error ? 'Retry dispatch evidence to load assignment records and interval quality.' : 'Loading dispatch evidence…'}</p>}
        </div>
      </details>
      <MilestoneForm key={`${dispatch.dispatch_id}:${unit?.id}:${detail.response_kind}`} data={detail} unit={unit} selectedDispatchId={dispatch.dispatch_id} onSaved={onSaved} pageLayout />
    </section>
  </div>
}
