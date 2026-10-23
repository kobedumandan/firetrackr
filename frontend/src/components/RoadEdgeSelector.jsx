import { useMemo } from 'react'
import { GeoJSON, Polyline, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { nearestRoadEdge } from '../utils/roadEdgeSelection'

export default function RoadEdgeSelector({ catalog, selected, active, color, onToggle, onMiss }) {
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), [])
  const map = useMapEvents({ click(event) {
    if (!active) return
    const edge = nearestRoadEdge([event.latlng.lng, event.latlng.lat], catalog.features, map.getZoom())
    if (edge) onToggle(edge.properties.segment_uid)
    else onMiss(map.getZoom() < 16 ? 'Zoom in to select individual road edges.' : 'Click directly on a road, away from the junction, to select its edge.')
  } })
  return <>
    {active && <GeoJSON data={catalog} style={{ color: '#b0bec5', weight: 2, opacity: 0.5 }} interactive={false} renderer={renderer} />}
    {catalog.features.filter(edge => selected.includes(edge.properties.segment_uid)).map(edge =>
      <Polyline key={edge.properties.segment_uid} positions={edge.geometry.coordinates.map(([lng, lat]) => [lat, lng])}
        pathOptions={{ color, weight: 7, opacity: 1, interactive: false, renderer }} />)}
  </>
}
