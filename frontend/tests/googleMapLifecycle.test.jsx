// @vitest-environment happy-dom
import { act, StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GooglePhotorealisticMap from '../src/components/GooglePhotorealisticMap'
import { loadGoogleMaps3D } from '../src/utils/googleMaps3D'
import { attachGoogle3DBridge } from '../src/utils/leafletGoogle3DBridge'
import { createGoogleConstraintOverlay } from '../src/utils/googleConstraintOverlay'
import { createGoogleBarangayOverlay } from '../src/utils/googleBarangayOverlay'
import { useMap } from 'react-leaflet'

vi.mock('react-leaflet', () => ({ useMap: vi.fn() }))
vi.mock('../src/utils/googleMaps3D', async original => ({ ...await original(), loadGoogleMaps3D: vi.fn() }))
vi.mock('../src/utils/leafletGoogle3DBridge', () => ({ attachGoogle3DBridge: vi.fn() }))
vi.mock('../src/utils/googleConstraintOverlay', () => ({ createGoogleConstraintOverlay: vi.fn() }))
vi.mock('../src/utils/googleBarangayOverlay', () => ({ createGoogleBarangayOverlay: vi.fn() }))

let count = 0
class GoogleMap extends HTMLElement {
  constructor(options) { super(); Object.assign(this, options); count++ }
  stopCameraAnimation = vi.fn()
  flyCameraTo = vi.fn(({ endCamera }) => Object.assign(this, endCamera))
}
customElements.define('test-google-map', GoogleMap)

let root, portalHost, controlsHost, props, bridge, roads, neighborhoods
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); count = 0
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  document.body.innerHTML = '<div id="root"></div><div id="map"></div><div id="controls"></div>'
  portalHost = document.getElementById('map'); controlsHost = document.getElementById('controls')
  root = createRoot(document.getElementById('root'))
  bridge = { setActive: vi.fn(), refresh: vi.fn(), dispose: vi.fn() }
  roads = { sync: vi.fn(), setActive: vi.fn(), dispose: vi.fn() }
  neighborhoods = { sync: vi.fn(), setActive: vi.fn(), dispose: vi.fn() }
  useMap.mockReturnValue({ getCenter: () => ({ lat: 7.307, lng: 125.635 }), getZoom: () => 12, getSize: () => ({ y: 800 }) })
  loadGoogleMaps3D.mockResolvedValue({ Map3DElement: GoogleMap })
  attachGoogle3DBridge.mockReturnValue(bridge)
  createGoogleConstraintOverlay.mockReturnValue(roads)
  createGoogleBarangayOverlay.mockReturnValue(neighborhoods)
  props = { portalHost, controlsHost, active: true, overlayRevision: {}, gnnData: null,
    barangayData: null, showBarangayLabels: true, onFallback: vi.fn() }
})
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); delete globalThis.IS_REACT_ACT_ENVIRONMENT })
const render = () => act(async () => root.render(<GooglePhotorealisticMap {...props} />))

describe('photorealistic view regressions', () => {
  it('activates the replacement renderer when the portal host changes', async () => {
    await render()
    bridge.setActive.mockClear()
    const replacement = document.createElement('div')
    document.body.append(replacement)
    props.portalHost = replacement
    await render()
    expect(replacement.querySelector('test-google-map')).toBeTruthy()
    expect(bridge.setActive).toHaveBeenCalledWith(true)
    expect(roads.sync).toHaveBeenLastCalledWith(null)
  })
  it('returns to a real Leaflet container after navigation', async () => {
    const real = await vi.importActual('react-leaflet')
    useMap.mockImplementation(real.useMap)
    function Page() {
      const [mapHost, setMapHost] = useState(null)
      const [toolsHost, setToolsHost] = useState(null)
      return <><div ref={setMapHost} /><div ref={setToolsHost} />
        <real.MapContainer center={[7.3, 125.6]} zoom={12}>
          <GooglePhotorealisticMap {...props} portalHost={mapHost} controlsHost={toolsHost} />
        </real.MapContainer>
      </>
    }
    for (let visit = 0; visit < 3; visit++) {
      await act(async () => root.render(<StrictMode><Page /></StrictMode>))
      expect(document.querySelectorAll('test-google-map')).toHaveLength(1)
      expect(document.querySelector('[aria-label="Increase tilt"]').disabled).toBe(false)
      await act(async () => root.render(null))
    }
    useMap.mockReset()
  })
  it('initializes again after navigating away and returning with portal hosts', async () => {
    function Page() {
      const [mapHost, setMapHost] = useState(null)
      const [toolsHost, setToolsHost] = useState(null)
      return <><div ref={setMapHost} /><div ref={setToolsHost} />
        <GooglePhotorealisticMap {...props} portalHost={mapHost} controlsHost={toolsHost} />
      </>
    }
    for (let visit = 0; visit < 3; visit++) {
      await act(async () => root.render(<StrictMode><Page /></StrictMode>))
      expect(document.querySelectorAll('test-google-map')).toHaveLength(1)
      expect(document.querySelector('[aria-label="Increase tilt"]').disabled).toBe(false)
      await act(async () => root.render(null))
      expect(document.querySelectorAll('test-google-map')).toHaveLength(0)
    }
  })
  it('enables camera controls without waiting for every tile, and never invents a 45-second error', async () => {
    await render()
    const tilt = controlsHost.querySelector('[aria-label="Increase tilt"]')
    expect(tilt.disabled).toBe(false)
    await act(async () => vi.advanceTimersByTimeAsync(60000))
    expect(portalHost.querySelector('[role="alert"]')).toBeNull()
    await act(async () => tilt.click())
    const map = portalHost.querySelector('test-google-map')
    expect(map.flyCameraTo).toHaveBeenCalledOnce()
    expect(map.tilt).toBe(65)
  })

  it('keeps one map instance across repeated style switches, with controls only for the active style', async () => {
    await render()
    const map = portalHost.querySelector('test-google-map')
    for (let i = 0; i < 3; i++) {
      props.active = false; await render()
      expect(controlsHost.childElementCount).toBe(0)
      props.active = true; await render()
      expect(controlsHost.querySelectorAll('[aria-label="Map camera controls"]')).toHaveLength(1)
    }
    expect(count).toBe(1)
    expect(portalHost.querySelector('test-google-map')).toBe(map)
    expect(bridge.dispose).not.toHaveBeenCalled()
  })

  it('updates road visibility while leaving the renderer and camera overlays intact', async () => {
    await render()
    const data = { constraints: { features: [] } }
    props.gnnData = data; await render()
    expect(roads.sync).toHaveBeenLastCalledWith(data)
    const scans = bridge.refresh.mock.calls.length
    const onCamera = attachGoogle3DBridge.mock.calls[0][4]
    await act(async () => onCamera({ tilt: 60, heading: 30 }))
    expect(bridge.refresh).toHaveBeenCalledTimes(scans)
    props.gnnData = null; await render()
    expect(roads.sync).toHaveBeenLastCalledWith(null)
    expect(count).toBe(1)
  })

  it('sends the selected barangay layer and label visibility to the native 3D overlay', async () => {
    await render()
    const data = { type: 'FeatureCollection', features: [] }
    props.barangayData = data; props.showBarangayLabels = false; await render()
    expect(neighborhoods.sync).toHaveBeenLastCalledWith(data, false)
    props.barangayData = null; await render()
    expect(neighborhoods.sync).toHaveBeenLastCalledWith(null, false)
  })

  it('still reports an actual SDK initialization failure', async () => {
    await render()
    await act(async () => portalHost.querySelector('test-google-map').dispatchEvent(new Event('gmp-error')))
    expect(portalHost.querySelector('[role="alert"]').textContent).toContain('could not initialize')
    expect(controlsHost.querySelector('[aria-label="Increase tilt"]').disabled).toBe(true)
  })

  it('does not sync the cached Google Barangay overlay while a standard map is active', async () => {
    await render()
    props.active = false
    await render()
    neighborhoods.sync.mockClear()
    for (let style = 0; style < 3; style++) {
      props.barangayData = { features: [] }; await render()
      props.barangayData = null; await render()
    }
    expect(neighborhoods.sync).not.toHaveBeenCalled()
    props.active = true
    await render()
    expect(neighborhoods.sync).toHaveBeenCalledOnce()
    expect(count).toBe(1)
  })

  it.each(['sync', 'setActive'])('contains a Barangay %s exception without blanking the dashboard', async method => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await render()
      const map = portalHost.querySelector('test-google-map')
      neighborhoods[method].mockImplementation(value => {
        if (value) throw new Error('SDK rejected Barangay geometry')
      })
      props.barangayData = { features: [] }
      await render()
      expect(portalHost.querySelector('test-google-map')).toBe(map)
      expect(portalHost.querySelector('[role="status"]').textContent).toContain('Barangay')
      expect(controlsHost.querySelector('[aria-label="Increase tilt"]').disabled).toBe(false)
      props.active = false
      await render()
      expect(portalHost.querySelector('[role="status"]')).toBeNull()
      expect(bridge.dispose).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledWith('Google Barangay overlay:', 'SDK rejected Barangay geometry')
    } finally { warn.mockRestore() }
  })
})
