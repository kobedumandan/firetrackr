// @vitest-environment happy-dom
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHeatmap } from '../src/hooks/useHeatmap'
import { fetchHeatmap } from '../src/api'
import { createGoogleHeatmapOverlay } from '../src/utils/googleHeatmapOverlay'
vi.mock('../src/api', () => ({ fetchHeatmap: vi.fn() }))
let root, state
function Consumer({ enabled = true, revision = 0 }) { state = useHeatmap(enabled, revision); return null }
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks()
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = '<div id="root"></div>'
  root = createRoot(document.getElementById('root'))
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); vi.unstubAllGlobals(); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
const render = props => act(async () => root.render(<StrictMode><Consumer {...props} /></StrictMode>))

describe('heatmap refresh lifecycle', () => {
  it('loads empty results, refreshes on incident revisions and timer, and stops when hidden', async () => {
    fetchHeatmap.mockResolvedValue([])
    await render({})
    expect(state.status).toBe('ready')
    expect(fetchHeatmap).toHaveBeenCalledTimes(1)
    await render({ revision: 1 })
    expect(fetchHeatmap).toHaveBeenCalledTimes(2)
    await act(async () => vi.advanceTimersByTimeAsync(120000))
    expect(fetchHeatmap).toHaveBeenCalledTimes(3)
    await render({ enabled: false })
    await act(async () => vi.advanceTimersByTimeAsync(240000))
    expect(fetchHeatmap).toHaveBeenCalledTimes(3)
  })
  it('ignores superseded responses and recovers from errors without retaining stale points', async () => {
    let finishOld
    fetchHeatmap.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve })).mockResolvedValueOnce([{ weight: .7 }])
    await render({})
    const signal = fetchHeatmap.mock.calls[0][0]
    await render({ revision: 1 })
    expect(signal.aborted).toBe(true)
    await act(async () => finishOld([{ weight: .4 }]))
    expect(state.points).toEqual([{ weight: .7 }])
    fetchHeatmap.mockRejectedValueOnce(new Error('offline'))
    await act(async () => state.refresh())
    expect(state.status).toBe('error'); expect(state.points).toEqual([])
    fetchHeatmap.mockResolvedValueOnce([])
    await act(async () => state.refresh())
    expect(state.status).toBe('ready')
  })
})

describe('Google heatmap overlay lifecycle', () => {
  it('batches polygons, reuses them across style switches, clears old geometry and cancels on dispose', () => {
    const frames = new Map(); let id = 0
    vi.stubGlobal('requestAnimationFrame', fn => { frames.set(++id, fn); return id })
    vi.stubGlobal('cancelAnimationFrame', key => frames.delete(key))
    const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()) }
    const map = document.createElement('div')
    class Polygon { constructor(options) { return Object.assign(document.createElement('div'), options) } }
    const overlay = createGoogleHeatmapOverlay(map, { Polygon3DElement: Polygon })
    const feature = { properties: { color: '#ed493b', band: 5 }, geometry: { coordinates: [[[125.6, 7.3], [125.61, 7.3], [125.6, 7.31], [125.6, 7.3]]] } }
    const data = { features: Array.from({ length: 65 }, () => feature) }
    overlay.sync(data); flush(); expect(map.children).toHaveLength(0)
    overlay.setActive(true); flush(); expect(map.children).toHaveLength(30)
    const first = map.firstChild
    expect(first.path[0]).toEqual({ lat: 7.3, lng: 125.6, altitude: 0 })
    expect(first.fillColor).toBe('#ed493ba6')
    overlay.setZoom(18)
    expect(first.fillColor).toBe('#ed493b0a')
    expect(map.firstChild).toBe(first)
    overlay.setActive(false); flush(); expect(map.children).toHaveLength(0)
    overlay.setActive(true); flush(); flush(); flush()
    expect(map.children).toHaveLength(65); expect(map.firstChild).toBe(first)
    expect([...map.children].every(element => element.fillColor === '#ed493b0a')).toBe(true)
    overlay.setZoom(12)
    expect([...map.children].every(element => element.fillColor === '#ed493ba6')).toBe(true)
    overlay.sync(null); expect(map.children).toHaveLength(0)
    overlay.sync(data); overlay.dispose(); flush()
    expect(map.children).toHaveLength(0); expect(frames.size).toBe(0)
  })
  it('contains native SDK errors and permits a later retry', () => {
    let frame
    vi.stubGlobal('requestAnimationFrame', fn => { frame = fn; return 1 })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const map = document.createElement('div'), onError = vi.fn()
    const library = {}
    const overlay = createGoogleHeatmapOverlay(map, library, onError)
    const data = { features: [{ properties: { color: '#ed493b', band: 5 }, geometry: { coordinates: [[[0, 0], [1, 0], [0, 1], [0, 0]]] } }] }
    overlay.sync(data); overlay.setActive(true); frame()
    expect(onError).toHaveBeenCalledOnce(); expect(map.children).toHaveLength(0)
    library.Polygon3DElement = class { constructor(options) { return Object.assign(document.createElement('div'), options) } }
    overlay.setActive(true); frame(); expect(map.children).toHaveLength(1)
    overlay.dispose()
  })
})
