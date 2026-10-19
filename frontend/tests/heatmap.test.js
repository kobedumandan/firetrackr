import { describe, expect, it } from 'vitest'
import { filterHeatmapPoints, heatmapSurface, inRing, manilaDate } from '../src/utils/heatmap'
import { heatmapOpacity } from '../src/utils/heatmapOpacity'
const square = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]

describe('heatmap close-up visibility', () => {
  it('preserves overview opacity and gradually reveals roads at closer zooms', () => {
    expect(heatmapOpacity(10)).toBe(.65)
    expect(heatmapOpacity(14)).toBe(.65)
    expect(heatmapOpacity(15)).toBeCloseTo(.39)
    expect(heatmapOpacity(16)).toBeCloseTo(.13)
    expect(heatmapOpacity(18)).toBeCloseTo(.039)
    expect(heatmapOpacity(21)).toBeCloseTo(.039)
    expect(heatmapOpacity(17)).toBeLessThan(heatmapOpacity(16))
  })
})

describe('heatmap selection', () => {
  it('uses inclusive Philippine incident dates, not UTC or generation dates', () => {
    const point = { lat: 1, lng: 1, weight: 0.4, occurred_at: '2026-10-18T17:00:00Z' }
    expect(manilaDate(point.occurred_at)).toBe('2026-10-19')
    expect(filterHeatmapPoints([point], { from: '2026-10-19', to: '2026-10-19' }, square)).toEqual([point])
    expect(filterHeatmapPoints([point], { from: '', to: '2026-10-18' }, square)).toEqual([])
    expect(filterHeatmapPoints([point], { from: '2026-10-20', to: '2026-10-19' }, square)).toEqual([])
  })
  it('excludes invalid and out-of-region points, preserving undated history only for all time', () => {
    const point = { lat: 1, lng: 1, weight: 1 }
    const points = [point, { ...point, lat: 4 }, { ...point, lng: NaN }, { ...point, weight: 0 }, { ...point, weight: null }]
    expect(filterHeatmapPoints(points, { from: '', to: '' }, square)).toEqual([point])
    expect(filterHeatmapPoints(points, { from: '2020-01-01', to: '' }, square)).toEqual([])
  })
})

describe('shared geographic heatmap surface', () => {
  it('returns no geometry for an empty selection', () => {
    expect(heatmapSurface([]).features).toEqual([])
  })
  it('creates closed finite polygons in longitude/latitude and keeps the influence local', () => {
    const point = { lat: 7.3, lng: 125.6, weight: 1 }
    const surface = heatmapSurface([point])
    expect(new Set(surface.features.map(f => f.properties.band)).size).toBe(6)
    for (const feature of surface.features) for (const ring of feature.geometry.coordinates) {
      expect(ring[0]).toEqual(ring.at(-1))
      expect(ring.length).toBeGreaterThan(3)
      for (const [lng, lat] of ring) {
        expect(Number.isFinite(lng) && Number.isFinite(lat)).toBe(true)
        expect(Math.abs(lng - point.lng)).toBeLessThan(0.006)
        expect(Math.abs(lat - point.lat)).toBeLessThan(0.006)
      }
    }
  })
  it('distinguishes isolated minor incidents from an overlapping critical cluster', () => {
    const minor = { lat: 7.3, lng: 125.6, weight: 0.4 }
    const critical = { lat: 7.3, lng: 125.62, weight: 1 }
    const surface = heatmapSurface([minor, critical, critical])
    const hottest = surface.features.filter(f => f.properties.band === 5)
    expect(hottest.some(f => inRing([critical.lng, critical.lat], f.geometry.coordinates[0]))).toBe(true)
    expect(hottest.some(f => inRing([minor.lng, minor.lat], f.geometry.coordinates[0]))).toBe(false)
  })
  it('preserves low-density holes inside a ring of incidents', () => {
    const points = Array.from({ length: 30 }, (_, i) => {
      const angle = i / 30 * Math.PI * 2
      return { lat: 7.3 + Math.sin(angle) * .01, lng: 125.6 + Math.cos(angle) * .01, weight: 1 }
    })
    const surface = heatmapSurface(points)
    expect(surface.features.some(f => f.geometry.coordinates.length > 1)).toBe(true)
    expect(surface.features.every(f => !inRing([125.6, 7.3], f.geometry.coordinates[0]) ||
      f.geometry.coordinates.slice(1).some(ring => inRing([125.6, 7.3], ring)))).toBe(true)
  })
  it('handles a dispersed 209-incident history with bounded closed geometry', () => {
    const points = Array.from({ length: 209 }, (_, i) => ({ lat: 7.2 + (i % 19) * .01, lng: 125.55 + Math.floor(i / 19) * .012, weight: [.4, .7, 1][i % 3] }))
    const surface = heatmapSurface(points)
    expect(surface.features.length).toBeGreaterThan(100)
    expect(surface.features.length).toBeLessThan(209 * 6)
    expect(surface.features.every(f => f.geometry.coordinates.every(r => r.length > 3 && r[0][0] === r.at(-1)[0]))).toBe(true)
  })
})
