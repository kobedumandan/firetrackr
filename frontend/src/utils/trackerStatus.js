// Off-duty pins stay stale on the map, but an intentional stop is not a fault.
// Older servers without tracking policy retain their existing stale behavior.
export function isTrackerOffline(row) {
  return !!row.is_stale && row.tracking?.on_duty !== false && row.tracking?.mode !== 'off'
}

export function hasTrackerLocation(row) {
  return Number.isFinite(row?.latitude) && Math.abs(row.latitude) <= 90
    && Number.isFinite(row?.longitude) && Math.abs(row.longitude) <= 180
}

export function offlineAlertTracker(notification, locations) {
  if (notification.tracker) return notification.tracker
  const name = notification.title?.replace(/\s+tracker offline$/i, '').trim().toLowerCase()
  if (!name) return null
  const matches = new Map()
  locations.forEach(row => {
    if (row.per_id != null && row.name?.trim().toLowerCase() === name && hasTrackerLocation(row)) matches.set(row.per_id, row)
  })
  if (matches.size !== 1) return null
  const tracker = matches.values().next().value
  return { ...tracker, is_stale: tracker.is_stale ?? (tracker.iot ? tracker.iot === 'offline' : true) }
}
