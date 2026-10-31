import MapControlIcon from './MapControlIcon'
import AnalysisIcon from './AnalysisIcon'
import { HEAT_COLORS, HEAT_RADIUS_METRES, manilaDate } from '../utils/heatmap'
import '../styles/HeatmapPanel.css'
import '../styles/CommandViewPanel.css'

export default function HeatmapPanel({ range, onRangeChange, count, status, onRefresh }) {
  const selectedDays = !range.from && !range.to ? 0 : Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1
  function preset(days) {
    if (!days) { onRangeChange({ from: '', to: '' }); return }
    const today = manilaDate(new Date())
    const start = new Date(`${today}T00:00:00Z`)
    start.setUTCDate(start.getUTCDate() - days + 1)
    onRangeChange({ from: start.toISOString().slice(0, 10), to: today })
  }
  return <section className="heatmap-panel command-view-panel" aria-label="Fire history heatmap">
    <div className="command-view-heading">
      <span><MapControlIcon name="heatmap" />Fire history</span>
      <span className="command-view-badge heatmap-view-badge">HEATMAP</span>
    </div>
    <div className="heatmap-panel-body">
      <div className="heatmap-summary" aria-busy={status === 'loading'}>
        <div className="heatmap-summary-heading"><span>Closed incidents</span></div>
        <strong>{status === 'loading' ? '…' : status === 'error' ? '—' : count.toLocaleString()}</strong>
      </div>
      <div className="heatmap-presets" role="group" aria-label="Heatmap date presets">{[0, 30, 365].map(days => <button key={days} type="button" aria-pressed={selectedDays === days} onClick={() => preset(days)}>{days ? `Last ${days} days` : 'All time'}</button>)}</div>
      <div className="heatmap-legend">
        <div className="heatmap-gradient" style={{ background: `linear-gradient(to right, ${HEAT_COLORS.join(',')})` }} />
        <div><span>Lower concentration</span><span>Higher</span></div>
      </div>
      <details className="heatmap-info">
        <summary><AnalysisIcon name="info" />About this heatmap<AnalysisIcon name="chevron" /></summary>
        <div className="heatmap-info-content">
          <section><div className="heatmap-info-heading"><span><AnalysisIcon name="chart" /></span><h3>Historical concentration</h3></div><p>Severity-weighted fire history, smoothed within {HEAT_RADIUS_METRES} m. Colors are relative to this selection.</p></section>
          <section><div className="heatmap-info-heading"><span><AnalysisIcon name="coverage" /></span><h3>Location accuracy</h3></div><p>Imported history includes estimated address and representative area pins. Open a pin for its location specification; shared area pins can create apparent hotspots.</p></section>
        </div>
      </details>
      <div className="heatmap-status" role={status === 'error' ? 'alert' : 'status'}>
        {status === 'loading' ? 'Updating fire history...' : status === 'error' ? 'Fire history could not load.' : count ? 'Historical concentration, not predicted fire risk.' : 'No closed incidents match this region and period.'}
      </div>
      {count > 0 && <p className="constraint-help">Hover an incident location on the heatmap for details. Click for more.</p>}
      <button type="button" className="heatmap-refresh" onClick={onRefresh} disabled={status === 'loading'}>{status === 'error' ? 'Retry' : 'Refresh data'}</button>
    </div>
  </section>
}
