import { useEffect, useRef, useState } from 'react'
import useMetricTooltips from '../hooks/useMetricTooltips'
import CsvReviewModal from './CsvReviewModal'
import KpiCard, { KPI_EMPTY } from './KpiCard'
import PerformanceIcon from './AnalysisIcon'
import { fetchResponsePerformance, fetchResponseDispatches, exportResponsePerformance, fetchResponseOperations, fetchResponseIncidents, exportResponseIncidents } from '../api'
import { ALL_METRICS, STAGES, dateTime, duration } from '../utils/operationalTimes'
import { SeverityBadge, StatusPill } from './incidentUi'
import OperationalTrendChart from './OperationalTrendChart'
import DurationTrendChart from './DurationTrendChart'
import ShiftComparison from './ShiftComparison'
import '../styles/ResponsePerformance.css'
import '../styles/OperationalTimePage.css'
import '../styles/ResponseOperations.css'
import '../styles/MethodNote.css'

const COLORS = ['var(--duration-green, #00b84a)', '#55b4ad', '#81a4e8', '#c49bd3', '#c7aa62', '#c98697']
const MEASURES = { response: 'After dispatch', handling: 'Dispatch handling', acknowledgement: 'Acknowledgement', turnout: 'Turnout', travel: 'Travel' }
const TEAM_EXPLANATIONS = {
  response: 'How long it takes from dispatching a team until it arrives at the incident scene. This includes getting ready and travelling.',
  handling: 'How long it takes from receiving the incident report until this team is dispatched. Teams sent later may have a longer time here.',
  acknowledgement: 'How long it takes after dispatch for the team to confirm it has received the assignment. This time is already included in turnout.',
  turnout: 'How long it takes after dispatch for the team to get ready and leave for the incident. This includes the time taken to acknowledge the assignment.',
  travel: 'How long the team spends travelling, from departure until arrival at the incident scene.',
}
const INCIDENT_COLUMNS = {
  Incident: 'The incident reference number and its current status.',
  'Report received': 'When the incident report was received. If the receipt time is unknown, the occurrence date is shown and labelled instead.',
  'Location / response': 'Where the incident happened and the type of response, such as a fire response.',
  'Dispatches / trucks': 'How many team assignments and responding trucks are recorded for this incident.',
  'Call-to-first-arrival': 'Time from receiving the report until the first responding crew or truck arrives at the scene.',
  Suppression: 'Time from the recorded start of firefighting until the fire is declared out. This does not apply to non-fire responses.',
  'Overall operation': 'Time from receiving the report until the operation is confirmed complete, including work after the fire is out.',
  Actions: 'Open the incident analysis to review its timeline, responding units and route evidence.',
}
const DISPATCH_COLUMNS = {
  'Dispatch / incident': 'The reference numbers for this team assignment and its incident.',
  'Team / context': 'The assigned team and details about its assignment, such as whether it was sent initially or as reinforcement.',
  Location: 'Where the team was sent to respond.',
  Dispatched: 'When the team was assigned to respond to the incident.',
  Acknowledged: 'When the team confirmed it had received the assignment.',
  Departed: 'When the team left for the incident.',
  Arrived: 'When the team arrived at the incident scene.',
  'After dispatch': TEAM_EXPLANATIONS.response,
  Quality: 'Whether the response time can be used. Pending means an endpoint is still awaited; missing means a required time is unavailable; invalid means the times need review; excluded means the assignment is left out of the calculation.',
  Actions: 'Open this dispatch to review the response details and supporting evidence.',
}
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
  const label = selected.length === 0 ? 'All Teams' : selected.length === 1 ? teams.find(t => String(t.id) === selected[0])?.name || '1 Team Selected' : `${selected.length} Teams Selected`
  return <div className="rp-team-field" ref={pickerRef} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
    <span id="rp-teams-label" className="rp-field-label">Teams</span>
    <button ref={triggerRef} type="button" className="rp-team-trigger" aria-labelledby="rp-teams-label rp-teams-value" aria-expanded={open} aria-controls="rp-team-options" onClick={() => setOpen(value => !value)}>
      <span id="rp-teams-value">{label}</span><PerformanceIcon name="chevron" />
    </button>
    {open && <div className="rp-team-options" id="rp-team-options" role="group" aria-label="Select teams">
      <p>Choose Teams to Compare</p>
      <label><input type="checkbox" checked={!selected.length} onChange={() => onChange([])} />All Teams</label>
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

function monthParams(query, month) {
  const params = new URLSearchParams(query)
  if (!month) return params
  const [year, number] = month.split('-').map(Number)
  const start = new Date(`${month}-01T00:00:00+08:00`).getTime()
  const end = Date.UTC(year, number, 1) - 8 * 3600000
  params.set('start', new Date(params.has('start') ? Math.max(start, new Date(params.get('start')).getTime()) : start).toISOString())
  params.set('end', new Date(params.has('end') ? Math.min(end, new Date(params.get('end')).getTime()) : end).toISOString())
  params.delete('all_dates')
  return params
}

function monthFor(at) {
  return new Date(new Date(at).getTime() + 8 * 3600000).toISOString().slice(0, 7)
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

function dispatchCount(count) {
  return `${count} ${count === 1 ? 'Dispatch' : 'Dispatches'}`
}

function TeamTrend({ monthly, onMonth, selectedMonth, loading }) {
  const teams = monthly[0]?.teams || []
  const hasValues = monthly.some(month => month.teams.some(team => team.mean_seconds != null))
  const distributionMonths = selectedMonth ? monthly.filter(month => month.month === selectedMonth) : monthly
  const distribution = teams.map((team, i) => ({ ...team, color: COLORS[i % COLORS.length], count: distributionMonths.reduce((sum, month) => sum + (month.teams.find(item => item.team_id === team.team_id)?.valid || 0), 0) })).sort((a, b) => b.count - a.count)
  const total = distribution.reduce((sum, team) => sum + team.count, 0)
  return <div className="ro-analysis-grid ro-team-trend-grid">
    <section className="ro-distribution-panel" aria-label="Dispatch distribution">
      <div className="rp-section-heading"><div><span className="ro-eyebrow">Measured dispatches</span><h2>Dispatch distribution</h2></div><span className="rp-count">{loading ? 'Loading…' : dispatchCount(total)}</span></div>
      <p>Share of measured dispatches by team {selectedMonth ? `in ${selectedMonth}` : 'across the reporting period'}.</p>
      {loading ? <div className="kpi-sk ro-distribution-skeleton" aria-hidden="true" /> : total > 0 ? <div className="ro-distribution-rows" role="region" aria-label="Team dispatch shares" tabIndex={0}>{distribution.map(team => <div className="ro-distribution-row" key={team.team_id}>
        <div><span><i style={{ background: team.color }} />{team.team_name || `Team ${team.team_id}`}</span><strong>{(team.count / total * 100).toFixed(1)}<small>%</small></strong></div>
        <div className="ro-distribution-track"><span style={{ width: `${team.count / total * 100}%`, background: team.color }} /></div>
        <span className="ro-distribution-duration">{dispatchCount(team.count)}</span>
      </div>)}</div> : <div className="ro-distribution-empty"><PerformanceIcon name="chart" /><strong>No measured dispatches</strong><p>Dispatches need valid response times to appear here.</p></div>}
    </section>
    <section className="rp-card rp-trends"><div className="rp-section-heading"><div><h2>Monthly team response after dispatch</h2><p>Mean time from dispatch to arrival</p></div></div>
    {loading ? <div className="rp-chart-skeleton kpi-sk" aria-hidden="true" /> : hasValues ? <div className="rp-chart"><DurationTrendChart label="Monthly mean response by team"
      sortTooltipByValue formatCount={dispatchCount}
      points={monthly.map(month => ({ label: month.month, values: Object.fromEntries(month.teams.map(team => [team.team_id, team.mean_seconds])), counts: Object.fromEntries(month.teams.map(team => [team.team_id, team.valid])) }))}
      series={teams.map((team, i) => ({ key: team.team_id, label: team.team_name || `Team ${team.team_id}`, color: COLORS[i % COLORS.length] }))}
      selectedIndex={monthly.findIndex(month => month.month === selectedMonth)} onSelect={index => onMonth(monthly[index].month)}
      onClose={selectedMonth ? () => onMonth(selectedMonth) : undefined}
    /></div> : <div className="rp-empty rp-chart-empty"><PerformanceIcon name="chart" /><h3>No response times to chart</h3><p>Try another date range or record kind. Dispatches need a recorded arrival to appear here.</p></div>}
    <p className="ota-chart-note"><PerformanceIcon name="info" />Gaps indicate missing measurements.</p>
    </section>
  </div>
}

function ExplainedTableHeading({ label, explanation, table, visuallyHidden = false }) {
  const { tooltipHandlers, renderTooltip } = useMetricTooltips()
  const key = `${table}-${label.replaceAll(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  return <th scope="col" tabIndex={0} {...tooltipHandlers(key)}>
    {visuallyHidden ? <span className="rp-sr-only">{label}</span> : label}
    {renderTooltip(key, explanation, false)}
  </th>
}

function LifecyclePanel({ data, loading, demo, selectedTimeframe, onTimeframeChange }) {
  const [trendMetric, setTrendMetric] = useState('all')
  const [measurementMode, setMeasurementMode] = useState('all')
  const { tooltipHandlers, renderTooltip } = useMetricTooltips()
  const stageExplanations = {
    processing: 'How long it takes from receiving an incident report until the first team is dispatched.',
    preparation: 'How long it takes after dispatch for the crew to get ready and the truck to leave for the incident.',
    travel: 'How long the truck spends travelling, from departure until it arrives at the incident scene.',
    suppression: 'How long firefighters spend putting out the fire, from the recorded start of firefighting until the fire is declared out. Work at the scene may continue after this.',
  }
  const allValid = measurementMode === 'all'
  const selectedPoint = data?.trends?.find(point => point.at === selectedTimeframe)
  const summary = selectedPoint ? selectedPoint.summary : data?.summary
  const breakdown = selectedPoint ? selectedPoint.breakdown : data?.breakdown
  const stageValues = allValid
    ? Object.fromEntries(ALL_METRICS.map(stage => [stage.key, selectedPoint ? selectedPoint.values[stage.key] : data?.summary?.[stage.key]?.mean_seconds]))
    : breakdown?.values || breakdown?.seconds || {}
  const stageCounts = allValid
    ? Object.fromEntries(ALL_METRICS.map(stage => [stage.key, (selectedPoint ? selectedPoint.counts?.[stage.key] : data?.summary?.[stage.key]?.valid) || 0]))
    : breakdown?.counts || Object.fromEntries(STAGES.map(stage => [stage.key, breakdown?.count || 0]))
  const chartPoints = allValid ? data?.trends || [] : (data?.trends || []).map(point => ({
    ...point, values: point.breakdown?.values || point.breakdown?.seconds || {},
    counts: point.breakdown?.counts || Object.fromEntries(STAGES.map(stage => [stage.key, point.breakdown?.count || 0])),
  }))
  const timeframeLabel = selectedPoint && (data.trend_period === '1d' ? dateTime(selectedPoint.at) : new Date(selectedPoint.at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', ...(data.trend_period !== 'all' ? { day: 'numeric' } : {}) }))
  const metrics = [
    { key: 'cta', label: 'Call-to-First-Arrival', description: 'Report Receipt → First Eligible Arrival', explanation: 'How long it takes from receiving an incident report until the first responding crew or fire truck arrives at the scene. This includes processing the report, getting ready and travelling.' },
    ...(!demo ? [{ key: 'operation', label: 'Overall Operation Time', description: 'Report Receipt → Confirmed Operation Completion', explanation: 'How long the whole operation takes, from receiving the incident report until the operation is confirmed complete. It includes the response and work at the scene, so it can continue after the fire is put out.' }] : []),
  ]
  const total = STAGES.reduce((sum, stage) => sum + (stageValues[stage.key] || 0), 0)
  const largest = Math.max(0, ...STAGES.map(stage => stageValues[stage.key] || 0))
  const hasMeasurements = STAGES.some(stage => Number.isFinite(stageValues[stage.key]))
  return <>
    <div className={`ro-overview${demo ? ' is-demo' : ''}`}>{metrics.map(({ key, label, description, explanation }) => <section className="ro-overview-card" key={key} aria-label={label}>
      <div className="ro-overview-tooltip-area" tabIndex={0} aria-label={label} {...tooltipHandlers(key)}>
      <div className="ro-metric-heading"><span className="ro-metric-icon"><PerformanceIcon name={key === 'cta' ? 'response' : 'acknowledgement'} /></span><div className="ro-metric-copy"><h2>{label}</h2><p className="ro-metric-definition">{description}</p></div><span className="ro-unit-label">Per Incident</span></div>
      {renderTooltip(key, explanation)}
      {loading ? <span className="rp-value-skeleton kpi-sk" /> : <strong className={`rp-overall${summary?.[key]?.mean_seconds == null ? ' is-empty' : ''}`}>{duration(summary?.[key]?.mean_seconds)}</strong>}
      <span className="ro-mean-caption">Average Duration<span>{loading ? 'Loading Measurements' : `${summary?.[key]?.valid || 0} Measured Incidents`}{timeframeLabel ? ` · ${timeframeLabel}` : ''}</span></span>
      </div>
      <Quality stat={summary?.[key]} />
    </section>)}</div>
    <section className="ro-stages-panel" aria-label="Operation stages">
    <div className="rp-section-heading"><div className="ro-stage-heading-copy"><span className="ro-team-summary-icon"><PerformanceIcon name="response" /></span><div><div className="rp-heading-title"><h2>Where the time goes</h2></div><p>Compare average durations across report processing, preparation, travel and fire suppression</p></div></div><span className="ro-section-hint">Select a stage to explore its trend</span></div>
    <div className="rp-kpis ro-stage-kpis">{STAGES.map((stage, index) => {
      const stat = summary?.[stage.key]
      const unit = ['preparation', 'travel'].includes(stage.key) && !demo
      return <section className={`rp-metric-card${trendMetric === stage.key ? ' is-selected' : ''}`} key={stage.key}>
        <span className="ro-stage-number">0{index + 1}</span>
        <div className="ro-stage-tooltip-area" {...tooltipHandlers(stage.key)}>
        <KpiCard label={stage.key === 'processing' ? 'Report processing' : stage.label} icon={<PerformanceIcon name={stage.key} />} accent="fire" loading={loading}
          value={stat?.mean_seconds == null ? KPI_EMPTY : duration(stat.mean_seconds)}
          onClick={() => setTrendMetric(stage.key)} actionLabel={`View ${stage.label.toLowerCase()} trend`} showNativeTooltip={false}
          sub={<>{unit ? 'Per Truck' : stage.key === 'suppression' ? 'Per Fire Incident' : 'Per Incident'} <span className="ro-label-separator" aria-hidden="true">|</span> {stage.key === 'processing' ? 'Receipt → First Dispatch' : stage.key === 'preparation' ? 'Dispatch → Departure' : stage.key === 'travel' ? 'Departure → Arrival' : 'Suppression Start → Fire Out'}</>}
          trend={stat?.change_percent == null ? null : { dir: stat.change_percent > 0 ? 'up' : 'down', text: `${Math.abs(stat.change_percent).toFixed(1)}% vs Preceding Window` }} />
        {renderTooltip(stage.key, stageExplanations[stage.key])}
        </div>
        <Quality stat={stat} compact />
      </section>
    })}</div>
    </section>
    <div className="ro-analysis-grid">
      <OperationalTrendChart points={chartPoints} period={data?.trend_period || 'all'} loading={loading} demo={demo} selectedMetric={trendMetric} onMetricChange={setTrendMetric} stagesOnly={!allValid} selectedTimeframe={selectedPoint?.at} onTimeframeChange={onTimeframeChange} />
      <section className="ro-distribution-panel ro-stage-distribution" aria-label="Stage distribution"><div className="rp-section-heading"><div><span className="ro-eyebrow">{allValid ? 'All valid measurements' : 'Common incident sample'}{timeframeLabel ? ` · ${timeframeLabel}` : ''}</span><h2>Stage distribution</h2></div>{!allValid && <span className="rp-count">{loading ? 'Loading…' : `${breakdown?.count || 0} ${breakdown?.count === 1 ? 'incident' : 'incidents'}`}</span>}</div>
        <div className="ro-measurement-modes" role="group" aria-label="Stage measurement sample">{[['all', 'All valid measurements'], ['complete', 'Four stages recorded']].map(([mode, label]) => <button type="button" key={mode} aria-pressed={measurementMode === mode} onClick={() => { setMeasurementMode(mode); if (mode === 'complete' && !STAGES.some(stage => stage.key === trendMetric)) setTrendMetric('all') }}>{label}</button>)}</div>
        <div className="ro-stage-distribution-scroll" role="region" aria-label="Stage measurements" tabIndex={0}>
        {loading ? <div className="kpi-sk ro-distribution-skeleton" /> : hasMeasurements ? <div className="ro-distribution-rows">{STAGES.map(stage => <div className="ro-distribution-row" key={stage.key}>
          <div><span><i style={{ background: stage.color }} />{stage.label}</span><strong>{allValid ? Number.isFinite(stageValues[stage.key]) ? duration(stageValues[stage.key]) : <MissingValue /> : Number.isFinite(stageValues[stage.key]) && total > 0 ? <>{(stageValues[stage.key] / total * 100).toFixed(1)}<small>%</small></> : <MissingValue />}</strong></div>
          <div className="ro-distribution-track"><span style={{ width: `${(allValid ? largest : total) > 0 ? (stageValues[stage.key] || 0) / (allValid ? largest : total) * 100 : 0}%`, background: stage.color }} /></div>
          <span className="ro-distribution-duration">{!allValid && <>{duration(stageValues[stage.key], '—')} <span className="ro-label-separator" aria-hidden="true">|</span> </>}{stageCounts[stage.key] || 0} {stageCounts[stage.key] === 1 ? 'Record' : 'Records'}</span>
        </div>)}</div> : <div className="ro-distribution-empty"><PerformanceIcon name="chart" /><strong>{allValid ? 'No valid stage measurements' : 'No complete stage sample'}</strong><p>{allValid ? 'Try another timeframe or measurement sample.' : 'All four stages need recorded endpoints.'}</p></div>}
        {allValid && <div className="ro-additional-metrics" aria-label="Other measured intervals">{ALL_METRICS.filter(metric => !STAGES.some(stage => stage.key === metric.key)).map(metric => <div key={metric.key}><span>{metric.label}</span><strong>{loading ? '…' : Number.isFinite(stageValues[metric.key]) ? duration(stageValues[metric.key]) : <MissingValue />}</strong><small>{stageCounts[metric.key] || 0} {stageCounts[metric.key] === 1 ? 'Record' : 'Records'}</small></div>)}</div>}
        <details className="rp-method-note ro-breakdown mo-method"><summary><PerformanceIcon name="info" />How this is calculated<PerformanceIcon name="chevron" /></summary><div className="mo-method-content is-single"><p>{allValid ? 'Each stage includes all of its valid measurements. Processing and suppression count incidents; preparation and travel count trucks. Bars compare mean durations; sample counts can differ. Call-to-arrival and overall operation are separate measures using their recorded endpoints.' : 'Only incidents with all four stages recorded are included. The first arriving truck supplies response stages. Percentages show each stage’s share of their combined mean duration.'}</p></div></details>
        </div>
      </section>
    </div>
  </>
}

function MissingValue() {
  return <span className="ro-missing-value" aria-label="No data">—</span>
}

function ReceiptDateTime({ value }) {
  if (!value) return <MissingValue />
  const date = new Date(value)
  const options = { timeZone: 'Asia/Manila' }
  return <time className="ro-receipt-time" dateTime={value}>
    <span>{date.toLocaleDateString('en-PH', { ...options, year: 'numeric', month: 'short', day: 'numeric' }).replaceAll(',', '')}</span>
    <span>{date.toLocaleTimeString('en-PH', { ...options, hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
  </time>
}

function responseKindLabel(kind) {
  if (!kind) return 'Unclassified'
  const label = kind.replaceAll('_', ' ').toLowerCase()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function IncidentRecords({ query, revision, onOpenAnalysis, demo, month, months, onMonthChange, teams, page, onPageChange: setPage }) {
  const [filters, setFilters] = useState({ team: '', quality: '', assignment: '' })
  const [results, setResults] = useState(() => new Map())
  const [csv, setCsv] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [retry, setRetry] = useState(0)
  const params = monthParams(query, month)
  for (const [key, value] of Object.entries({ incident_team_id: filters.team, arrival_quality: filters.quality, incident_assignment_type: filters.assignment })) if (value) params.set(key, value)
  const exportQuery = params.toString()
  params.set('page', page)
  const key = params.toString()
  const epoch = `${revision}:${retry}`
  const result = results.get(key)
  const data = result?.data
  const error = result?.error
  const loading = !data && !error
  const dirty = Boolean(month) || Object.values(filters).some(Boolean)
  const updateFilter = (field, value) => { setFilters(previous => ({ ...previous, [field]: value })); setPage(1); setExportError(null) }
  useEffect(() => {
    if (result?.epoch === epoch) return
    const controller = new AbortController()
    let alive = true
    const remember = value => setResults(previous => {
      const next = new Map(previous)
      next.delete(key); next.set(key, value)
      if (next.size > 12) next.delete(next.keys().next().value)
      return next
    })
    fetchResponseIncidents(key, controller.signal).then(data => { if (alive) remember({ epoch, data }) }, error => {
      if (alive && error.name !== 'AbortError') remember({ epoch, data: result?.data, error: error.message })
    })
    return () => { alive = false; controller.abort() }
  }, [key, epoch, result])
  async function download() {
    setExporting(true); setExportError(null)
    try { setCsv(await exportResponseIncidents(exportQuery)) }
    catch (error) { setExportError(error.message) }
    finally { setExporting(false) }
  }
  const currentPage = data?.page || page
  const totalPages = data?.total_pages || 1
  const pageSize = data?.page_size || 10
  const total = data?.total || 0
  const pageNumbers = totalPages <= 7 ? Array.from({ length: totalPages }, (_, i) => i + 1)
    : currentPage <= 4 ? [1, 2, 3, 4, 5, '…', totalPages]
      : currentPage >= totalPages - 3 ? [1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
        : [1, '…', currentPage - 1, currentPage, currentPage + 1, '…', totalPages]
  return <section className="rp-card rp-observations ro-incident-records" aria-label="Incident records" aria-busy={loading}>
    <div className="rp-section-heading"><div className="ro-stage-heading-copy"><span className="ro-table-icon"><PerformanceIcon name="handling" /></span><div><div className="rp-heading-title"><h2>Incident records</h2><span className="rp-count">{data?.total || 0}</span></div><p>Inspect milestones, responding units and route evidence for each incident.</p></div></div>
      <button className="rp-export" disabled={loading || !!error || exporting} onClick={download}><PerformanceIcon name="download" />{exporting ? 'Preparing…' : 'Review incident CSV'}</button></div>
    <div className="ro-dispatch-filters" role="group" aria-label="Incident record filters">
      <label>Month<select aria-label="Incident month" value={month} onChange={event => { onMonthChange(event.target.value); setExportError(null) }}><option value="">All months</option>{months.map(value => <option key={value} value={value}>{new Date(`${value}-01T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'long', year: 'numeric' })}</option>)}</select></label>
      <label>Responding team<select aria-label="Incident team" disabled={demo} value={filters.team} onChange={event => updateFilter('team', event.target.value)}><option value="">All teams</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      <label>Call-to-arrival data<select aria-label="Incident arrival data" value={filters.quality} onChange={event => updateFilter('quality', event.target.value)}><option value="">All arrival data</option>{['valid', 'pending', 'missing', 'invalid', 'excluded'].map(quality => <option key={quality} value={quality}>{responseKindLabel(quality)}</option>)}</select></label>
      <label>Assignment<select aria-label="Incident assignment" disabled={demo} value={filters.assignment} onChange={event => updateFilter('assignment', event.target.value)}><option value="">All assignments</option><option value="initial">With initial dispatches</option><option value="reinforcement">With reinforcements</option></select></label>
      <button type="button" className="ro-reset-dispatch-filters" aria-label="Reset incident filters" title="Reset incident filters" disabled={!dirty} onClick={() => { setFilters({ team: '', quality: '', assignment: '' }); onMonthChange(''); setPage(1); setExportError(null) }}><PerformanceIcon name="refresh" /></button>
    </div>
    {(error || exportError) && <p role="alert" className="rp-error">{error || exportError}{error && <button onClick={() => setRetry(n => n + 1)}>Retry incidents</button>}</p>}
    <div className="rp-scroll"><table><thead><tr>{Object.entries(INCIDENT_COLUMNS).map(([label, explanation]) => <ExplainedTableHeading key={label} label={label} explanation={explanation} table="incidents" />)}</tr></thead><tbody>
      {loading ? [0, 1, 2].map(n => <tr key={n} aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <td key={i}><span className="rp-cell-skeleton kpi-sk" /></td>)}</tr>) : data?.records.map(record => <tr key={record.fire_id}>
        <td><div className="ro-record-incident">INC-{record.fire_id}{record.status ? <StatusPill status={record.status} incident={record} /> : <MissingValue />}</div></td>
        <td><ReceiptDateTime value={record.synthetic_timeline?.report_received_at || record.reported_at || record.occurred_at} />{!record.reported_at && (record.synthetic_timeline?.report_received_at || record.occurred_at) && <small>{demo ? 'Synthesized receipt' : <>Occurrence date <span className="ro-label-separator" aria-hidden="true">|</span> receipt unknown</>}</small>}</td>
        <td>{record.location || record.barangay || <MissingValue />}<small>{record.response_kind ? responseKindLabel(record.response_kind) : <MissingValue />}</small></td>
        <td><span className="ro-unit-count">{record.dispatch_count == null ? <MissingValue /> : <>{record.dispatch_count} {record.dispatch_count === 1 ? 'Dispatch' : 'Dispatches'}</>}<small>{record.unit_count == null ? <MissingValue /> : <>{record.unit_count} {record.unit_count === 1 ? 'Truck' : 'Trucks'}</>}</small></span></td>
        {['cta', 'suppression', 'operation'].map(metric => <td key={metric} className="rp-duration">{metric === 'suppression' && record.response_kind && record.response_kind !== 'fire' ? 'N/A' : Number.isFinite(record.durations[metric]) ? duration(record.durations[metric]) : <MissingValue />}
          {record.metrics?.[metric]?.reason && <small>{record.metrics[metric].reason.replaceAll('_', ' ')}</small>}</td>)}
        <td><button type="button" className="inc-btn-view" aria-label={`View response analysis for INC-${record.fire_id}`} onClick={() => onOpenAnalysis(record.fire_id)}>View</button></td>
      </tr>)}
    </tbody></table></div>
    {!loading && !error && !data?.records.length && <div className="rp-empty"><h3>No incident records match these filters</h3><p>Try a wider date range or another record kind.</p></div>}
    {!loading && !error && total > 0 && <nav className="inc-pagination" aria-label="Incident pages">
      <span className="inc-page-info">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} of {total}</span>
      <div className="inc-page-controls">
        <button type="button" className="inc-page-btn next-prev-btn" aria-label="Previous incidents" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button>
        {pageNumbers.map((n, i) => n === '…' ? <span key={`ellipsis-${i}`} className="inc-page-ellipsis">…</span>
          : <button type="button" key={n} className={`inc-page-btn${currentPage === n ? ' active' : ''}`} aria-label={`Incident page ${n}`} aria-current={currentPage === n ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>)}
        <button type="button" className="inc-page-btn next-prev-btn" aria-label="Next incidents" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>›</button>
      </div>
    </nav>}
    {csv != null && <CsvReviewModal csv={csv} fileName="response-operations-incidents.csv" title="Incident lifecycle CSV" onClose={() => setCsv(null)} />}
  </section>
}

export default function ResponsePerformanceView({ onOpenAnalysis, onOpenDispatch }) {
  const { tooltipHandlers, renderTooltip } = useMetricTooltips()
  const [filters, setFilters] = useState(() => ({ ...initialDates(), period: 'custom', source: 'recorded', kind: 'operational', teams: [], station: '', barangay: '', severity: '' }))
  const [page, setPage] = useState(1)
  const [month, setMonth] = useState('')
  const [dispatchFilters, setDispatchFilters] = useState({ team: '', quality: '', assignment: '' })
  const [dispatchResults, setDispatchResults] = useState(() => new Map())
  const [incidentSelection, setIncidentSelection] = useState({ key: '', month: '', at: null })
  const [incidentPagination, setIncidentPagination] = useState({ key: '', page: 1 })
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(null)
  const [csvReview, setCsvReview] = useState(null)
  const query = queryFor(filters)
  const tableParams = monthParams(query, month)
  for (const [key, value] of Object.entries({ dispatch_team_id: dispatchFilters.team, response_quality: dispatchFilters.quality, assignment_type: dispatchFilters.assignment })) if (value) tableParams.set(key, value)
  const exportQuery = tableParams.toString()
  tableParams.set('page', page)
  tableParams.set('page_size', 10)
  const tableQuery = tableParams.toString()
  // Refreshes update the current view in place instead of clearing its cards,
  // charts and tables whenever GPS-related operational evidence changes.
  const key = query
  const data = result?.key === key ? result.data : null
  const operations = result?.key === key ? result.operations : null
  const dispatchResult = dispatchResults.get(tableQuery)
  const rows = dispatchResult?.rows || null
  const dispatchError = dispatchResult?.error || null
  const dispatchLoading = !rows && !dispatchError
  const error = result?.key === key ? result.error : null
  const loading = !data && !error
  const dispatchDirty = Boolean(month) || Object.values(dispatchFilters).some(Boolean)
  const updateDispatchFilter = (field, value) => { setDispatchFilters(previous => ({ ...previous, [field]: value })); setPage(1); setExportError(null) }
  const choices = result?.data
  const incidentMonth = incidentSelection.key === query ? incidentSelection.month : ''
  const operationalTimeframe = incidentSelection.key === query ? incidentSelection.at : null
  const incidentMonths = [...new Set((operations?.trends || []).map(point => monthFor(point.at)))]
  const incidentPage = incidentPagination.key === query ? incidentPagination.page : 1
  const setIncidentPage = page => setIncidentPagination({ key: query, page })
  const changeIncidentMonth = month => {
    const point = operations?.trend_period === 'all' ? operations.trends?.find(point => monthFor(point.at) === month) : null
    setIncidentSelection({ key: query, month, at: point?.at || null }); setIncidentPage(1)
  }
  const changeOperationalTimeframe = at => {
    const next = at === operationalTimeframe ? null : at
    setIncidentSelection({ key: query, month: next ? monthFor(next) : '', at: next }); setIncidentPage(1)
  }
  const currentPage = rows?.page || page
  const totalPages = rows?.total_pages || 1
  const pageSize = rows?.page_size || 10
  const total = rows?.total || 0
  const pageNumbers = totalPages <= 7 ? Array.from({ length: totalPages }, (_, i) => i + 1)
    : currentPage <= 4 ? [1, 2, 3, 4, 5, '…', totalPages]
      : currentPage >= totalPages - 3 ? [1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages]
        : [1, '…', currentPage - 1, currentPage, currentPage + 1, '…', totalPages]
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
    let alive = true
    Promise.all([demo ? Promise.resolve({}) : fetchResponsePerformance(query, controller.signal), fetchResponseOperations(query, controller.signal)])
      .then(([data, operations]) => { if (alive) setResult({ key, data, operations }) }, err => {
        if (alive && err.name !== 'AbortError') setResult(previous => ({ ...(previous?.key === key ? previous : {}), key, error: err.message }))
      })
    return () => { alive = false; controller.abort() }
  }, [query, revision, key, demo])
  useEffect(() => {
    if (dispatchResult?.revision === revision) return
    const controller = new AbortController()
    let alive = true
    const remember = result => setDispatchResults(previous => {
      const next = new Map(previous)
      next.delete(tableQuery)
      next.set(tableQuery, result)
      if (next.size > 12) next.delete(next.keys().next().value)
      return next
    })
    const request = demo ? Promise.resolve({ records: [] }) : fetchResponseDispatches(tableQuery, controller.signal)
    request.then(rows => { if (alive) remember({ revision, rows }) }, err => {
      if (alive && err.name !== 'AbortError') remember({ revision, rows: dispatchResult?.rows, error: err.message })
    })
    return () => { alive = false; controller.abort() }
  }, [tableQuery, revision, demo, dispatchResult])
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
    </header>
    <section className="rp-filter-panel" aria-label="Response filters">
      <div className="rp-filter-title"><span><PerformanceIcon name="filter" />Analysis Window</span><button className="ro-reset-filters" onClick={() => { setFilters({ ...initialDates(), period: 'custom', source: 'recorded', kind: 'operational', teams: [], station: '', barangay: '', severity: '' }); setPage(1); setMonth('') }}>Reset Filters</button></div>
      <div className="rp-filters">
        <label>Reporting Period<select value={filters.period} onChange={e => setPeriod(e.target.value)}>{Object.entries({ custom: 'Custom Dates', '1d': 'Past Day', '1w': 'Past Week', '1m': 'Past Month', '6m': 'Past Six Months', '1y': 'Past Year', all: 'All Recorded Dates' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Timing Data<select value={filters.source} onChange={e => update('source', e.target.value)}><option value="recorded">Recorded Operational Times</option></select></label>
        <label>Start Date<input type="date" disabled={filters.period === 'all'} aria-describedby="rp-date-help" value={filters.period === 'all' && operations?.start ? new Date(new Date(operations.start).getTime() + 8 * 3600000).toISOString().slice(0, 10) : filters.start} onChange={e => update('start', e.target.value)} /></label>
        <label>End Date<input type="date" aria-describedby="rp-date-help" value={filters.end} onChange={e => update('end', e.target.value)} /></label>
        <label>Record Kind<select disabled={demo} value={demo ? 'all' : filters.kind} onChange={e => update('kind', e.target.value)}>{['operational', 'drill', 'test', 'unknown', 'all'].map(k => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}</select></label>
      </div>
      {!demo && <details className="ro-refinements"><summary><span><PerformanceIcon name="filter" />Refine by Team, Station or Location{refinementCount > 0 && <span className="rp-count">{refinementCount} Active</span>}</span><PerformanceIcon name="chevron" /></summary><div className="rp-filters ro-refinement-fields">
        {!demo && <TeamFilter teams={choices?.teams || []} selected={filters.teams} onChange={value => update('teams', value)} />}
        {!demo && <label>Station<select value={filters.station} onChange={e => update('station', e.target.value)}><option value="">All Stations</option>{choices?.stations?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {!demo && <label>Barangay<select value={filters.barangay} onChange={e => update('barangay', e.target.value)}><option value="">All Barangays</option>{choices?.barangays?.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
        {!demo && <label>Severity<select value={filters.severity} onChange={e => update('severity', e.target.value)}><option value="">All Severities</option>{['Minor', 'Moderate', 'Critical'].map(s => <option key={s}>{s}</option>)}</select></label>}
      </div></details>}
      {!demo && activeRefinements.length > 0 && <div className="ro-filter-chips" aria-label="Active refinements">{activeRefinements.map(item => <button key={item.key} onClick={() => update(item.key, item.value)} aria-label={`Remove ${item.label} filter`}>{item.label}<span aria-hidden="true">×</span></button>)}</div>}
      <span id="rp-date-help" className="rp-sr-only">Dates in PHT · end date excluded</span>
    </section>
    {error && <div className="rp-error" role="alert"><PerformanceIcon name="info" /><div><strong>Could not load response observations</strong><p>{error}</p></div><button onClick={() => setRevision(n => n + 1)}>Retry</button></div>}
    {loading && <span className="rp-sr-only" role="status">Loading response observations…</span>}
    {(!error || data) && <>
      {demo && <aside className="ro-demo-banner"><PerformanceIcon name="info" /><div><strong>Synthesized BFP history</strong><p>Timings are simulated from historical incident dates. These figures do not measure actual BFP response performance.</p></div></aside>}
      <LifecyclePanel data={operations} loading={loading} demo={demo} selectedTimeframe={operationalTimeframe} onTimeframeChange={changeOperationalTimeframe} />
      <IncidentRecords key={query} query={query} revision={revision} onOpenAnalysis={onOpenAnalysis} demo={demo} month={incidentMonth} months={incidentMonths} onMonthChange={changeIncidentMonth} teams={choices?.teams || []} page={incidentPage} onPageChange={setIncidentPage} />
      {!demo && <details className="ro-team-analysis">
      <summary><span className="ro-team-summary-icon"><PerformanceIcon name="chart" /></span><span className="ro-team-summary-copy"><strong>Team comparison and dispatch evidence</strong><span>Compare crews, review monthly trends and trace individual dispatches.</span></span><span className="rp-count">{data?.candidate_dispatches ?? rows?.total ?? 0} dispatches</span><PerformanceIcon name="chevron" /></summary>
      <div className="ro-team-content">
      <div className="rp-section-heading rp-interval-heading"><div><h2>Response intervals</h2><p>One observation per dispatch for {filters.teams.length ? 'selected teams' : 'all teams'}. Dispatch handling includes later reinforcements.</p></div><span className="rp-tag">Dispatch-based</span></div>
      <div className="rp-kpis">{Object.entries(MEASURES).map(([key, label]) => {
        const stat = data?.summary[key]
        return <section className="rp-card rp-metric-card" key={key}>
          <div className="ro-team-tooltip-area" tabIndex={0} aria-label={label} {...tooltipHandlers(`team-${key}`)}>
          <KpiCard icon={<PerformanceIcon name={key} />} accent="fire" label={label} value={stat?.mean_seconds == null ? KPI_EMPTY : duration(stat.mean_seconds)} loading={loading}
            showNativeTooltip={false}
            sub={key === 'response' ? 'Dispatch → arrival' : key === 'handling' ? 'Report receipt → dispatch' : key === 'acknowledgement' ? 'Dispatch → acknowledgement' : key === 'turnout' ? 'Dispatch → departure' : 'Departure → arrival'}
            trend={stat?.change_percent == null ? null : { dir: stat.change_percent > 0 ? 'up' : 'down', text: `${Math.abs(stat.change_percent).toFixed(1)}% vs preceding window` }} />
          {renderTooltip(`team-${key}`, TEAM_EXPLANATIONS[key])}
          </div>
          <Quality stat={stat} compact />
        </section>
      })}</div>
      <details className="rp-method-note mo-method"><summary><PerformanceIcon name="info" />How to read these intervals<PerformanceIcon name="chevron" /></summary><div className="mo-method-content is-single"><p>Incident windows use report receipt dates, with occurrence dates used for listing when receipt is unknown. Team comparisons use dispatch dates. Acknowledgement is included in turnout; do not add them together. Missing receipt times do not prevent dispatch-to-arrival or truck travel measurement. Response intervals above six hours remain inspectable as invalid observations; suppression and overall operation can be longer. p90 uses the nearest-rank method.</p></div></details>
      <TeamTrend monthly={data?.monthly || []} loading={loading} selectedMonth={month} onMonth={value => { setMonth(current => current === value ? '' : value); setPage(1); setExportError(null) }} />
      <section className="rp-card rp-observations ro-dispatch-observations" aria-label="Dispatch observations" aria-busy={dispatchLoading}>
        <div className="rp-section-heading"><div><div className="rp-heading-title"><h2>Dispatch observations</h2>{!dispatchLoading && <span className="rp-count">{rows?.total || 0}</span>}</div><p>Inspect the records behind the response times</p></div>
          <button className="rp-export" disabled={exporting || dispatchLoading || !!dispatchError} onClick={download}><PerformanceIcon name="download" />{exporting ? 'Exporting…' : 'Export filtered CSV'}</button>
        </div>
        <div className="ro-dispatch-filters" role="group" aria-label="Dispatch observation filters">
          <label>Month<select aria-label="Dispatch month" value={month} onChange={event => { setMonth(event.target.value); setPage(1); setExportError(null) }}><option value="">All months</option>{(data?.monthly || []).map(item => <option key={item.month} value={item.month}>{new Date(`${item.month}-01T00:00:00+08:00`).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'long', year: 'numeric' })}</option>)}</select></label>
          <label>Team<select aria-label="Dispatch team" value={dispatchFilters.team} onChange={event => updateDispatchFilter('team', event.target.value)}><option value="">All teams</option>{(choices?.teams || []).map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <label>Response data<select aria-label="Dispatch response data" value={dispatchFilters.quality} onChange={event => updateDispatchFilter('quality', event.target.value)}><option value="">All response data</option>{['valid', 'pending', 'missing', 'invalid', 'excluded'].map(quality => <option key={quality} value={quality}>{responseKindLabel(quality)}</option>)}</select></label>
          <label>Assignment<select aria-label="Dispatch assignment" value={dispatchFilters.assignment} onChange={event => updateDispatchFilter('assignment', event.target.value)}><option value="">All assignments</option><option value="initial">Initial dispatches</option><option value="reinforcement">Reinforcements</option></select></label>
          <button type="button" className="ro-reset-dispatch-filters" aria-label="Reset dispatch filters" title="Reset dispatch filters" disabled={!dispatchDirty} onClick={() => { setDispatchFilters({ team: '', quality: '', assignment: '' }); setMonth(''); setPage(1); setExportError(null) }}><PerformanceIcon name="refresh" /></button>
        </div>
        {dispatchError && <div className="rp-error" role="alert"><span>{dispatchError}</span><button onClick={() => setRevision(value => value + 1)}>Retry dispatches</button></div>}
        {exportError && <p className="rp-error" role="alert">{exportError}</p>}
        <div className="rp-scroll"><table><thead><tr>{Object.entries(DISPATCH_COLUMNS).map(([label, explanation]) => <ExplainedTableHeading key={label} label={label} explanation={explanation} table="dispatches" visuallyHidden={label === 'Actions'} />)}</tr></thead><tbody>
          {dispatchLoading ? [0, 1, 2].map(n => <tr key={n} aria-hidden="true">{Array.from({ length: 10 }, (_, i) => <td key={i}><span className="rp-cell-skeleton kpi-sk" /></td>)}</tr>) : rows?.records.map(r => <tr key={r.dispatch_id}>
            <td><div className="ro-record-incident"><span>DISP-{r.dispatch_id}</span><span className="ro-dispatch-incident">INC-{r.fire_id}</span></div></td>
            <td><span className="rp-team-name">{r.context.team_name || <MissingValue />}</span><small className="ro-dispatch-context">{r.context.station_name || <MissingValue />}<span className="ro-label-separator" aria-hidden="true">|</span>{r.context.shift_name?.trim() ? <span className="ro-shift-chip" title={r.context.shift_name} aria-label={r.context.shift_name}>{r.context.shift_name.replace('Shift ', '')}</span> : <MissingValue />}{r.reinforcement && <><span className="ro-label-separator" aria-hidden="true">|</span>Reinforcement</>}</small></td>
            <td>{r.location || <MissingValue />}<small className="ro-dispatch-context ro-dispatch-location">{r.severity ? <SeverityBadge sev={r.severity} /> : <MissingValue />}<span className="ro-label-separator" aria-hidden="true">|</span>{r.record_kind ? responseKindLabel(r.record_kind) : <MissingValue />}</small></td>
            {[r.dispatch_at, r.acknowledged_at, r.departed_at, r.arrived_at].map((at, i) => <td key={i} className={`rp-timestamp${!at ? ' is-missing' : ''}`}><ReceiptDateTime value={at} /></td>)}
            <td className="rp-duration">{Number.isFinite(r.metrics.response.seconds) ? duration(r.metrics.response.seconds) : <MissingValue />}</td><td><span className="rp-quality-badge" data-quality={r.metrics.response.quality}>{responseKindLabel(r.metrics.response.reason || 'valid')}</span></td>
            <td><button type="button" className="inc-btn-view" aria-label={`View dispatch DISP-${r.dispatch_id}`} onClick={() => onOpenDispatch(r.dispatch_id, r.fire_id)}>View</button></td>
          </tr>)}
        </tbody></table></div>
        {!dispatchLoading && !dispatchError && !rows?.records.length && <div className="rp-empty"><PerformanceIcon name="handling" /><h3>No dispatch observations match these filters</h3><p>Adjust the table filters or selected month</p>{filters.kind === 'operational' && <button onClick={() => update('kind', 'unknown')}>View unclassified records</button>}</div>}
        {!dispatchLoading && !dispatchError && total > 0 && <nav className="inc-pagination" aria-label="Dispatch pages">
          <span className="inc-page-info">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, total)} of {total}</span>
          <div className="inc-page-controls">
            <button type="button" className="inc-page-btn next-prev-btn" aria-label="Previous dispatches" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button>
            {pageNumbers.map((n, i) => n === '…' ? <span key={`ellipsis-${i}`} className="inc-page-ellipsis">…</span>
              : <button type="button" key={n} className={`inc-page-btn${currentPage === n ? ' active' : ''}`} aria-label={`Dispatch page ${n}`} aria-current={currentPage === n ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>)}
            <button type="button" className="inc-page-btn next-prev-btn" aria-label="Next dispatches" disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>›</button>
          </div>
        </nav>}
      </section>
      </div>
      </details>}
      {!demo && <ShiftComparison data={data?.shift_comparison} loading={loading} />}
      {data?.notice && <p className="rp-notice"><PerformanceIcon name="info" />{data.notice}</p>}
    </>}
    {csvReview != null && <CsvReviewModal csv={csvReview} fileName="response-performance.csv" title="Response Performance CSV" onClose={() => setCsvReview(null)} />}
  </div></main>
}
