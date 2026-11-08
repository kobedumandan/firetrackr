import { hasTrackerLocation } from './trackerStatus'

const STALE_HIDE_MINUTES = 8 * 60

export function personnelMapPins(personnel, locations, focusedPersonnel) {
  const byId = new Map(locations.map(row => [row.per_id, row]))
  const saved = focusedPersonnel?.lastLocation
  const rows = saved && !personnel.some(row => row.per_id === saved.per_id)
    ? [...personnel, { ...saved, initials: (saved.name || '').split(/\s+/).map(part => part[0]).join('').slice(0, 2) }]
    : personnel
  return rows.flatMap(person => {
    const fallback = saved?.per_id === person.per_id ? saved : null
    const current = byId.get(person.per_id)
    const live = hasTrackerLocation(current) ? current : fallback || current
    if (live?.age_minutes >= STALE_HIDE_MINUTES && person.per_id !== focusedPersonnel?.per_id) return []
    const location = hasTrackerLocation(live) ? live : person
    if (!hasTrackerLocation(location)) return []
    return [{ personnel: person, live, position: [location.latitude, location.longitude] }]
  })
}
