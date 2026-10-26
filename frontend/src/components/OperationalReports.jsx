import { useEffect, useState } from 'react'
import { fetchOperationalReport, exportOperationalReport, fetchPersonnel, fetchTeams, fetchStations } from '../api'
import CsvReviewModal from './CsvReviewModal'
import AnalysisIcon from './AnalysisIcon'
import KpiCard, { KPI_EMPTY } from './KpiCard'
import { duration, dateTime } from '../utils/operationalTimes'
import '../styles/OperationalReports.css'

const TYPES = { 'personnel-deployment': 'Personnel Deployment', 'fire-prone-areas': 'Fire-Prone Areas', 'eta-accuracy': 'ETA Prediction Error' }
const REPORTS = {
  'personnel-deployment': { icon: 'acknowledgement', short: 'Personnel', hint: 'Assignments & deployment', description: 'Review personnel assignments, preserved roles and recorded deployment time.' },
  'fire-prone-areas': { icon: 'coverage', short: 'Fire-prone areas', hint: 'Frequency & severity', description: 'Explore historical fire concentration across Panabo City barangays.' },
  'eta-accuracy': { icon: 'response', short: 'ETA performance', hint: 'Predicted vs. actual travel', description: 'Compare saved route predictions with eligible recorded vehicle trips.' },
}
const SUMMARY_COLUMNS = [['name', 'Personnel'], ['assignments', 'Assignments'], ['unique_incidents', 'Unique incidents'], ['completed_assignments', 'Released'], ['cancelled_assignments', 'Canceled'], ['deployment_seconds', 'Recorded time'], ['duration_coverage', 'Timing coverage']]
const defaultFilters = type => ({ start: '', end: '', kind: type === 'fire-prone-areas' ? 'historical' : 'operational', per_id: '', team_id: '', station_id: '', shift: '', known_only: false, source: 'all' })
const formattedCount = value => value == null ? KPI_EMPTY : value.toLocaleString()
const signedDuration = value => value == null ? 'No data' : `${value < 0 ? '−' : '+'}${duration(value)}`
const personnelTime = value => value >= 3600 ? `${Math.floor(value / 3600)}h ${String(Math.floor(value % 3600 / 60)).padStart(2, '0')}m` : duration(value)
const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('')
const COLUMNS = {
  'personnel-deployment': [['name', 'Personnel'], ['role', 'Assigned role'], ['team', 'Team'], ['station', 'Station'], ['shift', 'Shift'], ['fire_id', 'Incident'], ['assigned_at', 'Assigned · PHT'], ['released_at', 'Released · PHT'], ['duration_seconds', 'Recorded duration'], ['duration_quality', 'Evidence']],
  'fire-prone-areas': [['rank', 'Rank'], ['barangay', 'Barangay'], ['incident_count', 'Incidents'], ['weighted_score', 'Weighted score'], ['missing_severity_count', 'Severity unknown'], ['estimated_locations', 'Estimated locations'], ['unknown_record_kind', 'Unclassified records']],
  'eta-accuracy': [['fire_id', 'Incident'], ['truck', 'Truck'], ['predicted_seconds', 'Predicted travel'], ['actual_seconds', 'Actual travel'], ['error_seconds', 'Signed error'], ['absolute_error_seconds', 'Absolute error'], ['error_percent', 'Error / predicted'], ['reason', 'Exclusion reason']],
}
function display(row, key) {
  const value = row[key]
  if (value == null) return 'Not recorded'
  if (key.endsWith('_seconds')) return `${key === 'error_seconds' && value > 0 ? '+' : key === 'error_seconds' && value < 0 ? '−' : ''}${duration(value)}`
  if (key.endsWith('_at')) return dateTime(value)
  if (key === 'error_percent') return `${value.toFixed(1)}%`
  if (key === 'fire_id') return `INC-${value}`
  if (key === 'weighted_score') return value.toFixed(1)
  return String(value).replaceAll('_', ' ')
}

function ReportCell({ row, column, maxScore }) {
  if (column === 'name') return <div className="op-person"><span className="op-avatar" aria-hidden="true">{initials(row.name)}</span><strong>{row.name || 'Name unavailable'}</strong></div>
  if (column === 'rank') return <span className="op-rank" data-leading={row.rank === 1}>{row.rank}</span>
  if (column === 'weighted_score') return <div className="op-score"><strong>{display(row, column)}</strong><span className="op-score-track" aria-hidden="true"><i style={{ width: `${maxScore > 0 ? Math.min(100, row.weighted_score / maxScore * 100) : 0}%` }} /></span></div>
  if (column === 'fire_id') return <span className="op-incident">{display(row, column)}</span>
  if (column === 'reason') return <span className={`op-evidence ${row.eligible ? 'is-recorded' : 'is-pending'}`}>{row.reason || (row.eligible ? 'Comparable' : 'Not comparable')}</span>
  if (column === 'duration_quality') return <span className={`op-evidence ${row.duration_quality === 'recorded' ? 'is-recorded' : 'is-pending'}`}>{row.duration_quality === 'clearance_not_recorded' ? 'Clearance pending' : display(row, column)}</span>
  if (column === 'deployment_seconds' && !row.duration_coverage) return <span className="op-missing">Not recorded</span>
  if (column === 'deployment_seconds') return <span className="op-number op-duration">{personnelTime(row.deployment_seconds)}</span>
  if (column === 'duration_coverage') return <span className="op-muted">{row.duration_coverage} recorded segments</span>
  if (column === 'missing_severity_count' && row[column] > 0) return <span className="op-evidence is-pending">{row[column]} unknown</span>
  return <span className={row[column] == null ? 'op-missing' : column.endsWith('_seconds') ? 'op-number op-duration' : column.endsWith('_at') ? 'op-timestamp' : 'op-number'}>{display(row, column)}</span>
}

export default function OperationalReports({ initialType = 'personnel-deployment', fixedType = false }) {
  const [type, setType] = useState(initialType)
  const [filters, setFilters] = useState(() => defaultFilters(initialType))
  const [options, setOptions] = useState({ personnel: [], teams: [], stations: [] })
  const [result, setResult] = useState(null)
  const [revision, setRevision] = useState(0)
  const [csv, setCsv] = useState(null)
  const [exportError, setExportError] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [page, setPage] = useState(1)
  const [tableView, setTableView] = useState('summary')
  const area = type === 'fire-prone-areas'
  const deployed = type === 'personnel-deployment'
  const params = new URLSearchParams()
  if (filters.start) params.set('start', `${filters.start}T00:00:00+08:00`)
  if (filters.end) params.set('end', `${filters.end}T00:00:00+08:00`)
  params.set('kind', filters.kind)
  if (area) params.set('known_only', String(filters.known_only))
  if (area) params.set('source', filters.source)
  if (deployed) for (const key of ['per_id', 'team_id', 'station_id', 'shift']) if (filters[key]) params.set(key, filters[key])
  const query = params.toString()
  const requestKey = `${type}:${query}:${revision}`
  const data = result?.key === requestKey ? result.data : null
  const error = result?.key === requestKey ? result.error : null
  const loading = !data && !error
  useEffect(() => {
    const controller = new AbortController()
    let alive = true
    fetchOperationalReport(type, query, controller.signal).then(data => { if (alive) setResult({ key: requestKey, data }) }, err => {
      if (alive && err.name !== 'AbortError') setResult({ key: requestKey, error: err.message })
    })
    return () => { alive = false; controller.abort() }
  }, [type, query, requestKey])
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    window.addEventListener('operational-times-updated', refresh)
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('operational-times-updated', refresh); window.removeEventListener('focus', refresh) }
  }, [])
  useEffect(() => {
    if (!deployed) return
    let alive = true
    Promise.allSettled([fetchPersonnel(), fetchTeams(), fetchStations()]).then(values => {
      if (alive) setOptions({ personnel: values[0].value || [], teams: values[1].value || [], stations: values[2].value || [] })
    })
    return () => { alive = false }
  }, [deployed])
  function update(key, value) { setFilters(prev => ({ ...prev, [key]: value })); setPage(1) }
  async function review(reportType = type) {
    setExporting(true); setExportError(null)
    try { setCsv({ text: await exportOperationalReport(reportType, query), type: reportType }) }
    catch (err) { setExportError(err.message) }
    finally { setExporting(false) }
  }
  const rows = data?.rows || []
  const personnel = data?.personnel || []
  const summaryView = deployed && tableView === 'summary'
  const tableRows = summaryView ? personnel : rows
  const columns = summaryView ? SUMMARY_COLUMNS : COLUMNS[type]
  const maxPage = Math.max(1, Math.ceil(tableRows.length / 25))
  const currentPage = Math.min(page, maxPage)
  const pageRows = tableRows.slice((currentPage - 1) * 25, currentPage * 25)
  const maxScore = Math.max(0, ...rows.map(row => row.weighted_score || 0))
  const defaults = defaultFilters(type)
  const dirty = Object.keys(defaults).some(key => filters[key] !== defaults[key])
  const assignmentFilters = ['per_id', 'team_id', 'station_id', 'shift'].filter(key => filters[key]).length
  const coverage = personnel.reduce((sum, person) => sum + (person.duration_coverage || 0), 0)
  const metrics = deployed ? [
    { label: 'Assigned personnel', value: formattedCount(data ? personnel.length : null), sub: 'People with preserved assignments', icon: 'acknowledgement', accent: 'blue' },
    { label: 'Personnel assignments', value: formattedCount(data ? personnel.reduce((sum, p) => sum + p.assignments, 0) : null), sub: 'Eligible assignments to dispatches', icon: 'handling', accent: 'fire' },
    { label: 'Unique incidents', value: formattedCount(data ? new Set(rows.filter(r => !r.excluded).map(r => r.fire_id)).size : null), sub: 'Each incident counted once', icon: 'suppression', accent: 'amber' },
    { label: 'Recorded personnel time', value: data && coverage ? personnelTime(personnel.reduce((sum, p) => sum + p.deployment_seconds, 0)) : KPI_EMPTY, sub: 'Overlaps removed for each person', icon: 'response', accent: 'green' },
  ] : area ? [
    { label: 'Historical incidents', value: formattedCount(data?.incident_count), sub: 'Within the selected population', icon: 'suppression', accent: 'fire' },
    { label: 'Ranked barangays', value: formattedCount(data ? rows.length : null), sub: 'Areas with assigned incidents', icon: 'coverage', accent: 'blue' },
    { label: 'Severity unknown', value: formattedCount(data ? rows.reduce((sum, r) => sum + r.missing_severity_count, 0) : null), sub: 'Among incidents in ranked areas', icon: 'info', accent: 'amber' },
    { label: 'Unassigned incidents', value: formattedCount(data?.unassigned_incidents), sub: 'Barangay could not be resolved', icon: 'processing', accent: 'purple' },
  ] : [
    { label: 'Comparable trips', value: formattedCount(data?.eligible_count), sub: 'Trips with matching departure evidence', icon: 'acknowledgement', accent: 'green' },
    { label: 'Excluded trips', value: formattedCount(data?.excluded_count), sub: 'Missing or non-comparable evidence', icon: 'info', accent: 'amber' },
    { label: 'Mean absolute error', value: data?.mae_seconds == null ? KPI_EMPTY : duration(data.mae_seconds), sub: 'Average prediction difference', icon: 'response', accent: 'fire' },
    { label: 'Median absolute error', value: data?.median_absolute_error_seconds == null ? KPI_EMPTY : duration(data.median_absolute_error_seconds), sub: 'Middle prediction difference', icon: 'chart', accent: 'blue' },
  ]
  const periodLabel = filters.start || filters.end ? 'Custom date range' : area ? 'All historical dates' : 'Latest 12 calendar months'
  const tableTitle = summaryView ? 'Personnel assignment summary' : area ? 'Severity-weighted barangay ranking' : deployed ? 'Assignment log' : 'Recorded observations'
  const Heading = fixedType ? 'h2' : 'h1'
  function changeReport(next) {
    setType(next)
    setFilters(prev => ({ ...prev, kind: defaultFilters(next).kind }))
    setPage(1)
    setTableView('summary')
    setExportError(null)
  }
  function reset() { setFilters(defaultFilters(type)); setPage(1) }

  return <section className={`op-reports${fixedType ? ' is-embedded' : ''}`} aria-label={TYPES[type]} aria-busy={loading}>
    <div className="op-workspace">
    <header className="op-report-heading">
      <div className="op-report-heading-copy"><span className="op-eyebrow">{fixedType ? 'Historical analysis' : 'Operational reporting'}</span><Heading>{fixedType ? TYPES[type] : 'Operational Reports'}</Heading><p>{REPORTS[type].description}</p></div>
      <div className="op-report-actions"><span className="op-timezone"><AnalysisIcon name="response" />Asia/Manila · PHT</span><div className="op-export-actions">
        {deployed && <button className="op-button" disabled={loading || exporting || !!error} onClick={() => review('personnel-deployment-summary')}><AnalysisIcon name="handling" />Review summary CSV</button>}
        <button className="op-button is-primary" disabled={loading || exporting || !!error} onClick={() => review()}><AnalysisIcon name="download" />{exporting ? 'Preparing…' : 'Review CSV'}</button>
      </div></div>
    </header>

    {!fixedType && <div className="op-report-switcher" role="group" aria-label="Report type">
      {Object.entries(REPORTS).map(([key, report]) => <button key={key} type="button" className="op-report-choice" aria-pressed={type === key} onClick={() => changeReport(key)}>
        <span className="op-choice-icon"><AnalysisIcon name={report.icon} /></span><span><strong>{report.short}</strong><small>{report.hint}</small></span><AnalysisIcon name="chevron" className="op-choice-arrow" />
      </button>)}
    </div>}

    <section className="op-filter-panel" aria-label="Report filters">
      <div className="op-filter-heading"><h2><AnalysisIcon name="filter" />Report filters</h2><div><span className="op-period-label">{periodLabel}</span>{dirty && <button className="op-text-button" onClick={reset}>Reset filters</button>}<button className="op-button op-refresh" onClick={() => setRevision(n => n + 1)}><AnalysisIcon name="refresh" />Refresh</button></div></div>
      <div className={`op-report-filters${area ? ' is-area' : ''}`}>
        <label>From · PHT<input type="date" value={filters.start} onChange={e => update('start', e.target.value)} /></label>
        <label>Until · PHT (exclusive)<input type="date" value={filters.end} onChange={e => update('end', e.target.value)} /></label>
        <label className="op-population-field">Record population<select value={filters.kind} onChange={e => update('kind', e.target.value)}>{(area ? [['historical', 'Historical (operational + unclassified)'], ['operational', 'Operational only'], ['unknown', 'Unclassified only'], ['test', 'Test only'], ['drill', 'Drill only'], ['all', 'All kinds']] : [['operational', 'Operational'], ['unknown', 'Unclassified'], ['test', 'Test'], ['drill', 'Drill'], ['all', 'All kinds']]).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        {area && <label>Incident source<select value={filters.source} onChange={e => update('source', e.target.value)}><option value="all">All sources</option><option value="imported">BFP imported history</option><option value="other">Other entries</option></select></label>}
      </div>
      {deployed && <details className="op-assignment-filters"><summary><span><AnalysisIcon name="filter" />Assignment filters{assignmentFilters > 0 && <span className="op-count">{assignmentFilters} active</span>}</span><AnalysisIcon name="chevron" /></summary><div className="op-report-filters is-assignment">
        <label>Personnel<select value={filters.per_id} onChange={e => update('per_id', e.target.value)}><option value="">All personnel</option>{options.personnel.map(p => <option key={p.per_id} value={p.per_id}>{p.name}</option>)}</select></label>
        <label>Team<select value={filters.team_id} onChange={e => update('team_id', e.target.value)}><option value="">All teams</option>{options.teams.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}</select></label>
        <label>Station<select value={filters.station_id} onChange={e => update('station_id', e.target.value)}><option value="">All stations</option>{options.stations.map(s => <option key={s.station_id} value={s.station_id}>{s.station_name}</option>)}</select></label>
        <label>Shift<select value={filters.shift} onChange={e => update('shift', e.target.value)}><option value="">All shifts</option>{['Shift A', 'Shift B'].map(s => <option key={s}>{s}</option>)}</select></label>
      </div></details>}
      <div className="op-filter-footer"><p><AnalysisIcon name="info" />{area ? 'Closed historical incidents. Test and drill records require an explicit population choice.' : 'Blank dates use the latest 12 calendar months. Unclassified history is available through Record population.'}</p>{area && <label className="op-report-check"><input type="checkbox" checked={filters.known_only} onChange={e => update('known_only', e.target.checked)} />Recorded severity only</label>}</div>
    </section>

    {(error || exportError) && <div role="alert" className="op-report-error"><AnalysisIcon name="info" /><div><strong>{error ? 'Could not load this report' : 'Could not prepare the export'}</strong><p>{error || exportError}</p></div>{error && <button className="op-button" onClick={() => setRevision(n => n + 1)}>Retry</button>}</div>}
    {loading && <p role="status" className="op-sr-only">Loading report…</p>}
    {!error && <>
      <div className="op-section-label"><span>{TYPES[type]}</span><span>{loading ? 'Loading observations' : `${formattedCount(deployed ? personnel.length : rows.length)} ${deployed ? 'personnel' : area ? 'ranked areas' : 'trip observations'}`}</span></div>
      <div className="op-report-stats" aria-label="Report summary">{metrics.map(metric => <KpiCard key={metric.label} label={metric.label} value={metric.value} sub={metric.sub} icon={<AnalysisIcon name={metric.icon} />} accent={metric.accent} loading={loading} />)}</div>
      {deployed && data?.unknown_roster_dispatches > 0 && <aside className="op-data-note"><span className="op-note-icon"><AnalysisIcon name="info" /></span><div><strong>Historical roster gaps</strong><p>{data.unknown_roster_dispatches} dispatches have no preserved historical roster and cannot be attributed to personnel.</p></div><span className="op-evidence is-pending">Evidence unavailable</span></aside>}
      {area && data && <div className="op-area-method"><div className="op-weight-legend" aria-label="Incident severity weights">{[['Minor', '0.4'], ['Moderate', '0.7'], ['Critical', '1.0'], ['Unknown', '0.5']].map(([label, weight]) => <span key={label} data-severity={label.toLowerCase()}><i />{label}<strong>{weight}</strong></span>)}</div><span>Tied scores share a rank</span></div>}

      <section className="op-table-panel" aria-label={tableTitle}>
        <div className="op-table-heading"><div><h2>{tableTitle}{!loading && <span className="op-count">{formattedCount(tableRows.length)}</span>}</h2><p>{summaryView ? 'Recorded assignments by personnel. Deployment time merges overlaps for each person.' : area ? 'Higher scores indicate greater historical concentration within the selected population.' : deployed ? 'The preserved assignments behind the summary. All timestamps in PHT.' : 'Predictions and actual travel for each recorded trip. Missing evidence remains visible.'}</p></div>
          {deployed && <div className="op-table-switcher" role="group" aria-label="Deployment table view">{[['summary', 'Personnel summary'], ['log', 'Assignment log']].map(([key, label]) => <button key={key} aria-pressed={tableView === key} onClick={() => { setTableView(key); setPage(1) }}>{label}</button>)}</div>}
        </div>
        <div className="op-report-scroll" role="region" aria-label={`${tableTitle} table`} tabIndex={0}><table className={area ? 'op-area-table' : summaryView ? 'op-summary-table' : 'op-observations-table'}><caption className="op-sr-only">{tableTitle}</caption><thead><tr>{columns.map(([key, title]) => <th key={key} scope="col">{title}</th>)}</tr></thead><tbody>
          {loading ? [0, 1, 2, 3].map(n => <tr key={n} aria-hidden="true">{columns.map(([key]) => <td key={key}><span className="op-cell-skeleton kpi-sk" /></td>)}</tr>) : pageRows.map((row, index) => <tr key={`${row.per_id || row.dispatch_id || row.brgy_id || row.unit_id}:${index}`}>{columns.map(([key]) => <td key={key}><ReportCell row={row} column={key} maxScore={maxScore} /></td>)}</tr>)}
        </tbody></table></div>
        {!loading && !tableRows.length && <div className="op-report-empty"><span><AnalysisIcon name={REPORTS[type].icon} /></span><h3>No observations match these filters.</h3><p>{!area && !deployed ? 'No data is available for comparable trips in this population. Missing historical evidence stays unavailable.' : summaryView ? 'New dispatches preserve personnel assignments. Older crews remain unknown until supported by evidence.' : 'Try a wider date range or another population. Missing historical evidence stays unavailable.'}</p>{dirty && <button className="op-button" onClick={reset}>Reset filters</button>}</div>}
        <nav className="op-report-pagination" aria-label="Report pages"><span>{loading ? 'Loading records…' : `${tableRows.length ? (currentPage - 1) * 25 + 1 : 0}–${Math.min(currentPage * 25, tableRows.length)} of ${formattedCount(tableRows.length)} ${summaryView ? 'personnel' : 'rows'}`}</span><div><span>Page {currentPage} of {maxPage}</span><button className="op-button op-page-previous" disabled={loading || currentPage === 1} onClick={() => setPage(currentPage - 1)}><AnalysisIcon name="chevron" />Previous</button><button className="op-button" disabled={loading || currentPage === maxPage} onClick={() => setPage(currentPage + 1)}>Next<AnalysisIcon name="chevron" /></button></div></nav>
      </section>
      {data && <details className="op-method-note"><summary><span><AnalysisIcon name="info" />Methodology & data quality</span><AnalysisIcon name="chevron" /></summary><div><p>{data.notice}</p>{area && <p>{data.formula} {data.incident_count} eligible incidents · {data.unassigned_incidents} without an assigned barangay. Ties share a rank.</p>}{!area && !deployed && <p>Mean signed error: <strong>{signedDuration(data.mean_error_seconds)}</strong>. Positive values mean actual travel took longer than predicted.</p>}</div></details>}
    </>}
    {csv && <CsvReviewModal csv={csv.text} fileName={`${csv.type}.csv`} title={TYPES[csv.type] || 'Personnel Deployment Summary'} onClose={() => setCsv(null)} />}
    </div>
  </section>
}
