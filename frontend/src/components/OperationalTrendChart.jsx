import { useState } from 'react'
import { ALL_METRICS } from '../utils/operationalTimes'
import AnalysisIcon from './AnalysisIcon'
import DurationTrendChart from './DurationTrendChart'

export default function OperationalTrendChart({ points = [], period, loading = false, demo = false, selectedMetric, onMetricChange, selectedTimeframe, onTimeframeChange, stagesOnly = false }) {
  const [localMetric, setLocalMetric] = useState('all')
  const metric = selectedMetric ?? localMetric
  const setMetric = onMetricChange || setLocalMetric
  const metrics = stagesOnly ? ALL_METRICS.slice(0, 4) : ALL_METRICS
  const series = metric === 'all' ? metrics.slice(0, 4) : metrics.filter(s => s.key === metric)
  const values = points.flatMap(p => series.map(s => p.values[s.key]).filter(v => v != null))
  const label = at => new Intl.DateTimeFormat('en-PH', period === '1d' ? { timeZone: 'Asia/Manila', hour: 'numeric' } : { timeZone: 'Asia/Manila', month: 'short', ...(['2023-2024', 'all'].includes(period) ? { year: '2-digit' } : {}), ...(period === '1w' || period === '1m' ? { day: 'numeric' } : {}) }).format(new Date(at))
  return <section className="ota-card ota-trends">
    <div className="ota-section-head"><div><h2>Operational trends</h2><p>Mean durations.</p></div>
      <label className="ota-trend-filter">Show<select aria-label="Trend metric" value={metric} onChange={e => setMetric(e.target.value)}><option value="all">All stages</option>{metrics.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
    </div>
    {loading ? <div className="kpi-sk ota-chart-skeleton" aria-hidden="true" /> : !values.length ? <div className="ota-empty ota-chart-empty"><AnalysisIcon name="chart" /><h3>No measured durations in this period.</h3><p>Try another period or stage. Intervals need both timestamps to appear here.</p></div> : <div className="ota-chart-scroll"><DurationTrendChart
      label={demo ? 'Synthesized demonstration duration trends in minutes' : 'Operational duration trends in minutes'}
      sortTooltipByValue formatCount={count => `${count} ${count === 1 ? 'Record' : 'Records'}`}
      selectedIndex={points.findIndex(point => point.at === selectedTimeframe)}
      onSelect={onTimeframeChange ? index => onTimeframeChange(points[index].at) : undefined}
      onClose={selectedTimeframe && onTimeframeChange ? () => onTimeframeChange(null) : undefined}
      points={points.map(point => ({ label: label(point.at), values: point.values, counts: point.counts }))}
      series={series}
    /></div>}
    <div className="ota-chart-footer"><div className="ota-legend">{series.map(s => <span key={s.key} style={{ '--ota-series-color': s.color }}><i />{s.label}</span>)}</div></div>
    <p className="ota-chart-note"><AnalysisIcon name="info" />Gaps indicate missing measurements.</p>
  </section>
}
