import { inRing } from './heatmap'

export function constraintLayerId(feature) {
  const p = feature.properties || {}
  return p.custom ? `custom:${p.constraint_id}` : `segment:${p.segment_uid ?? p.road_id ?? JSON.stringify(feature.geometry?.coordinates)}`
}

function midpoint(coordinates) {
  if (!coordinates.length) return [0, 0]
  const lengths = coordinates.slice(1).map((point, index) => {
    const previous = coordinates[index]
    const longitudeScale = Math.cos((point[1] + previous[1]) / 2 * Math.PI / 180)
    return Math.hypot((point[0] - previous[0]) * longitudeScale, point[1] - previous[1])
  })
  let remaining = lengths.reduce((total, value) => total + value, 0) / 2
  for (let index = 0; index < lengths.length; index++) {
    if (remaining <= lengths[index] && lengths[index]) {
      const ratio = remaining / lengths[index]
      return coordinates[index].map((value, axis) => value + (coordinates[index + 1][axis] - value) * ratio).slice(0, 2)
    }
    remaining -= lengths[index]
  }
  return coordinates[0]
}

function locationFor(coordinates, boundaries) {
  const point = midpoint(coordinates)
  for (const feature of boundaries?.features || []) {
    const geometry = feature.geometry
    const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates : geometry?.type === 'Polygon' ? [geometry.coordinates] : []
    if (polygons.some(rings => inRing(point, rings[0]) && !rings.slice(1).some(hole => inRing(point, hole)))) {
      return feature.properties?.brgy_name || feature.properties?.name || 'Unknown location'
    }
  }
  return 'Unknown location'
}

export function buildConstraintLayers(data, drawings, boundaries) {
  const rows = (data?.constraints?.features || []).filter(feature => {
    const p = feature.properties || {}
    return !p.custom && p.display_constraint_type && p.display_constraint_type !== 'normal'
  }).map(feature => {
    const p = feature.properties
    const coordinates = feature.geometry?.coordinates || []
    return { key: constraintLayerId(feature), coordinates, center: midpoint(coordinates),
      name: p.name || p.display_label || 'Unnamed road',
      location: p.barangay || locationFor(coordinates, boundaries),
      type: p.display_constraint_type, source: p.annotation_source === 'manual_verified' ? 'Baseline annotation' : 'Model prediction',
      color: p.map_color || '#c47800', feature }
  })
  for (const drawing of drawings) {
    const coordinates = drawing.coordinates || []
    rows.push({ key: `custom:${drawing.id}`, coordinates, center: midpoint(coordinates),
      name: drawing.name || 'Unnamed drawing', location: locationFor(coordinates, boundaries),
      type: drawing.constraint_type, source: 'Admin drawing',
      color: drawing.constraint_type === 'traffic_area' ? '#e0a128' : '#dc553b', drawing })
  }
  return rows
}

export function filterConstraintLayers(rows, { query = '', location = '', source = '', sort = 'location' }) {
  const search = query.trim().toLocaleLowerCase()
  return rows.filter(row => (!location || row.location === location) && (!source || row.source === source)
    && (!search || `${row.name} ${row.location} ${row.type}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => {
      if (sort === 'north') return b.center[1] - a.center[1] || a.key.localeCompare(b.key)
      if (sort === 'west') return a.center[0] - b.center[0] || a.key.localeCompare(b.key)
      return (sort === 'location' ? a.location.localeCompare(b.location) : 0) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
    })
}
