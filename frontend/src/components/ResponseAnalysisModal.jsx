import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import '../styles/OperationalTimePage.css'
import AppModal from './AppModal'
import ResponderRouteHistory from './ResponderRouteHistory'
import AnalysisIcon from './AnalysisIcon'
import SettingsLoading from './SettingsLoading'
import { Field } from './incidentForm'
import { confirmDispatchClearance, confirmOperationalMilestone, fetchOperationalDetail } from '../api'
import { MAP_CENTER, tileLayersFor } from '../data/mapConfig'
import { STAGES, dateTime, duration, manilaInput, parseRouteWkt } from '../utils/operationalTimes'
import '../styles/ResponseAnalysisModal.css'

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

function ResponseMap({ data, unit, stage, theme }) {
  const routes = useMemo(() => (unit?.routes || []).map(r => ({ ...r, points: parseRouteWkt(r.wkt) })).filter(r => r.points.length), [unit])
  const points = useMemo(() => [data.location, unit?.station_location, ...routes.flatMap(r => r.points), ...(unit?.gps_segments || []).flat()].filter(p => p?.every(Number.isFinite)), [data, unit, routes])
  return <div className="ota-map-wrap"><MapContainer center={MAP_CENTER} zoom={12} className="ota-map" scrollWheelZoom>
    {tileLayersFor(theme === 'light' ? 'street' : 'dark').map(layer => <TileLayer key={layer.url} {...layer} />)}
    <FitResponse points={points} />
    {routes.toSorted((a, b) => Number(a.route_id === unit.selected_route_id) - Number(b.route_id === unit.selected_route_id)).map(r => <Polyline key={r.route_id} positions={r.points} pathOptions={{ color: r.route_id === unit.selected_route_id && stage === 'travel' ? '#ff4d1a' : '#81878d', weight: r.route_id === unit.selected_route_id ? 5 : 3, opacity: r.route_id === unit.selected_route_id ? .95 : .45 }}><Tooltip>Route {r.rank} · {duration(r.eta_seconds)} · planned</Tooltip></Polyline>)}
    {(unit?.gps_segments || []).map((path, i) => <Polyline key={i} positions={path} pathOptions={{ color: '#f9c989', weight: 3, dashArray: '5 6' }}><Tooltip>Recorded vehicle GPS samples</Tooltip></Polyline>)}
    {data.location?.every(Number.isFinite) && <CircleMarker center={data.location} radius={9} pathOptions={{ color: '#ff4d1a', fillOpacity: .85 }}><Tooltip permanent>Incident</Tooltip></CircleMarker>}
    {unit?.station_location && <CircleMarker center={unit.station_location} radius={8} pathOptions={{ color: '#e8edf2', fillOpacity: .7 }}><Tooltip>Station · {unit.station}</Tooltip></CircleMarker>}
  </MapContainer><p className="ota-note">{unit?.baseline_available ? 'Routes preserved at departure.' : 'Current planned routes; original departure selection unavailable.'} {unit?.gps_segments?.length ? 'Dashed line: recorded vehicle GPS samples; gaps are not joined.' : 'No reliable historical vehicle GPS path. Planned routes do not prove the path driven.'}</p></div>
}

function MilestoneForm({ data, unit, onSaved }) {
  const [kind, setKind] = useState('receipt')
  const [at, setAt] = useState('')
  const [responseKind, setResponseKind] = useState(data.response_kind || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [submission, setSubmission] = useState(null)
  const [dispatchId, setDispatchId] = useState('')
  async function save(e) {
    e.preventDefault(); setBusy(true); setError(null)
    try {
      const body = { kind, occurred_at: new Date(`${at}+08:00`).toISOString(), response_kind: responseKind || null, dispatch_truck_id: ['departure', 'arrival'].includes(kind) ? unit?.id : null }
      const signature = JSON.stringify({ ...body, dispatch_id: kind === 'clearance' ? dispatchId : null })
      const key = submission?.signature === signature ? submission.key : crypto.randomUUID()
      setSubmission({ signature, key })
      if (kind === 'clearance') {
        await confirmDispatchClearance(Number(dispatchId), { occurred_at: body.occurred_at, idempotency_key: key })
        onSaved(await fetchOperationalDetail(data.fire_id))
      } else onSaved(await confirmOperationalMilestone(data.fire_id, { ...body, idempotency_key: key }))
      setAt('')
    }
    catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  return <details className="ota-confirm"><summary>Confirm a verified operational milestone</summary>
    <p className="ota-note">Use a verified occurrence time. Recorded milestones are preserved and cannot be overwritten here. Confirmations do not change dispatch or incident status.</p>
    <form onSubmit={save}>
      <Field label="Milestone"><select value={kind} onChange={e => setKind(e.target.value)}>{Object.entries({ receipt: 'Report received', departure: 'Truck departed', arrival: 'Truck arrived', suppression_start: 'Suppression started', fire_out: 'Fire out', classification: 'Response classification', clearance: 'Dispatch cleared', operation_complete: 'Operation complete / all units cleared' }).map(([key, label]) => <option key={key} value={key} disabled={['departure', 'arrival'].includes(key) && !unit}>{label}</option>)}</select></Field>
      {kind === 'clearance' && <Field label="Responding dispatch"><select required value={dispatchId} onChange={e => setDispatchId(e.target.value)}><option value="">Select a dispatch</option>{(data.dispatches || []).map(d => <option key={d.dispatch_id} value={d.dispatch_id} disabled={!!d.cleared_at}>{d.team || `Dispatch ${d.dispatch_id}`} · {d.cleared_at ? 'Clearance recorded' : d.status}</option>)}</select></Field>}
      <Field label="Response classification"><select value={responseKind} onChange={e => setResponseKind(e.target.value)} disabled={!!data.response_kind}><option value="">Unknown</option>{['fire', 'medical', 'rescue', 'other'].map(v => <option key={v}>{v}</option>)}</select></Field>
      <Field label="Verified occurrence · Philippine time"><input type="datetime-local" step="1" required value={at} onChange={e => setAt(e.target.value)} /></Field>
      <button type="button" onClick={() => setAt(manilaInput())}>Happened now</button> <button type="submit" disabled={busy || !at}>{busy ? 'Saving…' : 'Confirm milestone'}</button>
      {error && <p className="ota-error" role="alert">{error}</p>}
    </form>
  </details>
}

export default function ResponseAnalysisModal({ fireId, theme, onClose, onOpenDispatch }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [retry, setRetry] = useState(0)
  const [unitId, setUnitId] = useState(null)
  const [dispatchId, setDispatchId] = useState(null)
  const [stage, setStage] = useState('travel')
  const [vehicleContext, setVehicleContext] = useState(false)
  useEffect(() => {
    const refresh = () => setRetry(n => n + 1)
    window.addEventListener('operational-times-updated', refresh)
    return () => window.removeEventListener('operational-times-updated', refresh)
  }, [])
  useEffect(() => {
    let alive = true
    fetchOperationalDetail(fireId).then(value => { if (alive) { setData(value); setError(null) } }, err => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [fireId, retry])
  const detail = data?.fire_id === fireId ? data : null
  const unit = detail?.units.find(u => u.id === unitId) || (dispatchId != null ? detail?.units.find(u => u.dispatch_id === dispatchId) : detail?.units.find(u => u.id === detail.first_unit_id) || detail?.units[0])
  const selectedRoute = unit?.routes.find(r => r.route_id === unit.selected_route_id)
  const demo = detail?.timing_basis === 'synthetic_demo'
  const timeline = demo ? detail.synthetic_timeline : null
  const pairs = detail ? {
    processing: [['Report received', timeline?.report_received_at || detail.reported_at], ['Unit dispatched', timeline?.dispatch_at || unit?.dispatch_at]],
    preparation: [['Unit dispatched', timeline?.dispatch_at || unit?.dispatch_at], ['Truck departed', timeline?.departed_at || unit?.departed_at]],
    travel: [['Truck departed', timeline?.departed_at || unit?.departed_at], ['Truck arrived', timeline?.arrived_at || unit?.arrived_at]],
    suppression: [['Suppression started', timeline?.suppression_started_at || detail.suppression_started_at], ['Fire contained', detail.controlled_at], ['Fire out', timeline?.fire_out_at || detail.fire_out_at]],
  } : {}
  const sourceKinds = { processing: ['op_receipt'], preparation: ['op_departure'], travel: ['op_departure', 'op_arrival'], suppression: ['op_suppression_start', 'op_fire_control', 'op_fire_out'] }
  function selectDispatch(dispatchId) {
    const next = detail.units.find(u => u.dispatch_id === dispatchId)
    setDispatchId(dispatchId)
    setUnitId(next?.id ?? null)
  }
  return <AppModal eyebrow={`INCIDENT REVIEW / INC-${fireId}`} title="Response Analysis" subtitle={detail ? `${detail.barangay || 'Barangay unknown'} · ${detail.response_kind || 'Unclassified response'}` : 'Routes, response timing and operational evidence'} width={1280} className="ota-dialog ram-dialog" onClose={onClose} manageFocus>
    <div className="ram-body">
    {error && <div className="ram-notice ota-error" role="alert"><AnalysisIcon name="info" /><span>{error}</span><button type="button" onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
    {!detail && !error && <SettingsLoading message="Loading response analysis…" compact />}
    {demo && <p className="ram-notice">Synthesized demonstration timeline · {detail.source_record_id}. The source workbook records a date, not response timestamps. No real truck, crew or driven route is assigned to this simulation.</p>}
    {detail && <>
      <section className="ram-overview" aria-label="Incident overview">
        <div className="ram-incident"><span className="ram-eyebrow">INCIDENT LOCATION</span><h2>{detail.address || 'Address unavailable'}</h2><p>Report received <time>{dateTime(detail.reported_at)}</time></p><span className="ram-status"><i />{detail.status || 'Status unknown'}</span></div>
        <div className="ram-overview-metric"><AnalysisIcon name="response" /><span>Call-to-arrival</span><strong>{duration(detail.durations.cta)}</strong><small>First valid unit arrival</small></div>
        <div className="ram-overview-metric"><AnalysisIcon name="handling" /><span>Overall operation</span><strong>{duration(detail.durations.operation)}</strong><small>All units cleared: {dateTime(detail.operation_completed_at)}</small></div>
      </section>
      {detail.location_specification && <p className="ota-note ram-location-note">{detail.location_specification.label}: {detail.location_specification.specification}</p>}
      {!demo && <section className="ram-routes" aria-label="Personnel route analysis"><ResponderRouteHistory fireId={fireId} theme={theme} onSelectDispatch={selectDispatch} /></section>}
      <section className="ram-operations" aria-label="Unit operational metrics">
        <div className="ram-section-heading"><div><span className="ram-eyebrow">{demo ? 'DEMONSTRATION TIMING' : 'VEHICLE & INCIDENT TIMING'}</span><h3>Response timeline</h3><p>{unit ? `${unit.team || 'Unknown team'} · ${unit.truck} · ${unit.station || 'No assigned station'}` : 'No truck assigned'}</p></div>{unit && <span className="ram-context-label">Unit metrics · separate from personal GPS</span>}</div>
        {detail.units.length > 1 && <div className="ram-unit-buttons" role="group" aria-label="Responding unit">{detail.units.map(u => <button type="button" key={u.id} aria-pressed={u.id === unit?.id} onClick={() => setUnitId(u.id)}>{u.truck} · {u.team}</button>)}</div>}
        <div className="ota-stages ram-stages" role="group" aria-label="Operational stage">{STAGES.map((s, index) => <button type="button" key={s.key} className={s.key === stage ? 'active' : ''} aria-pressed={s.key === stage} onClick={() => setStage(s.key)}><span className="ram-stage-label"><AnalysisIcon name={s.key} /><span>{s.label}</span><small>0{index + 1}</small></span><strong>{s.key === 'suppression' && detail.response_kind && detail.response_kind !== 'fire' ? 'N/A' : duration(demo || s.key === 'suppression' ? detail.durations[s.key] : unit?.durations[s.key])}</strong><span className="ram-stage-scope">{s.key === 'suppression' ? 'Incident-wide' : demo ? 'Simulated' : 'Selected unit'}</span></button>)}</div>
        <div className="ram-timing-grid">
          <section className="ram-timestamps"><h4>{STAGES.find(s => s.key === stage).label} milestones <span>Philippine time</span></h4>
            <dl>{pairs[stage].map(([label, at]) => <div key={label}><dt><i />{label}</dt><dd>{dateTime(at)}</dd></div>)}</dl>
            {unit?.metrics?.[stage]?.reason && <p className="ota-note">Measurement quality: {unit.metrics[stage].reason.replaceAll('_', ' ')}. Original timestamps remain visible above.</p>}
            {['processing', 'preparation'].includes(stage) && unit?.dispatch_at && <p className="ota-note">Dispatch time source: the unit’s existing dispatch record.</p>}
            {stage === 'travel' && unit?.arrival_source === 'legacy_single_truck_dispatch' && <p className="ota-note">Arrival source: existing dispatch arrival record, with exactly one truck assigned.</p>}
            <div className="ota-sources">{detail.events.filter(e => sourceKinds[stage].includes(e.type) && (!e.unit_id || e.unit_id === unit?.id)).map((e, i) => <p key={i}>{e.type.replace('op_', '').replaceAll('_', ' ')}: {e.source || 'Unknown source'} · {e.actor || 'System'} · {e.verified ? 'Verified' : 'Unverified'}<small>Received {dateTime(e.received_at)}</small></p>)}</div>
          </section>
          {stage === 'travel' && !demo && <section className="ota-comparison"><h3>Travel Time vs. Selected Route ETA</h3><dl>{[['Selected route', unit?.baseline_available && selectedRoute ? `Route ${selectedRoute.rank}` : 'Original selection unavailable'], ['Estimated travel', duration(unit?.eta_seconds)], ['Actual travel', duration(unit?.durations.travel)], ['Difference', unit?.difference_seconds == null ? 'No data' : `${unit.difference_seconds >= 0 ? '+' : '−'}${duration(unit.difference_seconds)}`], ['Deviation', unit?.error_percent == null ? 'No data' : `${unit.error_percent >= 0 ? '+' : ''}${unit.error_percent.toFixed(1)}%`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            {unit?.difference_seconds != null && <p>Actual travel {unit.difference_seconds === 0 ? 'matched the selected route’s predicted duration.' : `took ${duration(unit.difference_seconds)} ${unit.difference_seconds > 0 ? 'longer' : 'less'} than the selected route’s predicted duration.`}</p>}
            <p className="ota-note">Unit report-to-arrival: {duration(unit?.durations.cta)}. ETA is a prediction; actual travel uses departure and arrival timestamps.</p>
            {unit?.eta_comparison_note && <p className="ota-note">{unit.eta_comparison_note}</p>}
          </section>}
        </div>
        {!demo && <details className="rt-vehicle-context" open={vehicleContext} onToggle={e => setVehicleContext(e.currentTarget.open)}><summary>Vehicle GPS and planned route context</summary>{vehicleContext && <ResponseMap data={detail} unit={unit} stage={stage} theme={theme} />}</details>}
        {!demo && <MilestoneForm key={`${detail.fire_id}:${unit?.id}:${detail.response_kind}`} data={detail} unit={unit} onSaved={setData} />}
        {onOpenDispatch && !demo && detail.dispatches?.length > 0 && <div className="ram-dispatch-links"><span>Dispatch records</span>{detail.dispatches.map(dispatch => <button type="button" key={dispatch.dispatch_id} onClick={() => onOpenDispatch(dispatch.dispatch_id)}>#{dispatch.dispatch_id} · {dispatch.team || 'Unknown team'}<AnalysisIcon name="chevron" /></button>)}</div>}
      </section>
    </>}
    </div>
    <div className="eim-footer ram-footer"><span><AnalysisIcon name="info" />All timestamps in Philippine time (UTC+8)</span><button type="button" className="apm-btn-cancel" onClick={onClose}>Close analysis</button></div>
  </AppModal>
}
