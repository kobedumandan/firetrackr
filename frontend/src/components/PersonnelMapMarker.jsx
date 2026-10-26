import { useMemo } from 'react'
import { Marker, Popup, Tooltip } from 'react-leaflet'
import L from 'leaflet'

const truckSvg = '<svg class="personnel-truck-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h11v11H3zM14 10h4l3 4v3h-7M6 3h5M5 10h6M5 13h6M16 11v3h4"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>'

function markerIcon(initials, color, shadow, deviated, truck) {
  const element = document.createElement('div')
  element.className = 'personnel-pin'
  const face = document.createElement('div')
  face.className = `personnel-marker${truck ? ' personnel-marker--truck' : ''}`
  Object.assign(face.style, { borderColor: color, color, boxShadow: `0 0 10px ${shadow}` })
  if (truck) face.innerHTML = truckSvg
  else face.textContent = initials || '??'
  element.append(face)
  if (deviated) {
    const badge = document.createElement('span')
    badge.className = 'personnel-deviation-badge'
    badge.textContent = '!'
    element.append(badge)
  }
  return L.divIcon({ className: 'personnel-map-icon', iconSize: [28, 28], iconAnchor: [14, 14], html: element.outerHTML })
}

function statusLabel(status) {
  return ({ onscene: 'On scene', on_scene: 'On scene', en_route: 'En route', dispatched: 'Dispatched', dispatch: 'Dispatched',
    standby: 'Standby', offduty: 'Off duty', off: 'Off duty' })[status] || status || 'Unknown'
}

export default function PersonnelMapMarker({ personnel, live, dispatch, team, position, recentlyUpdated = false }) {
  const member = dispatch?.members?.find(person => person.per_id === personnel.per_id)
    || team?.members?.find(person => person.per_id === personnel.per_id)
  const role = (member?.member_role || (team || dispatch ? 'Not available' : 'Unassigned')).replaceAll('_', ' ')
  const mode = live?.tracking?.mode
  const status = mode === 'off' ? 'offduty' : mode === 'standby' ? 'standby' : live?.personnel_status || dispatch?.dispatch_status || mode || personnel.status
  const color = live?.is_stale ? '#777' : ['onscene', 'on_scene'].includes(status) ? 'var(--accent-fire)'
    : ['dispatched', 'en_route'].includes(status) ? 'var(--accent-amber)' : 'var(--accent-green)'
  const shadow = live?.is_stale ? 'rgba(80,80,80,0.3)' : ['onscene', 'on_scene'].includes(status) ? 'rgba(255,77,26,0.5)'
    : ['dispatched', 'en_route'].includes(status) ? 'rgba(255,176,32,0.5)' : 'rgba(0,230,118,0.5)'
  // Only explicit manning evidence may turn a person into a truck marker.
  const truck = live?.manned_truck
  const isManning = !!truck
  const icon = useMemo(() => markerIcon(personnel.initials, color, shadow, live?.is_deviated, isManning),
    [personnel.initials, color, shadow, live?.is_deviated, isManning])
  const assignedTruck = dispatch?.truck_platenums?.join(', ') || team?.truck_platenum
  const lastSeen = live?.age_minutes != null ? `${live.age_minutes} min ago` : 'Not available'

  return <Marker position={position} icon={icon} mapAligned title={`${personnel.name} · ${truck ? 'Truck unit' : 'Personnel'}`}
    zIndexOffset={recentlyUpdated ? 1000 : 0} eventHandlers={{ click: event => event.target.closeTooltip() }}>
    <Tooltip direction="top" className="leaflet-dark-tooltip">
      <div className="tooltip-id">{personnel.name}{truck ? ` · ${truck.truck_platenum}` : ''}</div>
      <div className="tooltip-sub">{role} · {dispatch?.team_name || team?.team_name || personnel.team_name || 'No response team'}</div>
      <div className="tooltip-sub">Click for personnel details</div>
    </Tooltip>
    <Popup className="personnel-popup" minWidth={240} maxWidth={290}>
      <article className="personnel-card" aria-label={`Personnel details for ${personnel.name}`}>
        <div className="personnel-card-heading">
          <span className={`personnel-card-avatar${truck ? ' personnel-card-avatar--truck' : ''}`} aria-hidden="true">
            {truck ? <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h11v11H3zM14 10h4l3 4v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg> : personnel.initials}
          </span>
          <div><span className="personnel-card-kind">{truck ? 'Truck unit · Manning confirmed' : 'Personnel'}</span>
            <strong className="personnel-card-name">{personnel.name}</strong><span className="personnel-card-rank">{personnel.rank}</span></div>
        </div>
        <dl className="personnel-card-facts">
          <div><dt>Role</dt><dd>{role}</dd></div>
          <div><dt>Response team</dt><dd>{dispatch?.team_name || team?.team_name || personnel.team_name || 'Unassigned'}</dd></div>
          <div><dt>Station</dt><dd>{personnel.station || dispatch?.station_name || 'Unassigned'}</dd></div>
          <div><dt>Status</dt><dd>{statusLabel(status)}</dd></div>
          <div><dt>{truck ? 'Manning truck' : 'Assigned truck'}</dt><dd>{truck?.truck_platenum || assignedTruck || 'None assigned'}</dd></div>
        </dl>
        <div className={`personnel-card-fix${live?.is_stale ? ' personnel-card-fix--stale' : ''}`}>Last location: {lastSeen}{live?.is_stale ? ' · Stale' : ''}</div>
        {live?.is_deviated && <div className="personnel-card-warning">Off the selected route</div>}
      </article>
    </Popup>
  </Marker>
}
