import { useState } from 'react'
import { ALL_METRICS, duration } from '../utils/operationalTimes'

export default function OperationalTrendChart({ points = [], period }) {
  const [metric, setMetric] = useState('all')
  const series = metric === 'all' ? ALL_METRICS.slice(0, 4) : ALL_METRICS.filter(s => s.key === metric)
  const values = points.flatMap(p => series.map(s => p.values[s.key]).filter(v => v != null))
  const max = Math.max(60, ...values) * 1.15
  const x = index => 50 + index * 900 / Math.max(1, points.length - 1)
  const y = value => 180 - value / max * 150
  const label = at => new Intl.DateTimeFormat('en-PH', period === '1d' ? { timeZone: 'Asia/Manila', hour: 'numeric' } : { timeZone: 'Asia/Manila', month: 'short', ...(['2023-2024', 'all'].includes(period) ? { year: '2-digit' } : {}), ...(period === '1w' || period === '1m' ? { day: 'numeric' } : {}) }).format(new Date(at))
  return <section className="ota-card">
    <div className="ota-section-head"><div><h2>Operational Time Trends</h2><p>Average duration per stage over time · Philippine time</p></div>
      <select aria-label="Trend metric" value={metric} onChange={e => setMetric(e.target.value)}><option value="all">All Stages</option>{ALL_METRICS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
    </div>
    {!values.length ? <div className="ota-empty">No measured durations in this period.</div> : <div className="ota-chart-scroll"><svg viewBox="0 0 990 230" role="img" aria-label="Operational duration trends in minutes">
      {[0, 1, 2, 3].map(n => <g key={n}><line x1="50" x2="950" y1={y(n * max / 3)} y2={y(n * max / 3)} stroke="var(--border)" strokeDasharray="3 5" /><text x="40" y={y(n * max / 3) + 4} textAnchor="end">{(n * max / 180).toFixed(1)}</text></g>)}
      {series.map(s => {
        const segments = []; let current = []
        points.forEach((point, i) => { if (point.values[s.key] == null) { if (current.length) segments.push(current); current = [] } else current.push([i, point.values[s.key]]) })
        if (current.length) segments.push(current)
        return <g key={s.key}>{segments.map((segment, i) => <polyline key={i} points={segment.map(([index, value]) => `${x(index)},${y(value)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="2" />)}
          {points.map((p, i) => p.values[s.key] == null ? null : <circle key={p.at} cx={x(i)} cy={y(p.values[s.key])} r="4" fill={s.color} tabIndex="0" aria-label={`${label(p.at)}, ${s.label}: ${duration(p.values[s.key])}, ${p.counts[s.key]} observations`}><title>{label(p.at)} · {s.label}: {duration(p.values[s.key])} · n={p.counts[s.key]}</title></circle>)}
        </g>
      })}
      {points.map((point, i) => i % Math.max(1, Math.ceil(points.length / 9)) === 0 ? <text key={point.at} x={x(i)} y="207" textAnchor="middle">{label(point.at)}</text> : null)}
      <text x="10" y="12">Minutes</text>
    </svg></div>}
    <div className="ota-legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
  </section>
}
