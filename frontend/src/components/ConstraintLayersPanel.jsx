import { useMemo, useState } from 'react'
import { filterConstraintLayers } from '../utils/constraintLayers'
import '../styles/ConstraintLayersPanel.css'

export default function ConstraintLayersPanel({ rows, selectedKey, hidden, onSelect, onVisibility, onExit,
  onStartDraw, drawingType, pointCount, onUndo, onFinish, onCancel, onEdit, onDelete,
  loading, error, onRetry, notice, locationError }) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [source, setSource] = useState('')
  const [sort, setSort] = useState('location')
  const [limit, setLimit] = useState(100)
  const locations = useMemo(() => [...new Set(rows.map(row => row.location))].sort(), [rows])
  const filtered = useMemo(() => filterConstraintLayers(rows, { query, location, source, sort }), [rows, query, location, source, sort])
  const selected = rows.find(row => row.key === selectedKey)
  const change = (setter, value) => { setter(value); setLimit(100) }
  return <aside className="constraint-layers" aria-label="Constraint layers">
    <header><div><h2>Constraint layers</h2><span>Editing mode</span></div><button type="button" onClick={onExit}>Done</button></header>
    {notice && <p className="constraint-layers-notice" role="status">{notice}</p>}
    <div className="constraint-layers-add"><span>Add a drawing</span><div>
      <button type="button" disabled={!!drawingType} aria-pressed={drawingType === 'narrow_road'} onClick={() => onStartDraw('narrow_road')}>Narrow road</button>
      <button type="button" disabled={!!drawingType} aria-pressed={drawingType === 'traffic_area'} onClick={() => onStartDraw('traffic_area')}>Traffic area</button>
    </div></div>
    {drawingType && <div className="constraint-layers-draft" role="status"><span>{pointCount} points · Click along the road</span><div>
      <button type="button" disabled={!pointCount} onClick={onUndo}>Undo point</button>
      <button type="button" disabled={pointCount < 2} onClick={onFinish}>Save</button><button type="button" onClick={onCancel}>Cancel</button>
    </div></div>}
    <div className="constraint-layers-filters">
      <label>Search constraints<input type="search" value={query} onChange={event => change(setQuery, event.target.value)} placeholder="Road, barangay or type" /></label>
      <label>Location<select value={location} onChange={event => change(setLocation, event.target.value)}><option value="">All locations</option>{location && !locations.includes(location) && <option value={location}>{location} (no matching layers)</option>}{locations.map(name => <option key={name}>{name}</option>)}</select></label>
      <div><label>Source<select value={source} onChange={event => change(setSource, event.target.value)}><option value="">All sources</option>{['Admin drawing', 'Baseline annotation', 'Model prediction'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Sort<select value={sort} onChange={event => change(setSort, event.target.value)}><option value="location">Barangay A–Z</option><option value="name">Name A–Z</option><option value="north">North to south</option><option value="west">West to east</option></select></label></div>
    </div>
    <p className="constraint-layers-count">{filtered.length} of {rows.length} constraints <span>Filters apply to this list</span></p>
    {locationError && <p className="constraint-layers-notice">Barangay boundaries could not load. Drawings without a location are listed under Unknown location.</p>}
    {error && <p className="constraint-layers-notice" role="alert">{error} <button type="button" onClick={onRetry}>Retry</button></p>}
    <div className="constraint-layers-list" role="list" aria-label="Road constraint layers">
      {loading && <p role="status">Loading constraints…</p>}
      {!loading && !filtered.length && <p>No constraints match these filters.</p>}
      {filtered.slice(0, limit).map(row => <div role="listitem" key={row.key} className={`constraint-layer-row${selectedKey === row.key ? ' selected' : ''}`}>
        <button type="button" className="constraint-layer-select" aria-pressed={selectedKey === row.key} onClick={() => onSelect(row)}>
          <span className="constraint-layer-swatch" style={{ background: row.color }} /><span><strong>{row.name}</strong><small>{row.location}</small><small>{row.source} · {row.type.replaceAll('_', ' ')}</small></span>
        </button><button type="button" className="constraint-layer-eye" aria-label={`${hidden.has(row.key) ? 'Show' : 'Hide'} ${row.name}`} aria-pressed={!hidden.has(row.key)} onClick={() => onVisibility(row.key)}>{hidden.has(row.key) ? 'Show' : 'Hide'}</button>
      </div>)}
      {filtered.length > limit && <button type="button" onClick={() => setLimit(value => value + 100)}>Show 100 more</button>}
    </div>
    {selected && <section className="constraint-layer-inspector" aria-label="Selected constraint"><strong>{selected.name}</strong><p>{selected.location} · {selected.source}</p>
      {selected.drawing ? <div><button type="button" disabled={!!drawingType} onClick={() => onEdit(selected.drawing)}>Edit drawing</button><button type="button" disabled={!!drawingType} onClick={() => onDelete(selected.drawing.id)}>Delete drawing</button></div>
        : <p>Select Narrow road or Traffic area to add a correction drawing over this road. Baseline and model layers are read-only.</p>}
      <small>Hiding a layer affects this editing view only. Saved routing constraints stay active.</small>
    </section>}
  </aside>
}
