import { useEffect, useMemo, useState } from 'react'
import { GeoJSON, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { createRoadEdgeLookup } from '../utils/roadEdgeSelection'
import { frameThrottle } from '../utils/commandMapData'

export default function RoadEdgeSelector({ catalog, selected, active, color, onToggle, onMiss }) {
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), [])
  const [hoveredUid, setHoveredUid] = useState(null)
  const lookup = useMemo(() => createRoadEdgeLookup(catalog.features), [catalog])
  const map = useMap()
  const updateHover = useMemo(() => frameThrottle(event => {
    if (!active || event.originalEvent?.buttons) { setHoveredUid(null); return }
    const edge = lookup([event.latlng.lng, event.latlng.lat], map.getZoom())
    setHoveredUid(edge?.properties.segment_uid ?? null)
  }), [active, lookup, map])
  function clearHover() { updateHover.cancel(); setHoveredUid(null) }
  useMapEvents({
    mousemove: event => updateHover(event),
    mouseout: clearHover, movestart: clearHover, zoomstart: clearHover,
    click(event) {
      if (!active) return
      clearHover()
      const edge = lookup([event.latlng.lng, event.latlng.lat], map.getZoom())
      if (edge) onToggle(edge.properties.segment_uid)
      else onMiss(map.getZoom() < 16 ? 'Zoom in to select individual road edges.' : 'Click directly on a road, away from the junction, to select its edge.')
  } })
  useEffect(() => {
    const container = map.getContainer()
    const leave = () => { updateHover.cancel(); setHoveredUid(null) }
    container.addEventListener('pointerleave', leave)
    return () => { container.removeEventListener('pointerleave', leave); updateHover.cancel() }
  }, [map, updateHover])
  const preview = active && !selected.includes(hoveredUid) ? catalog.features.find(edge => edge.properties.segment_uid === hoveredUid) : null
  return <>
    {active && <GeoJSON data={catalog} style={{ color: '#b0bec5', weight: 2, opacity: 0.5 }} interactive={false} renderer={renderer} />}
    {catalog.features.filter(edge => selected.includes(edge.properties.segment_uid)).map(edge =>
      <Polyline key={edge.properties.segment_uid} positions={edge.geometry.coordinates.map(([lng, lat]) => [lat, lng])}
        pathOptions={{ color, weight: 7, opacity: 1, interactive: false, renderer }} />)}
    {preview && <>
      <Polyline positions={preview.geometry.coordinates.map(([lng, lat]) => [lat, lng])}
        pathOptions={{ color, weight: 13, opacity: 0.2, interactive: false, renderer, className: 'constraint-edge-preview-halo' }} />
      <Polyline positions={preview.geometry.coordinates.map(([lng, lat]) => [lat, lng])}
        pathOptions={{ color, weight: 5, opacity: 0.95, dashArray: '7 6', interactive: false, renderer, className: 'constraint-edge-preview' }} />
    </>}
  </>
}
