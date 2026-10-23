import { useEffect, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import AppModal from './AppModal'
import CsvReviewModal from './CsvReviewModal'
import KpiCard, { KPI_EMPTY } from './KpiCard'
import PerformanceIcon from './AnalysisIcon'
import { fetchResponsePerformance, fetchResponseDispatches, fetchResponseDispatch, exportResponsePerformance } from '../api'
import { dateTime, duration, parseRouteWkt } from '../utils/operationalTimes'
import { MAP_CENTER, tileLayersFor } from '../data/mapConfig'
import '../styles/ResponsePerformance.css'

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
  const query = new URLSearchParams({ start: `${filters.start}T00:00:00+08:00`, end: `${filters.end}T00:00:00+08:00`, record_kind: filters.kind })
  filters.teams.forEach(id => query.append('team_id', id))
  for (const [key, value] of Object.entries({ station_id: filters.station, barangay_id: filters.barangay, severity: filters.severity })) if (value) query.set(key, value)
  return query.toString()
}

function Quality({ stat }) {
  if (!stat) return null
  return <div className="rp-quality">
    <div className="rp-quality-heading"><strong>{stat.valid}/{stat.candidate} valid</strong><span>observations</span></div>
    <meter className="rp-quality-meter" min="0" max={stat.candidate || 1} value={stat.valid} aria-label="Valid observations" />
    <div className="rp-distribution"><span>Median <strong>{duration(stat.median_seconds)}</strong></span><span title="90th percentile, nearest rank">p90 <strong>{duration(stat.p90_seconds)}</strong></span></div>
    <div className="rp-quality-counts">{['pending', 'missing', 'invalid', 'excluded'].map(kind => <span key={kind} data-present={stat[kind] > 0}>{stat[kind]} {kind}</span>)}</div>
    {stat.small_sample && <span className="rp-sample-note">Fewer than 10 observations</span>}
    {Object.keys(stat.reasons || {}).length > 0 && <details className="rp-disclosure"><summary>Data quality details</summary><ul>{Object.entries(stat.reasons).map(([reason, count]) => <li key={reason}>{reason.replaceAll('_', ' ')}: {count}</li>)}</ul></details>}
  </div>
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
      <label>Planned route revision <select value={revision?.id || ''} onChange={e => setRevisionId(e.target.value)}>{data.route_revisions.map(r => <option value={r.id} key={r.id}>{dateTime(r.at)} · {r.selection_reason || 'Selection'}</option>)}</select></label>
      <p>Saved planned ETA: {duration(selected?.eta_seconds)} · Distance: {selected?.distance_meters == null ? 'Unknown' : `${(selected.distance_meters / 1000).toFixed(2)} km`} · Origin: {selected?.origin_source || 'Unknown'}. Planned geometry does not establish the route driven.</p>
      {!revision && <p>No preserved route revision exists for this legacy dispatch.</p>}
      <div className="rp-map"><MapContainer center={MAP_CENTER} zoom={12} style={{ height: '100%' }}>{tileLayersFor(theme === 'light' ? 'street' : 'dark').map(layer => <TileLayer key={layer.url} {...layer} />)}<FitRoute points={points} />{route.length > 1 && <Polyline positions={route} pathOptions={{ color: '#ff6c3b' }} />}{data.incident.location && <CircleMarker center={data.incident.location}><Tooltip>Incident</Tooltip></CircleMarker>}</MapContainer></div>
    </div>}
  </AppModal>
}

export default function ResponsePerformanceView({ theme, onOpenIncident }) {
  const [filters, setFilters] = useState(() => ({ ...initialDates(), kind: 'operational', teams: [], station: '', barangay: '', severity: '' }))
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
  }
  const exportQuery = tableParams.toString()
  tableParams.set('page', page)
  const tableQuery = tableParams.toString()
  const key = `${query}:${tableQuery}:${revision}`
  const data = result?.key === key ? result.data : null
  const rows = result?.key === key ? result.rows : null
  const error = result?.key === key ? result.error : null
  const loading = !data && !error
  const choices = result?.data
  const currentPage = rows?.page || page
  const update = (field, value) => { setFilters(f => ({ ...f, [field]: value })); setPage(1); setMonth(''); setExportError(null) }
  useEffect(() => {
    const controller = new AbortController()
    Promise.all([fetchResponsePerformance(query, controller.signal), fetchResponseDispatches(tableQuery, controller.signal)])
      .then(([data, rows]) => setResult({ key, data, rows }), err => { if (err.name !== 'AbortError') setResult({ key, error: err.message }) })
    return () => controller.abort()
  }, [query, tableQuery, revision, key])
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    const foreground = () => { if (!document.hidden) refresh() }
    window.addEventListener('operational-times-updated', refresh)
    window.addEventListener('focus', foreground)
    return () => { window.removeEventListener('operational-times-updated', refresh); window.removeEventListener('focus', foreground) }
  }, [])
  async function download() {
    setExporting(true); setExportError(null)
    try {
      const blob = await exportResponsePerformance(exportQuery, { download: false })
      setCsvReview(await blob.text())
    } catch (err) { setExportError(err.message) } finally { setExporting(false) }
  }
  return <main className="rp-view" aria-busy={loading}>
    <header className="m-view-heading rp-page-heading"><div><h1>Response Performance</h1><p>Follow the response timeline. Trace every result back to its dispatch.</p></div><span className="rp-timezone">Asia/Manila · PHT</span></header>
    <section className="rp-filter-panel" aria-label="Response filters">
      <div className="rp-filter-title"><span><PerformanceIcon name="filter" />Filters</span><span id="rp-date-help">Dates in PHT · end date excluded</span></div>
      <div className="rp-filters">
        <label>Start date<input type="date" aria-describedby="rp-date-help" value={filters.start} onChange={e => update('start', e.target.value)} /></label>
        <label>End date<input type="date" aria-describedby="rp-date-help" value={filters.end} onChange={e => update('end', e.target.value)} /></label>
        <label>Record kind<select value={filters.kind} onChange={e => update('kind', e.target.value)}>{['operational', 'drill', 'test', 'unknown', 'all'].map(k => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></label>
        <TeamFilter teams={choices?.teams || []} selected={filters.teams} onChange={value => update('teams', value)} />
        <label>Station<select value={filters.station} onChange={e => update('station', e.target.value)}><option value="">All stations</option>{choices?.stations.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Barangay<select value={filters.barangay} onChange={e => update('barangay', e.target.value)}><option value="">All barangays</option>{choices?.barangays.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>Severity<select value={filters.severity} onChange={e => update('severity', e.target.value)}><option value="">All severities</option>{['Minor', 'Moderate', 'Critical'].map(s => <option key={s}>{s}</option>)}</select></label>
        <button className="rp-refresh" onClick={() => setRevision(n => n + 1)} disabled={loading}><PerformanceIcon name="refresh" />Refresh</button>
      </div>
    </section>
    {error && <div className="rp-error" role="alert"><PerformanceIcon name="info" /><div><strong>Could not load response observations</strong><p>{error}</p></div><button onClick={() => setRevision(n => n + 1)}>Retry</button></div>}
    {loading && <span className="rp-sr-only" role="status">Loading response observations…</span>}
    {!error && <>
      <section className="rp-card rp-overall-card" aria-label="Overall first arrival">
        <div className="rp-overall-main"><div className="rp-section-heading"><h2>Overall first arrival</h2><span className="rp-tag"><span className="rp-status-dot" />All teams</span></div>
          <p>First eligible arrival minus verified report receipt.</p>
          {loading ? <span className="rp-value-skeleton kpi-sk" aria-hidden="true" /> : <strong className={`rp-overall${data?.overall.mean_seconds == null ? ' is-empty' : ''}`}>{duration(data?.overall.mean_seconds)}</strong>}
          <span className="rp-overall-caption">Mean call-to-arrival time</span>
          <p className="rp-scope-note"><PerformanceIcon name="info" />Team selection does not change this measure.</p>
        </div>
        <div className="rp-overall-quality"><span className="rp-eyebrow">Measurement coverage</span>{loading ? <div className="rp-coverage-skeleton kpi-sk" aria-hidden="true" /> : <Quality stat={data?.overall} />}</div>
      </section>
      <div className="rp-section-heading rp-interval-heading"><div><h2>Response intervals</h2><p>Mean durations for {filters.teams.length ? 'selected teams' : 'all teams'}. Compare each step of the response.</p></div><span className="rp-tag">Dispatch-based</span></div>
      <div className="rp-kpis">{Object.entries(MEASURES).map(([key, label]) => {
        const stat = data?.summary[key]
        return <section className="rp-card rp-metric-card" key={key}>
          <KpiCard icon={<PerformanceIcon name={key} />} accent="fire" label={label} value={stat?.mean_seconds == null ? KPI_EMPTY : duration(stat.mean_seconds)} loading={loading}
            sub={key === 'response' ? 'Dispatch → arrival' : key === 'handling' ? 'Report receipt → dispatch' : key === 'acknowledgement' ? 'Dispatch → acknowledgement' : key === 'turnout' ? 'Dispatch → departure' : 'Departure → arrival'}
            trend={stat?.change_percent == null ? null : { dir: stat.change_percent > 0 ? 'up' : 'down', text: `${Math.abs(stat.change_percent).toFixed(1)}% vs preceding window` }} />
          <Quality stat={stat} />
        </section>
      })}</div>
      <details className="rp-method-note"><summary><PerformanceIcon name="info" />How to read these intervals</summary><p>Acknowledgement is included in turnout; do not add them together. Missing receipt times do not prevent dispatch-to-arrival measurement. Intervals above six hours remain inspectable as invalid observations. p90 uses the nearest-rank method.</p></details>
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
      {data?.notice && <p className="rp-notice"><PerformanceIcon name="info" />{data.notice}</p>}
    </>}
    {csvReview != null && <CsvReviewModal csv={csvReview} fileName="response-performance.csv" title="Response Performance CSV" onClose={() => setCsvReview(null)} />}
    {selected != null && <DispatchDetail key={selected} id={selected} theme={theme} onClose={() => setSelected(null)} onOpenIncident={onOpenIncident} />}
  </main>
}
