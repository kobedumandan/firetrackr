import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchModelPreview } from '../api'
import { tileLayersFor } from '../data/mapConfig'
import SettingsLoading from './SettingsLoading'

function LinkedMap({ onReady, index }) {
  const map = useMap()
  useEffect(() => onReady(map, index), [map, onReady, index])
  return null
}

export default function ModelPreview({ version, theme = 'dark' }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const maps = useRef([])
  const registerMap = useCallback((map, index) => {
    const linked = maps.current
    linked[index] = map
    const sync = () => {
      const other = linked[1 - index]
      if (other && (!other.getCenter().equals(map.getCenter(), 1e-8) || other.getZoom() !== map.getZoom())) {
        other.setView(map.getCenter(), map.getZoom(), { animate: false })
      }
    }
    map.on('moveend', sync)
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(map.getContainer())
    return () => {
      observer.disconnect()
      map.off('moveend', sync)
      linked[index] = null
    }
  }, [])
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
  if (!data) return <SettingsLoading message="Loading changed roads…" compact />
  if (!data.features.length) return <p className="model-muted">No predicted classes changed in this comparison.</p>
  const bounds = L.geoJSON(data).getBounds()
  return <div className="model-preview">
    <p className="model-muted">{data.features.length} changed road{data.features.length === 1 ? '' : 's'} compared with {data.compared_against}. Pan or zoom either map to move both views.</p>
    <div className="model-preview-legend"><span>Predicted constrained</span><span>Predicted clear</span></div>
    <div className="model-preview-grid">{['champion', 'challenger'].map((side, index) => <section className="model-preview-pane" key={side} aria-label={index === 0 ? 'Before' : 'After'}>
      <div className="model-preview-pane-heading"><h3>{index === 0 ? 'Before' : 'After'}</h3><span>{index === 0 ? data.compared_against : version}</span></div>
      <MapContainer className="model-preview-map" bounds={bounds} boundsOptions={{ padding: [24, 24], maxZoom: 16 }} scrollWheelZoom={false} aria-label={`${index === 0 ? 'Before' : 'After'} road predictions`}>
        {tileLayersFor(theme === 'light' ? 'street' : 'dark').map(layer => <TileLayer key={`${theme}-${layer.url}`} {...layer} />)}
        <LinkedMap onReady={registerMap} index={index} />
        <GeoJSON data={data} style={feature => ({ color: feature.properties[`${side}_class`] ? '#c47800' : '#007e9b', weight: 5, opacity: .9 })}
          onEachFeature={(feature, layer) => {
            const label = document.createElement('span')
            label.textContent = `${feature.properties.name || 'Road segment'} · ${feature.properties[`${side}_class`] ? 'Predicted constrained' : 'Predicted clear'}`
            layer.bindTooltip(label)
          }} />
      </MapContainer>
    </section>)}</div>
    <p className="model-muted">Only changed predicted classes are shown. The comparison uses this candidate’s original audit baseline. Manually verified road types still determine routing costs. Previewing does not activate the model.</p>
  </div>
}
