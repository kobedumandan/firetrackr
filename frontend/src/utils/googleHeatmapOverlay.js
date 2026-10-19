import { setGooglePolygonPaths } from './googleMapGeometry'
import { heatmapOpacity } from './heatmapOpacity'

export function createGoogleHeatmapOverlay(map, library, onError = () => {}) {
  let data, active = false, frame = null, cursor = 0
  let opacityFactor = 1
  const elements = []
  const fillColor = feature => `${feature.properties.color}${Math.round((feature.properties.opacity ?? 0.65) * opacityFactor * 255).toString(16).padStart(2, '0')}`
  const cancel = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null }
  const detach = () => elements.forEach(element => element.remove())
  function build() {
    frame = null
    if (!active || !data) return
    try {
      const end = Math.min(cursor + 30, data.features.length)
      for (; cursor < end; cursor++) {
        const feature = data.features[cursor]
        let element = elements[cursor]
        if (!element) {
          const Polygon = library.Polygon3DElement
          if (!Polygon) throw new Error('Google polygon rendering is unavailable')
          element = new Polygon({ altitudeMode: 'CLAMP_TO_GROUND',
            fillColor: fillColor(feature), strokeWidth: 0,
            drawsOccludedSegments: true, zIndex: feature.properties.band + 1 })
          elements[cursor] = element
          const coordinates = ring => ring.map(([lng, lat]) => ({ lat, lng, altitude: 0 }))
          setGooglePolygonPaths(element, { path: coordinates(feature.geometry.coordinates[0]),
            innerPaths: feature.geometry.coordinates.slice(1).map(coordinates) })
        }
        if (element.parentNode !== map) map.append(element)
      }
      if (cursor < data.features.length) frame = requestAnimationFrame(build)
    } catch (error) {
      cancel(); detach(); elements.length = 0; cursor = 0; active = false
      onError(error)
    }
  }
  return {
    setZoom(zoom) {
      // Quantize to alpha precision so rotation/panning doesn't restyle every
      // polygon. Update color only; keep the contour geometry and instances.
      const next = Math.round(heatmapOpacity(zoom, 1) * 255) / 255
      if (next === opacityFactor) return
      opacityFactor = next
      try {
        elements.forEach((element, index) => { element.fillColor = fillColor(data.features[index]) })
      } catch (error) {
        cancel(); detach(); active = false; onError(error)
      }
    },
    sync(next) {
      if (next === data) return
      cancel(); detach(); elements.length = 0; cursor = 0; data = next
      if (active && data?.features.length) frame = requestAnimationFrame(build)
    },
    setActive(value) {
      if (active === value) return
      active = value; cancel(); cursor = 0
      if (!value) detach()
      else if (data?.features.length) frame = requestAnimationFrame(build)
    },
    dispose() { active = false; cancel(); detach(); elements.length = 0; data = null },
  }
}
