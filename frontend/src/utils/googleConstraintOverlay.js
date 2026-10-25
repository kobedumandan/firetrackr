import { constraintFeatures } from './commandMapData'
import { colorWithOpacity, setGoogleLinePath } from './googleMapGeometry'
import { createRoadHover } from './roadHover'
import { openConstraintPopup } from './constraintPopup'

export function createGoogleConstraintOverlay(map, library, leaflet, L) {
  let cachedData
  let selectedData
  let active = true
  let features = []
  let cursor = 0
  let frame = null
  const elements = new Map()
  const hover = createRoadHover()
  let pointer
  let hoveredRoad
  const hideHover = () => { hoveredRoad = null; hover.hide(); map.classList.remove('command-road-hover') }
  const onPointerMove = event => {
    pointer = event
    if (!active || event.buttons || leaflet.getContainer().classList.contains('pick-cursor')) { hideHover(); return }
    if (hoveredRoad) hover.show(hoveredRoad, event)
  }
  map.addEventListener('pointermove', onPointerMove)
  map.addEventListener('pointerleave', hideHover)
  map.addEventListener('gmp-centerchange', hideHover)
  map.addEventListener('gmp-headingchange', hideHover)
  map.addEventListener('gmp-tiltchange', hideHover)
  map.addEventListener('gmp-rangechange', hideHover)
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
          strokeColor: colorWithOpacity(feature.properties.color, feature.properties.opacity), strokeWidth: Math.max(3, feature.properties.weight) })
        setGoogleLinePath(element, feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng, altitude: 2 })))
        const showHover = event => {
          if (!active || !selectedData || (event.domEvent || pointer)?.buttons || leaflet.getContainer().classList.contains('pick-cursor')) { hideHover(); return }
          hoveredRoad = feature.properties
          map.classList.add('command-road-hover')
          hover.show(hoveredRoad, event.domEvent || pointer)
        }
        element.addEventListener('gmp-pointerover', showHover)
        element.addEventListener('gmp-pointermove', showHover)
        element.addEventListener('gmp-pointerout', hideHover)
        element.addEventListener('gmp-click', event => {
          if (leaflet.getContainer().classList.contains('pick-cursor')) return
          event.stopPropagation()
          if (!event.position) return
          hideHover()
          const rect = leaflet.getContainer().getBoundingClientRect()
          const screenAnchor = Number.isFinite(pointer?.clientX) ? { x: pointer.clientX - rect.left, y: pointer.clientY - rect.top } : undefined
          openConstraintPopup(leaflet, L, feature.properties, [event.position.lat, event.position.lng], screenAnchor)
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
      hideHover()
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
      if (!value) { cancel(); hideHover() }
      else if (selectedData && cursor < features.length && frame === null) frame = requestAnimationFrame(build)
    },
    dispose() {
      active = false; selectedData = null
      hideHover()
      cancel(); hover.dispose(); elements.forEach(element => element.remove()); elements.clear()
      map.removeEventListener('pointermove', onPointerMove)
      map.removeEventListener('pointerleave', hideHover)
      map.removeEventListener('gmp-centerchange', hideHover)
      map.removeEventListener('gmp-headingchange', hideHover)
      map.removeEventListener('gmp-tiltchange', hideHover)
      map.removeEventListener('gmp-rangechange', hideHover)
    },
  }
}
