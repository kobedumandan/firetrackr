import { useId, useState } from 'react'

export default function IncidentTrendChart({ points, labels, labelTicks, height = 250, width = 680 }) {
  const gradientId = useId()
  const [activeIndex, setActiveIndex] = useState(null)
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
  const active = activeIndex != null && activeIndex < points.length ? activeIndex : null
  const tooltipX = active == null ? 0 : Math.max(padL, Math.min(width - padR - 154, sx(active) + 12))
  const tooltipY = active == null ? 0 : Math.max(padT, Math.min(padT + h - 55, sy(points[active]) + 18))

  function inspect(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(bounds.width / width, bounds.height / height)
    if (!scale) return
    const offset = (bounds.width - width * scale) / 2
    const x = (event.clientX - bounds.left - offset) / scale
    if (x < padL || x > width - padR) { setActiveIndex(null); return }
    setActiveIndex(Math.max(0, Math.min(points.length - 1, Math.round((x - padL) / w * (points.length - 1)))))
  }

  return <svg viewBox={`0 0 ${width} ${height}`} className="m-line" role="img" aria-label="Monthly incident trend"
    onPointerMove={inspect} onPointerLeave={() => setActiveIndex(null)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setActiveIndex(null) }}>
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
    {points.map((value, index) => <circle key={index} cx={sx(index)} cy={sy(value)} r="6" className="m-line-point" tabIndex="0"
      onFocus={() => setActiveIndex(index)} aria-label={`${labels[index]}: ${value} incidents`}>
      <title>{`${labels[index]}: ${value} incident${value === 1 ? '' : 's'}`}</title>
    </circle>)}
    {active != null && <g className="mo-line-selection" pointerEvents="none">
      <line x1={sx(active)} x2={sx(active)} y1={padT} y2={padT + h} className="mo-line-crosshair" />
      <circle cx={sx(active)} cy={sy(points[active])} r="5" className="mo-line-active-point" />
      <g transform={`translate(${tooltipX},${tooltipY})`} className="mo-line-tooltip" role="status">
        <rect width="154" height="52" rx="5" />
        <text x="11" y="21" className="mo-line-tooltip-value">{points[active].toLocaleString()} {points[active] === 1 ? 'incident' : 'incidents'}</text>
        <text x="11" y="39" className="mo-line-tooltip-label">{labels[active]}</text>
      </g>
    </g>}
  </svg>
}
