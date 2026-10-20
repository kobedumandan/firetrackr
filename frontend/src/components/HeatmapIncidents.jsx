import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import { groupHeatmapIncidents, heatmapIncidentDetails, heatmapIncidentId } from '../utils/heatmapIncidents'
import '../styles/HeatmapIncidents.css'

export default function HeatmapIncidents({ points }) {
  const map = useMap()
  useEffect(() => {
    const markers = groupHeatmapIncidents(points).map(group => {
      const point = group[0]
      const label = group.length > 1 ? `${group.length} incidents at this location` : heatmapIncidentId(point)
      // Keep overview hit areas, then reveal pins as the heat surface fades.
      const icon = L.divIcon({ className: 'heatmap-incident-pin', iconSize: [28, 28], iconAnchor: [14, 14], html: '' })
      return L.marker([point.lat, point.lng], { icon, heatmapIncident: true, alt: label, title: label,
        keyboard: true, riseOnHover: true })
        .bindTooltip(heatmapIncidentDetails(group, 3), { className: 'heatmap-incident-leaflet-tooltip', direction: 'top', offset: [0, -8], opacity: 1 })
        .bindPopup(heatmapIncidentDetails(group), { className: 'heatmap-incident-popup', maxWidth: 300, maxHeight: 340, autoPan: false })
    })
    const group = L.layerGroup(markers).addTo(map)
    const updatePins = () => markers.forEach(marker => {
      const visible = map.getZoom() >= 16
      const current = marker.options.icon.options.html
      const html = visible ? '<span class="heatmap-incident-dot"></span>' : ''
      if (current !== html) {
        marker.setIcon(L.divIcon({ className: 'heatmap-incident-pin', iconSize: [28, 28], iconAnchor: [14, 14], html }))
        marker.fire('iconchange')
      }
    })
    map.on('zoomend', updatePins)
    updatePins()
    return () => { map.off('zoomend', updatePins); group.remove() }
  }, [map, points])
  return null
}
