// Route recalculation replaces IDs and geometry, so selection cannot be applied
// as a flag-only edit to the old route set.
export function replaceDispatchRoutes(previous, data) {
  if (!Array.isArray(data?.routes)) return previous
  const dispatchId = data.dispatch_id
  const existing = previous.find(route => route.dispatch_id === dispatchId)
  const selected = previous.find(route => route.dispatch_id === dispatchId && route.isSelected)
  if (data.options_only && selected?.route_id !== data.new_route_id) return previous
  if (data.alternatives_pending && selected?.route_id === data.new_route_id
      && previous.filter(route => route.dispatch_id === dispatchId).length > 1) return previous
  const replacements = data.routes.flatMap(route => {
    const match = route.route_wkt?.match(/LINESTRING\s*\(([^)]+)\)/i)
    if (!match) return []
    const positions = match[1].split(',').map(pair => {
      const [lon, lat] = pair.trim().split(/\s+/).map(Number)
      return [lat, lon]
    })
    if (positions.length < 2 || positions.some(point => !point.every(Number.isFinite))) return []
    return [{ id: `${dispatchId}_${route.route_id}`, route_id: route.route_id, dispatch_id: dispatchId,
      fire_id: data.fire_id ?? existing?.fire_id, positions, teamName: existing?.teamName || '', isGnn: true,
      isSelected: route.is_selected, rank: route.rank, routeType: route.route_type,
      etaMinutes: route.eta_minutes, distanceKm: route.distance_meters != null ? route.distance_meters / 1000 : null }]
  })
  if (!replacements.length) return previous
  return [...previous.filter(route => route.dispatch_id !== dispatchId), ...replacements]
}
