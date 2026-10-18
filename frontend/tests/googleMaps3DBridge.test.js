import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachGoogle3DBridge } from '../src/utils/leafletGoogle3DBridge'
import { zoomToRange } from '../src/utils/googleMaps3D'

class Emitter {
  listeners = new Map()
  on(names, callback) {
    for (const name of names.split(' ')) {
      if (!this.listeners.has(name)) this.listeners.set(name, new Set())
      this.listeners.get(name).add(callback)
    }
    return this
  }
  off(names, callback) {
    for (const name of names.split(' ')) this.listeners.get(name)?.delete(callback)
    return this
  }
  fire(name, event = {}) { this.listeners.get(name)?.forEach(callback => callback(event)); return this }
}
class Element extends EventTarget {
  style = {}
  children = []
  constructor(options = {}) { super(); Object.assign(this, options) }
  append(...nodes) { nodes.forEach(node => { node.parent = this; this.children.push(node) }) }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this) }
}
class Marker extends Emitter {
  options = { radius: 5, color: '#ff0000' }
  point = { lat: 7.3, lng: 125.6 }
  getLatLng() { return this.point }
}
class CircleMarker extends Marker {}
class Polyline extends Emitter {
  options = { color: '#00ff00', weight: 4 }
  getLatLngs() { return [{ lat: 7.3, lng: 125.6 }, { lat: 7.4, lng: 125.7 }] }
}
class Polygon extends Polyline {}

function fixture(options) {
  const frames = new Map()
  let nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame })
  vi.stubGlobal('cancelAnimationFrame', id => frames.delete(id))
  vi.stubGlobal('document', { createElement: () => new Element() })
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()) }
  const marker = new Marker()
  const line = new Polyline()
  const layers = new Set([marker, line])
  const leaflet = Object.assign(new Emitter(), {
    getSize: () => ({ x: 1000, y: 600 }),
    getCenter: () => ({ lat: 7.3, lng: 125.6 }), getZoom: () => 12,
    eachLayer: callback => layers.forEach(callback), closePopup: vi.fn(),
  })
  leaflet.setView = vi.fn(() => leaflet.fire('moveend'))
  const googleMap = new Element({ center: { lat: 7.3, lng: 125.6 }, range: zoomToRange(12, 7.3), tilt: 55, heading: 0 })
  const library = { MarkerElement: Element, MarkerInteractiveElement: Element, Polyline3DInteractiveElement: Element, Polygon3DInteractiveElement: Element }
  const L = { Marker, CircleMarker, Polyline, Polygon, latLng: (lat, lng) => ({ lat, lng }) }
  const camera = vi.fn()
  const bridge = attachGoogle3DBridge(leaflet, googleMap, library, L, camera, options)
  return { bridge, leaflet, googleMap, marker, line, layers, flush, frames, camera }
}

afterEach(() => vi.unstubAllGlobals())

describe('Leaflet / Google renderer lifecycle', () => {
  it('does not overwrite the visible map when a hidden renderer finishes loading', () => {
    const f = fixture({ initiallyActive: false })
    f.googleMap.center = { lat: 1, lng: 2 }
    f.bridge.setActive(false); f.flush()
    expect(f.leaflet.setView).not.toHaveBeenCalled()
    expect(f.googleMap.children).toHaveLength(0)
    f.bridge.setActive(true); f.flush()
    expect(f.googleMap.center).toEqual({ lat: 7.3, lng: 125.6, altitude: 0 })
    expect(f.googleMap.children).toHaveLength(2)
    f.bridge.dispose()
  })

  it('draws the city border as a closed, bright orange line above the terrain', () => {
    const f = fixture()
    f.line.options.className = 'jurisdiction-boundary'
    f.flush()
    const border = f.googleMap.children[1]
    expect(border.strokeColor).toBe('#ff5a1f')
    expect(border.strokeWidth).toBe(4)
    expect(border.path[0]).toEqual(border.path.at(-1))
    expect(border.path.every(point => point.altitude === 2)).toBe(true)
    f.bridge.dispose()
  })

  it('mirrors visible layers, follows live positions and removes hidden layers', () => {
    const f = fixture()
    f.flush()
    expect(f.googleMap.children).toHaveLength(2)
    expect(f.googleMap.children[0].position).toEqual({ lat: 7.3, lng: 125.6, altitude: 0 })
    const original = f.googleMap.children[1]
    f.bridge.refresh(); f.flush()
    expect(f.googleMap.children[1]).toBe(original)
    f.marker.point = { lat: 7.4, lng: 125.8 }
    f.marker.fire('move'); f.flush()
    expect(f.googleMap.children.find(element => element.position)?.position.lng).toBe(125.8)
    f.layers.delete(f.line)
    f.leaflet.fire('layerremove'); f.flush()
    expect(f.googleMap.children).toHaveLength(1)
    f.bridge.dispose()
    expect(f.googleMap.children).toHaveLength(0)
    expect(f.frames.size).toBe(0)
    for (const listeners of f.leaflet.listeners.values()) expect(listeners.size).toBe(0)
    expect(f.marker.listeners.get('move').size).toBe(0)
  })

  it('forwards picking and marker actions without changing the coordinate order', () => {
    const f = fixture()
    f.flush()
    const pick = vi.fn()
    const markerClick = vi.fn()
    f.leaflet.on('click', pick)
    f.marker.on('click', markerClick)
    const click = new Event('gmp-click', { cancelable: true })
    click.position = { lat: 7.2, lng: 125.9 }
    f.googleMap.dispatchEvent(click)
    expect(pick.mock.calls[0][0].latlng).toEqual({ lat: 7.2, lng: 125.9 })
    f.googleMap.children[0].dispatchEvent(new Event('gmp-click'))
    expect(markerClick).toHaveBeenCalledOnce()
    f.bridge.dispose()
  })

  it('returns the last 3D location on switching styles and removes camera listeners', () => {
    const f = fixture()
    f.googleMap.center = { lat: 7.5, lng: 125.8 }
    f.googleMap.range = zoomToRange(16, 7.5)
    f.bridge.dispose()
    expect(f.leaflet.setView).toHaveBeenCalledWith([7.5, 125.8], expect.closeTo(16), { animate: false })
    // moveend fired by setView must not feed back into the Google camera.
    expect(f.googleMap.center).toEqual({ lat: 7.5, lng: 125.8 })
    f.googleMap.dispatchEvent(new Event('gmp-headingchange'))
    expect(f.camera).not.toHaveBeenCalled()
  })

  it('does not access a destroyed Leaflet map when navigating away from Command', () => {
    const f = fixture()
    f.leaflet.fire('unload')
    f.bridge.dispose()
    expect(f.leaflet.setView).not.toHaveBeenCalled()
    expect(f.frames.size).toBe(0)
  })
})
