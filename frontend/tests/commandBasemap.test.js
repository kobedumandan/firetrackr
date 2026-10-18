import { afterEach, describe, expect, it, vi } from 'vitest'
import { COMMAND_BASEMAP_OPTIONS, TILE_OPTIONS, tileLayersFor } from '../src/data/mapConfig'
import {
  COMMAND_BASEMAP_KEY, isCommandBasemap, readCommandBasemap, saveCommandBasemap,
} from '../src/utils/commandBasemap'

afterEach(() => vi.unstubAllGlobals())

function storageWith(value) {
  const storage = { getItem: vi.fn(() => value), setItem: vi.fn() }
  vi.stubGlobal('window', { localStorage: storage })
  return storage
}

describe('Command map basemap preferences', () => {
  it.each(COMMAND_BASEMAP_OPTIONS.map(({ id }) => id))('restores and saves %s', (id) => {
    const storage = storageWith(id)
    expect(isCommandBasemap(id)).toBe(true)
    expect(readCommandBasemap()).toBe(id)
    expect(storage.getItem).toHaveBeenCalledWith(COMMAND_BASEMAP_KEY)
    saveCommandBasemap(id)
    expect(storage.setItem).toHaveBeenCalledWith(COMMAND_BASEMAP_KEY, id)
  })

  it.each([null, '', 'unknown'])('ignores invalid saved choice %s', (id) => {
    const storage = storageWith(id)
    expect(readCommandBasemap()).toBeNull()
    saveCommandBasemap(id)
    expect(storage.setItem).not.toHaveBeenCalled()
  })

  it('continues working when browser storage access is blocked', () => {
    vi.stubGlobal('window', {
      get localStorage() { throw new Error('Storage blocked') },
    })
    expect(readCommandBasemap()).toBeNull()
    expect(() => saveCommandBasemap('satellite')).not.toThrow()
  })

  it('continues working when browser storage is full', () => {
    const storage = storageWith(null)
    storage.setItem.mockImplementation(() => { throw new Error('Quota exceeded') })
    expect(() => saveCommandBasemap('dark')).not.toThrow()
  })

  it('has background tiles and provider credits for each option', () => {
    for (const { id } of TILE_OPTIONS) {
      expect(tileLayersFor(id)).not.toHaveLength(0)
      for (const layer of tileLayersFor(id)) {
        expect(layer.url).toContain('https://')
        expect(layer.attribution).toBeTruthy()
      }
    }
    expect(tileLayersFor('invalid')).toEqual(tileLayersFor('dark'))
  })

  it('uses a separate renderer for 3D without adding it to raster-only pickers', () => {
    expect(tileLayersFor('google-3d')).toEqual([])
    expect(TILE_OPTIONS.some(({ id }) => id === 'google-3d')).toBe(false)
  })
})
