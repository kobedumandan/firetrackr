import { describe, it, expect } from 'vitest'
import { dateTime, duration, manilaInput, parseRouteWkt } from '../src/utils/operationalTimes'

describe('Operational display units and coordinates', () => {
  it('keeps missing values distinct from zero and formats seconds', () => {
    expect(duration(null)).toBe('No data')
    expect(duration(0)).toBe('0m 00s')
    expect(duration(500)).toBe('8m 20s')
    expect(duration(-100)).toBe('1m 40s')
  })
  it('converts WKT longitude-latitude to Leaflet and rejects invalid geometry', () => {
    expect(parseRouteWkt('LINESTRING(125.6 7.3,125.61 7.31)')).toEqual([[7.3, 125.6], [7.31, 125.61]])
    expect(parseRouteWkt('LINESTRING(garbage)')).toEqual([])
    expect(parseRouteWkt('LINESTRING(0 95,1 92)')).toEqual([])
  })
  it('uses Philippine time independent of the computer timezone', () => {
    expect(manilaInput(new Date('2026-10-19T00:00:00Z'))).toBe('2026-10-19T08:00:00')
    expect(dateTime('2026-10-19T00:00:00Z')).toContain('8:00:00')
  })
})
