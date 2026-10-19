let libraryPromise

// Loaded only after the user chooses the Google style. One script is shared
// across style switches, including React StrictMode's setup/cleanup cycle.
export function loadGoogleMaps3D(apiKey) {
  if (!apiKey) return Promise.reject(new Error('Add your Google Maps API key to .env, then restart the frontend.'))
  if (libraryPromise) return libraryPromise
  libraryPromise = new Promise((resolve, reject) => {
    let script
    let settled = false
    const callback = '__firetrackrGoogleMapsReady'
    const timer = setTimeout(() => fail('Google Maps timed out. Check your connection and try again.'), 20000)
    function fail(message) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      script?.remove()
      // A late response must not throw if its request completes after timeout.
      window[callback] = () => {}
      reject(new Error(message))
    }
    function importLibrary() {
      window.google.maps.importLibrary('maps3d').then(library => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(library)
      }).catch(() => fail('Google 3D Maps could not load. Check your connection and API access.'))
    }
    if (window.google?.maps?.importLibrary) {
      importLibrary()
      return
    }
    window[callback] = importLibrary
    script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?${new URLSearchParams({
      key: apiKey, v: 'weekly', loading: 'async', callback,
    })}`
    script.async = true
    script.onerror = () => fail('Google Maps could not load. Check your connection or browser blocker.')
    document.head.append(script)
  }).catch(error => {
    libraryPromise = undefined
    throw error
  })
  return libraryPromise
}

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
export const wrapHeading = value => ((value % 360) + 360) % 360

// Approximate the same ground scale between Leaflet's zoom and Google's
// camera range. Both directions use the same conversion to prevent drift.
export function zoomToRange(zoom, latitude, height = 600) {
  const metresPerPixel = 156543.03392 * Math.cos(latitude * Math.PI / 180) / 2 ** zoom
  return clamp(metresPerPixel * Math.max(height, 1) / (2 * Math.tan(Math.PI / 8)), 80, 20000000)
}

export function rangeToZoom(range, latitude, height = 600) {
  const scale = 156543.03392 * Math.cos(latitude * Math.PI / 180) * Math.max(height, 1)
  return clamp(Math.log2(scale / (Math.max(range, 1) * 2 * Math.tan(Math.PI / 8))), 2, 19)
}

export function cameraAfterAction(camera, action) {
  const { tilt = 55, heading = 0, range = 5000 } = camera
  switch (action) {
    case 'tilt-up': return { tilt: clamp(tilt + 10, 0, 80) }
    case 'tilt-down': return { tilt: clamp(tilt - 10, 0, 80) }
    case 'rotate-left': return { heading: wrapHeading(heading - 15) }
    case 'rotate-right': return { heading: wrapHeading(heading + 15) }
    case 'zoom-in': return { range: clamp(range / 1.5, 80, 20000000) }
    case 'zoom-out': return { range: clamp(range * 1.5, 80, 20000000) }
    case 'reset': return { tilt: 0, heading: 0, roll: 0 }
    default: return {}
  }
}
