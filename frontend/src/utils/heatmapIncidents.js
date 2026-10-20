export function heatmapIncidentId(point) {
  return point.incident?.id || `Incident #${point.fire_id ?? 'unknown'}`
}

function add(parent, tag, className, text) {
  const element = document.createElement(tag)
  element.className = className
  element.textContent = text
  parent.append(element)
  return element
}

// Build DOM with textContent: names and addresses are user-entered text.
export function heatmapIncidentDetails(points, limit = points.length) {
  const content = document.createElement('div')
  content.className = 'heatmap-incident-details'
  if (points.length > 1) add(content, 'div', 'heatmap-incident-group', `${points.length} incidents at this location`)
  for (const point of points.slice(0, limit)) {
    const incident = point.incident || {}
    const card = add(content, 'div', 'heatmap-incident-card', '')
    add(card, 'div', 'heatmap-incident-id', heatmapIncidentId(point))
    add(card, 'div', 'heatmap-incident-name', incident.loc || 'Recorded fire location')
    if (incident.addr) add(card, 'div', 'heatmap-incident-address', incident.addr)
    const pin = point.location_specification
    if (pin) {
      add(card, 'div', 'heatmap-incident-address', pin.label)
      add(card, 'div', 'heatmap-incident-address', pin.specification)
      add(card, 'div', 'heatmap-incident-address', `Pin: ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)} · estimated`)
    }
    const date = new Date(point.occurred_at)
    if (point.occurred_at && Number.isFinite(date.getTime())) {
      add(card, 'div', 'heatmap-incident-date', `${date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', ...(point.occurrence_precision === 'date_only' ? {} : { hour: 'numeric', minute: '2-digit' }) })} (PH)${point.occurrence_precision === 'date_only' ? ' · time not recorded' : ''}`)
    }
    const fields = [['Severity', incident.sev], ['Alarm', point.alarm_basis === 'synthetic_demo' ? `${incident.alarm} (showcase assumption)` : incident.alarm], ['Status', incident.status], ['Structure', incident.structure], ['Casualties', incident.casualties]]
    const list = add(card, 'dl', 'heatmap-incident-fields', '')
    for (const [label, value] of fields) if (value) {
      add(list, 'dt', '', label)
      add(list, 'dd', '', label === 'Status' ? value.charAt(0).toUpperCase() + value.slice(1) : value)
    }
  }
  if (points.length > limit) add(content, 'div', 'heatmap-incident-more', `Click to view all ${points.length} incidents.`)
  return content
}

export function groupHeatmapIncidents(points) {
  const groups = new Map()
  for (const point of points) {
    const key = `${point.lat},${point.lng}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(point)
  }
  return [...groups.values()]
}
