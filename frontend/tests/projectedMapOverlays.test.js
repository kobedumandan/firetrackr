// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import L from 'leaflet'
import { createGoogleConstraintOverlay } from '../src/utils/googleConstraintOverlay'
import { createGoogleBarangayOverlay, prepareBarangays } from '../src/utils/googleBarangayOverlay'
import { BARANGAY_BOUNDARY_COLOR } from '../src/utils/mapOverlayColors'
import { attachRasterBridge } from '../src/utils/leafletRasterBridge'

function animationFrames() {
  const frames = new Map()
  let id = 0
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++id, callback); return id })
  vi.stubGlobal('cancelAnimationFrame', key => frames.delete(key))
  return {
    frames,
    flush() { const current = [...frames.values()]; frames.clear(); current.forEach(callback => callback()) },
  }
}
afterEach(() => vi.unstubAllGlobals())

describe('Google road overlay cache', () => {
  it('batches roads, resumes after style changes and reuses elements after GNN toggles', () => {
    const raf = animationFrames()
    const map = document.createElement('div')
    const create = vi.fn(options => Object.assign(document.createElement('div'), options))
    class Road { constructor(options) { return create(options) } }
    const overlay = createGoogleConstraintOverlay(map, { Polyline3DElement: Road }, {}, L)
    const data = { constraints: { features: Array.from({ length: 95 }, (_, i) => ({
      type: 'Feature', properties: { road_id: i, display_constraint_type: 'narrow_road', map_color: '#ff5500' },
      geometry: { type: 'LineString', coordinates: [[125.6, 7.3], [125.7, 7.4]] },
    })) } }
    overlay.sync(data); raf.flush()
    expect(map.children).toHaveLength(40)
    const first = map.firstChild
    expect(first.path[0]).toEqual({ lat: 7.3, lng: 125.6, altitude: 2 })
    overlay.setActive(false); raf.flush()
    expect(map.children).toHaveLength(40)
    overlay.setActive(true); raf.flush(); raf.flush()
    expect(map.children).toHaveLength(95)
    overlay.sync(null)
    expect(map.children).toHaveLength(0)
    overlay.sync(data); raf.flush(); raf.flush(); raf.flush()
    expect(map.firstChild).toBe(first)
    expect(create).toHaveBeenCalledTimes(95)
    overlay.dispose()
    expect(map.children).toHaveLength(0)
    expect(raf.frames.size).toBe(0)
  })

  it('cancels pending roads when GNN is hidden before a batch finishes', () => {
    const raf = animationFrames()
    const map = document.createElement('div')
    const overlay = createGoogleConstraintOverlay(map, {}, {}, L)
    overlay.sync({ constraints: { features: [] } })
    expect(raf.frames.size).toBe(1)
    overlay.sync(null); raf.flush()
    expect(map.children).toHaveLength(0)
    expect(raf.frames.size).toBe(0)
    overlay.dispose()
  })
})

describe('Google barangay overlay', () => {
  const data = { features: [{ properties: { brgy_name: 'San Francisco' },
    geometry: { type: 'Polygon', coordinates: [[[125.6, 7.3], [125.7, 7.3], [125.7, 7.4], [125.6, 7.3]]] },
  }] }

  it('defers SDK construction while hidden and builds labels only when needed', () => {
    const map = document.createElement('div')
    const polygon = vi.fn(() => document.createElement('div'))
    const marker = vi.fn(() => document.createElement('div'))
    class Polygon { constructor() { return polygon() } }
    class Marker { constructor() { return marker() } }
    const overlay = createGoogleBarangayOverlay(map, { Polygon3DElement: Polygon, Marker3DElement: Marker })
    overlay.setActive(false)
    overlay.sync(data, false)
    expect(polygon).not.toHaveBeenCalled()
    expect(marker).not.toHaveBeenCalled()
    overlay.setActive(true)
    expect(polygon).toHaveBeenCalledOnce()
    expect(marker).not.toHaveBeenCalled()
    overlay.sync(data, true)
    expect(marker).toHaveBeenCalledOnce()
    overlay.setActive(false)
    overlay.setActive(true)
    expect(polygon).toHaveBeenCalledOnce()
    expect(marker).toHaveBeenCalledOnce()
    expect(map.children).toHaveLength(2)
  })

  it.each(['constructor', 'path', 'append'])('falls back to orange outlines when Google rejects a polygon %s', failure => {
    const map = document.createElement('div')
    class Polygon {
      constructor() {
        if (failure === 'constructor') throw new Error('SDK polygon rejected')
        const element = document.createElement('div')
        element.dataset.polygon = 'true'
        if (failure === 'path') Object.defineProperty(element, 'path', { set() { throw new Error('SDK path rejected') } })
        return element
      }
    }
    class Line { constructor(options) { return Object.assign(document.createElement('div'), options) } }
    const append = map.append.bind(map)
    map.append = element => {
      if (failure === 'append' && element.dataset.polygon) throw new Error('SDK append rejected')
      append(element)
    }
    const overlay = createGoogleBarangayOverlay(map, { Polygon3DElement: Polygon, Polyline3DElement: Line })
    expect(() => overlay.sync(data, false)).not.toThrow()
    expect(map.children).toHaveLength(1)
    const outline = map.firstChild
    expect(outline.strokeColor).toBe(BARANGAY_BOUNDARY_COLOR)
    expect(outline.path).toHaveLength(4)
    overlay.sync(null)
    overlay.sync(data, false)
    expect(map.firstChild).toBe(outline)
  })

  it('preserves boundaries when a native label fails', () => {
    const map = document.createElement('div'), warning = vi.fn()
    class Polygon { constructor() { return document.createElement('div') } }
    class Marker { constructor() { throw new Error('SDK label rejected') } }
    const overlay = createGoogleBarangayOverlay(map, { Polygon3DElement: Polygon, Marker3DElement: Marker }, warning)
    expect(() => overlay.sync(data)).not.toThrow()
    expect(map.children).toHaveLength(1)
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ message: 'SDK label rejected' }))
  })

  it('cleans up partial builds and retries rather than caching a failure', () => {
    const map = document.createElement('div')
    let fail = true, count = 0
    class Polygon {
      constructor() {
        if (++count === 2 && fail) throw new Error('SDK unavailable')
        return document.createElement('div')
      }
    }
    const multiple = { features: [...data.features, ...data.features] }
    const overlay = createGoogleBarangayOverlay(map, { Polygon3DElement: Polygon })
    expect(() => overlay.sync(multiple)).toThrow('SDK unavailable')
    expect(map.children).toHaveLength(0)
    fail = false
    overlay.sync(multiple)
    expect(map.children).toHaveLength(2)
  })

  it('draws and caches native orange polygons and labels', () => {
    const map = document.createElement('div')
    const make = options => Object.assign(document.createElement('div'), options)
    class Polygon { constructor(options) { return make(options) } }
    class Marker { constructor(options) { return make(options) } }
    const data = { type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { brgy_id: 1, brgy_name: 'San Francisco', brgy_estpopulation: 1234 },
      geometry: { type: 'Polygon', coordinates: [[[125.6, 7.3], [125.7, 7.3], [125.7, 7.4], [125.6, 7.3]]] },
    }] }
    const prepared = prepareBarangays(data)
    expect(prepareBarangays(data)).toBe(prepared)
    expect(prepared[0].center).toEqual({ lat: 7.35, lng: 125.65, altitude: 12 })
    const overlay = createGoogleBarangayOverlay(map, { Polygon3DElement: Polygon, Marker3DElement: Marker })
    overlay.sync(data, true)
    expect(map.children).toHaveLength(2)
    const polygon = map.children[0], label = map.children[1]
    expect(polygon.strokeColor).toBe(BARANGAY_BOUNDARY_COLOR)
    expect(polygon.path[0]).toEqual({ lat: 7.3, lng: 125.6, altitude: 3 })
    expect(label.label).toContain('San Francisco')
    overlay.sync(null)
    expect(map.children).toHaveLength(0)
    overlay.sync(data, false)
    expect(map.children).toHaveLength(1)
    expect(map.firstChild).toBe(polygon)
    overlay.dispose()
    expect(map.children).toHaveLength(0)
  })
})

describe('tilted raster interactions', () => {
  it('keeps operational markers/routes, forwards picking, and avoids camera feedback', () => {
    const raf = animationFrames()
    const container = document.createElement('div')
    const marker = L.marker([7.3, 125.6], { icon: L.divIcon({ html: 'Station', iconSize: [20, 20] }) })
    const route = L.polyline([[7.3, 125.6], [7.4, 125.7]], { color: '#00ff00' })
    const layers = new Set([marker, route])
    const leaflet = Object.assign(new L.Evented(), {
      getCenter: () => ({ lat: 7.3, lng: 125.6 }), getZoom: () => 12,
      getContainer: () => container, eachLayer: callback => layers.forEach(callback), closePopup: vi.fn(),
    })
    leaflet.setView = vi.fn(() => leaflet.fire('moveend'))
    const source = { setData: vi.fn() }
    const canvas = document.createElement('canvas')
    const nativeMarkers = []
    class NativeMarker {
      constructor({ element }) { this.element = element; nativeMarkers.push(this) }
      setLngLat(point) { this.point = point; return this }
      addTo() { return this }
      remove() { this.removed = true }
    }
    const map = Object.assign(new L.Evented(), {
      getSource: () => source, getPitch: () => 30, getBearing: () => 15,
      getCenter: () => ({ lat: 7.4, lng: 125.7 }), getZoom: () => 13,
      getCanvas: () => canvas, resize: vi.fn(), queryRenderedFeatures: vi.fn(() => []),
    })
    map.jumpTo = vi.fn(() => map.fire('moveend'))
    // Match MapLibre 6: on() returns a Subscription, not a chainable map.
    const eventOn = map.on.bind(map)
    const eventOff = map.off.bind(map)
    map.on = vi.fn((name, handler) => {
      eventOn(name, handler)
      return { unsubscribe: () => eventOff(name, handler) }
    })
    const bridge = attachRasterBridge(leaflet, map, { Marker: NativeMarker }, L, vi.fn())
    bridge.setActive(true); raf.flush()
    expect(leaflet.setView).not.toHaveBeenCalled()
    expect(nativeMarkers[0].point).toEqual([125.6, 7.3])
    expect(source.setData.mock.calls[0][0].features[0].geometry.coordinates[0]).toEqual([125.6, 7.3])
    marker.setLatLng([7.5, 125.8])
    expect(nativeMarkers[0].point).toEqual([125.8, 7.5])
    bridge.refresh(); raf.flush()
    expect(nativeMarkers).toHaveLength(1)
    expect(source.setData).toHaveBeenCalledOnce()
    const markerClick = vi.fn(), pick = vi.fn()
    marker.on('click', markerClick); leaflet.on('click', pick)
    nativeMarkers[0].element.click()
    expect(markerClick).toHaveBeenCalledOnce()
    container.classList.add('pick-cursor')
    nativeMarkers[0].element.click()
    expect(markerClick).toHaveBeenCalledOnce()
    map.fire('click', { lngLat: { lat: 7.35, lng: 125.65 }, point: { x: 30, y: 40 } })
    expect(pick.mock.calls[0][0].latlng).toEqual(L.latLng(7.35, 125.65))
    map.fire('moveend')
    expect(leaflet.setView).toHaveBeenCalledWith([7.4, 125.7], 14, { animate: false })
    layers.delete(marker); leaflet.fire('layerremove'); raf.flush()
    expect(nativeMarkers[0].removed).toBe(true)
    leaflet.fire('unload'); bridge.dispose()
    expect(map.listens('click')).toBe(false)
    expect(raf.frames.size).toBe(0)
  })
})
