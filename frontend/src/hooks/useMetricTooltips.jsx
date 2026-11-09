import { useState } from 'react'
import { createPortal } from 'react-dom'

export default function useMetricTooltips() {
  const [tooltipMetric, setTooltipMetric] = useState(null)
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 })
  function positionTooltip(key, x, y) {
    const width = Math.min(320, window.innerWidth - 24)
    const height = document.getElementById(`ro-tooltip-${key}`)?.offsetHeight || 160
    setTooltipPosition({
      left: Math.max(12, Math.min(x + 16, window.innerWidth - width - 12)),
      top: Math.max(12, y + height + 28 > window.innerHeight ? y - height - 16 : y + 16),
    })
  }
  function tooltipHandlers(key) {
    return {
      'aria-describedby': `ro-tooltip-${key}`,
      onMouseEnter: event => { positionTooltip(key, event.clientX, event.clientY); setTooltipMetric(key) },
      onMouseMove: event => positionTooltip(key, event.clientX, event.clientY),
      onMouseLeave: () => setTooltipMetric(null),
      onFocus: event => { const bounds = event.currentTarget.getBoundingClientRect(); positionTooltip(key, bounds.left, bounds.top + 40); setTooltipMetric(key) },
      onBlur: event => { if (!event.currentTarget.contains(event.relatedTarget)) setTooltipMetric(null) },
      onKeyDown: event => { if (event.key === 'Escape') setTooltipMetric(null) },
    }
  }
  function renderTooltip(key, explanation, average = true) {
    return createPortal(<div id={`ro-tooltip-${key}`} role="tooltip" className="ro-kpi-tooltip" style={tooltipPosition} hidden={tooltipMetric !== key}>{explanation}{average && ' The number shown is the average across valid recorded times.'}</div>, document.body)
  }
  return { tooltipHandlers, renderTooltip }
}
