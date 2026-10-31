import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { fetchResponderTracks } from '../api'
import { MAP_CENTER, tileLayersFor } from '../data/mapConfig'
import { dateTime, duration, parseRouteWkt } from '../utils/operationalTimes'
import AnalysisIcon from './AnalysisIcon'
import KpiCard, { KPI_EMPTY } from './KpiCard'
import SettingsLoading from './SettingsLoading'
import '../styles/ResponderRouteHistory.css'

const palettes = {
  dark: ['#38bdf8', '#fbbf24', '#c084fc', '#34d399', '#fb7185', '#fb923c'],
  light: ['#0369a1', '#a16207', '#7e22ce', '#047857', '#be123c', '#c2410c'],
}

function RouteNote({ children }) {
  return <p className="rt-note"><AnalysisIcon name="info" /><span>{children}</span></p>
}

function vehicleSegments(segments = []) {
  const paths = []
  if (!Array.isArray(segments)) return paths
  for (const samples of segments) {
    if (!Array.isArray(samples)) continue
    let path = []
    for (const point of samples) {
      if (Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]) <= 90 && Math.abs(point[1]) <= 180) path.push(point)
      else {
        if (path.length > 1) paths.push(path)
        path = []
      }
    }
    if (path.length > 1) paths.push(path)
  }
  return paths
}

function FitTracks({ points, fitKey }) {
  const map = useMap()
  const lastFit = useRef(null)
  useEffect(() => {
    if (points.length && lastFit.current !== fitKey) {
      map.invalidateSize({ pan: false })
      map.fitBounds(points, { padding: [30, 30], maxZoom: 17, animate: false })
      lastFit.current = fitKey
    }
  }, [map, points, fitKey])
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
    observer.observe(map.getContainer())
    return () => observer.disconnect()
  }, [map])
  return null
}

export default function ResponderRouteHistory({ fireId, theme = 'dark', initialDispatchId = null, onSelectDispatch, vehicleUnits }) {
  const [result, setResult] = useState(null)
  const [revision, setRevision] = useState(0)
  const [selection, setSelection] = useState(null)
  const [fitRevision, setFitRevision] = useState(0)
  const scope = `${fireId}:${initialDispatchId || 'all'}`
  const filters = selection?.scope === scope ? selection : { scope, dispatch: String(initialDispatchId || 'all'), member: 'all', planned: false, samples: false, vehicle: false }
  const change = values => setSelection({ ...filters, ...values })
  const current = result?.fireId === fireId ? result : null
  const data = current?.data
  const pending = !current || current.revision !== revision

  useEffect(() => {
    const controller = new AbortController()
    let timer
    async function refresh() {
      try {
        const next = await fetchResponderTracks(fireId, controller.signal)
        if (controller.signal.aborted) return
        setResult({ fireId, revision, data: next })
        if (next.dispatches.some(d => ['dispatched', 'en_route', 'on_scene'].includes(d.status))) timer = setTimeout(refresh, 10000)
      } catch (error) {
        if (!controller.signal.aborted) setResult(previous => ({ fireId, revision, data: previous?.fireId === fireId ? previous.data : null, error: error.message }))
      }
    }
    refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [fireId, revision])
  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('operational-times-updated', refresh)
    return () => window.removeEventListener('operational-times-updated', refresh)
  }, [])

  const dispatches = useMemo(() => data?.dispatches || [], [data])
  const allMembers = useMemo(() => dispatches.flatMap(d => d.members.map(m => ({ ...m, dispatch: d, key: `${d.dispatch_id}:${m.per_id}` }))), [dispatches])
  const selectedDispatches = useMemo(() => filters.dispatch === 'all' ? dispatches : dispatches.filter(d => String(d.dispatch_id) === filters.dispatch), [dispatches, filters.dispatch])
  const members = useMemo(() => allMembers.filter(m => filters.dispatch === 'all' || String(m.dispatch.dispatch_id) === filters.dispatch), [allMembers, filters.dispatch])
  const activeMember = members.find(m => m.key === filters.member)
  const visible = useMemo(() => activeMember ? [activeMember] : members, [members, activeMember])
  const planned = useMemo(() => filters.planned ? selectedDispatches.filter(d => !activeMember || d.dispatch_id === activeMember.dispatch.dispatch_id).map(d => ({ dispatch: d, points: parseRouteWkt(d.generated_route?.wkt) })).filter(r => r.points.length > 1) : [], [filters.planned, selectedDispatches, activeMember])
  const vehicles = useMemo(() => (vehicleUnits || []).map(unit => ({ ...unit, segments: vehicleSegments(unit.gps_segments) })).filter(unit => unit.segments.length), [vehicleUnits])
  const visibleVehicles = useMemo(() => filters.vehicle ? vehicles.filter(unit => selectedDispatches.some(d => d.dispatch_id === unit.dispatch_id) && (!activeMember || unit.dispatch_id === activeMember.dispatch.dispatch_id)) : [], [filters.vehicle, vehicles, selectedDispatches, activeMember])
  const positions = useMemo(() => visible.flatMap(m => m.segments.flatMap(s => s.map(p => p.position))), [visible])
  const bounds = useMemo(() => [...positions, ...planned.flatMap(r => r.points), ...visibleVehicles.flatMap(unit => unit.segments.flat()), ...(data?.location ? [data.location] : [])], [positions, planned, visibleVehicles, data])
  const vehicleColour = theme === 'light' ? '#a16207' : '#f9c989'
  const palette = palettes[theme] || palettes.dark
  const colour = member => palette[allMembers.findIndex(m => m.key === member.key) % palette.length]
  const sampleCount = visible.reduce((n, m) => n + m.sample_count, 0)
  const recordedWindow = activeMember?.sample_count > 0 && activeMember.first_recorded_at && activeMember.last_recorded_at
    ? (new Date(activeMember.last_recorded_at) - new Date(activeMember.first_recorded_at)) / 1000 : null
  function selectMember(member) {
    change({ member: activeMember?.key === member.key ? 'all' : member.key })
    if (activeMember?.key !== member.key) onSelectDispatch?.(member.dispatch.dispatch_id)
  }

  return <div className="responder-tracks">
    <div className="rt-heading"><div><h3>Recorded responder routes</h3><p>Select a member to focus on their route and recorded metrics.</p></div><button type="button" className="rt-refresh" disabled={pending} onClick={() => setRevision(value => value + 1)}><AnalysisIcon name="refresh" />{pending ? 'Loading…' : 'Refresh'}</button></div>
    {!data && pending && <SettingsLoading message="Loading responder routes…" compact />}
    {!pending && current?.error && <div className="rt-error" role="alert">{current.error} <button type="button" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {data && <>
      {!dispatches.length ? <p className="rt-empty">No dispatches or responder GPS history are recorded for this incident.</p> : <>
        <div className="rt-workspace">
        <aside className="rt-roster" aria-label="Filter responder routes" tabIndex={0}>
          <div className="rt-roster-heading"><h4>Team members</h4><span>{members.length}</span></div>
          <label className="rt-team-filter">Team
            <select value={filters.dispatch} onChange={event => {
              const dispatch = event.target.value
              change({ dispatch, member: 'all' })
              if (dispatch !== 'all') onSelectDispatch?.(Number(dispatch))
            }}>
              <option value="all">All teams</option>
              {dispatches.map(d => <option key={d.dispatch_id} value={String(d.dispatch_id)}>{d.team || `Dispatch #${d.dispatch_id}`}</option>)}
            </select>
          </label>
          <div className="rt-roster-list" role="group" aria-label="Route history member">
            <button type="button" className="rt-member-toggle rt-all-members" aria-pressed={!activeMember} onClick={() => change({ member: 'all' })}>All members</button>
            {members.map(member => <button type="button" key={member.key} className="rt-member-toggle" aria-label={`Show route for ${member.name}, ${member.dispatch.team || `dispatch #${member.dispatch.dispatch_id}`}`} aria-pressed={activeMember?.key === member.key} onClick={() => selectMember(member)} style={{ '--rt-member-color': colour(member) }}>
              <span className="rt-avatar">{member.name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('')}</span><span className="rt-toggle-copy"><strong>{member.name}</strong><small>{member.roles.join(', ') || 'Role not recorded'}</small></span>
            </button>)}
            {!members.length && <RouteNote>No attributed members are recorded for this dispatch.</RouteNote>}
          </div>
        </aside>
        <section className="rt-route-detail" aria-label="Selected responder routes" tabIndex={0}>
        <div className="rt-focus-heading" aria-live="polite"><div className="rt-focus-copy">{activeMember ? <span className="rt-avatar" style={{ '--rt-member-color': colour(activeMember) }} aria-hidden="true">{activeMember.name.trim().split(/\s+/).slice(0, 2).map(n => n[0]).join('')}</span> : <span className="rt-detail-icon"><AnalysisIcon name="route" /></span>}<div><h4>{activeMember?.name || 'All Members'}<span className="rt-heading-pipe">|</span>Routes</h4><p>{activeMember ? activeMember.roles.join(', ') || 'Role not recorded' : `${visible.length} Personnels`}{' '}<span className="rt-heading-pipe">|</span>{' '}{activeMember ? activeMember.dispatch.team || `Dispatch #${activeMember.dispatch.dispatch_id}` : `${sampleCount.toLocaleString()} Recorded GPS Locations`}</p></div></div></div>
        {positions.length || planned.length || visibleVehicles.length ? <div className="rt-map-frame"><MapContainer className="rt-map" center={MAP_CENTER} zoom={12} scrollWheelZoom={false} aria-label="Recorded responder GPS routes">
          {tileLayersFor(theme === 'light' ? 'street' : 'dark').map(layer => <TileLayer key={layer.url} {...layer} />)}
          <FitTracks points={bounds} fitKey={`${scope}:${filters.dispatch}:${activeMember?.key || 'all'}:${filters.planned}:${filters.vehicle}:${fitRevision}`} />
          {planned.map(r => <Polyline key={r.dispatch.dispatch_id} positions={r.points} pathOptions={{ color: theme === 'light' ? '#64748b' : '#cbd5e1', weight: 3, dashArray: '7 7', opacity: .7 }}><Tooltip>Generated route · {r.dispatch.team || `Dispatch #${r.dispatch.dispatch_id}`} · planned</Tooltip></Polyline>)}
          {visibleVehicles.flatMap(unit => unit.segments.map((path, index) => <Polyline key={`vehicle:${unit.id}:${index}`} positions={path} pathOptions={{ color: vehicleColour, weight: 3, dashArray: '5 6' }}><Tooltip>{unit.truck} · recorded vehicle GPS · {unit.team || `Dispatch #${unit.dispatch_id}`}</Tooltip></Polyline>))}
          {visible.flatMap(member => member.segments.map((segment, index) => <Fragment key={`${member.key}:${index}`}>
            {segment.length > 1 && <Polyline positions={segment.map(p => p.position)} pathOptions={{ color: colour(member), weight: 4, opacity: .9 }}><Tooltip>{member.name} · recorded GPS locations</Tooltip></Polyline>}
            {(filters.samples ? segment : segment.length > 1 ? [segment[0], segment.at(-1)] : segment).map((sample, i) => <CircleMarker key={i} center={sample.position} radius={4} pathOptions={{ color: colour(member), fillColor: colour(member), fillOpacity: .9, weight: 2 }}><Tooltip>{member.name}<br />{dateTime(sample.at)}<br />{sample.accuracy_m == null ? 'Accuracy not recorded' : `Accuracy: ${sample.accuracy_m.toFixed(0)} m`}</Tooltip></CircleMarker>)}
          </Fragment>))}
          {data.location && <CircleMarker center={data.location} radius={7} pathOptions={{ color: '#ff4d1a', fillOpacity: .8 }}><Tooltip>Incident</Tooltip></CircleMarker>}
        </MapContainer><button type="button" className="rt-fit-tracks" aria-label="Fit tracks" title="Fit tracks" onClick={() => setFitRevision(value => value + 1)}><span className="rt-locate-icon" aria-hidden="true" /></button></div> : <p className="rt-empty rt-empty-map"><AnalysisIcon name="coverage" /><strong>No recorded route</strong><span>No usable GPS locations were saved for {activeMember ? 'this member' : 'these members'}. A recorded path is unavailable.</span></p>}
        <div className="rt-controls">
          <label className="rt-check"><input type="checkbox" checked={filters.planned} onChange={e => change({ planned: e.target.checked })} />Compare generated route</label>
          <label className="rt-check"><input type="checkbox" checked={filters.samples} onChange={e => change({ samples: e.target.checked })} />Show GPS samples</label>
          {vehicles.length > 0 && <label className="rt-check"><input type="checkbox" checked={filters.vehicle} onChange={e => change({ vehicle: e.target.checked })} />Show vehicle GPS</label>}
        </div>
        {filters.planned && <RouteNote>Dashed grey lines show generated plans.{!planned.length && ' No saved generated route is available for this selection.'}</RouteNote>}
        {vehicles.length > 0 && filters.vehicle && <RouteNote>Dashed amber lines show recorded vehicle GPS. Gaps remain disconnected; vehicle locations are separate from personal metrics.{!visibleVehicles.length && ' No vehicle GPS is available for this selection.'}</RouteNote>}
        {activeMember && <section className="rt-personal-metrics" aria-label={`${activeMember.name} recorded metrics`}>
          <KpiCard icon={<AnalysisIcon name="response" />} label="Recorded GPS window" value={duration(recordedWindow, KPI_EMPTY)} sub="First to last saved location" accent="muted" />
          <KpiCard icon={<AnalysisIcon name="coverage" />} label="GPS locations" value={activeMember.sample_count.toLocaleString()} sub="Usable recorded samples" accent="muted" />
          <KpiCard icon={<AnalysisIcon name="route" />} label="Track segments" value={activeMember.segments.length.toLocaleString()} sub="Gaps remain disconnected" accent="muted" />
          <KpiCard icon={<AnalysisIcon name="filter" />} label="Excluded locations" value={(activeMember.excluded_sample_count || 0).toLocaleString()} sub="Invalid or inaccurate fixes" accent="muted" />
        </section>}
        {!activeMember && <div className="rt-table-scroll"><table className="rt-members-table" aria-label="Recorded paths by member">
          <thead><tr><th scope="col">Personnel</th><th scope="col">Role / Team</th><th scope="col" className="rt-gps-count">Recorded GPS<br />Locations</th><th scope="col">Recorded GPS window</th></tr></thead>
          <tbody>{visible.map(member => <tr className="rt-member-row" key={member.key}>
            <th scope="row">{member.name}
              {member.excluded_sample_count > 0 && <small>{member.excluded_sample_count} inaccurate or invalid locations omitted.</small>}
              {member.unknown_accuracy_count > 0 && <small>Accuracy was not supplied for {member.unknown_accuracy_count} locations.</small>}
              {member.simplified && <small>Large history simplified for display; gap boundaries are preserved.</small>}
            </th>
            <td>{member.roles.join(', ') || 'Role not recorded'}<small>{member.dispatch.team || `Dispatch #${member.dispatch.dispatch_id}`}</small></td>
            <td className="rt-gps-count">{member.sample_count.toLocaleString()}</td>
            <td>{member.sample_count ? <>{dateTime(member.first_recorded_at)}<small>to {dateTime(member.last_recorded_at)}</small></> : 'No usable recorded locations'}</td>
          </tr>)}</tbody>
        </table></div>}
        <RouteNote>Solid coloured lines connect that member’s recorded positions. Gaps over {data.max_gap_seconds} seconds, inaccurate fixes, and implausible jumps remain disconnected. The path between samples is unobserved.{activeMember && ' The recorded GPS window describes location history, not confirmed travel time or arrival.'}</RouteNote>
        {selectedDispatches.some(d => !d.roster_available) && <RouteNote>Some dispatches have no saved assignment roster. Those dispatches list only responders with attributed GPS samples.</RouteNote>}
        {selectedDispatches.some(d => d.unattributed_sample_count > 0) && <RouteNote>Locations without a recorded responder identity are excluded from personal paths.</RouteNote>}
        </section></div>
      </>}
    </>}
  </div>
}
