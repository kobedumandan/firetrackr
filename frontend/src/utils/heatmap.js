import { REGION_BOUNDARY } from '../data/mapConfig'

export const HEAT_RADIUS_METRES = 500
export const HEAT_COLORS = ['#298be6', '#24c9cf', '#69cc65', '#f2d24c', '#f69a38', '#ed493b']
const LEVELS = [0.06, 0.18, 0.36, 0.54, 0.72, 0.9]
const STEP = 100, SIGMA = 200
export const EMPTY_HEATMAP = { type: 'FeatureCollection', features: [] }

export function inRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Dates are incident occurrence dates in the dashboard's operational timezone.
export function manilaDate(value) {
  const time = new Date(value).getTime()
  return value && Number.isFinite(time) ? new Date(time + 8 * 3600000).toISOString().slice(0, 10) : ''
}

export function filterHeatmapPoints(points, range, boundary = REGION_BOUNDARY) {
  if (range.from && range.to && range.from > range.to) return []
  return points.filter(point => {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng) ||
        !Number.isFinite(point.weight) || point.weight <= 0 || !inRing([point.lng, point.lat], boundary)) return false
    const date = manilaDate(point.occurred_at)
    return (!range.from || (date && date >= range.from)) && (!range.to || (date && date <= range.to))
  })
}

// Sparse Gaussian density sampled in metres, rather than screen pixels. The
// same contours feed all three renderers; camera changes never rebuild them.
export function heatmapSurface(points) {
  if (!points.length) return EMPTY_HEATMAP
  const latitude = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const longitude = points.reduce((sum, p) => sum + p.lng, 0) / points.length
  const metresLng = 111320 * Math.cos(latitude * Math.PI / 180)
  const grid = new Map(), cells = new Set()
  const key = (x, y) => `${x},${y}`
  const radius = HEAT_RADIUS_METRES / STEP
  for (const point of points) {
    const px = (point.lng - longitude) * metresLng / STEP, py = (point.lat - latitude) * 111320 / STEP
    for (let x = Math.floor(px - radius); x <= Math.ceil(px + radius); x++) {
      for (let y = Math.floor(py - radius); y <= Math.ceil(py + radius); y++) {
        const distance2 = ((x - px) ** 2 + (y - py) ** 2) * STEP ** 2
        if (distance2 > HEAT_RADIUS_METRES ** 2) continue
        grid.set(key(x, y), (grid.get(key(x, y)) || 0) + point.weight * Math.exp(-distance2 / (2 * SIGMA ** 2)))
        for (const dx of [-1, 0]) for (const dy of [-1, 0]) cells.add(key(x + dx, y + dy))
      }
    }
  }
  let peak = 0
  for (const value of grid.values()) peak = Math.max(peak, value)
  if (!peak) return EMPTY_HEATMAP
  const valueAt = (x, y) => (grid.get(key(x, y)) || 0) / peak
  const features = []
  for (let band = 0; band < LEVELS.length; band++) {
    const level = LEVELS[band], nodes = new Map(), links = new Map()
    const connect = (a, b) => {
      if (!links.has(a)) links.set(a, [])
      if (!links.has(b)) links.set(b, [])
      links.get(a).push(b); links.get(b).push(a)
    }
    for (const cell of cells) {
      const [x, y] = cell.split(',').map(Number)
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]]
      const values = corners.map(([cx, cy]) => valueAt(cx, cy))
      const mask = values.reduce((bits, v, i) => bits | (v >= level ? 1 << i : 0), 0)
      if (mask === 0 || mask === 15) continue
      const edges = [[0, 1, `h:${x},${y}`], [1, 2, `v:${x + 1},${y}`], [3, 2, `h:${x},${y + 1}`], [0, 3, `v:${x},${y}`]]
      const crossing = edges.map(([a, b, id]) => {
        const t = (level - values[a]) / (values[b] - values[a])
        if ((values[a] >= level) === (values[b] >= level)) return null
        nodes.set(id, [corners[a][0] + t * (corners[b][0] - corners[a][0]), corners[a][1] + t * (corners[b][1] - corners[a][1])])
        return id
      })
      const hits = crossing.filter(Boolean)
      if (hits.length === 2) connect(...hits)
      else if (hits.length === 4) {
        // Resolve saddle cells by their centre, keeping islands and holes valid.
        const highCenter = values.reduce((a, b) => a + b, 0) / 4 >= level
        const pairs = (mask === 5) === highCenter ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]]
        pairs.forEach(([a, b]) => connect(crossing[a], crossing[b]))
      }
    }
    const visited = new Set(), rings = []
    for (const start of links.keys()) {
      if (visited.has(start)) continue
      const ring = []
      let current = start, previous
      while (!visited.has(current)) {
        visited.add(current); ring.push(nodes.get(current))
        const next = links.get(current).find(id => id !== previous)
        previous = current; current = next
      }
      if (current === start && ring.length >= 3) rings.push([...ring, ring[0]])
    }
    const area = ring => Math.abs(ring.reduce((sum, p, i) => i ? sum + ring[i - 1][0] * p[1] - p[0] * ring[i - 1][1] : sum, 0))
    const ordered = rings.map(ring => ({ ring, area: area(ring), depth: 0, parent: null })).sort((a, b) => b.area - a.area)
    ordered.forEach((entry, i) => {
      for (let j = i - 1; j >= 0; j--) if (inRing(entry.ring[0], ordered[j].ring)) {
        entry.parent = ordered[j]; entry.depth = ordered[j].depth + 1; break
      }
    })
    const geographic = ring => ring.map(([x, y]) => [longitude + x * STEP / metresLng, latitude + y * STEP / 111320])
    for (const entry of ordered.filter(item => item.depth % 2 === 0)) {
      features.push({ type: 'Feature', properties: { color: HEAT_COLORS[band], opacity: 0.65, band },
        geometry: { type: 'Polygon', coordinates: [geographic(entry.ring), ...ordered.filter(item => item.parent === entry && item.depth % 2 === 1).map(item => geographic(item.ring))] } })
    }
  }
  return { type: 'FeatureCollection', features }
}
