import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { filterConstraintLayers, roadPreviewPath } from '../utils/constraintLayers'
import { scheduleSummary } from '../utils/constraintSchedule'
import '../styles/ConstraintLayersPanel.css'

const iconPaths = {
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  road: 'M7 3 4 21M17 3l3 18M12 4v3m0 4v3m0 4v3',
  traffic: 'M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM12 6h.01M12 12h.01M12 18h.01M4 5l3 2m10 0 3-2M4 11l3 2m10 0 3-2',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  filter: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  pin: 'M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  hidden: 'm3 3 18 18M10.6 5.1 12 5c6 0 10 7 10 7a22 22 0 0 1-3 3.5M6 6.5A22 22 0 0 0 2 12s4 7 10 7a12 12 0 0 0 5.4-1.4M10 10a3 3 0 0 0 4 4',
  info: 'M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  edit: 'm16 3 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14l-1 7Z',
}

function ConstraintIcon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={iconPaths[name]} /></svg>
}

const typeLabels = {
  normal: 'No constraint',
  narrow_road: 'Narrow road', narrow_road_slight: 'Slightly narrow', narrow_road_severe: 'Severely narrow',
  traffic_area: 'Traffic congestion', traffic_general: 'Traffic congestion', traffic_school: 'School traffic',
  traffic_market: 'Market traffic', traffic_nightmarket: 'Night market', traffic_highway: 'Highway traffic',
  traffic_pnm: 'Traffic congestion', construction: 'Construction',
}
const typeLabel = row => typeLabels[row.type] || row.type.replaceAll('_', ' ')
const rowIcon = row => row.type.startsWith('traffic') ? 'traffic' : 'road'

function RoadPreview({ coordinates, color }) {
  const path = useMemo(() => roadPreviewPath(coordinates), [coordinates])
  return <div className="constraint-road-preview" style={{ color }} aria-hidden="true">
    {path ? <svg viewBox="0 0 48 40" fill="none"><path d={path} stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg> : <ConstraintIcon name="road" />}
  </div>
}

export default function ConstraintLayersPanel({ rows, selectedKey, hidden, onSelect, onVisibility, onExit, onClearSelection,
  onStartSelection, selectionType, edgeCount, onFinish, onCancel, onEdit, onDelete, locked, roadsReady,
  loading, error, onRetry, notice, locationError }) {
  const [query, setQuery] = useState('')
  const [location, setLocation] = useState('')
  const [source, setSource] = useState('')
  const [sort, setSort] = useState('location')
  const [limit, setLimit] = useState(100)
  const [recent, setRecent] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterId = useId()
  const listRef = useRef(null)
  const locations = useMemo(() => [...new Set(rows.map(row => row.location))].sort(), [rows])
  const filtered = useMemo(() => filterConstraintLayers(recent ? rows.filter(row => row.drawing?.segment_uids?.some(uid => uid.startsWith('edge-v1-'))) : rows, { query, location, source, sort: recent ? 'recent' : sort }), [rows, query, location, source, sort, recent])
  const selected = rows.find(row => row.key === selectedKey)
  const listed = filtered.slice(0, limit)
  const selectedOutsideList = selected && !listed.some(row => row.key === selectedKey)
  const shownRows = selectedOutsideList ? [selected, ...listed] : listed
  useEffect(() => {
    listRef.current?.querySelector('.constraint-layer-row.selected')?.scrollIntoView?.({ block: 'nearest', behavior: document.documentElement.dataset.motion === 'off' ? 'instant' : 'smooth' })
  }, [selectedKey])
  const filterCount = Number(!!location) + Number(!!source) + Number(!recent && sort !== 'location')
  const hasFilters = !!query || filterCount > 0
  const change = (setter, value) => { setter(value); setLimit(100) }
  const resetFilters = () => { setQuery(''); setLocation(''); setSource(''); setSort('location'); setLimit(100) }

  return <aside className="constraint-layers" aria-label="Constraint layers">
    <header className="constraint-layers-header">
      <span className="constraint-layers-emblem"><ConstraintIcon name="layers" /></span>
      <div className="constraint-layers-heading"><span className="constraint-layers-eyebrow">Map workspace</span><h2>Constraint layers</h2></div>
      <button type="button" className="constraint-layers-done" disabled={locked} onClick={onExit}><ConstraintIcon name="check" />Done</button>
    </header>
    <div className="constraint-layers-body">
      {notice && <p className="constraint-layers-notice constraint-layers-notice--success" role="status"><ConstraintIcon name="info" /><span>{notice}</span></p>}
      <section className="constraint-layers-add" aria-label="Add a constraint">
        <div className="constraint-layers-section-heading"><h3>Add a constraint</h3><span className="constraint-layers-mode"><i />Editing mode</span></div>
        <p>Choose a type, then select roads on the map.</p>
        <div className="constraint-layers-types">
          <button type="button" className="constraint-type constraint-type--narrow" disabled={!!selectionType || !roadsReady || locked} aria-pressed={selectionType === 'narrow_road'} onClick={() => onStartSelection('narrow_road')}><ConstraintIcon name="road" /><span>Narrow road</span></button>
          <button type="button" className="constraint-type constraint-type--traffic" disabled={!!selectionType || !roadsReady || locked} aria-pressed={selectionType === 'traffic_area'} onClick={() => onStartSelection('traffic_area')}><ConstraintIcon name="traffic" /><span>Traffic congestion</span></button>
        </div>
        {!roadsReady && !error && <p className="constraint-layers-road-status" role="status">Loading selectable roads…</p>}
      </section>
      {selectionType && <div className="constraint-layers-draft" role="status">
        <div className="constraint-draft-heading"><span className={`constraint-draft-dot${selectionType === 'traffic_area' ? ' constraint-draft-dot--traffic' : ''}`} /><strong>{edgeCount} {edgeCount === 1 ? 'edge' : 'edges'} selected</strong><span>{selectionType === 'traffic_area' ? 'Traffic' : 'Narrow road'}</span></div>
        <p>Click a road to select or deselect it. Review your selection before saving.</p>
        <div className="constraint-draft-actions"><button type="button" className="constraint-primary-btn" disabled={!edgeCount || locked} onClick={onFinish}><ConstraintIcon name="check" />Review and save</button><button type="button" className="constraint-text-btn" disabled={locked} onClick={onCancel}>Cancel selection</button></div>
      </div>}
      <div className="constraint-layer-recent" role="group" aria-label="Constraint list">
        <button type="button" aria-pressed={!recent} onClick={() => { setRecent(false); setLimit(100) }}>All constraints</button>
        <button type="button" aria-pressed={recent} onClick={() => { setRecent(true); resetFilters() }}>Recently saved edges</button>
      </div>
      <div className="constraint-layers-filters">
        <div className="constraint-search-row">
          <label className="constraint-search"><ConstraintIcon name="search" /><input aria-label="Search constraints" type="search" value={query} onChange={event => change(setQuery, event.target.value)} placeholder="Search roads or barangays" />{query && <button type="button" aria-label="Clear search" onClick={() => change(setQuery, '')}><ConstraintIcon name="close" /></button>}</label>
          <button type="button" className={`constraint-filter-toggle${filterCount ? ' has-filters' : ''}`} aria-label={filterCount ? `Filters (${filterCount} active)` : 'Filters'} aria-expanded={filtersOpen} aria-controls={filterId} onClick={() => setFiltersOpen(value => !value)}><ConstraintIcon name="filter" /></button>
        </div>
        {filtersOpen && <div id={filterId} className="constraint-filter-fields">
          <label className="constraint-location-field">Location<select value={location} onChange={event => change(setLocation, event.target.value)}><option value="">All locations</option>{location && !locations.includes(location) && <option value={location}>{location} (unavailable)</option>}{locations.map(name => <option key={name}>{name}</option>)}</select></label>
          <label>Source<select value={source} onChange={event => change(setSource, event.target.value)}><option value="">All sources</option>{['Saved road constraint', 'Baseline annotation', 'Model prediction'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Sort<select disabled={recent} value={recent ? 'recent' : sort} onChange={event => change(setSort, event.target.value)}>{recent && <option value="recent">Newest first</option>}<option value="location">Barangay A–Z</option><option value="name">Name A–Z</option><option value="north">North to south</option><option value="west">West to east</option></select></label>
        </div>}
      </div>
      <div className="constraint-layers-count"><span><strong>{filtered.length.toLocaleString()}</strong> {hasFilters ? `of ${rows.length.toLocaleString()} constraints` : 'constraints'}</span>{hasFilters ? <button type="button" className="constraint-text-btn" onClick={resetFilters}>Clear filters</button> : hidden.size > 0 && <span>{hidden.size} hidden</span>}</div>
      {locationError && <p className="constraint-layers-notice"><ConstraintIcon name="info" /><span>Barangay boundaries could not load. Constraints without a location are listed under Unknown location.</span></p>}
      {error && <div className="constraint-layers-notice constraint-layers-notice--error" role="alert"><ConstraintIcon name="info" /><div><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></div></div>}
      {selectedOutsideList && <p className="constraint-selection-hint">Selected road shown above the current results.</p>}
      <div ref={listRef} className="constraint-layers-list" role="list" aria-label="Road constraint layers" aria-busy={!!loading}>
        {loading && <div className="constraint-layers-empty" role="status"><ConstraintIcon name="layers" /><strong>Loading constraints…</strong><p>Getting your road layers ready.</p></div>}
        {!loading && !error && !shownRows.length && <div className="constraint-layers-empty"><ConstraintIcon name={hasFilters ? 'search' : 'layers'} /><strong>{hasFilters ? 'No matching roads' : recent ? 'No saved edges yet' : 'No constraints yet'}</strong><p>{hasFilters ? 'Try another search or clear your filters.' : 'Choose a constraint type above to start selecting roads.'}</p>{hasFilters && <button type="button" onClick={resetFilters}>Clear filters</button>}</div>}
        {!loading && shownRows.map(row => <div role="listitem" key={row.key} className={`constraint-layer-row${selectedKey === row.key ? ' selected' : ''}${hidden.has(row.key) ? ' is-hidden' : ''}`}>
          <button type="button" className="constraint-layer-select" aria-pressed={selectedKey === row.key} onClick={() => onSelect(row)}>
            <RoadPreview coordinates={row.coordinates} color={row.color} />
            <span className="constraint-layer-copy">
              <span className="constraint-layer-title"><span className="constraint-layer-swatch" style={{ '--constraint-color': row.color }}><ConstraintIcon name={rowIcon(row)} /></span><strong title={row.name}>{row.name}</strong></span>
              <small className="constraint-layer-location"><ConstraintIcon name="pin" />{row.location}</small><span className="constraint-layer-tags"><span>{typeLabel(row)}</span><span className={row.drawing ? 'constraint-source--saved' : ''}>{row.drawing ? 'Saved' : row.source === 'Baseline annotation' ? 'Baseline' : 'Prediction'}</span></span>{recent && row.drawing?.created_at && <small className="constraint-layer-date">{new Date(row.drawing.created_at).toLocaleString()}</small>}
            </span>
          </button>
          <button type="button" className="constraint-layer-eye" aria-label={`${hidden.has(row.key) ? 'Show' : 'Hide'} ${row.name}`} title={hidden.has(row.key) ? 'Show on map' : 'Hide on map'} aria-pressed={!hidden.has(row.key)} onClick={() => onVisibility(row.key)}><ConstraintIcon name={hidden.has(row.key) ? 'hidden' : 'eye'} /></button>
        </div>)}
        {!loading && filtered.length > limit && <button type="button" className="constraint-load-more" onClick={() => setLimit(value => value + 100)}>Show 100 more<span>{(filtered.length - limit).toLocaleString()} remaining</span></button>}
      </div>
    </div>
    {selected ? <section className="constraint-layer-inspector" style={{ '--constraint-color': selected.color }} aria-label="Selected constraint">
      <div className="constraint-inspector-heading"><div><ConstraintIcon name="layers" /><h3>Selected constraint</h3></div>{onClearSelection && <button type="button" className="constraint-clear-selection" aria-label="Clear selected road" title="Show all roads at full brightness" onClick={onClearSelection}><ConstraintIcon name="close" /></button>}</div>
      <div className="constraint-inspector-road">
        <RoadPreview coordinates={selected.coordinates} color={selected.color} />
        <div className="constraint-inspector-road-copy"><span className="constraint-inspector-type">{typeLabel(selected)}</span><strong className="constraint-inspector-name">{selected.name}</strong><p className="constraint-inspector-location"><ConstraintIcon name="pin" />{selected.location}</p></div>
      </div>
      <dl className="constraint-inspector-facts">
        <div><dt>Source</dt><dd><span className={`constraint-inspector-source${selected.drawing ? ' constraint-inspector-source--saved' : ''}`}>{selected.source}</span></dd></div>
        {selected.drawing?.narrow_severity && <div><dt>Narrow-road severity</dt><dd className="constraint-inspector-severity"><ConstraintIcon name="road" />{selected.drawing.narrow_severity === 'severe' ? 'Severe' : 'Slight'}</dd></div>}
        {selected.drawing?.constraint_type?.startsWith('traffic') && <div className="constraint-inspector-schedule"><dt><ConstraintIcon name="clock" />Active hours</dt><dd>{scheduleSummary(selected.drawing.traffic_schedule)}</dd></div>}
      </dl>
      {!selected.drawing && <p className="constraint-inspector-hint"><ConstraintIcon name="info" /><span>Edit this road’s condition. Your saved changes will take priority on the map and for new routes.</span></p>}
      <div className="constraint-inspector-actions">
        <button type="button" className="constraint-edit-btn" disabled={!!selectionType || locked || !!error} onClick={() => onEdit(selected)}><ConstraintIcon name="edit" />Edit constraint</button>
        {selected.drawing && <button type="button" className="constraint-remove-btn" disabled={!!selectionType || !roadsReady || locked} onClick={() => onDelete(selected.drawing.id)}><ConstraintIcon name="trash" />{selected.drawing.baseline_segment_uid ? 'Restore original' : 'Remove constraint'}</button>}</div>
    </section> : null}
  </aside>
}
