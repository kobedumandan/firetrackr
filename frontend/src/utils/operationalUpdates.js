// Deviation broadcasts can accompany every GPS fix. They change map overlays,
// not operational timings or report populations. Route replacements still
// refresh reports because they can change the saved ETA evidence.
export function shouldRefreshOperationalData(type) {
  return type !== 'dispatch_deviation' && /^(operational_times_updated|incident_|dispatch_|route_updated)/.test(type || '')
}
