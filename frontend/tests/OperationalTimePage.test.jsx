// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import OperationalTimePage from '../src/pages/OperationalTimePage'
import { fetchOperationalTimes, fetchOperationalDetail } from '../src/api'

vi.mock('../src/api', () => ({ fetchOperationalTimes: vi.fn(), fetchOperationalDetail: vi.fn(), confirmOperationalMilestone: vi.fn(), invalidateOperationalTimes: vi.fn() }))
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-map>{children}</div>,
  TileLayer: () => null, CircleMarker: ({ children }) => <div>{children}</div>,
  Tooltip: ({ children }) => <span>{children}</span>,
  Polyline: ({ pathOptions, children }) => <div data-line={pathOptions.color}>{children}</div>,
  useMap: () => ({ invalidateSize: vi.fn(), fitBounds: vi.fn(), getContainer: () => document.body }),
}))
let root, host
const durations = { processing: 120, preparation: 180, travel: 600, suppression: 1800, cta: 900 }
const summary = Object.fromEntries(Object.entries(durations).map(([key, seconds]) => [key, { seconds, count: 1, change_percent: null }]))
const record = { fire_id: 7, reported_at: '2026-10-19T00:00:00Z', response_kind: 'fire', durations }
const overview = { summary, breakdown: { count: 1, seconds: durations }, trends: [], records: [record], total: 1 }
beforeEach(() => {
  vi.clearAllMocks()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
  fetchOperationalTimes.mockResolvedValue(overview)
  fetchOperationalDetail.mockResolvedValue({ ...record, location: [7.3, 125.6], events: [], units: [{ id: 2, truck: 'TRUCK', team: 'TEAM', station: 'STATION', durations, selected_route_id: 9, baseline_available: true, eta_seconds: 480, difference_seconds: 120, error_percent: 25, gps_segments: [], routes: [{ route_id: 8, rank: 1, wkt: 'LINESTRING(125.6 7.3,125.61 7.31)' }, { route_id: 9, rank: 2, wkt: 'LINESTRING(125.6 7.3,125.62 7.32)' }] }] })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
const render = async () => act(async () => { root.render(<OperationalTimePage theme="dark" />) })
const click = async element => act(async () => { element.click() })

describe('Operational time analysis', () => {
  it('opens recorded operational data and keeps imported demo timing available explicitly', async () => {
    await render()
    expect(host.querySelector('h1').textContent).toBe('Operational Time Analysis')
    expect(host.querySelectorAll('.m-period-btn')).toHaveLength(6)
    expect(host.textContent).not.toContain('Demonstration timing')
    expect(fetchOperationalTimes).toHaveBeenLastCalledWith('all', 1, 'recorded', 'operational')
    expect(host.textContent).toContain('INC-7')
    await click([...host.querySelectorAll('.m-period-btn')].find(b => b.textContent === '1w'))
    expect(fetchOperationalTimes).toHaveBeenLastCalledWith('1w', 1, 'recorded', 'operational')
    await act(async () => { const select = host.querySelector('[aria-label="Timing data"]'); select.value = 'demo'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.textContent).toContain('Demonstration timing')
    expect(fetchOperationalTimes).toHaveBeenLastCalledWith('1w', 1, 'demo', 'all')
  })
  it('uses server pagination and resets the page when changing data source', async () => {
    fetchOperationalTimes.mockImplementation((period, page, source) => Promise.resolve({ ...overview, page, source, total: 78, page_size: 5, total_pages: 16 }))
    await render()
    await click(host.querySelector('[aria-label="Page 16"]'))
    expect(fetchOperationalTimes).toHaveBeenLastCalledWith('all', 16, 'recorded', 'operational')
    expect(host.querySelector('[aria-label="Next page"]').disabled).toBe(true)
    await act(async () => { const select = host.querySelector('[aria-label="Timing data"]'); select.value = 'demo'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(fetchOperationalTimes).toHaveBeenLastCalledWith('all', 1, 'demo', 'all')
    expect(host.textContent).toContain('Demonstration timing')
  })
  it('shows loading, errors, and empty data without fabricated values', async () => {
    fetchOperationalTimes.mockReturnValue(new Promise(() => {}))
    await render()
    expect(host.textContent).toContain('Loading operational records')
    fetchOperationalTimes.mockRejectedValue(new Error('Service unavailable'))
    await click(host.querySelector('.m-period-btn'))
    expect(host.querySelector('[role="alert"]').textContent).toContain('Service unavailable')
    fetchOperationalTimes.mockResolvedValue({ ...overview, summary: {}, records: [], breakdown: { count: 0 }, total: 0 })
    await click(host.querySelectorAll('.m-period-btn')[1])
    expect(host.textContent).toContain('No operational records')
    expect(host.textContent).not.toContain('10.0 min')
  })
  it('opens details lazily, highlights selected route two, switches stages and restores focus', async () => {
    await render()
    expect(fetchOperationalDetail).not.toHaveBeenCalled()
    const recordButton = host.querySelector('.ota-record-link'); recordButton.focus()
    await click(recordButton)
    const dialog = document.querySelector('[role="dialog"]')
    expect(fetchOperationalDetail).toHaveBeenCalledWith(7)
    expect(dialog.textContent).toContain('Route 2')
    expect(dialog.textContent).toContain('+25.0%')
    expect(dialog.querySelectorAll('[data-line="#ff4d1a"]')).toHaveLength(1)
    expect(dialog.textContent).toContain('No reliable historical GPS path')
    await click(dialog.querySelector('.ota-stages button'))
    expect(dialog.querySelectorAll('[data-line="#ff4d1a"]')).toHaveLength(0)
    await click(dialog.querySelector('[aria-label="Close"]'))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(recordButton)
  })
})
