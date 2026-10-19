import { rangeToZoom, zoomToRange } from './googleMaps3D'
import { frameThrottle } from './commandMapData'
import { setGoogleLinePath, setGooglePolygonPaths } from './googleMapGeometry'
import { PANABO_BOUNDARY_COLOR } from './mapOverlayColors'
import { attachIncidentHover } from './incidentHover'

const position = point => ({ lat: point.lat, lng: point.lng, altitude: 0 })

export function linePaths(points) {
  if (!points?.length) return []
  if (typeof points[0].lat === 'number') return [points.map(position)]
  return points.flatMap(linePaths)
}

export function polygonPaths(points) {
  if (!points?.length) return []
  if (typeof points[0].lat === 'number') return [{ path: points.map(position), innerPaths: [] }]
  if (typeof points[0]?.[0]?.lat === 'number') {
    return [{ path: points[0].map(position), innerPaths: points.slice(1).map(ring => ring.map(position)) }]
  }
  return points.flatMap(polygonPaths)
}

function colorWithOpacity(color = '#ff4d1a', opacity = 1) {
  if (/^#[\da-f]{6}$/i.test(color)) {
    return `${color}${Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0')}`
  }
  return color
}

function labelFor(layer) {
  const content = layer.getTooltip?.()?.getContent()
  if (!content) return ''
  if (typeof content !== 'string') return content.textContent?.trim() || ''
  const label = document.createElement('div')
  label.innerHTML = content
  return label.textContent.trim()
}

// Reuse the *visible* Leaflet layers as the source of truth. This preserves
// dispatch filtering, live positions, layer toggles and existing click actions.
export function attachGoogle3DBridge(leaflet, googleMap, library, L, onCamera, { initiallyActive = true } = {}) {
  const overlays = new Map()
  let syncing = false
  let disposed = false
  let unloaded = false
  let active = initiallyActive
  let cameraTimer = null
  let frame = null
  const height = () => leaflet.getSize().y

  function saveCamera() {
    if (!active || disposed || unloaded || !googleMap.center) return
    const { lat, lng } = googleMap.center
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    syncing = true
    try {
      leaflet.setView([lat, lng], rangeToZoom(googleMap.range, lat, height()), { animate: false })
    } finally {
      syncing = false
    }
  }

  function fromLeaflet() {
    if (!active || syncing || disposed || unloaded) return
    const center = leaflet.getCenter()
    const range = zoomToRange(leaflet.getZoom(), center.lat, height())
    // Do not reset a cached camera simply because Leaflet rounds its zoom.
    if (Math.abs(center.lat - googleMap.center.lat) > 0.000001 || Math.abs(center.lng - googleMap.center.lng) > 0.000001) googleMap.center = position(center)
    if (Math.abs(rangeToZoom(googleMap.range, center.lat, height()) - leaflet.getZoom()) > 0.51) googleMap.range = range
  }

  function fromGoogle(event) {
    if (event.isSteady) saveCamera()
  }

  function forwardClick(event) {
    if (!active || !event.position) return
    event.preventDefault()
    leaflet.closePopup()
    leaflet.fire('click', { latlng: L.latLng(event.position.lat, event.position.lng), originalEvent: event })
  }

  function clickLayer(layer, event) {
    if (!active) return
    if (leaflet.getContainer?.().classList.contains('pick-cursor')) return
    event.stopPropagation()
    const latlng = layer.getLatLng?.() ?? (event.position && L.latLng(event.position.lat, event.position.lng))
    layer.fire('click', { latlng, originalEvent: event })
    if (!layer.getPopup?.() && layer.getTooltip?.() && latlng) {
      L.popup({ autoPan: false }).setLatLng(latlng).setContent(layer.getTooltip().getContent()).openOn(leaflet)
    }
  }

  function describe(layer) {
    const options = layer.options || {}
    // The 2D world mask is not a surface in a globe renderer.
    if (options.className === 'cov-hatch-path') return null
    if (options.className === 'barangay-boundary' || options.icon?.options?.className === 'barangay-map-label') return null
    if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
      const point = layer.getLatLng()
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null
      return { type: 'marker', position: position(point), title: labelFor(layer),
        icon: options.icon?.options, radius: options.radius, color: options.fillColor || options.color,
        interactive: options.interactive !== false, opacity: options.opacity ?? 1 }
    }
    if (layer instanceof L.Polyline) {
      if (options.className === 'jurisdiction-boundary') {
        return { type: 'line', paths: linePaths(layer.getLatLngs()).map(path => [...path, path[0]]),
          strokeColor: PANABO_BOUNDARY_COLOR, strokeWidth: 4, zIndex: 10, title: '' }
      }
      return { type: layer instanceof L.Polygon ? 'polygon' : 'line',
        paths: layer instanceof L.Polygon ? polygonPaths(layer.getLatLngs()) : linePaths(layer.getLatLngs()),
        strokeColor: colorWithOpacity(options.color, options.opacity ?? 1),
        strokeWidth: options.stroke === false ? 0 : options.weight ?? 3,
        fillColor: options.fill === false ? '#00000000' : colorWithOpacity(options.fillColor || options.color, options.fillOpacity ?? 0.2),
        title: labelFor(layer) }
    }
    return null
  }

  function createOverlay(layer, description) {
    const elements = []
    let hover
    const popup = layer.getPopup?.()
    const previousAutoPan = popup?.options.autoPan
    if (popup) popup.options.autoPan = false
    if (description.type === 'marker') {
      const htmlMarker = Boolean(library.MarkerElement)
      const Marker = description.interactive
        ? library.MarkerInteractiveElement || library.Marker3DInteractiveElement
        : library.MarkerElement || library.Marker3DElement
      const element = new Marker({
        position: description.position, title: description.title,
        altitudeMode: 'CLAMP_TO_GROUND', anchorLeft: '-50%', anchorTop: '-50%',
      })
      const icon = layer.options.icon?.createIcon()
      if (icon && htmlMarker) {
        icon.classList.remove('leaflet-marker-icon', 'leaflet-zoom-animated', 'leaflet-interactive')
        Object.assign(icon.style, { position: 'relative', margin: '0', transform: 'none' })
        const anchor = layer.options.icon.options.iconAnchor
        if (anchor) {
          element.anchorLeft = `${-anchor[0]}px`
          element.anchorTop = `${-anchor[1]}px`
        }
        element.append(icon)
      } else if (htmlMarker) {
        const dot = document.createElement('span')
        dot.className = 'google-map-dot'
        Object.assign(dot.style, { background: description.color || '#ff4d1a',
          width: `${2 * (description.radius || 5)}px`, height: `${2 * (description.radius || 5)}px` })
        element.append(dot)
      }
      element.style.opacity = description.opacity
      if (description.interactive) element.addEventListener('gmp-click', event => clickLayer(layer, event))
      hover = attachIncidentHover(element, layer, () => active && !disposed && !unloaded && !leaflet.getContainer?.().classList.contains('pick-cursor'))
      elements.push(element)
    } else {
      for (const path of description.paths) {
        const polygon = description.type === 'polygon'
        const interactive = Boolean(layer.getTooltip?.() || layer.getPopup?.())
        const Element = polygon
          ? (interactive && library.Polygon3DInteractiveElement) || library.Polygon3DElement || library.Polygon3DInteractiveElement
          : (interactive && library.Polyline3DInteractiveElement) || library.Polyline3DElement || library.Polyline3DInteractiveElement
        const element = new Element({
          altitudeMode: 'RELATIVE_TO_GROUND', drawsOccludedSegments: true,
          strokeColor: description.strokeColor, strokeWidth: description.strokeWidth,
          zIndex: description.zIndex,
          ...(polygon ? { fillColor: description.fillColor } : {}),
        })
        if (polygon) setGooglePolygonPaths(element, path)
        else setGoogleLinePath(element, path.map(point => ({ ...point, altitude: 2 })))
        element.addEventListener('gmp-click', event => {
          // Plain boundaries must not swallow location picking/drawing clicks.
          if (!layer.getTooltip?.() && !layer.getPopup?.()) return
          clickLayer(layer, event)
        })
        elements.push(element)
      }
    }
    googleMap.append(...elements)
    const move = () => schedule()
    layer.on('move', move)
    return {
      signature: JSON.stringify(description),
      hideHover() { hover?.hide() },
      remove() {
        hover?.dispose()
        layer.off('move', move)
        elements.forEach(element => element.remove())
        if (popup) popup.options.autoPan = previousAutoPan
      },
    }
  }

  function refresh() {
    frame = null
    if (!active || disposed) return
    const seen = new Set()
    leaflet.eachLayer(layer => {
      const description = describe(layer)
      if (!description) return
      seen.add(layer)
      const current = overlays.get(layer)
      if (current?.signature === JSON.stringify(description)) return
      current?.remove()
      overlays.set(layer, createOverlay(layer, description))
    })
    for (const [layer, overlay] of overlays) {
      if (!seen.has(layer)) {
        overlay.remove()
        overlays.delete(layer)
      }
    }
  }

  function schedule() {
    if (!disposed && frame === null) frame = requestAnimationFrame(refresh)
  }
  const readCamera = frameThrottle(() => {
    if (active) onCamera({ tilt: googleMap.tilt ?? 0, heading: googleMap.heading ?? 0, range: googleMap.range })
  })
  function cameraChanged() {
    if (!active) return
    overlays.forEach(overlay => overlay.hideHover())
    readCamera()
    clearTimeout(cameraTimer)
    cameraTimer = setTimeout(saveCamera, 150)
  }
  function onUnload() { unloaded = true }
  leaflet.on('unload', onUnload)
  leaflet.on('moveend', fromLeaflet)
  leaflet.on('layeradd layerremove', schedule)
  googleMap.addEventListener('gmp-steadychange', fromGoogle)
  googleMap.addEventListener('gmp-click', forwardClick)
  const cameraEvents = ['gmp-centerchange', 'gmp-tiltchange', 'gmp-headingchange', 'gmp-rangechange']
  cameraEvents.forEach(name => googleMap.addEventListener(name, cameraChanged))
  schedule()

  return {
    refresh: schedule,
    setActive(value) {
      if (active && !value) saveCamera()
      active = value
      if (!value) overlays.forEach(overlay => overlay.hideHover())
      if (value) { fromLeaflet(); schedule(); readCamera() }
      else { readCamera.cancel(); clearTimeout(cameraTimer) }
    },
    dispose() {
      // Carry the last position back even if the user switches mid-gesture.
      saveCamera()
      disposed = true
      readCamera.cancel()
      clearTimeout(cameraTimer)
      if (frame !== null) cancelAnimationFrame(frame)
      leaflet.off('moveend', fromLeaflet)
      leaflet.off('unload', onUnload)
      leaflet.off('layeradd layerremove', schedule)
      googleMap.removeEventListener('gmp-steadychange', fromGoogle)
      googleMap.removeEventListener('gmp-click', forwardClick)
      cameraEvents.forEach(name => googleMap.removeEventListener(name, cameraChanged))
      overlays.forEach(overlay => overlay.remove())
      overlays.clear()
      leaflet.closePopup()
    },
  }
}
