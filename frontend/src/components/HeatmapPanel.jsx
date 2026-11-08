import { useState } from 'react'
import MapControlIcon from './MapControlIcon'
import { HEAT_COLORS, manilaDate } from '../utils/heatmap'
import '../styles/HeatmapPanel.css'
import '../styles/CommandViewPanel.css'

export default function HeatmapPanel({ range, onRangeChange, count, status, onRefresh }) {
  const [customRange, setCustomRange] = useState(false)
  const [rangeDraft, setRangeDraft] = useState(range)
  const [rangeError, setRangeError] = useState('')
  const today = manilaDate(new Date())
  const selectedDays = !range.from && !range.to ? 0 : Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1
  function preset(days) {
    setCustomRange(false)
    setRangeError('')
    if (!days) { setRangeDraft({ from: '', to: '' }); onRangeChange({ from: '', to: '' }); return }
    const today = manilaDate(new Date())
    const start = new Date(`${today}T00:00:00Z`)
    start.setUTCDate(start.getUTCDate() - days + 1)
    const next = { from: start.toISOString().slice(0, 10), to: today }
    setRangeDraft(next)
    onRangeChange(next)
  }
  function updateRange(key, value) {
    const next = { ...rangeDraft, [key]: value }
    setRangeDraft(next)
    setCustomRange(!!(next.from || next.to))
    if (next.from && next.to && next.from > next.to) { setRangeError('The start date must be on or before the end date.'); return }
    if (next.from > today || next.to > today) { setRangeError('Reporting dates cannot be in the future.'); return }
    setRangeError('')
    onRangeChange(next.from || next.to ? { from: next.from, to: next.to || today } : { from: '', to: '' })
  }
  return <section className="heatmap-panel command-view-panel" aria-label="Fire history heatmap">
    <div className="command-view-heading">
      <span><MapControlIcon name="heatmap" />Fire History</span>
      <span className="command-view-badge heatmap-view-badge">HEATMAP</span>
    </div>
    <div className="heatmap-panel-body">
      <div className="heatmap-summary" aria-busy={status === 'loading'}>
        <div className="heatmap-summary-heading"><span>Closed Incidents</span></div>
        <strong>{status === 'loading' ? '…' : status === 'error' ? '—' : count.toLocaleString()}</strong>
      </div>
      <div className="heatmap-presets" role="group" aria-label="Heatmap date presets">
        {[0, 30, 365].map(days => <button key={days} type="button" aria-pressed={!customRange && selectedDays === days} onClick={() => preset(days)}>{days ? `Last ${days} days` : 'All time'}</button>)}
      </div>
      <div className={`heatmap-date-range${range.from || range.to ? ' is-active' : ''}`} role="group" aria-label="Custom fire history date range">
        <label>From<input type="date" aria-label="Start date" className={!rangeDraft.from ? 'is-empty' : undefined} value={rangeDraft.from} max={rangeDraft.to || today} onChange={event => updateRange('from', event.target.value)} /></label>
        <label>To<input type="date" aria-label="End date" className={!rangeDraft.to ? 'is-empty' : undefined} value={rangeDraft.to} min={rangeDraft.from || undefined} max={today} onChange={event => updateRange('to', event.target.value)} /></label>
        {rangeError && <span className="heatmap-range-error" role="alert">{rangeError}</span>}
      </div>
      <div className="heatmap-legend">
        <div className="heatmap-gradient" style={{ background: `linear-gradient(to right, ${HEAT_COLORS.join(',')})` }} />
        <div><span>Lower concentration</span><span>Higher</span></div>
      </div>
      <div className="heatmap-status" role={status === 'error' ? 'alert' : 'status'}>
        {status === 'loading' ? 'Updating fire history...' : status === 'error' ? 'Fire history could not load.' : count ? 'Historical concentration, not predicted fire risk.' : 'No closed incidents match this region and period.'}
      </div>
      <button type="button" className="heatmap-refresh" onClick={onRefresh} disabled={status === 'loading'}>{status === 'error' ? 'Retry' : 'Refresh Data'}</button>
    </div>
  </section>
}
