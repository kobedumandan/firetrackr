// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MapContainer } from 'react-leaflet'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HeatmapIncidents from '../src/components/HeatmapIncidents'
import { attachIncidentHover } from '../src/utils/incidentHover'
import { groupHeatmapIncidents, heatmapIncidentDetails } from '../src/utils/heatmapIncidents'

const point = { fire_id: 1, lat: 7.3, lng: 125.6, occurred_at: '2026-10-18T17:00:00Z', incident: {
  id: 'INC-2026-001', loc: 'Market road', addr: '<img src=x onerror=alert(1)>', sev: 'Critical', alarm: '3rd Alarm', status: 'closed', structure: 'Residential' } }
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('individual heatmap incidents', () => {
  it('labels representative coordinates, date-only history, and assumed alarms', () => {
    const card = heatmapIncidentDetails([{ ...point, occurrence_precision: 'date_only', alarm_basis: 'synthetic_demo',
      location_specification: { label: 'Barangay representative pin', specification: 'Inside the named barangay; exact property unknown.' } }])
    expect(card.textContent).toContain('Barangay representative pin')
    expect(card.textContent).toContain('exact property unknown')
    expect(card.textContent).toContain('7.300000, 125.600000')
    expect(card.textContent).toContain('time not recorded')
    expect(card.textContent).toContain('3rd Alarm (showcase assumption)')
    expect(card.querySelector('.heatmap-incident-date').textContent).not.toMatch(/AM|PM/)
  })
  it('keeps duplicate coordinates together and renders details as text', () => {
    const second = { ...point, fire_id: 2, incident: { ...point.incident, id: 'INC-2026-002' } }
    const groups = groupHeatmapIncidents([point, second, { ...point, lng: 125.61 }])
    expect(groups.map(group => group.length)).toEqual([2, 1])
    const card = heatmapIncidentDetails([point, second])
    expect(card.querySelector('img')).toBeNull()
    expect(card.textContent).toContain(point.incident.addr)
    expect(card.textContent).toContain('INC-2026-001')
    expect(card.textContent).toContain('Oct 19, 2026')
    expect(card.textContent).toContain('Critical')
    expect(card.textContent).toContain('Closed')
    expect(heatmapIncidentDetails([point, second], 1).textContent).toContain('Click to view all 2')
  })
  it('shows a hover/focus card, hides on escape, and removes handlers on disposal', () => {
    const marker = document.createElement('div'); document.body.append(marker)
    const content = heatmapIncidentDetails([point])
    const layer = { options: { heatmapIncident: true, title: point.incident.id }, getTooltip: () => ({ getContent: () => content }) }
    let active = true
    const hover = attachIncidentHover(marker, layer, () => active)
    marker.dispatchEvent(new Event('pointerenter'))
    expect(document.querySelector('[role="tooltip"]').textContent).toContain('Market road')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    marker.dispatchEvent(new Event('focusin'))
    expect(document.querySelectorAll('[role="tooltip"]')).toHaveLength(1)
    hover.hide(); active = false
    marker.dispatchEvent(new Event('gmp-pointerover'))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    active = true; hover.dispose()
    marker.dispatchEvent(new Event('pointerenter'))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
  })
  it('adds filtered Leaflet markers with tooltips and removes them on view/data changes', async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const container = document.createElement('div'); document.body.append(container)
    const root = createRoot(container)
    try {
      const render = points => act(async () => root.render(<MapContainer center={[7.3, 125.6]} zoom={14}><HeatmapIncidents points={points} /></MapContainer>))
      await render([point, { ...point, fire_id: 2 }])
      expect(document.querySelectorAll('.heatmap-incident-pin')).toHaveLength(1)
      expect(document.querySelector('.heatmap-incident-pin').innerHTML).toBe('')
      document.querySelector('.heatmap-incident-pin').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(document.querySelector('.heatmap-incident-leaflet-tooltip').textContent).toContain('2 incidents')
      await render([])
      expect(document.querySelectorAll('.heatmap-incident-pin')).toHaveLength(0)
      expect(document.querySelector('.heatmap-incident-leaflet-tooltip')).toBeNull()
    } finally { await act(async () => root.unmount()); delete globalThis.IS_REACT_ACT_ENVIRONMENT }
  })
})
