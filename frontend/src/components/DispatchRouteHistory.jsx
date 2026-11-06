import { useEffect, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import AnalysisIcon from './AnalysisIcon'
import AnalysisValue from './AnalysisValue'
import { dateTime, duration, parseRouteWkt } from '../utils/operationalTimes'
import { MAP_CENTER, tileLayersFor } from '../data/mapConfig'

function FitRoute({ points }) {
  const map = useMap()
  useEffect(() => { map.invalidateSize(); if (points.length) map.fitBounds(points, { maxZoom: 16, padding: [30, 30], animate: false }) }, [map, points])
  return null
}

export default function DispatchRouteHistory({ data, theme, pageLayout = false }) {
  const [revisionId, setRevisionId] = useState('')
  const [showPlans, setShowPlans] = useState(false)
  const revisions = data.route_revisions || []
  const revision = revisions.find(r => String(r.id) === revisionId) || revisions[0]
  const selected = revision?.routes?.find(r => r.route_id === revision.selected_route_id)
  const route = parseRouteWkt(selected?.wkt)
  const location = data.incident?.location
  const points = [...route, ...(location ? [location] : [])]
  const content = <>
    <label className={pageLayout ? 'ddp-revision-field' : undefined}>Planned route revision <select value={revision?.id ?? ''} disabled={pageLayout && !revisions.length} onChange={e => setRevisionId(e.target.value)}>{revisions.map(r => <option value={r.id} key={r.id}>{dateTime(r.at)} {pageLayout ? '|' : '·'} {r.selection_reason || 'Selection'}</option>)}</select></label>
    {pageLayout ? <>
      <dl className="ddp-plan-metrics">{[
        ['Selected route', selected ? `Route ${selected.rank}` : null],
        ['Saved planned ETA', duration(selected?.eta_seconds)],
        ['Distance', selected?.distance_meters == null ? null : `${(selected.distance_meters / 1000).toFixed(2)} km`],
        ['Origin', selected?.origin_source || 'Unknown'],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><AnalysisValue value={value} /></dd></div>)}</dl>
      <p className="ddp-note"><AnalysisIcon name="info" /><span>Planned geometry does not establish the route driven.</span></p>
    </> : <p>Saved planned ETA: {duration(selected?.eta_seconds)} · Distance: {selected?.distance_meters == null ? 'Unknown' : `${(selected.distance_meters / 1000).toFixed(2)} km`} · Origin: {selected?.origin_source || 'Unknown'}. Planned geometry does not establish the route driven.</p>}
    {!revision && <p className={pageLayout ? 'ddp-empty' : undefined}>No preserved route revision exists for this legacy dispatch.</p>}
    {showPlans && (!pageLayout || revision) && <div className={pageLayout ? 'ddp-plan-map' : 'rp-map'}><MapContainer center={MAP_CENTER} zoom={12} style={{ height: '100%' }}>{tileLayersFor(theme === 'light' ? 'street' : 'dark').map(layer => <TileLayer key={layer.url} {...layer} />)}<FitRoute points={points} />{route.length > 1 && <Polyline positions={route} pathOptions={{ color: '#ff6c3b' }} />}{location && <CircleMarker center={location}><Tooltip>Incident</Tooltip></CircleMarker>}</MapContainer></div>}
    {pageLayout && revision && route.length < 2 && <p className="ddp-empty">No saved route geometry is available for this revision.</p>}
  </>
  return <details className={`rt-vehicle-context${pageLayout ? ' ddp-route-history rar-disclosure' : ''}`} open={showPlans} onToggle={e => setShowPlans(e.currentTarget.open)}>
    <summary className={pageLayout ? 'rp-section-heading rar-section-heading' : undefined}>{pageLayout ? <><div className="rar-section-heading-copy"><span className="rar-section-heading-icon"><AnalysisIcon name="route" /></span><div><h3>Generated Route History</h3><p>Inspect saved route selections and predictions.</p></div></div><AnalysisIcon name="chevron" className="rar-chevron" /></> : 'Generated route history'}</summary>
    {pageLayout ? <div className="ddp-route-body">{content}</div> : content}
  </details>
}
