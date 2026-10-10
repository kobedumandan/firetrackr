import { TILE_OPTIONS } from '../data/mapConfig'
import '../styles/CommandBasemapSelector.css'

export default function CommandBasemapSelector({ value, onChange }) {
  return (
    <div className="command-basemap" role="group" aria-label="Map style">
      <span className="command-basemap-label">Map style</span>
      <div className="command-basemap-options">
        {TILE_OPTIONS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={value === id}
            onClick={() => onChange(id)}
            title={id === 'satellite' ? '2D satellite imagery' : `${label} street map`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
