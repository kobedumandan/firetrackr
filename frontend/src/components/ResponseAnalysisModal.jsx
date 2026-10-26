import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import AppModal from './AppModal'
import { Field } from './incidentForm'
import { confirmDispatchClearance, confirmOperationalMilestone, fetchOperationalDetail } from '../api'
import { MAP_CENTER, tileLayersFor } from '../data/mapConfig'
import { STAGES, dateTime, duration, manilaInput, parseRouteWkt } from '../utils/operationalTimes'

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
  const points = useMemo(() => [data.location, unit?.station_location, ...routes.flatMap(r => r.points)].filter(p => p?.every(Number.isFinite)), [data, unit, routes])
  return <div className="ota-map-wrap"><MapContainer center={MAP_CENTER} zoom={12} className="ota-map" scrollWheelZoom>
    {tileLayersFor(theme === 'light' ? 'street' : 'dark').map(layer => <TileLayer key={layer.url} {...layer} />)}
    <FitResponse points={points} />
    {routes.toSorted((a, b) => Number(a.route_id === unit.selected_route_id) - Number(b.route_id === unit.selected_route_id)).map(r => <Polyline key={r.route_id} positions={r.points} pathOptions={{ color: r.route_id === unit.selected_route_id && stage === 'travel' ? '#ff4d1a' : '#81878d', weight: r.route_id === unit.selected_route_id ? 5 : 3, opacity: r.route_id === unit.selected_route_id ? .95 : .45 }}><Tooltip>Route {r.rank} · {duration(r.eta_seconds)} · planned</Tooltip></Polyline>)}
    {(unit?.gps_segments || []).map((path, i) => <Polyline key={i} positions={path} pathOptions={{ color: '#f9c989', weight: 3, dashArray: '5 6' }}><Tooltip>Recorded vehicle GPS samples</Tooltip></Polyline>)}
    <CircleMarker center={data.location} radius={9} pathOptions={{ color: '#ff4d1a', fillOpacity: .85 }}><Tooltip permanent>Incident</Tooltip></CircleMarker>
    {unit?.station_location && <CircleMarker center={unit.station_location} radius={8} pathOptions={{ color: '#e8edf2', fillOpacity: .7 }}><Tooltip>Station · {unit.station}</Tooltip></CircleMarker>}
  </MapContainer><p className="ota-note">{unit?.baseline_available ? 'Routes preserved at departure.' : 'Current planned routes; original departure selection unavailable.'} {unit?.gps_segments.length ? 'Dashed line: recorded GPS samples; gaps are not joined.' : 'No reliable historical GPS path. Planned routes do not prove the path driven.'}</p></div>
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
  const [stage, setStage] = useState('travel')
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
  const unit = data?.units.find(u => u.id === unitId) || data?.units.find(u => u.id === data.first_unit_id) || data?.units[0]
  const selectedRoute = unit?.routes.find(r => r.route_id === unit.selected_route_id)
  const demo = data?.timing_basis === 'synthetic_demo'
  const timeline = demo ? data.synthetic_timeline : null
  const pairs = data ? {
    processing: [['Report received', timeline?.report_received_at || data.reported_at], ['Unit dispatched', timeline?.dispatch_at || unit?.dispatch_at]],
    preparation: [['Unit dispatched', timeline?.dispatch_at || unit?.dispatch_at], ['Truck departed', timeline?.departed_at || unit?.departed_at]],
    travel: [['Truck departed', timeline?.departed_at || unit?.departed_at], ['Truck arrived', timeline?.arrived_at || unit?.arrived_at]],
    suppression: [['Suppression started', timeline?.suppression_started_at || data.suppression_started_at], ['Fire controlled', data.controlled_at], ['Fire out', timeline?.fire_out_at || data.fire_out_at]],
  } : {}
  const sourceKinds = { processing: ['op_receipt'], preparation: ['op_departure'], travel: ['op_departure', 'op_arrival'], suppression: ['op_suppression_start', 'op_fire_out'] }
  return <AppModal title={`Response Analysis · INC-${fireId}`} subtitle={data ? `${data.response_kind || 'Unclassified'} · ${data.barangay || 'Barangay unknown'} · ${data.status}` : 'Loading incident details…'} width={1240} className="ota-dialog" onClose={onClose} manageFocus>
    {error && <div className="ota-error" role="alert">{error} <button onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
    {!data && !error && <div className="ota-empty" role="status">Loading response analysis…</div>}
    {demo && <p className="m-data-note">Synthesized demonstration timeline · {data.source_record_id}. The source workbook records a date, not response timestamps. No real truck, crew or driven route is assigned to this simulation.</p>}
    {data?.location_specification && <p className="ota-note">{data.location_specification.label}: {data.location_specification.specification}</p>}
    {data && <><p className="ota-note">Overall operation: {duration(data.durations.operation)} · Report received {dateTime(data.reported_at)} → all units cleared {dateTime(data.operation_completed_at)}</p><div className="ota-modal-meta"><span>Report: {dateTime(data.reported_at)} · {data.address || 'Address unavailable'}</span><span>Station: {unit?.station || 'No assigned station'}</span>
      {data.units.length > 0 ? <label>Responding unit <select value={unit?.id || ''} onChange={e => setUnitId(Number(e.target.value))}>{data.units.map(u => <option key={u.id} value={u.id}>{u.truck} · {u.team} · dispatch #{u.dispatch_id}</option>)}</select></label> : <span>No truck assigned</span>}
      <span>Incident call-to-arrival: <strong>{duration(data.durations.cta)}</strong> · first valid arrival</span>
      {onOpenDispatch && !demo && <div className="ro-dispatch-links">{(data.dispatches || []).map(dispatch => <button key={dispatch.dispatch_id} onClick={() => onOpenDispatch(dispatch.dispatch_id)}>Dispatch #{dispatch.dispatch_id} · {dispatch.team || 'Unknown team'} · {dispatch.status}</button>)}</div>}
    </div><div className="ota-modal-layout"><ResponseMap data={data} unit={unit} stage={stage} theme={theme} />
      <div className="ota-details"><div className="ota-stages" role="group" aria-label="Operational stage">{STAGES.map(s => <button key={s.key} className={s.key === stage ? 'active' : ''} aria-pressed={s.key === stage} onClick={() => setStage(s.key)}><span>{s.label}</span><strong>{s.key === 'suppression' && data.response_kind && data.response_kind !== 'fire' ? 'N/A' : duration(demo || s.key === 'suppression' ? data.durations[s.key] : unit?.durations[s.key])}</strong></button>)}</div>
        {unit?.metrics?.[stage]?.reason && <p className="ota-note">Measurement quality: {unit.metrics[stage].reason.replaceAll('_', ' ')}. Original timestamps remain visible below.</p>}
        <dl>{pairs[stage].map(([label, at]) => <div key={label}><dt>{label}</dt><dd>{dateTime(at)}</dd></div>)}</dl>
        {['processing', 'preparation'].includes(stage) && unit?.dispatch_at && <p className="ota-note">Dispatch time source: the unit’s existing dispatch record.</p>}
        {stage === 'travel' && unit?.arrival_source === 'legacy_single_truck_dispatch' && <p className="ota-note">Arrival source: existing dispatch arrival record, with exactly one truck assigned.</p>}
        <div className="ota-sources">{data.events.filter(e => sourceKinds[stage].includes(e.type) && (!e.unit_id || e.unit_id === unit?.id)).map((e, i) => <p key={i}>{e.type.replace('op_', '').replaceAll('_', ' ')}: {e.source || 'Unknown source'} · {e.actor || 'System'} · {e.verified ? 'Verified' : 'Unverified'}<small>Received {dateTime(e.received_at)}</small></p>)}</div>
        {stage === 'travel' && !demo && <section className="ota-comparison"><h3>Travel Time vs. Selected Route ETA</h3><dl>{[['Selected route', unit?.baseline_available && selectedRoute ? `Route ${selectedRoute.rank}` : 'Original selection unavailable'], ['Estimated travel', duration(unit?.eta_seconds)], ['Actual travel', duration(unit?.durations.travel)], ['Difference', unit?.difference_seconds == null ? 'No data' : `${unit.difference_seconds >= 0 ? '+' : '−'}${duration(unit.difference_seconds)}`], ['Deviation', unit?.error_percent == null ? 'No data' : `${unit.error_percent >= 0 ? '+' : ''}${unit.error_percent.toFixed(1)}%`]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {unit?.difference_seconds != null && <p>Actual travel {unit.difference_seconds === 0 ? 'matched the selected route’s predicted duration.' : `took ${duration(unit.difference_seconds)} ${unit.difference_seconds > 0 ? 'longer' : 'less'} than the selected route’s predicted duration.`}</p>}
          <p className="ota-note">Unit report-to-arrival: {duration(unit?.durations.cta)}. ETA is a prediction; actual travel uses departure and arrival timestamps.</p>
          {unit?.eta_comparison_note && <p className="ota-note">{unit.eta_comparison_note}</p>}
        </section>}
        {!demo && <MilestoneForm key={`${data.fire_id}:${unit?.id}:${data.response_kind}`} data={data} unit={unit} onSaved={setData} />}
      </div>
    </div></>}
  </AppModal>
}
