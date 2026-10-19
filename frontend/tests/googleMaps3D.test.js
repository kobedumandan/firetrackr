import { describe, expect, it } from 'vitest'
import { cameraAfterAction, zoomToRange, rangeToZoom } from '../src/utils/googleMaps3D'
import { linePaths, polygonPaths } from '../src/utils/leafletGoogle3DBridge'
import { selectGoogleMapsKey } from '../config/publicGoogleMapsEnv'

describe('3D camera', () => {
  it('clamps tilt, wraps rotation and resets north without changing the location', () => {
    expect(cameraAfterAction({ tilt: 76 }, 'tilt-up')).toEqual({ tilt: 80 })
    expect(cameraAfterAction({ tilt: 3 }, 'tilt-down')).toEqual({ tilt: 0 })
    expect(cameraAfterAction({ heading: 355 }, 'rotate-right')).toEqual({ heading: 10 })
    expect(cameraAfterAction({ heading: 5 }, 'rotate-left')).toEqual({ heading: 350 })
    expect(cameraAfterAction({ tilt: 60, heading: 100, range: 500 }, 'reset')).toEqual({ tilt: 0, heading: 0, roll: 0 })
    expect(cameraAfterAction({ range: 80 }, 'zoom-in')).toEqual({ range: 80 })
    expect(cameraAfterAction({ range: 20000000 }, 'zoom-out')).toEqual({ range: 20000000 })
  })
  it.each([8, 12, 16, 18])('preserves zoom %s across renderer changes', zoom => {
    expect(rangeToZoom(zoomToRange(zoom, 7.307, 700), 7.307, 700)).toBeCloseTo(zoom, 8)
  })
})

describe('public key selection', () => {
  it('uses the frontend setting first and accepts the existing backend key spelling', () => {
    expect(selectGoogleMapsKey({ VITE_GOOGLE_MAPS_API_KEY: ' frontend ' }, { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'backend' })).toBe('frontend')
    expect(selectGoogleMapsKey({}, { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'backend' })).toBe('backend')
    expect(selectGoogleMapsKey({}, { next_public_google_maps_api_key: 'lowercase' })).toBe('lowercase')
    expect(selectGoogleMapsKey({ VITE_GOOGLE_MAPS_API_KEY: '' }, { NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: 'backend' })).toBe('backend')
  })
  it('does not select backend secrets or similarly prefixed keys', () => {
    expect(selectGoogleMapsKey({}, { JWT_SECRET: 'secret', DATABASE_URL: 'secret', NEXT_PUBLIC_GOOGLE_MAPS_API_KEY_PRIVATE: 'secret' })).toBe('')
  })
})

describe('geometry conversion', () => {
  const ring = [{ lat: 7.3, lng: 125.6 }, { lat: 7.4, lng: 125.7 }, { lat: 7.5, lng: 125.6 }]
  it('preserves separate line parts', () => {
    const paths = linePaths([ring, ring])
    expect(paths).toHaveLength(2)
    expect(paths[0][0]).toEqual({ lat: 7.3, lng: 125.6, altitude: 0 })
  })
  it('keeps holes associated with their polygon in multipolygons', () => {
    const parts = polygonPaths([[ring, ring], [ring]])
    expect(parts).toHaveLength(2)
    expect(parts[0].innerPaths).toHaveLength(1)
    expect(parts[1].innerPaths).toHaveLength(0)
  })
})
