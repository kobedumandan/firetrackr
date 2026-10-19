import { frameThrottle } from './commandMapData'
import { attachIncidentHover } from './incidentHover'

// Leaflet remains the dashboard's interaction model. MapLibre projects its
// visible operational layers with the same camera as the tilted raster tiles.
export function attachRasterBridge(leaflet, map, maplibre, L, onCamera) {
  const markers = new Map()
  const clickTargets = new Map()
  let active = false
  let syncing = false
  let unloaded = false
  let lastGeometry = ''
  let nextId = 0
  const ids = new WeakMap()
  const idFor = layer => { if (!ids.has(layer)) ids.set(layer, ++nextId); return ids.get(layer) }

  function label(layer) {
    const content = layer.getTooltip?.()?.getContent()
    return typeof content === 'string' ? content.replace(/<[^>]*>/g, ' ').trim() : content?.textContent?.trim() || ''
  }
  function clickLayer(layer, event) {
    const latlng = layer.getLatLng?.() || L.latLng(event.lngLat.lat, event.lngLat.lng)
    layer.fire('click', { latlng, originalEvent: event.originalEvent })
    if (!layer.getPopup?.() && layer.getTooltip?.()) {
      L.popup({ autoPan: false }).setLatLng(latlng).setContent(layer.getTooltip().getContent()).openOn(leaflet)
    }
  }
  const refresh = frameThrottle(() => {
    if (!active || unloaded) return
    const seen = new Set()
    const features = []
    clickTargets.clear()
    leaflet.eachLayer(layer => {
      const options = layer.options || {}
      if (['cov-hatch-path', 'jurisdiction-boundary'].includes(options.className)) return
      if (layer instanceof L.Marker) {
        seen.add(layer)
        const point = layer.getLatLng()
        const signature = JSON.stringify([options.icon?.options, label(layer), options.opacity])
        let entry = markers.get(layer)
        if (entry?.signature !== signature) {
          entry?.remove()
          const element = options.icon?.createIcon() || document.createElement('span')
          element.classList.remove('leaflet-marker-icon', 'leaflet-interactive', 'leaflet-zoom-animated')
          Object.assign(element.style, { margin: '0', opacity: options.opacity ?? 1 })
          element.title = label(layer)
          const iconSize = options.icon?.options.iconSize || [0, 0]
          const anchor = options.icon?.options.iconAnchor || [iconSize[0] / 2, iconSize[1] / 2]
          const marker = new maplibre.Marker({ element, anchor: 'center',
            offset: [iconSize[0] / 2 - anchor[0], iconSize[1] / 2 - anchor[1]],
            pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
          marker.setLngLat([point.lng, point.lat]).addTo(map)
          const click = event => {
            if (options.interactive === false) return
            if (leaflet.getContainer().classList.contains('pick-cursor')) return
            event.stopPropagation()
            clickLayer(layer, { originalEvent: event })
          }
          element.style.pointerEvents = options.interactive === false ? 'none' : 'auto'
          element.addEventListener('click', click)
          const hover = attachIncidentHover(element, layer, () => active && !unloaded && !leaflet.getContainer().classList.contains('pick-cursor'))
          const move = () => { const point = layer.getLatLng(); marker.setLngLat([point.lng, point.lat]) }
          layer.on('move', move)
          const popup = layer.getPopup?.()
          const autoPan = popup?.options.autoPan
          if (popup) popup.options.autoPan = false
          entry = { signature, marker, hover, remove() {
            hover?.dispose()
            layer.off('move', move); element.removeEventListener('click', click); marker.remove()
            if (popup) popup.options.autoPan = autoPan
          } }
          markers.set(layer, entry)
        }
        entry.marker.setLngLat([point.lng, point.lat])
      } else if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        const feature = layer.toGeoJSON()
        const id = idFor(layer)
        feature.id = id
        feature.properties = { layerId: id, color: options.color || '#ff4d1a', weight: options.weight ?? 3,
          opacity: options.opacity ?? 1, fillColor: options.fillColor || options.color || '#ff4d1a',
          fillOpacity: options.fill === false ? 0 : options.fillOpacity ?? 0.2, radius: options.radius || 4,
          dashed: Boolean(options.dashArray), interactive: options.interactive !== false,
        }
        features.push(feature)
        clickTargets.set(id, layer)
      }
    })
    for (const [layer, entry] of markers) {
      if (!seen.has(layer)) { entry.remove(); markers.delete(layer) }
    }
    const geometry = JSON.stringify(features)
    if (geometry !== lastGeometry) {
      map.getSource('command-overlays').setData({ type: 'FeatureCollection', features })
      lastGeometry = geometry
    }
  })

  const readCamera = frameThrottle(() => {
    if (active) onCamera({ tilt: map.getPitch(), heading: (map.getBearing() + 360) % 360 })
  })
  function saveCamera() {
    if (!active || syncing || unloaded) return
    const center = map.getCenter()
    syncing = true
    try { leaflet.setView([center.lat, center.lng], map.getZoom() + 1, { animate: false }) }
    finally { syncing = false }
  }
  function fromLeaflet() {
    if (!active || syncing || unloaded) return
    const center = leaflet.getCenter()
    syncing = true
    try { map.jumpTo({ center: [center.lng, center.lat], zoom: leaflet.getZoom() - 1 }) }
    finally { syncing = false }
  }
  function onClick(event) {
    if (!active) return
    // Drawing/picking must use the real map projection, even over a road.
    if (!leaflet.getContainer().classList.contains('pick-cursor')) {
      const hits = map.queryRenderedFeatures(event.point, { layers: ['command-points', 'command-lines', 'command-fills', 'command-roads'] })
      const hit = hits.find(feature => feature.layer.id === 'command-roads' ? !feature.properties.normal : feature.properties.interactive)
      const layer = hit && clickTargets.get(Number(hit.properties.layerId))
      if (layer && (layer.getTooltip?.() || layer.getPopup?.())) { clickLayer(layer, event); return }
      if (hit?.layer.id === 'command-roads') {
        const content = document.createElement('div'); content.textContent = hit.properties.title
        L.popup({ autoPan: false }).setLatLng([event.lngLat.lat, event.lngLat.lng]).setContent(content).openOn(leaflet)
        return
      }
    }
    leaflet.closePopup()
    leaflet.fire('click', { latlng: L.latLng(event.lngLat.lat, event.lngLat.lng), originalEvent: event.originalEvent })
  }
  function onMove(event) {
    if (active) leaflet.fire('mousemove', { latlng: L.latLng(event.lngLat.lat, event.lngLat.lng), originalEvent: event.originalEvent })
  }
  const onOut = () => { if (active) leaflet.fire('mouseout') }
  const onUnload = () => { unloaded = true }
  const hideHover = () => markers.forEach(entry => entry.hover?.hide())
  leaflet.on('moveend', fromLeaflet).on('layeradd layerremove', refresh).on('unload', onUnload)
  // MapLibre 6 on() returns a Subscription rather than the map itself.
  const listeners = [['movestart', hideHover], ['moveend', saveCamera], ['move', readCamera], ['click', onClick], ['mousemove', onMove], ['mouseout', onOut]]
  listeners.forEach(([name, handler]) => map.on(name, handler))
  return {
    refresh,
    setActive(value) {
      if (active && !value) saveCamera()
      active = value
      if (!value) hideHover()
      if (value) { map.resize(); fromLeaflet(); refresh(); readCamera() }
    },
    dispose() {
      saveCamera(); active = false; refresh.cancel(); readCamera.cancel()
      leaflet.off('moveend', fromLeaflet).off('layeradd layerremove', refresh).off('unload', onUnload)
      listeners.forEach(([name, handler]) => map.off(name, handler))
      markers.forEach(entry => entry.remove()); markers.clear(); leaflet.closePopup()
    },
  }
}
