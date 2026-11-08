import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchModelPreview } from '../api'
import { tileLayersFor } from '../data/mapConfig'
import SettingsLoading from './SettingsLoading'
import ModelSettingsIcon from './ModelSettingsIcon'

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
  if (!data.features.length) return <div className="model-preview-empty"><span className="model-card-icon"><ModelSettingsIcon name="map" /></span><h3>No Classification Changes</h3><p>Both models predict the same classes for all compared roads.</p></div>
  const bounds = L.geoJSON(data).getBounds()
  const constrained = data.features.filter(feature => feature.properties.challenger_class).length
  const clear = data.features.length - constrained
  return <div className="model-preview">
    <div className="model-preview-summary">
      <div className="model-preview-stat"><span>Changed Roads</span><strong>{data.features.length.toLocaleString()}</strong><small>Compared with {data.compared_against}</small></div>
      <div className="model-preview-stat model-preview-constrained"><span>Now Predicted Constrained</span><strong>{constrained.toLocaleString()}</strong><small>Previously predicted clear</small></div>
      <div className="model-preview-stat model-preview-clear"><span>Now Predicted Clear</span><strong>{clear.toLocaleString()}</strong><small>Previously predicted constrained</small></div>
    </div>
    <div className="model-preview-toolbar"><p><ModelSettingsIcon name="map" />Linked views <span className="model-separator">|</span> Pan or zoom either map to compare the same roads.</p><button type="button" className="model-btn" onClick={() => maps.current.forEach(map => map?.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 }))}><ModelSettingsIcon name="refresh" />Reset View</button></div>
    <div className="model-preview-grid">{['champion', 'challenger'].map((side, index) => <section className="model-preview-pane" key={side} aria-label={index === 0 ? 'Before' : 'After'}>
      <div className="model-preview-pane-heading"><div><span className="model-preview-step">{index === 0 ? 'Before' : 'After'}</span><h3>{index === 0 ? 'Audit Baseline' : 'Selected Model'}</h3></div><span className="model-preview-version">{index === 0 ? data.compared_against : version}</span></div>
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
    <div className="model-preview-legend" aria-label="Prediction legend">
      <div className="model-preview-legend-item model-preview-constrained"><span className="model-preview-swatch" /><div><strong>Predicted Constrained</strong><p>The model predicts a road constraint for this segment.</p></div></div>
      <div className="model-preview-legend-item model-preview-clear"><span className="model-preview-swatch" /><div><strong>Predicted Clear</strong><p>The model predicts no road constraint for this segment.</p></div></div>
    </div>
    <div className="model-preview-note"><strong>How to Read This Comparison</strong><p>Only roads whose predicted class changed are highlighted. The baseline is the selected model's original audit comparison, which may differ from the current active model. Predictions do not confirm live road conditions. Manually verified road types still determine routing costs, and previewing does not activate a model.</p></div>
  </div>
}
