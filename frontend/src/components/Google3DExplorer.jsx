import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import { loadGoogleMaps3d } from '../utils/googleMaps3d'
import '../styles/Google3DExplorer.css'

const SETUP_HELP = 'Check that Maps JavaScript API and billing are enabled for your Google key, and that this website is allowed by its restrictions.'

function ExplorerDialog({ center, onClose }) {
  const dialogRef = useRef(null)
  const hostRef = useRef(null)
  const mapRef = useRef(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [tilt, setTilt] = useState(65)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog.showModal()
    return () => dialog.close()
  }, [])

  useEffect(() => {
    let disposed = false
    let failed = false
    let map
    const host = hostRef.current
    const fail = (message) => {
      if (disposed) return
      failed = true
      setError(message)
      setStatus('error')
    }
    const previousAuthFailure = window.gm_authFailure
    const authFailure = () => {
      fail(`Google could not authorize this map. ${SETUP_HELP}`)
      previousAuthFailure?.()
    }
    window.gm_authFailure = authFailure
    const timeout = window.setTimeout(() => {
      fail(`Google's 3D map did not finish loading. Check your connection and browser graphics acceleration. ${SETUP_HELP}`)
    }, 30000)

    loadGoogleMaps3d().then(({ Map3DElement }) => {
      if (disposed || failed) return
      map = new Map3DElement({
        center: { lat: center.lat, lng: center.lng, altitude: 0 },
        range: 2200,
        tilt: 65,
        heading: 0,
        mode: 'HYBRID',
        defaultUIHidden: false,
      })
      map.setAttribute('aria-label', 'Google photorealistic 3D map')
      map.addEventListener('gmp-error', () => {
        window.clearTimeout(timeout)
        fail(`Google could not initialize the 3D map. ${SETUP_HELP}`)
      })
      map.addEventListener('gmp-steadychange', (event) => {
        if (!disposed && !failed && event.isSteady) {
          window.clearTimeout(timeout)
          setStatus('ready')
        }
      })
      map.addEventListener('gmp-tiltchange', () => {
        if (!disposed) setTilt(Math.round(map.tilt ?? 65))
      })
      mapRef.current = map
      host.replaceChildren(map)
    }).catch((cause) => {
      window.clearTimeout(timeout)
      // Missing-key errors contain no credentials; never display a request URL.
      fail(import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim()
        ? `Unable to load Google Maps. ${SETUP_HELP}`
        : cause.message)
    })

    return () => {
      disposed = true
      window.clearTimeout(timeout)
      if (window.gm_authFailure === authFailure) {
        window.gm_authFailure = previousAuthFailure
      }
      mapRef.current = null
      map?.remove()
    }
  }, [center, attempt])

  function rotate(degrees) {
    const map = mapRef.current
    if (map) map.heading = ((map.heading ?? 0) + degrees + 360) % 360
  }

  function resetCamera() {
    const map = mapRef.current
    if (!map) return
    map.center = { lat: center.lat, lng: center.lng, altitude: 0 }
    map.range = 2200
    map.heading = 0
    map.tilt = 65
  }

  return createPortal(
    <dialog ref={dialogRef} className="google-3d-dialog" aria-labelledby="google-3d-title" onCancel={onClose}>
      <header className="google-3d-header">
        <div>
          <h2 id="google-3d-title">Photorealistic 3D</h2>
          <p>Explore buildings and terrain. Return to the command map for incidents and dispatch.</p>
        </div>
        <button type="button" autoFocus onClick={onClose}>Back to command map</button>
      </header>
      <div className="google-3d-stage">
        <div ref={hostRef} className="google-3d-host" />
        {status === 'loading' && <div className="google-3d-loading" role="status">Loading Google 3D imagery…</div>}
        {status === 'error' && (
          <div className="google-3d-error" role="alert">
            <h3>3D map unavailable</h3>
            <p>{error}</p>
            <a href="https://developers.google.com/maps/documentation/javascript/get-api-key" target="_blank" rel="noreferrer">Google Maps setup instructions</a>
            <button type="button" onClick={() => {
              setError('')
              setStatus('loading')
              setAttempt((value) => value + 1)
            }}>Try again</button>
          </div>
        )}
      </div>
      <footer className="google-3d-footer">
        <div className="google-3d-camera" aria-label="3D camera controls">
          <button type="button" disabled={status !== 'ready'} onClick={() => rotate(-30)}>Rotate left</button>
          <button type="button" disabled={status !== 'ready'} onClick={() => rotate(30)}>Rotate right</button>
          <label>
            Tilt
            <input type="range" min="0" max="80" value={Math.min(80, tilt)} disabled={status !== 'ready'}
              onChange={(event) => {
                const value = Number(event.target.value)
                setTilt(value)
                if (mapRef.current) mapRef.current.tilt = value
              }} />
            <span>{tilt}°</span>
          </label>
          <button type="button" disabled={status !== 'ready'} onClick={resetCamera}>Reset view</button>
        </div>
        <p>Drag to move and scroll to zoom. Detailed 3D buildings depend on Google’s imagery coverage at this location.</p>
      </footer>
    </dialog>,
    document.body,
  )
}

export default function Google3DExplorer({ disabled = false }) {
  const map = useMap()
  const [center, setCenter] = useState(null)
  return (
    <>
      <button type="button" className="google-3d-open" disabled={disabled}
        title={disabled ? 'Finish picking or drawing before exploring in 3D' : 'Explore this location with Google photorealistic 3D'}
        onClick={(event) => {
          event.stopPropagation()
          const location = map.getCenter()
          setCenter({ lat: location.lat, lng: location.lng })
        }}>
        <span aria-hidden="true">3D</span> Explore in 3D
      </button>
      {center && <ExplorerDialog center={center} onClose={() => setCenter(null)} />}
    </>
  )
}
