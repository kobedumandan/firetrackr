import { useId, useRef, useState } from 'react'
import { duration } from '../utils/operationalTimes'
import '../styles/DurationTrendChart.css'

// Values stay in seconds; only the vertical axis is converted to minutes.
export default function DurationTrendChart({ points, series, label, onSelect, onClose, selectedIndex = -1, sortTooltipByValue = false, formatCount = count => `n=${count}` }) {
  const id = useId()
  const chartRef = useRef(null)
  const [hovered, setHovered] = useState(null)
  const [focused, setFocused] = useState(null)
  const width = 900, height = 300, left = 52, right = 18, top = 22, bottom = 38
  const plotWidth = width - left - right, baseline = height - bottom
  const values = points.flatMap(point => series.map(item => point.values[item.key]).filter(value => value != null))
  const rawStep = Math.max(60, ...values) / 4 / 60
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude
  const max = step * 4 * 60
  const x = index => left + (points.length === 1 ? plotWidth / 2 : index * plotWidth / Math.max(1, points.length - 1))
  const y = value => baseline - value / max * (baseline - top)
  const index = focused ?? hovered ?? (selectedIndex >= 0 ? selectedIndex : null)
  const active = index != null ? points[index] : null
  const tooltipSeries = active && sortTooltipByValue
    ? [...series].sort((a, b) => (active.values[a.key] ?? Infinity) - (active.values[b.key] ?? Infinity))
    : series
  const tickStride = Math.max(1, Math.ceil(points.length / 8))

  function inspect(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(bounds.width / width, bounds.height / height)
    if (!scale) return
    const offset = (bounds.width - width * scale) / 2
    const position = (event.clientX - bounds.left - offset) / scale
    setHovered(position < left || position > width - right ? null : Math.max(0, Math.min(points.length - 1, Math.round((position - left) / plotWidth * (points.length - 1)))))
  }

  function closeTooltip() {
    setHovered(null)
    setFocused(null)
    onClose?.()
    chartRef.current?.focus()
  }

  return <div className="duration-trend" onPointerLeave={() => setHovered(null)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null) }}>
    <svg ref={chartRef} tabIndex={onClose ? -1 : undefined} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}
      onPointerMove={inspect}>
      <defs>{series.map((item, i) => <linearGradient key={item.key} id={`${id}-${i}`} x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor={item.color} stopOpacity={series.length === 1 ? '.28' : '.13'} />
        <stop offset="100%" stopColor={item.color} stopOpacity="0" />
      </linearGradient>)}</defs>
      <text className="duration-trend-unit" x={left} y="12">Minutes</text>
      {[0, 1, 2, 3, 4].map(tick => <g key={tick}>
        <line className="duration-trend-grid" x1={left} x2={width - right} y1={y(tick * step * 60)} y2={y(tick * step * 60)} />
        <text x={left - 12} y={y(tick * step * 60) + 4} textAnchor="end">{Number((tick * step).toFixed(2))}</text>
      </g>)}
      {series.map((item, seriesIndex) => {
        const segments = []; let segment = []
        points.forEach((point, i) => {
          if (point.values[item.key] == null) { if (segment.length) segments.push(segment); segment = [] }
          else segment.push([i, point.values[item.key]])
        })
        if (segment.length) segments.push(segment)
        return <g key={item.key}>{segments.map((entries, i) => {
          const path = entries.map(([at, value], n) => `${n ? 'L' : 'M'}${x(at)},${y(value)}`).join(' ')
          return <g key={i}>
            <path className="duration-trend-area" d={`${path} L${x(entries.at(-1)[0])},${baseline} L${x(entries[0][0])},${baseline} Z`} fill={`url(#${id}-${seriesIndex})`} />
            <path className="duration-trend-line" d={path} stroke={item.color} />
            {entries.length === 1 && <circle cx={x(entries[0][0])} cy={y(entries[0][1])} r="3" fill={item.color} />}
          </g>
        })}</g>
      })}
      <line className="duration-trend-baseline" x1={left} x2={width - right} y1={baseline} y2={baseline} />
      {points.map((point, i) => i % tickStride === 0 && <g key={i}>
        <line className="duration-trend-baseline" x1={x(i)} x2={x(i)} y1={baseline} y2={baseline + 5} />
        <text x={x(i)} y={height - 12} textAnchor="middle">{point.label}</text>
      </g>)}
      {points.map((point, i) => <rect key={i} className="duration-trend-target" x={x(i) - 8} y={top} width="16" height={baseline - top}
        tabIndex="0" role={onSelect ? 'button' : undefined} aria-pressed={onSelect ? selectedIndex === i : undefined}
        aria-label={`${point.label}: ${series.map(item => `${item.label}: ${duration(point.values[item.key])}, ${formatCount(point.counts?.[item.key] || 0)}`).join('; ')}`}
        onFocus={() => setFocused(i)} onClick={() => onSelect?.(i)}
        onKeyDown={event => {
          if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect(i) }
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault()
            const next = Math.max(0, Math.min(points.length - 1, i + (event.key === 'ArrowRight' ? 1 : -1)))
            event.currentTarget.parentNode.querySelectorAll('.duration-trend-target')[next].focus()
          }
        }} />)}
      {active && <g pointerEvents="none">
        <line className="duration-trend-crosshair" x1={x(index)} x2={x(index)} y1={top} y2={baseline} />
        {series.map(item => active.values[item.key] != null && <circle key={item.key} className="duration-trend-active" cx={x(index)} cy={y(active.values[item.key])} r="5" fill={item.color} />)}
      </g>}
    </svg>
    {active && <div className={`duration-trend-tooltip${x(index) > width / 2 ? ' is-right' : ''}${onClose ? ' is-interactive' : ''}`} style={{ left: `${x(index) / width * 100}%` }} role="status">
      <header><strong>{active.label}</strong>{onClose && <button type="button" className="duration-trend-close" aria-label="Close tooltip and reset timeframe" onClick={closeTooltip}>×</button>}</header>
      {tooltipSeries.map(item => <div key={item.key}><i style={{ background: item.color }} /><span>{item.label}</span><b className={!Number.isFinite(active.values[item.key]) ? 'duration-trend-missing' : undefined} aria-label={!Number.isFinite(active.values[item.key]) ? 'No data' : undefined}>{duration(active.values[item.key], '—')}</b><small>{formatCount(active.counts?.[item.key] || 0)}</small></div>)}
    </div>}
  </div>
}
