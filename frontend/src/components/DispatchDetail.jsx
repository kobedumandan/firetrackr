import { useEffect, useState } from 'react'
import AppModal from './AppModal'
import ResponderRouteHistory from './ResponderRouteHistory'
import DispatchRouteHistory from './DispatchRouteHistory'
import { fetchResponseDispatch } from '../api'
import { dateTime, duration } from '../utils/operationalTimes'
import '../styles/ResponsePerformance.css'

const MEASURES = { response: 'After dispatch', handling: 'Dispatch handling', acknowledgement: 'Acknowledgement', turnout: 'Turnout', travel: 'Travel' }
export default function DispatchDetail({ id, theme, onClose, onOpenIncident }) {
  const [result, setResult] = useState(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetchResponseDispatch(id, controller.signal).then(data => setResult({ data }), err => { if (err.name !== 'AbortError') setResult({ error: err.message }) })
    return () => controller.abort()
  }, [id, retry])
  const data = result?.data
  return <AppModal title={`Dispatch #${id}`} subtitle={data ? `${data.context.team_name || 'Unknown team'} · INC-${data.fire_id}` : 'Loading dispatch…'} onClose={onClose} width={1100} className="rp-dialog" manageFocus>
    {result?.error && <p role="alert">{result.error} <button onClick={() => setRetry(n => n + 1)}>Retry</button></p>}
    {!result && <p role="status">Loading dispatch history…</p>}
    {data && <div className="rp-detail"><p>{data.location} · {data.record_kind} · {data.status}{data.reinforcement ? ' · Later reinforcement' : ''}</p>
      {onOpenIncident && data.incident_record && <button onClick={() => onOpenIncident(data.incident_record)}>Open incident register details</button>}
      <p>Station: {data.context.station_name || 'Unknown'} · Shift: {data.context.shift_name || 'Unknown'} · Truck: {data.context.truck || 'Unknown'} · Context: {data.context.provenance === 'assignment' ? 'Preserved at assignment' : 'Current metadata; historical context unknown'}</p>
      <dl>{[['Report received', data.report_received_at], ['Dispatched', data.dispatch_at], ['Acknowledged', data.acknowledged_at], ['Departed', data.departed_at], ['Arrived', data.arrived_at]].map(([label, at]) => <div key={label}><dt>{label}</dt><dd>{dateTime(at)}</dd></div>)}</dl>
      <p>Acknowledgement actor: {data.acknowledged_by || 'Unknown'} · Departure actor: {data.departed_by || 'Unknown'}. Mobile action times reflect server receipt.</p>
      <div className="rp-scroll"><table><thead><tr><th>Measure</th><th>Duration</th><th>Data quality</th></tr></thead><tbody>{Object.entries(MEASURES).map(([key, label]) => <tr key={key}><td>{label}</td><td>{duration(data.metrics[key].seconds)}</td><td>{data.metrics[key].reason?.replaceAll('_', ' ') || 'Valid'}</td></tr>)}</tbody></table></div>
      <ResponderRouteHistory fireId={data.fire_id} initialDispatchId={id} theme={theme} />
      <DispatchRouteHistory data={data} theme={theme} />
    </div>}
  </AppModal>
}
