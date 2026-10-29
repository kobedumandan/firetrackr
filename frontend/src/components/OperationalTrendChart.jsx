import { useState } from 'react'
import { ALL_METRICS, duration } from '../utils/operationalTimes'
import AnalysisIcon from './AnalysisIcon'
import DurationTrendChart from './DurationTrendChart'

const seriesColor = stage => ['processing', 'cta'].includes(stage.key) ? 'var(--duration-green, #00b84a)' : stage.color

export default function OperationalTrendChart({ points = [], period, loading = false, demo = false, selectedMetric, onMetricChange }) {
  const [localMetric, setLocalMetric] = useState('all')
  const metric = selectedMetric ?? localMetric
  const setMetric = onMetricChange || setLocalMetric
  const series = metric === 'all' ? ALL_METRICS.slice(0, 4) : ALL_METRICS.filter(s => s.key === metric)
  const values = points.flatMap(p => series.map(s => p.values[s.key]).filter(v => v != null))
  const label = at => new Intl.DateTimeFormat('en-PH', period === '1d' ? { timeZone: 'Asia/Manila', hour: 'numeric' } : { timeZone: 'Asia/Manila', month: 'short', ...(['2023-2024', 'all'].includes(period) ? { year: '2-digit' } : {}), ...(period === '1w' || period === '1m' ? { day: 'numeric' } : {}) }).format(new Date(at))
  return <section className="ota-card ota-trends">
    <div className="ota-section-head"><div><h2>Operational trends</h2><p>Mean durations · gaps indicate missing measurements.</p></div>
      <label className="ota-trend-filter">Show<select aria-label="Trend metric" value={metric} onChange={e => setMetric(e.target.value)}><option value="all">All stages</option>{ALL_METRICS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
    </div>
    {loading ? <div className="kpi-sk ota-chart-skeleton" aria-hidden="true" /> : !values.length ? <div className="ota-empty ota-chart-empty"><AnalysisIcon name="chart" /><h3>No measured durations in this period.</h3><p>Try another period or stage. Intervals need both timestamps to appear here.</p></div> : <div className="ota-chart-scroll"><DurationTrendChart
      label={demo ? 'Synthesized demonstration duration trends in minutes' : 'Operational duration trends in minutes'}
      points={points.map(point => ({ label: label(point.at), values: point.values, counts: point.counts }))}
      series={series.map(stage => ({ ...stage, color: series.length === 1 ? 'var(--duration-green, #00b84a)' : seriesColor(stage) }))}
    /></div>}
    <div className="ota-chart-footer"><div className="ota-legend">{series.map(s => <span key={s.key} style={{ '--ota-series-color': series.length === 1 ? 'var(--duration-green, #00b84a)' : seriesColor(s) }}><i />{s.label}</span>)}</div><span className={`ota-tag${demo ? ' ota-demo-tag' : ''}`}>{demo ? 'Synthesized demo · ' : ''}Minutes · PHT</span></div>
    {!!points.length && !loading && <details className="ota-chart-data"><summary>Chart data and sample counts</summary><div className="ota-table-scroll"><table><thead><tr><th scope="col">Period · PHT</th>{series.map(s => <th scope="col" key={s.key}>{s.label}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.at}><th scope="row">{label(point.at)}</th>{series.map(s => <td key={s.key}>{duration(point.values[s.key])}<small>n={point.counts[s.key] || 0}</small></td>)}</tr>)}</tbody></table></div></details>}
  </section>
}
