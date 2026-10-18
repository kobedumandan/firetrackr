import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

function browser() {
  const scripts = []
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', {
    createElement: () => ({ remove: vi.fn() }),
    head: { append: script => scripts.push(script) },
  })
  return scripts
}

describe('Google Maps lazy loader', () => {
  it('does not make a request without a configured key', async () => {
    const scripts = browser()
    const { loadGoogleMaps3D } = await import('../src/utils/googleMaps3D')
    await expect(loadGoogleMaps3D('')).rejects.toThrow('API key')
    expect(scripts).toHaveLength(0)
  })

  it('shares one load across rapid style changes and StrictMode remounts', async () => {
    const scripts = browser()
    const { loadGoogleMaps3D } = await import('../src/utils/googleMaps3D')
    const first = loadGoogleMaps3D('test-public-key')
    expect(loadGoogleMaps3D('test-public-key')).toBe(first)
    expect(scripts).toHaveLength(1)
    expect(new URL(scripts[0].src).hostname).toBe('maps.googleapis.com')
    const library = { Map3DElement: class {} }
    window.google = { maps: { importLibrary: vi.fn().mockResolvedValue(library) } }
    window.__firetrackrGoogleMapsReady()
    await expect(first).resolves.toBe(library)
    expect(window.google.maps.importLibrary).toHaveBeenCalledWith('maps3d')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('clears a failed load so Retry can request the script again', async () => {
    const scripts = browser()
    const { loadGoogleMaps3D } = await import('../src/utils/googleMaps3D')
    const first = loadGoogleMaps3D('test-public-key')
    const failure = expect(first).rejects.toThrow('could not load')
    scripts[0].onerror()
    await failure
    expect(scripts[0].remove).toHaveBeenCalledOnce()
    const retry = loadGoogleMaps3D('test-public-key')
    expect(scripts).toHaveLength(2)
    const timeout = expect(retry).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(20000)
    await timeout
    expect(scripts[1].remove).toHaveBeenCalledOnce()
  })

  it('times out a stalled library import even when the Google bootstrap is already present', async () => {
    browser()
    window.google = { maps: { importLibrary: vi.fn(() => new Promise(() => {})) } }
    const { loadGoogleMaps3D } = await import('../src/utils/googleMaps3D')
    const failure = expect(loadGoogleMaps3D('test-public-key')).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(20000)
    await failure
  })
})
