// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as maplibre from 'maplibre-gl'
import { useMap } from 'react-leaflet'
import RasterCommandMap from '../src/components/RasterCommandMap'
import { attachRasterBridge } from '../src/utils/leafletRasterBridge'

vi.mock('react-leaflet', () => ({ useMap: vi.fn() }))
vi.mock('../src/utils/leafletRasterBridge', () => ({ attachRasterBridge: vi.fn() }))
vi.mock('maplibre-gl', () => {
  let instance
  class Map {
    handlers = new globalThis.Map()
    sources = new globalThis.Map(['command-roads', 'command-heat'].map(id => [id, { setData: vi.fn() }]))
    layers = new globalThis.Map()
    canvas = document.createElement('canvas')
    constructor(options) { this.container = options.container; instance = this }
    on(name, callback) { this.handlers.set(name, callback); return this }
    fire(name, event = {}) { this.handlers.get(name)?.(event) }
    getContainer() { return this.container }
    getSource(id) { return this.sources.get(id) }
    addSource(id, source) { this.sources.set(id, source) }
    getLayer(id) { return this.layers.get(id) }
    addLayer(layer) { this.layers.set(layer.id, layer) }
    setLayoutProperty = vi.fn()
    jumpTo = vi.fn()
    getCanvas() { return this.canvas }
    remove() {}
  }
  return { Map, setWorkerUrl: vi.fn(), __instance: () => instance }
})

let root
beforeEach(() => {
  vi.clearAllMocks()
  attachRasterBridge.mockImplementation(() => ({ setActive: vi.fn(), refresh: vi.fn(), dispose: vi.fn() }))
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = '<div id="root"></div><div id="map"></div><div id="controls"></div>'
  root = createRoot(document.getElementById('root'))
  useMap.mockReturnValue({ getCenter: () => ({ lat: 7.3, lng: 125.6 }), getZoom: () => 12 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

describe('standard map fallback', () => {
  it('falls back when startup silently stalls and ignores a late load', async () => {
    vi.useFakeTimers()
    const onUnavailable = vi.fn()
    await act(async () => root.render(<RasterCommandMap
      portalHost={document.getElementById('map')} active tileMode="street" onUnavailable={onUnavailable}
    />))
    await act(async () => vi.advanceTimersByTimeAsync(15000))
    expect(onUnavailable).toHaveBeenCalledOnce()
    await act(async () => maplibre.__instance().fire('load'))
    expect(attachRasterBridge).not.toHaveBeenCalled()
  })

  it('falls back if the operational layer bridge cannot initialize', async () => {
    const onUnavailable = vi.fn()
    attachRasterBridge.mockImplementationOnce(() => { throw new Error('Incompatible subscription API') })
    await act(async () => root.render(<RasterCommandMap
      portalHost={document.getElementById('map')} active tileMode="street" onUnavailable={onUnavailable}
    />))
    await act(async () => maplibre.__instance().fire('load'))
    expect(onUnavailable).toHaveBeenCalledOnce()
  })
  it('reapplies the basemap and bridge when a ready renderer is replaced', async () => {
    const controlsHost = document.getElementById('controls')
    const render = portalHost => act(async () => root.render(<RasterCommandMap
      portalHost={portalHost} controlsHost={controlsHost} active tileMode="satellite"
      overlayRevision={null} gnnData={null} heatmapData={null} picking={false}
    />))
    await render(document.getElementById('map'))
    const first = maplibre.__instance()
    expect(maplibre.setWorkerUrl).toHaveBeenCalledWith(expect.any(String))
    await act(async () => first.fire('load'))
    expect(first.getLayer('basemap-satellite')).toBeTruthy()
    const replacement = document.createElement('div')
    document.body.append(replacement)
    await render(replacement)
    const second = maplibre.__instance()
    expect(second).not.toBe(first)
    await act(async () => second.fire('load'))
    expect(second.getLayer('basemap-satellite')).toBeTruthy()
    expect(attachRasterBridge.mock.results.at(-1).value.setActive).toHaveBeenCalledWith(true)
    expect(second.getSource('command-heat').setData).toHaveBeenCalled()
  })
  it('requests the original Leaflet renderer once when WebGL initialization fails', async () => {
    const onUnavailable = vi.fn()
    await act(async () => root.render(
      <RasterCommandMap
        portalHost={document.getElementById('map')}
        controlsHost={document.getElementById('controls')}
        active
        tileMode="street"
        overlayRevision={{}}
        gnnData={null}
        heatmapData={null}
        picking={false}
        onUnavailable={onUnavailable}
      />,
    ))
    await vi.waitFor(() => expect(maplibre.__instance()).toBeTruthy())
    await act(async () => maplibre.__instance().fire('error', { error: new Error('WebGL unavailable') }))
    maplibre.__instance().fire('error', { error: new Error('second error') })
    expect(onUnavailable).toHaveBeenCalledOnce()
  })
})
