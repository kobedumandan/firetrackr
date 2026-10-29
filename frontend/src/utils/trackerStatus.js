// Off-duty pins stay stale on the map, but an intentional stop is not a fault.
// Older servers without tracking policy retain their existing stale behavior.
export function isTrackerOffline(row) {
  return !!row.is_stale && row.tracking?.on_duty !== false && row.tracking?.mode !== 'off'
}
