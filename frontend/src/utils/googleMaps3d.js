import { importLibrary, setOptions } from '@googlemaps/js-api-loader'

let configured = false

// Load only when the user opens 3D; the dispatch map remains independent.
export function loadGoogleMaps3d() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
  if (!key) {
    return Promise.reject(new Error('Add VITE_GOOGLE_MAPS_API_KEY to frontend/.env, then restart the frontend.'))
  }
  if (!configured) {
    setOptions({ key, v: 'weekly', language: 'en', region: 'PH' })
    configured = true
  }
  return importLibrary('maps3d')
}
