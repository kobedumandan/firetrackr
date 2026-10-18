import { COMMAND_BASEMAP_OPTIONS } from '../data/mapConfig'

export const COMMAND_BASEMAP_KEY = 'firetrackr.commandBasemap'

export function isCommandBasemap(value) {
  return COMMAND_BASEMAP_OPTIONS.some(({ id }) => id === value)
}

export function readCommandBasemap() {
  try {
    const saved = window.localStorage.getItem(COMMAND_BASEMAP_KEY)
    return isCommandBasemap(saved) ? saved : null
  } catch {
    return null
  }
}

export function saveCommandBasemap(value) {
  if (!isCommandBasemap(value)) return
  try {
    window.localStorage.setItem(COMMAND_BASEMAP_KEY, value)
  } catch {
    // The control still works when browser storage is unavailable.
  }
}
