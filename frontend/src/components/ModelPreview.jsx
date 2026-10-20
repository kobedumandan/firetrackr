import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchModelPreview } from '../api'

export default function ModelPreview({ version }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetchModelPreview(version, controller.signal).then(value => {
      if (!controller.signal.aborted) setData(value)
    }).catch(err => {
      if (!controller.signal.aborted) setError(err.message)
    })
    return () => controller.abort()
  }, [version])
  if (error) return <p className="model-error" role="alert">{error}</p>
  if (!data) return <p role="status">Loading changed roads…</p>
  if (!data.features.length) return <p className="model-muted">No predicted classes changed in this comparison.</p>
  const bounds = L.geoJSON(data).getBounds()
  return <div className="model-preview">
    <p className="model-muted">Classification changes compared with {data.compared_against}. This preview does not change the active model.</p>
    <div className="model-preview-legend"><span>New constrained prediction</span><span>Cleared prediction</span></div>
    <MapContainer className="model-preview-map" bounds={bounds} boundsOptions={{ padding: [20, 20], maxZoom: 16 }} scrollWheelZoom={false} aria-label="Changed road predictions">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
      <GeoJSON data={data} style={feature => ({ color: feature.properties.challenger_class ? '#c47800' : '#007e9b', weight: 5, opacity: .9 })}
        onEachFeature={(feature, layer) => {
          const label = document.createElement('span')
          label.textContent = `${feature.properties.name || 'Road segment'} · ${feature.properties.challenger_class ? 'New constrained prediction' : 'Cleared prediction'}`
          layer.bindTooltip(label)
        }} />
    </MapContainer>
  </div>
}
