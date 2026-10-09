import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loader = vi.hoisted(() => ({ setOptions: vi.fn(), importLibrary: vi.fn() }))
vi.mock('@googlemaps/js-api-loader', () => loader)

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  loader.importLibrary.mockReset()
  vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', 'test-browser-key')
})

afterEach(() => vi.unstubAllEnvs())

describe('Google 3D loading', () => {
  it('does not contact Google merely by importing the module', async () => {
    await import('../src/utils/googleMaps3d')
    expect(loader.setOptions).not.toHaveBeenCalled()
    expect(loader.importLibrary).not.toHaveBeenCalled()
  })

  it('requires the Google key, not the unrelated CARTO setting', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', '  ')
    vi.stubEnv('VITE_CARTO_MAP_API_KEY', 'different-provider-key')
    const { loadGoogleMaps3d } = await import('../src/utils/googleMaps3d')
    await expect(loadGoogleMaps3d()).rejects.toThrow('frontend/.env')
    expect(loader.setOptions).not.toHaveBeenCalled()
    expect(loader.importLibrary).not.toHaveBeenCalled()
  })

  it('configures once and reuses the Google loader when reopening', async () => {
    vi.stubEnv('VITE_GOOGLE_MAPS_API_KEY', ' test-browser-key ')
    const library = { Map3DElement: class {} }
    loader.importLibrary.mockResolvedValue(library)
    const { loadGoogleMaps3d } = await import('../src/utils/googleMaps3d')
    await expect(loadGoogleMaps3d()).resolves.toBe(library)
    await expect(loadGoogleMaps3d()).resolves.toBe(library)
    expect(loader.setOptions).toHaveBeenCalledTimes(1)
    expect(loader.setOptions).toHaveBeenCalledWith({
      key: 'test-browser-key', v: 'weekly', language: 'en', region: 'PH',
    })
    expect(loader.importLibrary).toHaveBeenCalledWith('maps3d')
  })

  it('allows a new load attempt after a network failure', async () => {
    loader.importLibrary.mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ Map3DElement: class {} })
    const { loadGoogleMaps3d } = await import('../src/utils/googleMaps3d')
    await expect(loadGoogleMaps3d()).rejects.toThrow('network unavailable')
    await expect(loadGoogleMaps3d()).resolves.toHaveProperty('Map3DElement')
    expect(loader.setOptions).toHaveBeenCalledTimes(1)
  })
})
