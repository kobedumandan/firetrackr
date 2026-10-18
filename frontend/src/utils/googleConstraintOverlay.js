import { constraintFeatures } from './commandMapData'
import { setGoogleLinePath } from './googleMapGeometry'

export function createGoogleConstraintOverlay(map, library, leaflet, L) {
  let cachedData
  let selectedData
  let active = true
  let features = []
  let cursor = 0
  let frame = null
  const elements = new Map()
  function cancel() { if (frame !== null) cancelAnimationFrame(frame); frame = null }
  function build() {
    frame = null
    if (!active || !selectedData) return
    // Preserve native road imagery; draw the actual constraints above it.
    // Bounded batches keep camera input responsive on modest laptops.
    const end = Math.min(cursor + 40, features.length)
    for (; cursor < end; cursor++) {
      const feature = features[cursor]
      let element = elements.get(feature.id)
      if (!element) {
        const Element = library.Polyline3DInteractiveElement || library.Polyline3DElement
        element = new Element({ altitudeMode: 'RELATIVE_TO_GROUND', drawsOccludedSegments: true,
          strokeColor: feature.properties.color, strokeWidth: Math.max(3, feature.properties.weight) })
        setGoogleLinePath(element, feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng, altitude: 2 })))
        element.addEventListener('gmp-click', event => {
          if (leaflet.getContainer().classList.contains('pick-cursor')) return
          event.stopPropagation()
          if (!event.position) return
          const content = document.createElement('div'); content.textContent = feature.properties.title
          L.popup({ autoPan: false }).setLatLng([event.position.lat, event.position.lng]).setContent(content).openOn(leaflet)
        })
        elements.set(feature.id, element)
      }
      if (element.parentNode !== map) map.append(element)
    }
    if (cursor < features.length) frame = requestAnimationFrame(build)
  }
  return {
    sync(data) {
      if (selectedData === data) return
      cancel()
      selectedData = data
      elements.forEach(element => element.remove())
      if (!data) return
      if (cachedData !== data) {
        elements.clear()
        cachedData = data
        features = constraintFeatures(data).features.filter(feature => !feature.properties.normal)
      }
      cursor = 0
      if (active) frame = requestAnimationFrame(build)
    },
    setActive(value) {
      active = value
      if (!value) cancel()
      else if (selectedData && cursor < features.length && frame === null) frame = requestAnimationFrame(build)
    },
    dispose() { cancel(); elements.forEach(element => element.remove()); elements.clear() },
  }
}
