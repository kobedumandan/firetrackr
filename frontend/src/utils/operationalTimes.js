export const STAGES = [
  { key: 'processing', label: 'Report processing', color: '#b85b2a', icon: 'description' },
  { key: 'preparation', label: 'Preparation', color: '#f48d42', icon: 'notifications_active' },
  { key: 'travel', label: 'Travel', color: '#ff4d1a', icon: 'local_shipping' },
  { key: 'suppression', label: 'Suppression', color: '#a2a4a5', icon: 'local_fire_department' },
]
export const ALL_METRICS = [...STAGES, { key: 'cta', label: 'Call-to-arrival', color: '#ddd2c8' }, { key: 'operation', label: 'Overall operation', color: '#aab8d4' }]
export function duration(seconds, missing = 'No data') {
  if (seconds == null || !Number.isFinite(seconds)) return missing
  const total = Math.round(Math.abs(seconds))
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`
}
export function dateTime(value) {
  if (!value) return 'No data'
  return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(value))
}
export function manilaInput(date = new Date()) {
  return new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 19)
}
export function parseRouteWkt(value) {
  const match = typeof value === 'string' && value.match(/^\s*(?:SRID=4326;)?LINESTRING\s*\(([^)]+)\)\s*$/i)
  if (!match) return []
  const points = match[1].split(',').map(p => p.trim().split(/\s+/).map(Number)).map(([lon, lat]) => [lat, lon])
  return points.length > 1 && points.every(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) ? points : []
}
