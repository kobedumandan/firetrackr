import { useState } from 'react'
import { ALL_METRICS, duration } from '../utils/operationalTimes'
import AnalysisIcon from './AnalysisIcon'

const seriesColor = stage => stage.key === 'cta' ? 'var(--text-primary)' : `color-mix(in srgb, ${stage.color} 70%, var(--text-primary))`

export default function OperationalTrendChart({ points = [], period, loading = false, demo = false }) {
  const [metric, setMetric] = useState('all')
  const series = metric === 'all' ? ALL_METRICS.slice(0, 4) : ALL_METRICS.filter(s => s.key === metric)
  const values = points.flatMap(p => series.map(s => p.values[s.key]).filter(v => v != null))
  const max = Math.max(60, ...values) * 1.15
  const x = index => 50 + index * 900 / Math.max(1, points.length - 1)
  const y = value => 180 - value / max * 150
  const label = at => new Intl.DateTimeFormat('en-PH', period === '1d' ? { timeZone: 'Asia/Manila', hour: 'numeric' } : { timeZone: 'Asia/Manila', month: 'short', ...(['2023-2024', 'all'].includes(period) ? { year: '2-digit' } : {}), ...(period === '1w' || period === '1m' ? { day: 'numeric' } : {}) }).format(new Date(at))
  return <section className="ota-card ota-trends">
    <div className="ota-section-head"><div><h2>Operational Time Trends</h2><p>Average duration per stage over time. Gaps indicate missing measurements.</p></div>
      <label className="ota-trend-filter">Show<select aria-label="Trend metric" value={metric} onChange={e => setMetric(e.target.value)}><option value="all">All Stages</option>{ALL_METRICS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
    </div>
    {loading ? <div className="kpi-sk ota-chart-skeleton" aria-hidden="true" /> : !values.length ? <div className="ota-empty ota-chart-empty"><AnalysisIcon name="chart" /><h3>No measured durations in this period.</h3><p>Try another period or stage. Intervals need both timestamps to appear here.</p></div> : <div className="ota-chart-scroll"><svg viewBox="0 0 990 230" role="img" aria-label={demo ? 'Synthesized demonstration duration trends in minutes' : 'Operational duration trends in minutes'}>
      {[0, 1, 2, 3].map(n => <g key={n}><line x1="50" x2="950" y1={y(n * max / 3)} y2={y(n * max / 3)} stroke="var(--border)" strokeDasharray="3 5" /><text x="40" y={y(n * max / 3) + 4} textAnchor="end">{(n * max / 180).toFixed(1)}</text></g>)}
      {series.map(s => {
        const segments = []; let current = []
        points.forEach((point, i) => { if (point.values[s.key] == null) { if (current.length) segments.push(current); current = [] } else current.push([i, point.values[s.key]]) })
        if (current.length) segments.push(current)
        return <g key={s.key}>{segments.map((segment, i) => <polyline key={i} points={segment.map(([index, value]) => `${x(index)},${y(value)}`).join(' ')} fill="none" stroke={seriesColor(s)} strokeWidth="2" />)}
          {points.map((p, i) => p.values[s.key] == null ? null : <circle key={p.at} cx={x(i)} cy={y(p.values[s.key])} r="4" fill={seriesColor(s)} tabIndex="0" aria-label={`${label(p.at)}, ${s.label}: ${duration(p.values[s.key])}, ${p.counts[s.key]} observations`}><title>{label(p.at)} · {s.label}: {duration(p.values[s.key])} · n={p.counts[s.key]}</title></circle>)}
        </g>
      })}
      {points.map((point, i) => i % Math.max(1, Math.ceil(points.length / 9)) === 0 ? <text key={point.at} x={x(i)} y="207" textAnchor="middle">{label(point.at)}</text> : null)}
      <text x="10" y="12">Minutes</text>
    </svg></div>}
    <div className="ota-chart-footer"><div className="ota-legend">{series.map(s => <span key={s.key} style={{ '--ota-series-color': seriesColor(s) }}><i />{s.label}</span>)}</div><span className={`ota-tag${demo ? ' ota-demo-tag' : ''}`}>{demo ? 'Synthesized demo · ' : ''}Minutes · PHT</span></div>
    {!!points.length && !loading && <details className="ota-chart-data"><summary>Chart data and sample counts</summary><div className="ota-table-scroll"><table><thead><tr><th scope="col">Period · PHT</th>{series.map(s => <th scope="col" key={s.key}>{s.label}</th>)}</tr></thead><tbody>{points.map(point => <tr key={point.at}><th scope="row">{label(point.at)}</th>{series.map(s => <td key={s.key}>{duration(point.values[s.key])}<small>n={point.counts[s.key] || 0}</small></td>)}</tr>)}</tbody></table></div></details>}
  </section>
}
