import { useState } from 'react'
import useMetricTooltips from '../hooks/useMetricTooltips'
import { duration } from '../utils/operationalTimes'
import PerformanceIcon from './AnalysisIcon'
import DurationTrendChart from './DurationTrendChart'

const METRICS = { response: 'Dispatch to arrival', turnout: 'Preparation', travel: 'Travel' }
const SHIFTS = ['Shift A', 'Shift B']
const SERIES = SHIFTS.map((name, index) => ({ key: name, label: name, color: index ? '#81a4e8' : 'var(--duration-green, #00b84a)' }))
const STATISTICS = { median_seconds: 'Median', mean_seconds: 'Average', p90_seconds: 'p90' }
const STATISTIC_EXPLANATIONS = {
  median_seconds: 'The middle response time when valid times are sorted from shortest to longest. Half are at or below this time and half are at or above it.',
  mean_seconds: 'All valid response times added together, then divided by the number of valid dispatches. A few very long responses can raise this value.',
  p90_seconds: 'At least 90% of valid response times are at or below this time. It helps show how long slower responses take.',
  counts: 'Valid is the number of dispatches with usable recorded times for this interval. Total includes all dispatches considered, even those with missing, pending, invalid or excluded times. Fewer than 10 valid times means the comparison is based on a small sample.',
}
const INTERVAL_EXPLANATIONS = {
  response: 'Measured from dispatch until arrival at the scene.',
  turnout: 'Measured from dispatch until departure, including getting ready.',
  travel: 'Measured from departure until arrival at the scene.',
}

export default function ShiftComparison({ data, loading }) {
  const { tooltipHandlers, renderTooltip } = useMetricTooltips()
  const [metric, setMetric] = useState('response')
  const [assignment, setAssignment] = useState('initial')
  const [statistic, setStatistic] = useState('median_seconds')
  const [selectedAt, setSelectedAt] = useState(null)
  const group = data?.[assignment]
  const trends = group?.trends || []
  const selectedPoint = trends.find(point => point.at === selectedAt)
  const comparison = selectedPoint || group
  const shifts = SHIFTS.map(name => comparison?.shifts.find(shift => shift.name === name) || { name, dispatches: 0, summary: {} })
  const stats = shifts.map(shift => shift.summary[metric])
  const comparable = stats.every(stat => Number.isFinite(stat?.[statistic]))
  const difference = comparable ? stats[0][statistic] - stats[1][statistic] : null
  const resultShift = difference != null && Math.abs(difference) >= 0.5 ? SERIES[difference < 0 ? 0 : 1] : null
  const legacy = shifts.reduce((sum, shift) => sum + (shift.legacy_dispatches || 0), 0)
  const formatPeriod = at => new Date(at).toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', month: 'short', year: 'numeric', ...(group?.period !== 'monthly' ? { day: 'numeric' } : {}), ...(group?.period === 'hourly' ? { hour: 'numeric' } : {}) })
  const points = trends.map(point => ({ label: formatPeriod(point.at),
    values: Object.fromEntries(SHIFTS.map(name => [name, point.shifts.find(shift => shift.name === name)?.summary[metric]?.[statistic] ?? null])),
    counts: Object.fromEntries(SHIFTS.map(name => [name, point.shifts.find(shift => shift.name === name)?.summary[metric]?.valid ?? 0])),
  }))
  const hasValues = points.some(point => SHIFTS.some(name => point.values[name] != null))
  return <details className="ro-team-analysis ro-shift-analysis" aria-labelledby="ro-shift-title" aria-busy={loading}>
    <summary><span className="ro-team-summary-icon"><PerformanceIcon name="chart" /></span><span className="ro-team-summary-copy"><strong id="ro-shift-title">Shift comparison</strong><span>Compare Shift A and Shift B across teams in the selected analysis window.</span></span><span className="rp-count">2 shifts</span><PerformanceIcon name="chevron" /></summary>
    <div className="ro-team-content ro-shift-content">
    <section className="ro-shift-filter-panel" aria-label="Shift comparison filters">
    <div className="rp-filter-title"><span><PerformanceIcon name="filter" />Shift comparison filters</span><button type="button" onClick={() => { setMetric('response'); setAssignment('initial'); setStatistic('median_seconds'); setSelectedAt(null) }}>Reset filters</button></div>
    <div className="ro-shift-controls">
      <label>Response interval<select value={metric} onChange={event => setMetric(event.target.value)}>{Object.entries(METRICS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Assignment<select value={assignment} onChange={event => setAssignment(event.target.value)}><option value="initial">Initial dispatches</option><option value="reinforcement">Reinforcements</option><option value="all">All assignments</option></select></label>
      <label>Statistic<select value={statistic} onChange={event => setStatistic(event.target.value)}>{Object.entries(STATISTICS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    </div>
    </section>
    {loading ? <p role="status">Loading shift comparison…</p> : !comparison ? <div className="rp-empty"><h3>Shift comparison is unavailable</h3><p>No shift observations are available for this analysis window.</p></div> : <>
      <div className="ro-analysis-grid ro-team-trend-grid ro-shift-trend-grid">
      <section className="ro-shift-metrics" aria-label="Shift statistics">
      <div className="rp-section-heading ro-shift-stat-heading"><div><span className="ro-eyebrow">Measured dispatches</span><h2>{selectedPoint ? formatPeriod(selectedPoint.at) : 'Full analysis window'}</h2></div><span className="rp-count">{stats.reduce((total, stat) => total + (stat?.valid ?? 0), 0)} dispatches</span></div>
      <p>Statistics for {selectedPoint ? 'the selected period' : 'all dispatches in the analysis window'}.</p>
      <div className="ro-shift-result-box"><span className="ro-shift-result-badge" style={{ '--shift-result-color': resultShift?.color || 'var(--rp-muted)' }} aria-label={resultShift?.label || 'Both shifts'}>{resultShift ? resultShift.label.replace('Shift ', '') : 'A/B'}</span><p className="ro-shift-result">{difference == null ? 'Both shifts need valid observations to calculate a difference.' : Math.abs(difference) < 0.5 ? `Both shifts have the same ${STATISTICS[statistic].toLowerCase()} time to the nearest second.` : `${difference < 0 ? 'Shift A' : 'Shift B'} has a ${duration(Math.abs(difference))} shorter ${STATISTICS[statistic].toLowerCase()} time.`}</p></div>
      <div className="rp-scroll"><table><caption className="rp-sr-only">{METRICS[metric]} statistics by shift</caption><thead><tr><th scope="col">Metric</th>{shifts.map(shift => <th scope="col" key={shift.name}>{shift.name}</th>)}</tr></thead><tbody>
        {Object.entries(STATISTICS).map(([key, label]) => <tr key={key} tabIndex={0} {...tooltipHandlers(`shift-${key}`)}><th scope="row">{label}{renderTooltip(`shift-${key}`, `${STATISTIC_EXPLANATIONS[key]} ${INTERVAL_EXPLANATIONS[metric]} Applies to the selected period and assignment filter.`, false)}</th>{stats.map((stat, index) => <td key={SHIFTS[index]}>{duration(stat?.[key])}</td>)}</tr>)}
        <tr tabIndex={0} {...tooltipHandlers('shift-counts')}><th scope="row">Valid / total{renderTooltip('shift-counts', STATISTIC_EXPLANATIONS.counts, false)}</th>{stats.map((stat, index) => <td key={SHIFTS[index]}>{stat?.valid ?? 0} / {stat?.candidate ?? 0}{stat?.small_sample && <small className="ro-shift-sample">Fewer than 10 valid</small>}</td>)}</tr>
      </tbody></table></div>
      {!stats.some(stat => stat?.valid > 0) && <p className="ro-shift-note">No valid timings match this interval and assignment. Adjust the analysis window or filters.</p>}
      </section>
      <section className="rp-card rp-trends ro-shift-trends" aria-label="Shift trend chart">
      <div className="rp-section-heading"><div><h2>Shift performance over time</h2><p>{STATISTICS[statistic]} {METRICS[metric].toLowerCase()} · {group.period || 'monthly'} periods in PHT. Select a period to inspect its statistics.</p></div></div>
      <div className="ro-shift-chart">
        {hasValues ? <DurationTrendChart label={`${group.period} ${STATISTICS[statistic].toLowerCase()} ${METRICS[metric].toLowerCase()} by shift`} points={points} series={SERIES}
          selectedIndex={trends.findIndex(point => point.at === selectedPoint?.at)}
          onSelect={index => setSelectedAt(current => current === trends[index].at ? null : trends[index].at)}
          onClose={selectedPoint ? () => setSelectedAt(null) : undefined}
          formatCount={count => `${count} valid dispatches`} /> : <div className="rp-empty rp-chart-empty"><PerformanceIcon name="chart" /><h3>No shift timings to chart</h3><p>Try another interval, assignment or analysis window.</p></div>}
      </div>
      <div className="ro-shift-legend ota-chart-footer" aria-label="Chart legend"><div className="ota-legend">{SERIES.map(series => <span key={series.key} style={{ '--ota-series-color': series.color }}><i />{series.label}</span>)}</div></div>
      <p className="ro-shift-note ota-chart-note"><PerformanceIcon name="info" />Gaps indicate periods without valid measurements. Lower times indicate faster responses.</p>
      <div className="ro-shift-quality" aria-label="Shift timing quality counts">
        {shifts.map((shift, index) => ['missing', 'pending', 'invalid', 'excluded'].some(key => stats[index]?.[key] > 0) && <div className="ro-shift-quality-row" key={shift.name}><strong>{shift.name}</strong><div className="rp-quality-counts">{['missing', 'pending', 'invalid', 'excluded'].map(key => <span key={key} data-present={stats[index]?.[key] > 0}>{stats[index]?.[key] ?? 0} {key}</span>)}</div></div>)}
      </div>
      </section>
      </div>
      <details className="rp-method-note mo-method"><summary><PerformanceIcon name="info" />How to read this chart<PerformanceIcon name="chevron" /></summary><div className="mo-method-content is-single"><div>
        <p>Preparation: dispatch to departure. Travel: departure to arrival. Each dispatch counts once; only valid timings contribute to duration statistics. p90 uses nearest rank.</p>
        <p>Incident suppression and total operation durations are shared outcomes and are not attributed to a shift.</p>
      </div></div></details>
      {legacy > 0 && <p className="ro-shift-note">{legacy} dispatches use current team metadata rather than a shift snapshot recorded at dispatch.</p>}
      {comparison.unknown_dispatches > 0 && <p className="ro-shift-note">{comparison.unknown_dispatches} dispatches have unknown or unsupported shift labels and are omitted from this comparison.</p>}
    </>}
    </div>
  </details>
}
