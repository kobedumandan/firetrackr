import { describe, expect, it, vi } from 'vitest'
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec'
import { createAsyncCache } from '../src/utils/asyncCache'
import { constraintFeatures, rasterTileUrls } from '../src/utils/commandMapData'
import { rasterMapStyle, selectRasterStyle } from '../src/utils/rasterMapStyle'
import { setGoogleLinePath, setGooglePolygonPaths } from '../src/utils/googleMapGeometry'

describe('constraint data caching', () => {
  it('shares in-flight requests, expires results and retries failures', async () => {
    let time = 0
    const cache = createAsyncCache({ ttl: 100, now: () => time })
    const request = vi.fn().mockResolvedValue({ roads: 1438 })
    const a = cache.get('gnn', request)
    expect(cache.get('gnn', request)).toBe(a)
    await a
    expect(await cache.get('gnn', request)).toEqual({ roads: 1438 })
    expect(request).toHaveBeenCalledTimes(1)
    time = 101
    await cache.get('gnn', request)
    expect(request).toHaveBeenCalledTimes(2)
    const fail = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('recovered')
    await expect(cache.get('custom', fail)).rejects.toThrow('offline')
    expect(await cache.get('custom', fail)).toBe('recovered')
  })
  it('does not let a stale in-flight response overwrite data after an edit', async () => {
    const cache = createAsyncCache()
    let resolveOld
    const pending = cache.get('gnn', () => new Promise(resolve => { resolveOld = resolve }))
    await Promise.resolve()
    cache.clear()
    await cache.get('gnn', () => Promise.resolve('new'))
    resolveOld('old')
    await pending
    expect(await cache.get('gnn', () => Promise.resolve('wrong'))).toBe('new')
  })
  it('bounds retained entries and separates users/servers', async () => {
    const cache = createAsyncCache({ maxEntries: 2 })
    await cache.get('user-a:gnn', () => 'a')
    await cache.get('user-b:gnn', () => 'b')
    expect(await cache.get('user-a:gnn', () => 'wrong')).toBe('a')
    await cache.get('user-c:gnn', () => 'c')
    expect(await cache.get('user-a:gnn', () => 'fresh')).toBe('fresh')
  })
})

describe('raster renderer and HD sources', () => {
  it('has a valid native MapLibre style, including the orange city boundary and GNN layer', () => {
    const style = rasterMapStyle()
    expect(validateStyleMin(style).map(error => error.message)).toEqual([])
    expect(style.layers.find(layer => layer.id === 'command-boundary').paint['line-color']).toBe('#ff5a1f')
    expect(style.sources['command-boundary'].data.geometry.coordinates.length).toBeGreaterThan(20)
    expect(style.layers.find(layer => layer.id === 'command-roads').source).toBe('command-roads')
  })
  it('requests retina tiles without leaking undefined keys', () => {
    expect(rasterTileUrls({ url: 'https://{s}.example/{z}/{x}/{y}{r}.png?key=undefined', subdomains: 'ab' })).toEqual([
      'https://a.example/{z}/{x}/{y}@2x.png', 'https://b.example/{z}/{x}/{y}@2x.png',
    ])
  })
  it('reuses source instances and cached tiles when switching back to a style', () => {
    const sources = new Map(), layers = new Map()
    const map = {
      getSource: key => sources.get(key), getLayer: key => layers.get(key),
      addSource: vi.fn((key, source) => sources.set(key, source)),
      addLayer: (layer) => layers.set(layer.id, layer),
      setLayoutProperty: vi.fn(),
    }
    selectRasterStyle(map, 'street')
    const source = sources.get('basemap-street')
    selectRasterStyle(map, 'dark')
    selectRasterStyle(map, 'street')
    expect(map.addSource).toHaveBeenCalledTimes(2)
    expect(sources.get('basemap-street')).toBe(source)
    expect(map.setLayoutProperty).toHaveBeenLastCalledWith('basemap-dark', 'visibility', 'none')
  })
})

describe('Google geometry compatibility', () => {
  it('does not assign empty polygon holes rejected by the weekly SDK', () => {
    let holes
    const polygon = { path: null, get innerPaths() { return holes }, set innerPaths(value) {
      if (value?.length === 0) throw new Error('empty iterable')
      holes = value
    } }
    const path = [{ lat: 7.3, lng: 125.6 }, { lat: 7.4, lng: 125.7 }, { lat: 7.3, lng: 125.8 }]
    setGooglePolygonPaths(polygon, { path })
    expect(polygon.path).toBe(path); expect(holes).toBeUndefined()
    setGooglePolygonPaths(polygon, { path, innerPaths: [path] })
    expect(holes).toEqual([path])
    setGooglePolygonPaths(polygon, { path })
    expect(holes).toBeUndefined()
  })
  it('sets real path properties on both current and older Google SDK shapes', () => {
    const path = [{ lat: 7.3, lng: 125.6 }, { lat: 7.4, lng: 125.7 }]
    const modern = { path: null }, legacy = { coordinates: null }
    setGoogleLinePath(modern, path); setGoogleLinePath(legacy, path)
    expect(modern.path).toBe(path); expect(legacy.coordinates).toBe(path)
    const polygon = { outerCoordinates: null, innerCoordinates: null }
    setGooglePolygonPaths(polygon, { path, innerPaths: [path] })
    expect(polygon.outerCoordinates).toBe(path); expect(polygon.innerCoordinates).toEqual([path])
  })
  it('keeps backend road colors and geometry and reuses the prepared collection', () => {
    const data = { constraints: { features: [{ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [ [[125.6, 7.3], [125.7, 7.4]], [[125.8, 7.5], [125.9, 7.6]] ] }, properties: { road_id: 2, map_color: '#BF360C', display_constraint_type: 'narrow_road' } }] } }
    const result = constraintFeatures(data)
    expect(result.features).toHaveLength(2)
    expect(result.features[0].geometry.coordinates[0]).toEqual([125.6, 7.3])
    expect(result.features[0].properties.color).toBe('#BF360C')
    expect(constraintFeatures(data)).toBe(result)
    expect(constraintFeatures(null).features).toHaveLength(0)
  })
})
