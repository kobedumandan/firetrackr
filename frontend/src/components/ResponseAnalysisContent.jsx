import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import '../styles/OperationalTimePage.css'
import ResponderRouteHistory from './ResponderRouteHistory'
import AnalysisIcon from './AnalysisIcon'
import AnalysisValue from './AnalysisValue'
import MilestoneConfirmationFields from './MilestoneConfirmationFields'
import KpiCard, { KPI_EMPTY } from './KpiCard'
import SettingsLoading from './SettingsLoading'
import { Field } from './incidentForm'
import { DetailsSection } from '../layout/DetailsLayout'
import { confirmDispatchClearance, confirmOperationalMilestone, correctOperationalMilestone, fetchOperationalDetail } from '../api'
import { MAP_CENTER, tileLayersFor } from '../data/mapConfig'
import { STAGES, dateTime, duration, manilaInput, parseRouteWkt } from '../utils/operationalTimes'
import { incidentControl, incidentStatusLabel, isFireOperation } from '../utils/incidentOperations'
import '../styles/ResponseAnalysisModal.css'

function TimingSeparator({ pageLayout }) {
  return pageLayout ? <span className="ram-separator" aria-hidden="true">|</span> : '·'
}

function OperationsSection({ pageLayout, title, children }) {
  const content = <section className={`ram-operations${pageLayout ? ' ota-dialog ram-dialog' : ''}`} aria-label="Unit operational metrics">{children}</section>
  return pageLayout ? <section className="dl-section">
    <div className="dl-section-head"><div className="dl-section-title">{title}</div></div>
    {content}
  </section> : content
}

function TravelInsights({ unit, pageLayout }) {
  const content = <>
    {unit?.difference_seconds != null && <p>Actual travel {unit.difference_seconds === 0 ? 'matched the selected route’s predicted duration.' : `took ${duration(unit.difference_seconds)} ${unit.difference_seconds > 0 ? 'longer' : 'less'} than the selected route’s predicted duration.`}</p>}
    <p className="ota-note">Unit report-to-arrival: <AnalysisValue value={duration(unit?.durations.cta)} />. ETA is a prediction; actual travel uses departure and arrival timestamps.</p>
    {unit?.eta_comparison_note && <p className="ota-note">{unit.eta_comparison_note}</p>}
  </>
  return pageLayout ? <section className="ram-travel-insights" aria-label="Travel insights">
    <h4><AnalysisIcon name="info" />Insights</h4>
    {content}
  </section> : content
}

function FitResponse({ points }) {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
    if (points.length) map.fitBounds(points, { padding: [35, 35], maxZoom: 16, animate: false })
    const observer = new ResizeObserver(() => map.invalidateSize())
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map, points])
  return null
}

function ResponseMap({ data, unit, stage, theme, pageLayout }) {
  const routes = useMemo(() => (unit?.routes || []).map(r => ({ ...r, points: parseRouteWkt(r.wkt) })).filter(r => r.points.length), [unit])
  const points = useMemo(() => [data.location, unit?.station_location, ...routes.flatMap(r => r.points), ...(unit?.gps_segments || []).flat()].filter(p => p?.every(Number.isFinite)), [data, unit, routes])
  return <div className="ota-map-wrap"><MapContainer center={MAP_CENTER} zoom={12} className="ota-map" scrollWheelZoom>
    {tileLayersFor(theme === 'light' ? 'street' : 'dark').map(layer => <TileLayer key={layer.url} {...layer} />)}
    <FitResponse points={points} />
    {routes.toSorted((a, b) => Number(a.route_id === unit.selected_route_id) - Number(b.route_id === unit.selected_route_id)).map(r => <Polyline key={r.route_id} positions={r.points} pathOptions={{ color: r.route_id === unit.selected_route_id && stage === 'travel' ? '#ff4d1a' : '#81878d', weight: r.route_id === unit.selected_route_id ? 5 : 3, opacity: r.route_id === unit.selected_route_id ? .95 : .45 }}><Tooltip>Route {r.rank} <TimingSeparator pageLayout={pageLayout} /> {pageLayout ? <AnalysisValue value={duration(r.eta_seconds)} /> : duration(r.eta_seconds)} <TimingSeparator pageLayout={pageLayout} /> planned</Tooltip></Polyline>)}
    {(unit?.gps_segments || []).map((path, i) => <Polyline key={i} positions={path} pathOptions={{ color: '#f9c989', weight: 3, dashArray: '5 6' }}><Tooltip>Recorded vehicle GPS samples</Tooltip></Polyline>)}
    {data.location?.every(Number.isFinite) && <CircleMarker center={data.location} radius={9} pathOptions={{ color: '#ff4d1a', fillOpacity: .85 }}><Tooltip permanent>Incident</Tooltip></CircleMarker>}
    {unit?.station_location && <CircleMarker center={unit.station_location} radius={8} pathOptions={{ color: '#e8edf2', fillOpacity: .7 }}><Tooltip>Station · {unit.station}</Tooltip></CircleMarker>}
  </MapContainer><p className="ota-note">{unit?.baseline_available ? 'Routes preserved at departure.' : 'Current planned routes; original departure selection unavailable.'} {unit?.gps_segments?.length ? 'Dashed line: recorded vehicle GPS samples; gaps are not joined.' : 'No reliable historical vehicle GPS path. Planned routes do not prove the path driven.'}</p></div>
}

const MILESTONES = {
  receipt: 'Report received', departure: 'Truck departed', arrival: 'Truck arrived',
  suppression_start: 'Suppression started', fire_out: 'Fire out', classification: 'Response classification',
  clearance: 'Dispatch cleared', operation_complete: 'Operation complete / all units cleared',
}

function milestoneTimestamp(data, unit, kind, dispatchId) {
  if (kind === 'departure') return unit?.departed_at || null
  if (kind === 'arrival') return unit?.arrived_at || null
  if (kind === 'clearance') return data.dispatches?.find(item => String(item.dispatch_id) === dispatchId)?.cleared_at || null
  if (kind === 'classification') return [...(data.events || [])].reverse().find(event => event.type === 'op_classification' && event.verified)?.at || null
  return data[{ receipt: 'reported_at', suppression_start: 'suppression_started_at', fire_out: 'fire_out_at', operation_complete: 'operation_completed_at' }[kind]] || null
}

const recordedInput = value => value ? manilaInput(new Date(value)) : ''
const sameInputTime = (left, right) => left === right || Boolean(left && right && new Date(`${left}+08:00`).getTime() === new Date(`${right}+08:00`).getTime())

export function MilestoneForm({ data, unit, onSaved, pageLayout, selectedDispatchId }) {
  const [kind, setKind] = useState('receipt')
  const [draft, setDraft] = useState(null)
  const [classificationDraft, setClassificationDraft] = useState('')
  const [clearanceReason, setClearanceReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [dispatchId, setDispatchId] = useState(() => selectedDispatchId == null ? '' : String(selectedDispatchId))
  const scopeKey = `${data.fire_id}:${kind}:${['departure', 'arrival'].includes(kind) ? unit?.id : kind === 'clearance' ? dispatchId : 'incident'}`
  const currentAt = milestoneTimestamp(data, unit, kind, dispatchId)
  const activeDraft = draft?.scopeKey === scopeKey ? draft : null
  const originalAt = activeDraft ? activeDraft.originalAt : currentAt
  const at = activeDraft ? activeDraft.at : recordedInput(currentAt)
  const changed = originalAt ? !sameInputTime(at, recordedInput(originalAt)) : Boolean(at)
  const responseKind = data.effective_response_kind || data.response_kind || classificationDraft
  const fireOperation = isFireOperation({ ...data, response_kind: responseKind })
  const milestones = Object.fromEntries(Object.entries(MILESTONES).filter(([key]) =>
    fireOperation || !['suppression_start', 'fire_out'].includes(key)))
  function changeTime(value) {
    setDraft(sameInputTime(value, recordedInput(currentAt)) ? null : { scopeKey, at: value, originalAt })
    setSaved(null); setError(null)
  }
  function changeKind(value) {
    setKind(value); setDraft(null); setSaved(null); setError(null)
  }
  function changeClassification(value) {
    setClassificationDraft(value)
    if (['suppression_start', 'fire_out'].includes(kind) && !isFireOperation({ ...data, response_kind: value })) {
      changeKind('receipt')
    }
  }
  function changeDispatch(value) {
    setDispatchId(value); setDraft(null); setSaved(null); setError(null)
  }
  function keepRecordedTime() {
    setDraft(null); setSaved(null); setError(null)
  }
  async function save(e) {
    e.preventDefault()
    if (originalAt && !changed) return
    setBusy(true); setError(null); setSaved(null)
    try {
      const body = { kind, occurred_at: new Date(`${at}+08:00`).toISOString(), dispatch_truck_id: ['departure', 'arrival'].includes(kind) ? unit?.id : null,
        ...(originalAt ? { previous_occurred_at: originalAt, dispatch_id: kind === 'clearance' ? Number(dispatchId) : null } : { response_kind: data.response_kind ? null : responseKind || null }) }
      const signature = JSON.stringify({ ...body, action: originalAt ? 'correct' : 'confirm', dispatch_id: kind === 'clearance' ? dispatchId : null })
      const key = submission?.signature === signature ? submission.key : crypto.randomUUID()
      setSubmission({ signature, key })
      if (originalAt) onSaved(await correctOperationalMilestone(data.fire_id, { ...body, idempotency_key: key }))
      else if (kind === 'clearance') {
        await confirmDispatchClearance(Number(dispatchId), { occurred_at: body.occurred_at, idempotency_key: key, reason: clearanceReason.trim() })
        onSaved(await fetchOperationalDetail(data.fire_id))
      } else onSaved(await confirmOperationalMilestone(data.fire_id, { ...body, idempotency_key: key }))
      setDraft(null)
      setSaved(originalAt ? 'Milestone timestamp updated.' : 'Milestone confirmed.')
    }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  const guidance = <p className="ota-note">Times use Philippine time. Keep the saved time or record an audited correction. Actual clearance starts truck return; operation completion advances the incident's operational stage.</p>
  const classificationField = <Field label="Response classification"><select value={responseKind} onChange={e => changeClassification(e.target.value)} disabled={!!data.response_kind}><option value="">Unknown</option>{['fire', 'medical', 'rescue', 'other'].map(v => <option key={v}>{v}</option>)}</select></Field>
  const actions = <>
    <button type="button" onClick={() => changeTime(manilaInput())}>Happened now</button>
    <button type="submit" disabled={busy || !at || (Boolean(originalAt) && !changed)}>{busy ? 'Saving…' : originalAt ? 'Save timestamp' : 'Confirm milestone'}</button>
  </>
  return <details className={`ota-confirm${pageLayout ? ' rar-disclosure' : ''}`}><summary className={pageLayout ? 'rp-section-heading rar-section-heading' : undefined}>{pageLayout ? <>
    <div className="rar-section-heading-copy"><span className="rar-section-heading-icon"><AnalysisIcon name="acknowledgement" /></span><div><h3>Confirm a Verified Operational Milestone</h3><p>Record a verified occurrence time</p></div></div>
    <AnalysisIcon name="chevron" className="rar-chevron" />
  </> : 'Confirm a verified operational milestone'}</summary>
    {!pageLayout && guidance}
    <form onSubmit={save} onChange={() => { setSaved(null); setError(null) }} aria-busy={busy}>
      {kind === 'clearance' && !originalAt && <Field label="Radio source / clearance reason"><input required maxLength={255} value={clearanceReason} onChange={event => setClearanceReason(event.target.value)} placeholder="Who confirmed the team is physically clear?" /></Field>}
      {pageLayout ? <MilestoneConfirmationFields data={data} unit={unit} milestones={milestones} kind={kind} at={at} recordedAt={originalAt} changed={changed} responseKind={responseKind} dispatchId={dispatchId} busy={busy} error={error} saved={saved} onKindChange={changeKind} onTimeChange={changeTime} onClassificationChange={changeClassification} onDispatchChange={changeDispatch} onNow={() => changeTime(manilaInput())} onKeepRecorded={keepRecordedTime} /> : <>
      <Field label="Milestone"><select value={kind} onChange={e => changeKind(e.target.value)}>{Object.entries(milestones).map(([key, label]) => <option key={key} value={key} disabled={['departure', 'arrival'].includes(key) && !unit}>{label}</option>)}</select></Field>
      {kind === 'clearance' && <Field label="Responding dispatch"><select required value={dispatchId} onChange={e => changeDispatch(e.target.value)}><option value="">Select a dispatch</option>{(data.dispatches || []).map(d => <option key={d.dispatch_id} value={d.dispatch_id}>{d.team || `Dispatch ${d.dispatch_id}`} · {d.cleared_at ? 'Clearance recorded' : d.status}</option>)}</select></Field>}
      {classificationField}
      <Field label={<>Verified occurrence <TimingSeparator /> Philippine time</>}><input type="datetime-local" step="1" required value={at} onChange={e => changeTime(e.target.value)} /></Field>
      {actions}
      {error && <p className="ota-error" role="alert">{error}</p>}
      </>}
    </form>
  </details>
}

export default function ResponseAnalysisContent({ fireId, detail, error, onRetry, onSaved, theme, onOpenDispatch, pageLayout = false }) {
  const [unitId, setUnitId] = useState(null)
  const [dispatchId, setDispatchId] = useState(null)
  const [stage, setStage] = useState('travel')
  const [vehicleContext, setVehicleContext] = useState(false)
  const unit = detail?.units.find(u => u.id === unitId) || (dispatchId != null ? detail?.units.find(u => u.dispatch_id === dispatchId) : detail?.units.find(u => u.id === detail.first_unit_id) || detail?.units[0])
  const selectedRoute = unit?.routes.find(r => r.route_id === unit.selected_route_id)
  const demo = detail?.timing_basis === 'synthetic_demo'
  const timeline = demo ? detail.synthetic_timeline : null
  const fireOperation = isFireOperation(detail)
  const pairs = detail ? {
    processing: [['Report received', timeline?.report_received_at || detail.reported_at], ['Unit dispatched', timeline?.dispatch_at || unit?.dispatch_at]],
    preparation: [['Unit dispatched', timeline?.dispatch_at || unit?.dispatch_at], ['Truck departed', timeline?.departed_at || unit?.departed_at]],
    travel: [['Truck departed', timeline?.departed_at || unit?.departed_at], ['Truck arrived', timeline?.arrived_at || unit?.arrived_at]],
    suppression: fireOperation ? [['Suppression started', timeline?.suppression_started_at || detail.suppression_started_at], [incidentControl(detail).label, detail.controlled_at], ['Fire out', timeline?.fire_out_at || detail.fire_out_at]] : [],
  } : {}
  const sourceKinds = { processing: ['op_receipt'], preparation: ['op_departure'], travel: ['op_departure', 'op_arrival'], suppression: ['op_suppression_start', 'op_fire_control', 'op_fire_out'] }
  const stageEvents = stage === 'suppression' && !fireOperation ? [] : detail?.events.filter(e => sourceKinds[stage].includes(e.type) && (!e.unit_id || e.unit_id === unit?.id)) || []
  function selectDispatch(dispatchId) {
    const next = detail.units.find(u => u.dispatch_id === dispatchId)
    setDispatchId(dispatchId)
    setUnitId(next?.id ?? null)
  }
  return <div className="ram-body">
    {error && <div className="ram-notice ota-error" role="alert"><AnalysisIcon name="info" /><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></div>}
    {!detail && !error && <SettingsLoading message="Loading response analysis…" compact />}
    {demo && <p className="ram-notice">Synthesized demonstration timeline · {detail.source_record_id}. The source workbook records a date, not response timestamps. No real truck, crew or driven route is assigned to this simulation.</p>}
    {detail && <>
      {!pageLayout && <section className="ram-overview" aria-label="Incident overview">
        <div className="ram-incident"><span className="ram-eyebrow">INCIDENT LOCATION</span><h2>{detail.address || 'Address unavailable'}</h2><p>Report received <time><AnalysisValue value={dateTime(detail.reported_at)} /></time></p><span className="ram-status"><i />{incidentStatusLabel(detail.status, detail)}</span></div>
        <div className="ram-overview-metric"><AnalysisIcon name="response" /><span>Call-to-arrival</span><strong><AnalysisValue value={duration(detail.durations.cta)} /></strong><small>First valid unit arrival</small></div>
        <div className="ram-overview-metric"><AnalysisIcon name="handling" /><span>Overall operation</span><strong><AnalysisValue value={duration(detail.durations.operation)} /></strong><small>All units cleared: <AnalysisValue value={dateTime(detail.operation_completed_at)} /></small></div>
      </section>}
      {detail.location_specification && <p className="ota-note ram-location-note">{detail.location_specification.label}: {detail.location_specification.specification}</p>}
      {!demo && (pageLayout ? <DetailsSection title="Responder Route History"><ResponderRouteHistory fireId={fireId} theme={theme} onSelectDispatch={selectDispatch} vehicleUnits={detail.units} /></DetailsSection> : <section className="ram-routes" aria-label="Personnel route analysis"><ResponderRouteHistory fireId={fireId} theme={theme} onSelectDispatch={selectDispatch} /></section>)}
      <OperationsSection pageLayout={pageLayout} title={demo ? 'DEMONSTRATION TIMING' : 'VEHICLE & INCIDENT TIMING'}>
        <div className={`ram-section-heading${pageLayout ? ' rt-heading' : ''}`}><div>{!pageLayout && <span className="ram-eyebrow">{demo ? 'DEMONSTRATION TIMING' : 'VEHICLE & INCIDENT TIMING'}</span>}<h3>Response timeline</h3><p>{pageLayout ? demo ? 'Review simulated milestones and response durations.' : 'Review recorded milestones and response durations.' : unit ? <>{unit.team || 'Unknown team'} <TimingSeparator /> {unit.truck} <TimingSeparator /> {unit.station || 'No assigned station'}</> : 'No truck assigned'}</p></div>{!pageLayout && unit && <span className="ram-context-label">Unit metrics <TimingSeparator /> separate from personal GPS</span>}</div>
        {detail.units.length > 1 && <div className="ram-unit-buttons" role="group" aria-label="Responding unit">{detail.units.map(u => <button type="button" key={u.id} aria-pressed={u.id === unit?.id} onClick={() => setUnitId(u.id)}>{u.truck} <TimingSeparator pageLayout={pageLayout} /> {u.team}</button>)}</div>}
        <div className={`ota-stages ram-stages${pageLayout ? ' rt-personal-metrics' : ''}`} role="group" aria-label="Operational stage">{STAGES.map((s, index) => <button type="button" key={s.key} className={`${pageLayout ? 'kpi-card ' : ''}${s.key === stage ? 'active' : ''}`} aria-pressed={s.key === stage} onClick={() => setStage(s.key)}>
          {pageLayout ? <span className="kpi-card-head"><span className="kpi-card-label">{s.label}</span><span className="kpi-card-icon kpi-card-icon-muted"><AnalysisIcon name={s.key} /></span></span> : <span className="ram-stage-label"><AnalysisIcon name={s.key} /><span>{s.label}</span><small>0{index + 1}</small></span>}
          <strong className={pageLayout ? 'kpi-card-value' : undefined}><AnalysisValue value={s.key === 'suppression' && !fireOperation ? 'N/A' : duration(demo || s.key === 'suppression' ? detail.durations[s.key] : unit?.durations[s.key])} /></strong>
          <span className={`ram-stage-scope${pageLayout ? ' kpi-card-sub' : ''}`}>{s.key === 'suppression' ? 'Incident-wide' : demo ? 'Simulated' : 'Selected unit'}</span>
        </button>)}</div>
        {pageLayout && unit && <p className="ram-context-label ota-chart-note"><AnalysisIcon name="info" /><span>Unit metrics <TimingSeparator pageLayout /> separate from personal GPS</span></p>}
        <div className="ram-timing-grid">
          <section className="ram-timestamps">
            {pageLayout ? <div className="ram-evidence-heading"><span className="ram-evidence-icon"><AnalysisIcon name={stage} /></span><div><h4>{STAGES.find(s => s.key === stage).label} milestones</h4><p>Philippine time (UTC+8)</p></div></div> : <h4>{STAGES.find(s => s.key === stage).label} milestones <span>Philippine time</span></h4>}
            {stage === 'suppression' && !fireOperation && <p className="ota-note">Suppression timing applies only to fire responses.</p>}
            <dl className={pageLayout ? 'ram-milestones' : undefined}>{pairs[stage].map(([label, at]) => <div key={label} data-recorded={pageLayout ? Boolean(at) : undefined}><dt><i aria-hidden="true" />{label}</dt><dd>{pageLayout && at ? <time dateTime={at}>{dateTime(at)}</time> : <AnalysisValue value={dateTime(at)} />}</dd></div>)}</dl>
            {unit?.metrics?.[stage]?.reason && <p className="ota-note">Measurement quality: {unit.metrics[stage].reason.replaceAll('_', ' ')}. Original timestamps remain visible above.</p>}
            {['processing', 'preparation'].includes(stage) && unit?.dispatch_at && <p className="ota-note">Dispatch time source: the unit’s existing dispatch record.</p>}
            {stage === 'travel' && unit?.arrival_source === 'legacy_single_truck_dispatch' && <p className="ota-note">Arrival source: existing dispatch arrival record, with exactly one truck assigned.</p>}
            <div className="ota-sources">{pageLayout && stageEvents.length > 0 && <h5>Recorded evidence</h5>}{stageEvents.map((e, i) => <p key={i}>{e.type.replace('op_', '').replaceAll('_', ' ')}: {e.source || 'Unknown source'} <TimingSeparator pageLayout={pageLayout} /> {e.actor || 'System'} <TimingSeparator pageLayout={pageLayout} /> {e.verified ? 'Verified' : 'Unverified'}<small>Received <AnalysisValue value={dateTime(e.received_at)} /></small></p>)}</div>
          </section>
          {stage === 'travel' && !demo && <section className="ota-comparison">
            {pageLayout ? <div className="ram-evidence-heading"><span className="ram-evidence-icon"><AnalysisIcon name="route" /></span><div><h3>Travel Time vs. Selected Route ETA</h3><p>Selected unit comparison</p></div></div> : <h3>Travel Time vs. Selected Route ETA</h3>}
            {pageLayout && <div className="ram-travel-kpis rt-personal-metrics">
              <KpiCard icon={<AnalysisIcon name="route" />} label="Estimated travel" value={duration(unit?.eta_seconds, KPI_EMPTY)} sub="Selected route estimate" accent="muted" />
              <KpiCard icon={<AnalysisIcon name="travel" />} label="Actual travel" value={duration(unit?.durations.travel, KPI_EMPTY)} sub="Departure to arrival" accent="muted" />
            </div>}
            <dl className={pageLayout ? 'ram-comparison-details' : undefined}>{[['Selected route', unit?.baseline_available && selectedRoute ? `Route ${selectedRoute.rank}` : 'Original selection unavailable'], ...(!pageLayout ? [['Estimated travel', duration(unit?.eta_seconds)], ['Actual travel', duration(unit?.durations.travel)]] : []), ['Difference', unit?.difference_seconds == null ? 'No data' : `${unit.difference_seconds >= 0 ? '+' : '−'}${duration(unit.difference_seconds)}`], ['Deviation', unit?.error_percent == null ? 'No data' : `${unit.error_percent >= 0 ? '+' : ''}${unit.error_percent.toFixed(1)}%`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><AnalysisValue value={value} /></dd></div>)}</dl>
            <TravelInsights unit={unit} pageLayout={pageLayout} />
          </section>}
        </div>
        {!demo && !pageLayout && <details className="rt-vehicle-context" open={vehicleContext} onToggle={e => setVehicleContext(e.currentTarget.open)}><summary>Vehicle GPS and planned route context</summary>{vehicleContext && <ResponseMap data={detail} unit={unit} stage={stage} theme={theme} />}</details>}
        {!demo && <MilestoneForm key={`${detail.fire_id}:${unit?.id}:${detail.response_kind}`} data={detail} unit={unit} onSaved={onSaved} pageLayout={pageLayout} />}
        {onOpenDispatch && !demo && detail.dispatches?.length > 0 && <div className="ram-dispatch-links"><span>Dispatch records</span>{detail.dispatches.map(dispatch => <button type="button" key={dispatch.dispatch_id} onClick={() => onOpenDispatch(dispatch.dispatch_id)}>#{dispatch.dispatch_id} <TimingSeparator pageLayout={pageLayout} /> {dispatch.team || 'Unknown team'}<AnalysisIcon name="chevron" /></button>)}</div>}
      </OperationsSection>
    </>}
    </div>
}
