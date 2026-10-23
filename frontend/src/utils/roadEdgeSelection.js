// Match only authoritative road lines, within both a small screen tolerance
// and six metres. Tile features (buildings, labels, land) are never candidates.
export function nearestRoadEdge(point, features, zoom) {
  if (zoom < 16) return null
  const scale = Math.cos(point[1] * Math.PI / 180)
  const tolerance = Math.min(6, 6 * 156543.03392 * scale / 2 ** zoom)
  let best = null, distance = tolerance, ambiguous = false
  for (const feature of features) {
    if (feature.geometry?.type !== 'LineString') continue
    const points = feature.geometry.coordinates
    let candidateDistance = Infinity
    for (let i = 1; i < points.length; i++) {
      const a = [(points[i - 1][0] - point[0]) * 111320 * scale, (points[i - 1][1] - point[1]) * 111320]
      const b = [(points[i][0] - point[0]) * 111320 * scale, (points[i][1] - point[1]) * 111320]
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)))
      candidateDistance = Math.min(candidateDistance, Math.hypot(a[0] + t * dx, a[1] + t * dy))
    }
    if (best && Math.abs(candidateDistance - distance) < 0.1) ambiguous = true
    else if (candidateDistance < distance) {
      best = feature; distance = candidateDistance; ambiguous = false
    }
  }
  return ambiguous ? null : best
}

export function toggleRoadEdge(selected, uid) {
  return selected.includes(uid) ? selected.filter(value => value !== uid) : [...selected, uid]
}
