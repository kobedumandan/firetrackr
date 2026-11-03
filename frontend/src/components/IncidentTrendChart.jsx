import { useId, useLayoutEffect, useRef, useState } from 'react'
import '../styles/DurationTrendChart.css'

function MonthTooltip({ anchor, label, count, causes, onClose, chartRef }) {
  const tooltipRef = useRef(null)
  useLayoutEffect(() => {
    const tooltip = tooltipRef.current
    const container = chartRef.current?.parentElement
    if (!tooltip || !container) return
    const viewport = container.closest('.mo-line-chart') || container
    function place() {
      const bounds = container.getBoundingClientRect()
      const visible = viewport.getBoundingClientRect()
      const leftEdge = Math.max(0, visible.left - bounds.left)
      const rightEdge = Math.min(bounds.width || visible.width || 320, visible.right - bounds.left || 320)
      const available = Math.max(0, rightEdge - leftEdge)
      tooltip.style.maxWidth = `${Math.max(1, Math.min(320, available - 16))}px`
      const tooltipWidth = tooltip.getBoundingClientRect().width
      const point = anchor * bounds.width
      const desired = anchor > .5 ? point - tooltipWidth - 12 : point + 12
      const maximum = Math.max(leftEdge + 8, rightEdge - tooltipWidth - 8)
      tooltip.style.left = `${Math.max(leftEdge + 8, Math.min(maximum, desired))}px`
      tooltip.style.transform = 'none'
      tooltip.style.visibility = 'visible'
    }
    place()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    observer?.observe(container)
    observer?.observe(tooltip)
    if (viewport !== container) observer?.observe(viewport)
    viewport.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => { observer?.disconnect(); viewport.removeEventListener('scroll', place); window.removeEventListener('resize', place) }
  }, [anchor, label, count, causes, chartRef])

  return <div ref={tooltipRef} className={`duration-trend-tooltip mo-line-tooltip${onClose ? ' is-interactive' : ''}`} style={{ left: `${anchor * 100}%`, visibility: 'hidden' }} role="status">
    <header><strong>{label}</strong>{onClose && <button type="button" className="duration-trend-close" aria-label="Close tooltip and reset timeframe" onClick={onClose}>×</button>}</header>
    <div className="mo-line-tooltip-count"><span>{count.toLocaleString()} {count === 1 ? 'incident' : 'incidents'}</span></div>
    {causes.length > 0 && <>
      <div className="mo-line-tooltip-section"><span>Top 5 reported causes</span></div>
      {causes.map(cause => <div className="mo-line-tooltip-cause" key={cause.cause}>
        <i style={{ background: 'var(--mo-line-color)' }} /><span title={cause.cause}>{cause.cause}</span><b>{cause.count.toLocaleString()}</b>
      </div>)}
    </>}
  </div>
}

export default function IncidentTrendChart({ points, labels, monthLabels = labels, causesByMonth = [], labelTicks, height = 250, width = 680, selectedIndex = -1, onSelect, onClose }) {
  const gradientId = useId()
  const chartRef = useRef(null)
  const [hovered, setHovered] = useState(null)
  const [focused, setFocused] = useState(null)
  if (!points.length) return <div className="m-empty">No monthly data</div>

  const padL = 42, padR = 14, padT = 16, padB = 32
  const w = width - padL - padR, h = height - padT - padB
  const highest = Math.max(...points, 1)
  const rawStep = highest / 4
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const niceStep = Math.max(1, (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude)
  const max = niceStep * 4
  const sx = index => padL + index * w / Math.max(points.length - 1, 1)
  const sy = value => padT + h - value / max * h
  const path = points.map((value, index) => `${index ? 'L' : 'M'}${sx(index)},${sy(value)}`).join(' ')
  const area = `${path} L${sx(points.length - 1)},${padT + h} L${sx(0)},${padT + h} Z`
  const pinned = selectedIndex >= 0 && selectedIndex < points.length ? selectedIndex : null
  const inspected = pinned ?? focused ?? hovered
  const active = inspected != null && inspected < points.length ? inspected : null
  const causes = active == null ? [] : (causesByMonth[active] ?? []).slice(0, 5)

  function inspect(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(bounds.width / width, bounds.height / height)
    if (!scale) return
    const offset = (bounds.width - width * scale) / 2
    const x = (event.clientX - bounds.left - offset) / scale
    if (x < padL || x > width - padR) { setHovered(null); return }
    setHovered(Math.max(0, Math.min(points.length - 1, Math.round((x - padL) / w * (points.length - 1)))))
  }

  function closeTooltip() {
    setHovered(null)
    setFocused(null)
    onClose?.()
    chartRef.current?.focus()
  }

  return <div className="duration-trend mo-incident-trend"
    onPointerLeave={() => setHovered(null)}
    onKeyDown={event => { if (event.key === 'Escape') closeTooltip() }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null) }}>
    <svg ref={chartRef} tabIndex={onClose ? -1 : undefined} viewBox={`0 0 ${width} ${height}`} className="m-line" role={onSelect ? 'group' : 'img'} aria-label="Monthly incident trend"
      onPointerMove={inspect}>
    <defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stopColor="var(--mo-line-color)" stopOpacity="0.24" />
      <stop offset="100%" stopColor="var(--mo-line-color)" stopOpacity="0" />
    </linearGradient></defs>
    {[0, 0.25, 0.5, 0.75, 1].map(step => {
      const y = padT + h * (1 - step)
      return <g key={step}>
        <line x1={padL} x2={width - padR} y1={y} y2={y} className="m-line-grid" />
        <text x={padL - 10} y={y + 3} textAnchor="end" className="m-line-ytick">{Math.round(max * step)}</text>
      </g>
    })}
    <path d={area} fill={`url(#${gradientId})`} />
    <path d={path} className="mo-line-stroke" fill="none" stroke="var(--mo-line-color)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    {points.length === 1 && active == null && <circle cx={sx(0)} cy={sy(points[0])} r="4" className="mo-line-active-point" />}
    <line x1={padL} x2={width - padR} y1={padT + h} y2={padT + h} className="mo-line-baseline" />
    {(labelTicks || labels.map((text, index) => ({ text, index }))).map(tick => <text key={tick.index} x={sx(tick.index)} y={height - 9} textAnchor="middle" className="m-line-xtick">{tick.text}</text>)}
    {points.map((value, index) => <circle key={index} cx={sx(index)} cy={sy(value)} r="6" className="m-line-point" tabIndex={onSelect ? undefined : '0'}
      onFocus={() => setFocused(index)} aria-label={`${monthLabels[index]}: ${value} incidents`}>
      <title>{`${labels[index]}: ${value} incident${value === 1 ? '' : 's'}`}</title>
    </circle>)}
    {onSelect && points.map((value, index) => {
      const left = index === 0 ? padL : (sx(index - 1) + sx(index)) / 2
      const right = index === points.length - 1 ? width - padR : (sx(index) + sx(index + 1)) / 2
      return <rect key={index} className="mo-line-target" x={left} y={padT} width={right - left} height={height - padT}
        role="button" tabIndex="0" aria-pressed={selectedIndex === index}
        aria-label={`Filter breakdowns to ${monthLabels[index]}: ${value} incidents`}
        onFocus={() => setFocused(index)} onClick={() => onSelect(index)}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(index) }
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault()
            const next = Math.max(0, Math.min(points.length - 1, index + (event.key === 'ArrowRight' ? 1 : -1)))
            event.currentTarget.parentNode.querySelectorAll('.mo-line-target')[next].focus()
          }
        }} />
    })}
    {active != null && <g className="mo-line-selection" pointerEvents="none">
      <line x1={sx(active)} x2={sx(active)} y1={padT} y2={padT + h} className="mo-line-crosshair" />
      <circle cx={sx(active)} cy={sy(points[active])} r="5" className="mo-line-active-point" />
    </g>}
    </svg>
    {active != null && <MonthTooltip anchor={sx(active) / width} label={monthLabels[active]} count={points[active]} causes={causes} onClose={pinned != null && onClose ? closeTooltip : undefined} chartRef={chartRef} />}
  </div>
}
