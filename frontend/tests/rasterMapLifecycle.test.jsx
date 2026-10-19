// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as maplibre from 'maplibre-gl'
import { useMap } from 'react-leaflet'
import RasterCommandMap from '../src/components/RasterCommandMap'

vi.mock('react-leaflet', () => ({ useMap: vi.fn() }))
vi.mock('../src/utils/leafletRasterBridge', () => ({ attachRasterBridge: vi.fn() }))
vi.mock('maplibre-gl', () => {
  let instance
  class Map {
    handlers = new globalThis.Map()
    constructor(options) { this.container = options.container; instance = this }
    on(name, callback) { this.handlers.set(name, callback); return this }
    fire(name, event = {}) { this.handlers.get(name)?.(event) }
    getContainer() { return this.container }
    remove() {}
  }
  return { Map, __instance: () => instance }
})

let root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = '<div id="root"></div><div id="map"></div><div id="controls"></div>'
  root = createRoot(document.getElementById('root'))
  useMap.mockReturnValue({ getCenter: () => ({ lat: 7.3, lng: 125.6 }), getZoom: () => 12 })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(async () => {
  await act(async () => root.unmount())
  vi.unstubAllGlobals()
  vi.useRealTimers()
  delete globalThis.IS_REACT_ACT_ENVIRONMENT
})

describe('standard map fallback', () => {
  it('falls back when a worker stalls without a map error event', async () => {
    vi.useFakeTimers()
    const onUnavailable = vi.fn()
    await act(async () => root.render(<RasterCommandMap
      portalHost={document.getElementById('map')} controlsHost={document.getElementById('controls')}
      active tileMode="street" onUnavailable={onUnavailable}
    />))
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(onUnavailable).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(onUnavailable).toHaveBeenCalledOnce()
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
        heatPoints={null}
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
