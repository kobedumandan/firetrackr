import { useState } from 'react'
import { COMMAND_BASEMAP_OPTIONS } from '../data/mapConfig'
import '../styles/CommandBasemapSelector.css'
import MapControlIcon from './MapControlIcon'
import PanelToggleIcon from './PanelToggleIcon'
import '../styles/MapActions.css'

export default function CommandBasemapSelector({ value, onChange }) {
  const [collapsed, setCollapsed] = useState(true)
  if (collapsed) {
    return <button type="button" className="map-actions-float-btn command-basemap-float-btn"
      onClick={() => setCollapsed(false)} title="Expand map styles" aria-label="Expand map styles" aria-expanded={false}>
      <PanelToggleIcon />Map style
    </button>
  }
  return (
    <div className="command-basemap" role="group" aria-label="Map style">
      <div className="command-basemap-heading">
        <span className="command-basemap-label"><MapControlIcon name="layers" />Map style</span>
        <div className="command-basemap-actions">
          <span className="command-basemap-mode">{value === 'google-3d' ? '3D VIEW' : '2D VIEW'}</span>
          <button type="button" className="map-actions-collapse-btn" onClick={() => setCollapsed(true)}
            aria-expanded={true} aria-label="Collapse map styles" title="Collapse map styles">
            <PanelToggleIcon expanded />
          </button>
        </div>
      </div>
      <div className="command-basemap-options">
        {COMMAND_BASEMAP_OPTIONS.filter(({ id }) => id !== 'satellite').map(({ id, label, title }) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            aria-label={label}
            onClick={() => onChange(id)}
            title={title ?? `${label} street map`}
            className="command-basemap-option"
          >
            <MapControlIcon name={id === 'google-3d' ? 'cube' : id} />
            <span>{id === 'google-3d' ? '3D' : label}</span>
            {id === 'google-3d' && <span className="command-basemap-option-note">Photorealistic</span>}
          </button>
        ))}
      </div>
      {value === 'satellite' && <span className="command-basemap-fallback" role="status">Satellite fallback active</span>}
    </div>
  )
}
