import { useEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import AppModal from './AppModal'
import CsvReviewModal from './CsvReviewModal'
import KpiCard, { KPI_EMPTY } from './KpiCard'
import PerformanceIcon from './AnalysisIcon'
import { fetchResponsePerformance, fetchResponseDispatches, fetchResponseDispatch, exportResponsePerformance, fetchResponseOperations, fetchResponseIncidents, exportResponseIncidents } from '../api'
import { STAGES, dateTime, duration, parseRouteWkt } from '../utils/operationalTimes'
import ResponseAnalysisModal from './ResponseAnalysisModal'
import ResponderRouteHistory from './ResponderRouteHistory'
import OperationalTrendChart from './OperationalTrendChart'
import { MAP_CENTER, tileLayersFor } from '../data/mapConfig'
import '../styles/ResponsePerformance.css'
import '../styles/OperationalTimePage.css'
import '../styles/ResponseOperations.css'

const COLORS = ['#ed8059', '#55b4ad', '#81a4e8', '#c49bd3', '#c7aa62', '#c98697']
const MEASURES = { response: 'After dispatch', handling: 'Dispatch handling', acknowledgement: 'Acknowledgement', turnout: 'Turnout', travel: 'Travel' }
function TeamFilter({ teams, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const pickerRef = useRef(null)
  const triggerRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const outside = event => { if (!pickerRef.current?.contains(event.target)) setOpen(false) }
    const escape = event => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const label = selected.length === 0 ? 'All teams' : selected.length === 1 ? teams.find(t => String(t.id) === selected[0])?.name || '1 team selected' : `${selected.length} teams selected`
  return <div className="rp-team-field" ref={pickerRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <span id="rp-teams-label" className="rp-field-label">Teams</span>
    <button ref={triggerRef} type="button" className="rp-team-trigger" aria-labelledby="rp-teams-label rp-teams-value" aria-expanded={open} aria-controls="rp-team-options" onClick={() => setOpen(value => !value)}>
      <span id="rp-teams-value">{label}</span><PerformanceIcon name="chevron" />
    </button>
    {open && <div className="rp-team-options" id="rp-team-options" role="group" aria-label="Select teams">
      <p>Choose teams to compare</p>
      <label><input type="checkbox" checked={!selected.length} onChange={() => onChange([])} />All teams</label>
      {teams.map(team => <label key={team.id}><input type="checkbox" checked={selected.includes(String(team.id))} onChange={event => onChange(event.target.checked ? [...selected, String(team.id)] : selected.filter(id => id !== String(team.id)))} />{team.name}</label>)}
      {!teams.length && <small>No teams in this date range.</small>}
    </div>}
  </div>
}

function initialDates() {
  const now = new Date(Date.now() + 8 * 3600000)
  return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 10),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10) }
}

function queryFor(filters) {
  const demo = filters.source === 'demo'
  const query = new URLSearchParams({ end: `${filters.end}T00:00:00+08:00`, record_kind: demo ? 'all' : filters.kind })
  if (filters.period === 'all') query.set('all_dates', 'true')
  else query.set('start', `${filters.start}T00:00:00+08:00`)
  if (demo) { query.set('source', 'demo'); return query.toString() }
  filters.teams.forEach(id => query.append('team_id', id))
  for (const [key, value] of Object.entries({ station_id: filters.station, barangay_id: filters.barangay, severity: filters.severity })) if (value) query.set(key, value)
  return query.toString()
}

function Quality({ stat, compact = false }) {
  if (!stat) return null
  const body = <>
    {!compact && <div className="rp-quality-heading"><strong>{stat.valid}/{stat.candidate} valid</strong><span>observations</span></div>}
    <meter className="rp-quality-meter" min="0" max={stat.candidate || 1} value={stat.valid} aria-label="Valid observations" />
    <div className="rp-distribution"><span>Median <strong>{duration(stat.median_seconds)}</strong></span><span title="90th percentile, nearest rank">p90 <strong>{duration(stat.p90_seconds)}</strong></span></div>
    <div className="rp-quality-counts">{['pending', 'missing', 'invalid', 'excluded'].map(kind => <span key={kind} data-present={stat[kind] > 0}>{stat[kind]} {kind}</span>)}</div>
    {stat.small_sample && <span className="rp-sample-note">Fewer than 10 observations</span>}
    {Object.keys(stat.reasons || {}).length > 0 && <details className="rp-disclosure"><summary>Data quality details</summary><ul>{Object.entries(stat.reasons).map(([reason, count]) => <li key={reason}>{reason.replaceAll('_', ' ')}: {count}</li>)}</ul></details>}
  </>
  return compact ? <details className="rp-quality ro-quality-compact"><summary><strong>{stat.valid}/{stat.candidate} valid</strong><span>Statistics<PerformanceIcon name="chevron" /></span></summary><div className="ro-quality-body">{body}</div></details> : <div className="rp-quality">{body}</div>
}

function TeamTrend({ monthly, onMonth, selectedMonth, loading }) {
  const teams = monthly[0]?.teams || []
  const hasValues = monthly.some(month => month.teams.some(team => team.mean_seconds != null))
  const highest = Math.max(60, ...monthly.flatMap(m => m.teams.map(t => t.mean_seconds || 0))) * 1.15
  const x = i => 50 + i * 850 / Math.max(1, monthly.length - 1)
  const y = v => 175 - v / highest * 145
  return <section className="rp-card rp-trends"><div className="rp-section-heading"><div><h2>Monthly team response after dispatch</h2><p>Mean time from dispatch to arrival. Select a month to inspect its dispatches.</p></div><span className="rp-tag">Minutes · PHT</span></div>
    {loading ? <div className="rp-chart-skeleton kpi-sk" aria-hidden="true" /> : hasValues ? <div className="rp-chart"><svg viewBox="0 0 950 215" role="img" aria-label="Monthly mean response by team">
      {[0, .25, .5, .75, 1].map(f => <g key={f}><line x1="50" x2="900" y1={y(highest * f)} y2={y(highest * f)} stroke="currentColor" opacity=".15" strokeDasharray="3 5" /><text x="38" y={y(highest * f) + 4} textAnchor="end">{(highest * f / 60).toFixed(1)}</text></g>)}
      {teams.map((team, ti) => {
        const segments = []; let segment = []
        monthly.forEach((month, i) => { const value = month.teams.find(t => t.team_id === team.team_id)?.mean_seconds
          if (value == null) { if (segment.length) segments.push(segment); segment = [] } else segment.push(`${x(i)},${y(value)}`)
        }); if (segment.length) segments.push(segment)
        return <g key={team.team_id}>{segments.map((s, i) => <polyline key={i} points={s.join(' ')} fill="none" stroke={COLORS[ti % COLORS.length]} strokeWidth="2" />)}
          {monthly.map((month, i) => { const stat = month.teams.find(t => t.team_id === team.team_id)
            return stat?.mean_seconds == null ? null : <circle key={month.month} cx={x(i)} cy={y(stat.mean_seconds)} r="5" fill={COLORS[ti % COLORS.length]}><title>{team.team_name}: {duration(stat.mean_seconds)} · n={stat.valid} · {month.month}</title></circle>
          })}</g>
      })}
      {monthly.map((month, i) => i % Math.max(1, Math.ceil(monthly.length / 12)) === 0 && <text key={month.month} x={x(i)} y="204" textAnchor="middle">{month.month}</text>)}
    </svg></div> : <div className="rp-empty rp-chart-empty"><PerformanceIcon name="chart" /><h3>No response times to chart</h3><p>Try another date range or record kind. Dispatches need a recorded arrival to appear here.</p></div>}
    <div className="rp-legend">{teams.map((t, i) => <span key={t.team_id}><i style={{ background: COLORS[i % COLORS.length] }} />{t.team_name || `Team ${t.team_id}`}</span>)}</div>
    <div className="rp-chart-footer"><details className="rp-disclosure"><summary>Chart data and sample counts</summary><div className="rp-scroll"><table><thead><tr><th>Month</th>{teams.map(t => <th key={t.team_id}>{t.team_name}</th>)}</tr></thead><tbody>{monthly.map(m => <tr key={m.month}><td><button aria-pressed={selectedMonth === m.month} onClick={() => onMonth(m.month)}>{m.month}</button></td>{m.teams.map(t => <td key={t.team_id}>{duration(t.mean_seconds)} · n={t.valid}</td>)}</tr>)}</tbody></table></div></details>
    <div className="rp-months" aria-label="Filter dispatches by month">{monthly.map(m => <button key={m.month} aria-pressed={selectedMonth === m.month} onClick={() => onMonth(m.month)}>{m.month}</button>)}</div></div>
  </section>
}

function FitRoute({ points }) {
  const map = useMap()
  useEffect(() => { map.invalidateSize(); if (points.length) map.fitBounds(points, { maxZoom: 16, padding: [30, 30], animate: false }) }, [map, points])
  return null
}

function DispatchDetail({ id, theme, onClose, onOpenIncident }) {
  const [result, setResult] = useState(null)
  const [revisionId, setRevisionId] = useState('')
  const [retry, setRetry] = useState(0)
  const [showPlans, setShowPlans] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetchResponseDispatch(id, controller.signal).then(data => setResult({ data }), err => { if (err.name !== 'AbortError') setResult({ error: err.message }) })
    return () => controller.abort()
  }, [id, retry])
  const data = result?.data
  const revision = data?.route_revisions.find(r => String(r.id) === revisionId) || data?.route_revisions[0]
  const selected = revision?.routes.find(r => r.route_id === revision.selected_route_id)
  const route = parseRouteWkt(selected?.wkt)
  const points = [...route, ...(data?.incident.location ? [data.incident.location] : [])]
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
      <details className="rt-vehicle-context" open={showPlans} onToggle={e => setShowPlans(e.currentTarget.open)}><summary>Generated route history</summary>
      <label>Planned route revision <select value={revision?.id || ''} onChange={e => setRevisionId(e.target.value)}>{data.route_revisions.map(r => <option value={r.id} key={r.id}>{dateTime(r.at)} · {r.selection_reason || 'Selection'}</option>)}</select></label>
      <p>Saved planned ETA: {duration(selected?.eta_seconds)} · Distance: {selected?.distance_meters == null ? 'Unknown' : `${(selected.distance_meters / 1000).toFixed(2)} km`} · Origin: {selected?.origin_source || 'Unknown'}. Planned geometry does not establish the route driven.</p>
      {!revision && <p>No preserved route revision exists for this legacy dispatch.</p>}
      {showPlans && <div className="rp-map"><MapContainer center={MAP_CENTER} zoom={12} style={{ height: '100%' }}>{tileLayersFor(theme === 'light' ? 'street' : 'dark').map(layer => <TileLayer key={layer.url} {...layer} />)}<FitRoute points={points} />{route.length > 1 && <Polyline positions={route} pathOptions={{ color: '#ff6c3b' }} />}{data.incident.location && <CircleMarker center={data.incident.location}><Tooltip>Incident</Tooltip></CircleMarker>}</MapContainer></div>}
      </details>
    </div>}
  </AppModal>
}

function LifecyclePanel({ data, loading, demo }) {
  const [trendMetric, setTrendMetric] = useState('all')
  const metrics = [
    { key: 'cta', label: 'Call-to-first-arrival', description: 'Report receipt → first eligible arrival' },
    ...(!demo ? [{ key: 'operation', label: 'Overall operation time', description: 'Report receipt → confirmed operation completion / all units cleared' }] : []),
  ]
  const total = STAGES.reduce((sum, stage) => sum + (data?.breakdown?.seconds[stage.key] || 0), 0)
  return <>
    <div className={`ro-overview${demo ? ' is-demo' : ''}`}>{metrics.map(({ key, label, description }) => <section className="ro-overview-card" key={key} aria-label={label}>
      <div className="ro-metric-heading"><span className="ro-metric-icon"><PerformanceIcon name={key === 'cta' ? 'response' : 'acknowledgement'} /></span><h2>{label}</h2><span className="ro-unit-label">Per incident</span></div>
      <p className="ro-metric-definition">{description}</p>
      {loading ? <span className="rp-value-skeleton kpi-sk" /> : <strong className={`rp-overall${data?.summary[key]?.mean_seconds == null ? ' is-empty' : ''}`}>{duration(data?.summary[key]?.mean_seconds)}</strong>}
      <span className="ro-mean-caption">Mean duration<span>{loading ? 'Loading measurements' : `${data?.summary[key]?.valid || 0} measured incidents`}</span></span>
      <Quality stat={data?.summary[key]} />
    </section>)}</div>
    <section className="ro-stages-panel" aria-label="Operation stages">
    <div className="rp-section-heading"><div><span className="ro-eyebrow">From report to fire out</span><h2>Where the time goes</h2></div><span className="ro-section-hint">Select a stage to explore its trend</span></div>
    <div className="rp-kpis ro-stage-kpis">{STAGES.map((stage, index) => {
      const stat = data?.summary[stage.key]
      const unit = ['preparation', 'travel'].includes(stage.key) && !demo
      return <section className={`rp-metric-card${trendMetric === stage.key ? ' is-selected' : ''}`} key={stage.key}>
        <span className="ro-stage-number">0{index + 1}</span>
        <KpiCard label={stage.key === 'processing' ? 'Report processing' : stage.label} icon={<PerformanceIcon name={stage.key} />} accent="fire" loading={loading}
          value={stat?.mean_seconds == null ? KPI_EMPTY : duration(stat.mean_seconds)}
          onClick={() => setTrendMetric(stage.key)} actionLabel={`View ${stage.label.toLowerCase()} trend`}
          sub={`${unit ? 'Per truck' : stage.key === 'suppression' ? 'Per fire incident' : 'Per incident'} · ${stage.key === 'processing' ? 'receipt → first dispatch' : stage.key === 'preparation' ? 'dispatch → departure' : stage.key === 'travel' ? 'departure → arrival' : 'suppression start → fire out'}`}
          trend={stat?.change_percent == null ? null : { dir: stat.change_percent > 0 ? 'up' : 'down', text: `${Math.abs(stat.change_percent).toFixed(1)}% vs preceding window` }} />
        <Quality stat={stat} compact />
      </section>
    })}</div>
    <p className="ro-stage-note"><PerformanceIcon name="info" />Processing and suppression count incidents; preparation and travel count {demo ? 'simulated timelines' : 'trucks'}. Each stage has its own sample.</p>
    </section>
    <div className="ro-analysis-grid">
      <OperationalTrendChart points={data?.trends || []} period={data?.trend_period || 'all'} loading={loading} demo={demo} selectedMetric={trendMetric} onMetricChange={setTrendMetric} />
      <section className="ro-distribution-panel" aria-label="Stage distribution"><div className="rp-section-heading"><div><span className="ro-eyebrow">Common incident sample</span><h2>Stage distribution</h2></div><span className="rp-count">{loading ? 'Loading…' : `n=${data?.breakdown?.count || 0}`}</span></div>
        <p>Share of the four measured intervals.</p>
        {loading ? <div className="kpi-sk ro-distribution-skeleton" /> : total > 0 ? <div className="ro-distribution-rows">{STAGES.map(stage => <div className="ro-distribution-row" key={stage.key}>
          <div><span><i style={{ background: stage.color }} />{stage.label}</span><strong>{(data.breakdown.seconds[stage.key] / total * 100).toFixed(1)}<small>%</small></strong></div>
          <div className="ro-distribution-track"><span style={{ width: `${data.breakdown.seconds[stage.key] / total * 100}%`, background: stage.color }} /></div>
          <span className="ro-distribution-duration">{duration(data.breakdown.seconds[stage.key])}</span>
        </div>)}</div> : <div className="ro-distribution-empty"><PerformanceIcon name="chart" /><strong>No complete stage sample</strong><p>All four stages need recorded endpoints.</p></div>}
        <details className="rp-method-note ro-breakdown"><summary>How this is calculated</summary><p>The first arriving truck supplies the response stages for fire incidents with all four stages available. These shares exclude arrival-to-suppression and clearance gaps. Overall operation time uses its own endpoints.</p></details>
      </section>
    </div>
  </>
}

function IncidentRecords({ query, revision, theme, onOpenDispatch, demo }) {
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  const [csv, setCsv] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [retry, setRetry] = useState(0)
  const key = `${query}:${page}:${revision}:${retry}`
  const data = result?.key === key ? result.data : null
  const error = result?.key === key ? result.error : null
  const loading = !data && !error
  useEffect(() => {
    const controller = new AbortController()
    fetchResponseIncidents(`${query}&page=${page}`, controller.signal).then(data => setResult({ key, data }), error => {
      if (error.name !== 'AbortError') setResult({ key, error: error.message })
    })
    return () => controller.abort()
  }, [query, page, key])
  async function download() {
    setExporting(true); setExportError(null)
    try { setCsv(await exportResponseIncidents(query)) }
    catch (error) { setExportError(error.message) }
    finally { setExporting(false) }
  }
  const currentPage = data?.page || page
  return <section className="rp-card rp-observations ro-incident-records" aria-label="Incident records">
    <div className="rp-section-heading"><div><div className="rp-heading-title"><span className="ro-table-icon"><PerformanceIcon name="handling" /></span><h2>Incident records</h2><span className="rp-count">{data?.total || 0}</span></div><p>Inspect milestones, responding units and route evidence for each incident.</p></div>
      <button disabled={loading || !!error || exporting} onClick={download}><PerformanceIcon name="download" />{exporting ? 'Preparing…' : 'Review incident CSV'}</button></div>
    {(error || exportError) && <p role="alert" className="rp-error">{error || exportError}{error && <button onClick={() => setRetry(n => n + 1)}>Retry incidents</button>}</p>}
    <div className="rp-scroll"><table><thead><tr>{['Incident', 'Report received · PHT', 'Location / response', 'Dispatches / trucks', 'Call-to-first-arrival', 'Suppression', 'Overall operation'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>
      {loading ? [0, 1, 2].map(n => <tr key={n} aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <td key={i}><span className="rp-cell-skeleton kpi-sk" /></td>)}</tr>) : data?.records.map(record => <tr key={record.fire_id}>
        <td><button className="rp-record-link" onClick={() => setSelected(record.fire_id)}>INC-{record.fire_id}<PerformanceIcon name="chevron" /></button><small className="ro-record-status" data-status={record.status}>{record.status || 'Unknown status'}</small></td>
        <td>{dateTime(record.synthetic_timeline?.report_received_at || record.reported_at || record.occurred_at)}{!record.reported_at && <small>{demo ? 'Synthesized receipt' : 'Occurrence date · receipt unknown'}</small>}</td>
        <td>{record.location || record.barangay || 'Location unknown'}<small>{record.response_kind || 'Unclassified'}</small></td>
        <td><span className="ro-unit-count">{record.dispatch_count} {record.dispatch_count === 1 ? 'dispatch' : 'dispatches'}<small>{record.unit_count} {record.unit_count === 1 ? 'truck' : 'trucks'}</small></span></td>
        {['cta', 'suppression', 'operation'].map(metric => <td key={metric} className={`rp-duration${record.durations[metric] == null ? ' ro-missing' : ''}`}>{metric === 'suppression' && record.response_kind && record.response_kind !== 'fire' ? 'N/A' : duration(record.durations[metric])}
          {record.metrics?.[metric]?.reason && <small>{record.metrics[metric].reason.replaceAll('_', ' ')}</small>}</td>)}
      </tr>)}
    </tbody></table></div>
    {!loading && !error && !data?.records.length && <div className="rp-empty"><h3>No incident records match these filters</h3><p>Try a wider date range or another record kind.</p></div>}
    <nav className="rp-pagination" aria-label="Incident pages"><span>{data?.total || 0} incidents · Page {currentPage} of {data?.total_pages || 1}</span><div>
      <button disabled={loading || currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous incidents</button>
      <button disabled={loading || !!error || currentPage >= (data?.total_pages || 1)} onClick={() => setPage(currentPage + 1)}>Next incidents</button>
    </div></nav>
    {selected != null && <ResponseAnalysisModal key={selected} fireId={selected} theme={theme} onClose={() => setSelected(null)} onOpenDispatch={id => { setSelected(null); onOpenDispatch(id) }} />}
    {csv != null && <CsvReviewModal csv={csv} fileName="response-operations-incidents.csv" title="Incident lifecycle CSV" onClose={() => setCsv(null)} />}
  </section>
}

export default function ResponsePerformanceView({ theme, onOpenIncident }) {
  const [filters, setFilters] = useState(() => ({ ...initialDates(), period: 'custom', source: 'recorded', kind: 'operational', teams: [], station: '', barangay: '', severity: '' }))
  const [page, setPage] = useState(1)
  const [month, setMonth] = useState('')
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [csvReview, setCsvReview] = useState(null)
  const query = queryFor(filters)
  const tableParams = new URLSearchParams(query)
  if (month) {
    const monthStart = new Date(`${month}-01T00:00:00+08:00`)
    const [year, mm] = month.split('-').map(Number)
    const monthEnd = new Date(Date.UTC(year, mm, 1) - 8 * 3600000)
    tableParams.set('start', new Date(Math.max(monthStart.getTime(), new Date(tableParams.get('start')).getTime())).toISOString())
    tableParams.set('end', new Date(Math.min(monthEnd.getTime(), new Date(tableParams.get('end')).getTime())).toISOString())
    tableParams.delete('all_dates')
  }
  const exportQuery = tableParams.toString()
  tableParams.set('page', page)
  const tableQuery = tableParams.toString()
  const key = `${query}:${tableQuery}:${revision}`
  const data = result?.key === key ? result.data : null
  const operations = result?.key === key ? result.operations : null
  const rows = result?.key === key ? result.rows : null
  const error = result?.key === key ? result.error : null
  const loading = !data && !error
  const choices = result?.data
  const currentPage = rows?.page || page
  const demo = filters.source === 'demo'
  const refinementCount = [filters.teams.length > 0, filters.station, filters.barangay, filters.severity].filter(Boolean).length
  const activeRefinements = [
    ...(filters.teams.length ? [{ key: 'teams', label: `${filters.teams.length} ${filters.teams.length === 1 ? 'team' : 'teams'}`, value: [] }] : []),
    ...(filters.station ? [{ key: 'station', label: choices?.stations?.find(s => String(s.id) === filters.station)?.name || 'Station', value: '' }] : []),
    ...(filters.barangay ? [{ key: 'barangay', label: choices?.barangays?.find(b => String(b.id) === filters.barangay)?.name || 'Barangay', value: '' }] : []),
    ...(filters.severity ? [{ key: 'severity', label: filters.severity, value: '' }] : []),
  ]
  const update = (field, value) => { setFilters(f => ({ ...f, [field]: value, ...(field === 'start' || (field === 'end' && f.period !== 'all') ? { period: 'custom' } : {}) })); setPage(1); setMonth(''); setExportError(null) }
  const setPeriod = period => {
    const dates = initialDates()
    const days = { '1d': 1, '1w': 7, '1m': 30, '6m': 182, '1y': 365 }[period]
    if (days) dates.start = new Date(new Date(`${dates.end}T00:00:00Z`).getTime() - days * 86400000).toISOString().slice(0, 10)
    setFilters(f => ({ ...f, ...(period === 'custom' ? {
      start: f.period === 'all' && operations?.start ? new Date(new Date(operations.start).getTime() + 8 * 3600000).toISOString().slice(0, 10) : f.start,
    } : dates), period })); setPage(1); setMonth('')
  }
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([demo ? Promise.resolve({}) : fetchResponsePerformance(query, controller.signal), demo ? Promise.resolve({ records: [] }) : fetchResponseDispatches(tableQuery, controller.signal), fetchResponseOperations(query, controller.signal)])
      .then(([data, rows, operations]) => setResult({ key, data, rows, operations }), err => { if (err.name !== 'AbortError') setResult({ key, error: err.message }) })
    return () => controller.abort()
  }, [query, tableQuery, revision, key, demo])
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    const foreground = () => { if (!document.hidden) refresh() }
    window.addEventListener('operational-times-updated', refresh)
    window.addEventListener('focus', foreground)
    const timer = setInterval(foreground, 60000)
    return () => { window.removeEventListener('operational-times-updated', refresh); window.removeEventListener('focus', foreground); clearInterval(timer) }
  }, [])
  async function download() {
    setExporting(true); setExportError(null)
    try {
      const blob = await exportResponsePerformance(exportQuery, { download: false })
      setCsvReview(await blob.text())
    } catch (err) { setExportError(err.message) } finally { setExporting(false) }
  }
  return <main className="rp-view" aria-busy={loading}><div className="ro-workspace">
    <header className="rp-page-heading"><div><span className="ro-eyebrow">Incident lifecycle &amp; team analysis</span><h1>Response &amp; Operations</h1><p>From the first call to the final clearance.</p></div>
      <div className="ro-heading-actions"><span className="rp-timezone"><PerformanceIcon name="response" />Asia/Manila · PHT</span><button className="rp-refresh" onClick={() => setRevision(n => n + 1)} disabled={loading}><PerformanceIcon name="refresh" />{loading ? 'Updating…' : 'Refresh'}</button></div>
    </header>
    <section className="rp-filter-panel" aria-label="Response filters">
      <div className="rp-filter-title"><span><PerformanceIcon name="filter" />Analysis window</span><button className="ro-reset-filters" onClick={() => { setFilters({ ...initialDates(), period: 'custom', source: 'recorded', kind: 'operational', teams: [], station: '', barangay: '', severity: '' }); setPage(1); setMonth('') }}>Reset filters</button></div>
      <div className="rp-filters">
        <label>Reporting period<select value={filters.period} onChange={e => setPeriod(e.target.value)}>{Object.entries({ custom: 'Custom dates', '1d': 'Past day', '1w': 'Past week', '1m': 'Past month', '6m': 'Past six months', '1y': 'Past year', all: 'All recorded dates' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Timing data<select value={filters.source} onChange={e => update('source', e.target.value)}><option value="recorded">Recorded operational times</option><option value="demo">BFP history · synthesized demo</option></select></label>
        <label>Start date<input type="date" disabled={filters.period === 'all'} aria-describedby="rp-date-help" value={filters.period === 'all' && operations?.start ? new Date(new Date(operations.start).getTime() + 8 * 3600000).toISOString().slice(0, 10) : filters.start} onChange={e => update('start', e.target.value)} /></label>
        <label>End date<input type="date" aria-describedby="rp-date-help" value={filters.end} onChange={e => update('end', e.target.value)} /></label>
        <label>Record kind<select disabled={demo} value={demo ? 'all' : filters.kind} onChange={e => update('kind', e.target.value)}>{['operational', 'drill', 'test', 'unknown', 'all'].map(k => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></label>
      </div>
      {!demo && <details className="ro-refinements"><summary><span><PerformanceIcon name="filter" />Refine by team, station or location{refinementCount > 0 && <span className="rp-count">{refinementCount} active</span>}</span><PerformanceIcon name="chevron" /></summary><div className="rp-filters ro-refinement-fields">
        {!demo && <TeamFilter teams={choices?.teams || []} selected={filters.teams} onChange={value => update('teams', value)} />}
        {!demo && <label>Station<select value={filters.station} onChange={e => update('station', e.target.value)}><option value="">All stations</option>{choices?.stations?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {!demo && <label>Barangay<select value={filters.barangay} onChange={e => update('barangay', e.target.value)}><option value="">All barangays</option>{choices?.barangays?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {!demo && <label>Severity<select value={filters.severity} onChange={e => update('severity', e.target.value)}><option value="">All severities</option>{['Minor', 'Moderate', 'Critical'].map(s => <option key={s}>{s}</option>)}</select></label>}
      </div></details>}
      {!demo && activeRefinements.length > 0 && <div className="ro-filter-chips" aria-label="Active refinements">{activeRefinements.map(item => <button key={item.key} onClick={() => update(item.key, item.value)} aria-label={`Remove ${item.label} filter`}>{item.label}<span aria-hidden="true">×</span></button>)}</div>}
      <div className="ro-filter-footer"><span id="rp-date-help">Dates in PHT · end date excluded</span><span><PerformanceIcon name="info" />Team filters apply to dispatch comparisons; incident totals include all crews.</span></div>
    </section>
    {error && <div className="rp-error" role="alert"><PerformanceIcon name="info" /><div><strong>Could not load response observations</strong><p>{error}</p></div><button onClick={() => setRevision(n => n + 1)}>Retry</button></div>}
    {loading && <span className="rp-sr-only" role="status">Loading response observations…</span>}
    {!error && <>
      {demo && <aside className="ro-demo-banner"><PerformanceIcon name="info" /><div><strong>Synthesized BFP history</strong><p>Timings are simulated from historical incident dates. These figures do not measure actual BFP response performance.</p></div></aside>}
      <LifecyclePanel data={operations} loading={loading} demo={demo} />
      {!demo && <details className="ro-team-analysis">
      <summary><span className="ro-team-summary-icon"><PerformanceIcon name="chart" /></span><span className="ro-team-summary-copy"><strong>Team comparison and dispatch evidence</strong><span>Compare crews, review monthly trends and trace individual dispatches.</span></span><span className="rp-count">{data?.candidate_dispatches ?? rows?.total ?? 0} dispatches</span><PerformanceIcon name="chevron" /></summary>
      <div className="ro-team-content">
      <div className="rp-section-heading rp-interval-heading"><div><h2>Response intervals</h2><p>One observation per dispatch for {filters.teams.length ? 'selected teams' : 'all teams'}. Dispatch handling includes later reinforcements.</p></div><span className="rp-tag">Dispatch-based</span></div>
      <div className="rp-kpis">{Object.entries(MEASURES).map(([key, label]) => {
        const stat = data?.summary[key]
        return <section className="rp-card rp-metric-card" key={key}>
          <KpiCard icon={<PerformanceIcon name={key} />} accent="fire" label={label} value={stat?.mean_seconds == null ? KPI_EMPTY : duration(stat.mean_seconds)} loading={loading}
            sub={key === 'response' ? 'Dispatch → arrival' : key === 'handling' ? 'Report receipt → dispatch' : key === 'acknowledgement' ? 'Dispatch → acknowledgement' : key === 'turnout' ? 'Dispatch → departure' : 'Departure → arrival'}
            trend={stat?.change_percent == null ? null : { dir: stat.change_percent > 0 ? 'up' : 'down', text: `${Math.abs(stat.change_percent).toFixed(1)}% vs preceding window` }} />
          <Quality stat={stat} compact />
        </section>
      })}</div>
      <details className="rp-method-note"><summary><PerformanceIcon name="info" />How to read these intervals</summary><p>Incident windows use report receipt dates, with occurrence dates used for listing when receipt is unknown. Team comparisons use dispatch dates. Acknowledgement is included in turnout; do not add them together. Missing receipt times do not prevent dispatch-to-arrival or truck travel measurement. Response intervals above six hours remain inspectable as invalid observations; suppression and overall operation can be longer. p90 uses the nearest-rank method.</p></details>
      <TeamTrend monthly={data?.monthly || []} loading={loading} selectedMonth={month} onMonth={value => { setMonth(current => current === value ? '' : value); setPage(1) }} />
      <section className="rp-card rp-observations">
        <div className="rp-section-heading"><div><div className="rp-heading-title"><h2>Dispatch observations</h2>{!loading && <span className="rp-count">{rows?.total || 0}</span>}</div><p>Inspect the records behind the response times. All timestamps in PHT.</p></div>
          <button className="rp-export" disabled={exporting || loading || !!error} onClick={download}><PerformanceIcon name="download" />{exporting ? 'Exporting…' : 'Export filtered CSV'}</button>
        </div>
        {exportError && <p className="rp-error" role="alert">{exportError}</p>}
        {month && <div className="rp-active-month"><span>Showing {month}</span><button onClick={() => { setMonth(''); setPage(1) }}>Clear month filter</button></div>}
        <div className="rp-scroll"><table><thead><tr>{['Dispatch / incident', 'Team / context', 'Location', 'Dispatched', 'Acknowledged', 'Departed', 'Arrived', 'After dispatch', 'Quality'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>
          {loading ? [0, 1, 2].map(n => <tr key={n} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <td key={i}><span className="rp-cell-skeleton kpi-sk" /></td>)}</tr>) : rows?.records.map(r => <tr key={r.dispatch_id}>
            <td><button className="rp-record-link" onClick={() => setSelected(r.dispatch_id)}>#{r.dispatch_id} · INC-{r.fire_id}<PerformanceIcon name="chevron" /></button></td>
            <td><span className="rp-team-name">{r.context.team_name}</span><small>{r.context.station_name || 'Station unknown'} · {r.context.shift_name || 'Shift unknown'}{r.reinforcement ? ' · Reinforcement' : ''}</small></td>
            <td>{r.location}<small>{r.severity || 'Severity unknown'} · {r.record_kind}</small></td>
            {[r.dispatch_at, r.acknowledged_at, r.departed_at, r.arrived_at].map((at, i) => <td key={i} className={`rp-timestamp${!at ? ' is-missing' : ''}`}>{dateTime(at)}</td>)}
            <td className="rp-duration">{duration(r.metrics.response.seconds)}</td><td><span className="rp-quality-badge" data-quality={r.metrics.response.quality}>{r.metrics.response.reason?.replaceAll('_', ' ') || 'Valid'}</span></td>
          </tr>)}
        </tbody></table></div>
        {!loading && !rows?.records.length && <div className="rp-empty"><PerformanceIcon name="handling" /><h3>No dispatch observations match these filters</h3><p>Adjust the date range or record kind. Older records remain under unknown until reviewed.</p>{filters.kind === 'operational' && <button onClick={() => update('kind', 'unknown')}>View unclassified records</button>}</div>}
        <nav className="rp-pagination" aria-label="Dispatch pages"><span>{rows?.total || 0} dispatches<span className="rp-page-divider">·</span>Page {currentPage} of {rows?.total_pages || 1}</span><div><button disabled={currentPage <= 1 || loading} onClick={() => setPage(currentPage - 1)}>Previous</button><button disabled={loading || currentPage >= (rows?.total_pages || 1)} onClick={() => setPage(currentPage + 1)}>Next</button></div></nav>
      </section>
      </div>
      </details>}
      <IncidentRecords key={query} query={query} revision={revision} theme={theme} onOpenDispatch={setSelected} demo={demo} />
      {data?.notice && <p className="rp-notice"><PerformanceIcon name="info" />{data.notice}</p>}
    </>}
    {csvReview != null && <CsvReviewModal csv={csvReview} fileName="response-performance.csv" title="Response Performance CSV" onClose={() => setCsvReview(null)} />}
    {selected != null && <DispatchDetail key={selected} id={selected} theme={theme} onClose={() => setSelected(null)} onOpenIncident={onOpenIncident} />}
  </div></main>
}
