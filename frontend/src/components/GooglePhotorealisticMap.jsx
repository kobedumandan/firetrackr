import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { loadGoogleMaps3D, zoomToRange, rangeToZoom, cameraAfterAction } from '../utils/googleMaps3D'
import { attachGoogle3DBridge } from '../utils/leafletGoogle3DBridge'
import { createGoogleConstraintOverlay } from '../utils/googleConstraintOverlay'
import { createGoogleBarangayOverlay } from '../utils/googleBarangayOverlay'
import { createGoogleHeatmapOverlay } from '../utils/googleHeatmapOverlay'
import MapCameraControls from './MapCameraControls'
import '../styles/GooglePhotorealisticMap.css'

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

export default function GooglePhotorealisticMap({ portalHost, controlsHost, active, onFallback, heatmapData, overlayRevision, gnnData, barangayData, showBarangayLabels }) {
  const leaflet = useMap()
  const host = useRef(null)
  const runtime = useRef(null)
  const fallback = useRef({ active, onFallback })
  useEffect(() => { fallback.current = { active, onFallback } }, [active, onFallback])
  const [instance, setInstance] = useState(null)
  const [status, setStatus] = useState('loading')
  const [readyScene, setReadyScene] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [camera, setCamera] = useState({ tilt: 55, heading: 0 })
  const onCameraChange = useCallback(next => {
    setCamera(next)
    const current = runtime.current
    if (current && Number.isFinite(next.range)) {
      current.heatmap.setZoom(rangeToZoom(next.range, current.map.center.lat, leaflet.getSize().y))
    }
  }, [leaflet])
  const [barangayError, setBarangayError] = useState(false)
  const [heatmapFailure, setHeatmapFailure] = useState(null)
  const reportHeatmapError = useCallback(error => {
    console.warn('Google heatmap overlay:', error?.message || error)
    setHeatmapFailure({ data: runtime.current?.heatmapData })
  }, [])
  const reportBarangayError = useCallback(error => {
    // Log the actual SDK message locally; cross-origin uncaught errors otherwise
    // arrive as just "Script error" and unmount the entire dashboard.
    console.warn('Google Barangay overlay:', error?.message || error)
    setBarangayError(true)
  }, [])

  // Keep this instance and Google's own tile cache alive between style changes.
  useEffect(() => {
    if (!portalHost || !host.current) return
    let cancelled = false
    let failed = false
    let map
    const previousAuthFailure = window.gm_authFailure
    function fail(message) {
      if (cancelled || failed) return
      failed = true
      setError(message)
      setStatus('error')
      if (fallback.current.active) fallback.current.onFallback?.()
    }
    const authFailure = () => {
      previousAuthFailure?.()
      fail('Google rejected this API key. Check Maps JavaScript API access, billing, and the allowed website addresses in Google Cloud.')
    }
    window.gm_authFailure = authFailure
    const onError = () => fail('Google could not initialize the 3D map. Check API access and that your browser supports WebGL.')
    const onSteady = event => {
      if (!cancelled && !failed && event.isSteady) setReadyScene(map)
    }
    loadGoogleMaps3D(API_KEY).then(library => {
      if (cancelled || failed) return
      const center = leaflet.getCenter()
      map = new library.Map3DElement({
        center: { lat: center.lat, lng: center.lng, altitude: 0 },
        range: zoomToRange(leaflet.getZoom(), center.lat, leaflet.getSize().y),
        fov: 45, tilt: 55, heading: 0, mode: 'SATELLITE', defaultUIHidden: true,
        gestureHandling: 'GREEDY', minTilt: 0, maxTilt: 80,
        ...(library.QualityMode ? { qualityMode: library.QualityMode.FIDELITY } : {}),
        description: 'FireTrackr photorealistic map. Drag to pan; use the controls to tilt, rotate and zoom.',
      })
      map.style.width = '100%'
      map.style.height = '100%'
      map.addEventListener('gmp-error', onError)
      map.addEventListener('gmp-steadychange', onSteady)
      const bridge = attachGoogle3DBridge(leaflet, map, library, L, onCameraChange, { initiallyActive: false })
      runtime.current = {
        map, bridge,
        roads: createGoogleConstraintOverlay(map, library, leaflet, L),
        barangays: createGoogleBarangayOverlay(map, library, reportBarangayError),
        heatmap: createGoogleHeatmapOverlay(map, library, reportHeatmapError),
      }
      setInstance(map)
      host.current.append(map)
      // Steady means *every* streamed tile is done, not that the map is usable.
      // Finer imagery can load while navigating. Only SDK errors are fatal.
      // Keep the initial loading cover separate from interactive readiness.
      setStatus('ready')
    }).catch(error => fail(error.message))

    return () => {
      cancelled = true
      if (window.gm_authFailure === authFailure) window.gm_authFailure = previousAuthFailure
      runtime.current?.bridge.dispose()
      runtime.current?.roads.dispose()
      runtime.current?.barangays.dispose()
      runtime.current?.heatmap.dispose()
      runtime.current = null
      map?.removeEventListener('gmp-error', onError)
      map?.removeEventListener('gmp-steadychange', onSteady)
      map?.remove()
    }
  }, [leaflet, portalHost, attempt, reportBarangayError, reportHeatmapError, onCameraChange])

  useEffect(() => {
    const current = runtime.current
    if (!current || current.map !== instance) return
    current.bridge.setActive(active && status === 'ready')
    current.roads.setActive(active && status === 'ready')
  }, [active, status, instance])
  useEffect(() => { if (active && status === 'ready' && runtime.current?.map === instance) runtime.current.bridge.refresh() }, [active, status, overlayRevision, instance])
  useEffect(() => { if (runtime.current?.map === instance) runtime.current?.roads.sync(gnnData) }, [gnnData, status, instance])
  useEffect(() => {
    const current = runtime.current
    if (!current || current.map !== instance) return
    current.heatmapData = heatmapData
    current.heatmap.setZoom(rangeToZoom(current.map.range, current.map.center.lat, leaflet.getSize().y))
    current.heatmap.sync(heatmapData)
    current.heatmap.setActive(active && status === 'ready')
  }, [active, status, instance, heatmapData, leaflet])
  useEffect(() => {
    const overlay = runtime.current?.barangays
    if (!overlay || runtime.current.map !== instance) return
    try {
      if (!active || status !== 'ready') {
        overlay.setActive(false)
        return
      }
      overlay.sync(barangayData, showBarangayLabels)
      overlay.setActive(true)
    } catch (error) {
      // A failed optional overlay must never unmount the app or the other maps.
      overlay.setActive(false)
      // The SDK rejected this update; publish that external failure once.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      reportBarangayError(error)
    }
  }, [active, barangayData, showBarangayLabels, status, reportBarangayError, instance])

  function act(action) {
    const map = runtime.current?.map
    if (!map || status !== 'ready') return
    const change = cameraAfterAction(map, action)
    if (document.documentElement.dataset.motion === 'off') Object.assign(map, change)
    else {
      map.stopCameraAnimation()
      map.flyCameraTo({ endCamera: { center: map.center, range: map.range, heading: map.heading, tilt: map.tilt, ...change }, durationMillis: 240 })
    }
  }

  if (!portalHost) return null
  return <>
    {createPortal(<>
      <div className="google-map-canvas" ref={host} />
      {active && status !== 'error' && (status === 'loading' || readyScene !== instance) && (
        <div className="google-map-loading" role="progressbar" aria-label="Loading photorealistic map">
          <span className="google-map-spinner" aria-hidden="true" />
        </div>
      )}
      {active && status === 'error' && (
        <div className="google-map-message" role="alert">
          <strong>Photorealistic map unavailable</strong>
          <p>{error}</p>
          <div>
            <button type="button" onClick={() => { setStatus('loading'); setReadyScene(null); setError(''); setAttempt(value => value + 1) }}>Retry</button>
            <button type="button" onClick={onFallback}>Use Satellite</button>
          </div>
        </div>
      )}
      {active && heatmapData && heatmapFailure?.data === heatmapData && <div className="google-map-note" role="alert">The 3D heatmap could not render. Choose Light or Dark to view it.</div>}
      {active && barangayData && barangayError && <div className="google-map-note" role="status">
        Some Barangay details could not load in 3D. <button type="button" onClick={onFallback}>View in Satellite</button>
      </div>}
    </>, portalHost)}
    {active && <MapCameraControls host={controlsHost} camera={camera} onAction={act} disabled={status !== 'ready'} title="3D view" detail="HD" />}
  </>
}
