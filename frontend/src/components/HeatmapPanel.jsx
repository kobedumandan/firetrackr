import { useState } from 'react'
import PanelToggleIcon from './PanelToggleIcon'
import { HEAT_COLORS, HEAT_RADIUS_METRES, manilaDate } from '../utils/heatmap'
import '../styles/HeatmapPanel.css'

export default function HeatmapPanel({ range, onRangeChange, count, status, onRefresh }) {
  const [open, setOpen] = useState(true)
  const invalid = range.from && range.to && range.from > range.to
  function preset(days) {
    if (!days) { onRangeChange({ from: '', to: '' }); return }
    const today = manilaDate(new Date())
    const start = new Date(`${today}T00:00:00Z`)
    start.setUTCDate(start.getUTCDate() - days + 1)
    onRangeChange({ from: start.toISOString().slice(0, 10), to: today })
  }
  if (!open) return <button type="button" className="constraint-float-btn" aria-label="Expand fire heatmap" aria-expanded={false} onClick={() => setOpen(true)}><PanelToggleIcon />Fire heatmap</button>
  return <section className="heatmap-panel" aria-label="Fire history heatmap">
    <div className="constraint-editor-head">
      <button type="button" className="constraint-collapse-btn" onClick={() => setOpen(false)} aria-label="Collapse fire heatmap" aria-expanded={true}><PanelToggleIcon expanded /></button>
      <span className="constraint-editor-title">Fire history</span>
    </div>
    <div className="heatmap-panel-body">
      <div className="heatmap-summary"><strong>{count.toLocaleString()}</strong><span>closed incident{count === 1 ? '' : 's'} in this region</span></div>
      <div className="heatmap-presets" aria-label="Heatmap date presets">
        <button type="button" onClick={() => preset(0)}>All time</button>
        <button type="button" onClick={() => preset(30)}>Last 30 days</button>
        <button type="button" onClick={() => preset(365)}>Last 365 days</button>
      </div>
      <div className="heatmap-dates">
        <label>From (PH time)<input type="date" value={range.from} max={range.to || undefined} onChange={e => onRangeChange({ ...range, from: e.target.value })} /></label>
        <label>Through (PH time)<input type="date" value={range.to} min={range.from || undefined} onChange={e => onRangeChange({ ...range, to: e.target.value })} /></label>
      </div>
      <div className="heatmap-legend">
        <div className="heatmap-gradient" style={{ background: `linear-gradient(to right, ${HEAT_COLORS.join(',')})` }} />
        <div><span>Lower concentration</span><span>Higher</span></div>
      </div>
      <p className="constraint-help">Severity-weighted fire history, smoothed within {HEAT_RADIUS_METRES} m. Colors are relative to this selection.</p>
      <p className="constraint-help">Imported history includes estimated address and representative area pins. Open a pin for its location specification; shared area pins can create apparent hotspots.</p>
      <div className="heatmap-status" role={invalid || status === 'error' ? 'alert' : 'status'}>
        {invalid ? 'Choose an end date on or after the start date.' : status === 'loading' ? 'Updating fire history...' : status === 'error' ? 'Fire history could not load.' : count ? 'Historical concentration, not predicted fire risk.' : 'No closed incidents match this region and date range.'}
      </div>
      {count > 0 && <p className="constraint-help">Hover an incident location on the heatmap for details. Click for more.</p>}
      <button type="button" className="heatmap-refresh" onClick={onRefresh} disabled={status === 'loading'}>{status === 'error' ? 'Retry' : 'Refresh data'}</button>
    </div>
  </section>
}
