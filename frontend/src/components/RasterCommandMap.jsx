import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { attachRasterBridge } from '../utils/leafletRasterBridge'
import { rasterMapStyle, selectRasterStyle } from '../utils/rasterMapStyle'
import { constraintFeatures, EMPTY_GEOJSON } from '../utils/commandMapData'
import { clamp } from '../utils/googleMaps3D'
import MapCameraControls from './MapCameraControls'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function RasterCommandMap({ portalHost, controlsHost, active, tileMode, overlayRevision, gnnData, heatPoints, picking }) {
  const leaflet = useMap()
  const host = useRef(null)
  const runtime = useRef(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [camera, setCamera] = useState({ tilt: 0, heading: 0 })

  useEffect(() => {
    if (!portalHost || !host.current) return
    let cancelled = false
    let map
    let observer
    import('maplibre-gl').then(maplibre => {
      if (cancelled) return
      const center = leaflet.getCenter()
      map = new maplibre.Map({
        container: host.current, style: rasterMapStyle(), center: [center.lng, center.lat],
        zoom: leaflet.getZoom() - 1, pitch: 0, bearing: 0, minZoom: 1, maxZoom: 20, maxPitch: 70,
        pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
        maxTileCacheSize: 96, maxTileCacheZoomLevels: 4, fadeDuration: 160,
        canvasContextAttributes: { antialias: true },
        attributionControl: { compact: true },
      })
      map.on('load', () => {
        if (cancelled) return
        runtime.current = { map, bridge: attachRasterBridge(leaflet, map, maplibre, L, setCamera) }
        setReady(true)
      })
      map.on('error', event => {
        // A missing tile is recoverable; the SDK retains surrounding tiles.
        if (!event.sourceId) setError('The map could not initialize. Enable hardware acceleration and reload the page.')
      })
      observer = new ResizeObserver(() => { if (map.getContainer().offsetWidth) map.resize() })
      observer.observe(host.current)
    }).catch(() => { if (!cancelled) setError('The map renderer could not load. Reload the page to retry.') })
    return () => {
      cancelled = true; observer?.disconnect(); runtime.current?.bridge.dispose(); runtime.current = null; map?.remove()
    }
  }, [leaflet, portalHost])

  useEffect(() => { if (ready) runtime.current?.bridge.setActive(active) }, [active, ready])
  useEffect(() => {
    if (ready && active) selectRasterStyle(runtime.current.map, tileMode)
  }, [ready, active, tileMode])
  useEffect(() => { if (ready && active) runtime.current?.bridge.refresh() }, [ready, active, overlayRevision])
  useEffect(() => {
    if (ready) runtime.current.map.getSource('command-roads').setData(constraintFeatures(gnnData))
  }, [ready, gnnData])
  useEffect(() => {
    if (!ready) return
    runtime.current.map.getSource('command-heat').setData(heatPoints?.length ? {
      type: 'FeatureCollection', features: heatPoints.map(point => ({ type: 'Feature', properties: { weight: point.weight },
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] } })),
    } : EMPTY_GEOJSON)
  }, [ready, heatPoints])
  useEffect(() => { if (ready) runtime.current.map.getCanvas().style.cursor = picking ? 'crosshair' : '' }, [ready, picking])

  function act(action) {
    const map = runtime.current?.map
    if (!map) return
    const duration = document.documentElement.dataset.motion === 'off' ? 0 : 240
    const options = { duration }
    if (action === 'tilt-up' || action === 'tilt-down') options.pitch = clamp(map.getPitch() + (action === 'tilt-up' ? 10 : -10), 0, 70)
    if (action === 'rotate-left' || action === 'rotate-right') options.bearing = map.getBearing() + (action === 'rotate-left' ? -15 : 15)
    if (action === 'zoom-in' || action === 'zoom-out') options.zoom = clamp(map.getZoom() + (action === 'zoom-in' ? 0.6 : -0.6), 1, 20)
    if (action === 'reset') { options.pitch = 0; options.bearing = 0 }
    map.easeTo(options)
  }
  if (!portalHost) return null
  return <>
    {createPortal(<><div className="raster-map-canvas" ref={host} />{active && error && <div className="google-map-message" role="alert">{error}</div>}</>, portalHost)}
    {active && <MapCameraControls host={controlsHost} camera={camera} onAction={act} disabled={!ready || Boolean(error)} maxTilt={70} title="Map view · HD" />}
  </>
}
