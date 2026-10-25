import { inRing } from './heatmap'
import { roadConstraintColor } from './mapOverlayColors'

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
  const editedSegments = new Set(drawings.map(row => row.baseline_segment_uid).filter(Boolean))
  const rows = (data?.constraints?.features || []).filter(feature => {
    const p = feature.properties || {}
    return !p.custom && !editedSegments.has(p.segment_uid) && p.display_constraint_type && p.display_constraint_type !== 'normal'
  }).map(feature => {
    const p = feature.properties
    const coordinates = feature.geometry?.coordinates || []
    return { key: constraintLayerId(feature), coordinates, center: midpoint(coordinates),
      name: p.name || p.display_label || 'Unnamed road',
      location: p.barangay || locationFor(coordinates, boundaries),
      type: p.display_constraint_type, source: p.annotation_source === 'manual_verified' ? 'Baseline annotation' : 'Model prediction',
      color: p.map_color || roadConstraintColor(p.display_constraint_type, p.narrow_severity, data?.style_config), feature }
  })
  for (const drawing of drawings) {
    const coordinates = drawing.coordinates || []
    rows.push({ key: `custom:${drawing.id}`, coordinates, center: midpoint(coordinates),
      name: drawing.name || 'Saved road', location: locationFor(coordinates, boundaries),
      type: drawing.constraint_type, source: drawing.baseline_segment_uid ? 'Edited baseline road' : 'Saved road constraint',
      color: roadConstraintColor(drawing.constraint_type, drawing.narrow_severity, data?.style_config), drawing })
  }
  return rows
}

export function baselineConstraintForEdit(row) {
  const props = row.feature?.properties || {}
  const defaults = props.edit_defaults || {
    constraint_type: row.type.startsWith('narrow_road') ? 'narrow_road' : row.type.startsWith('traffic') || row.type === 'construction' ? row.type : 'normal',
    narrow_severity: row.type === 'narrow_road_severe' ? 'severe' : row.type === 'narrow_road_slight' ? 'slight' : null,
    traffic_schedule: null,
  }
  return { ...defaults, name: row.name, baseline_segment_uid: props.segment_uid,
    coordinates: row.coordinates, predictionReview: row.type.startsWith('predicted_') }
}

export function filterConstraintLayers(rows, { query = '', location = '', source = '', sort = 'location' }) {
  const search = query.trim().toLocaleLowerCase()
  return rows.filter(row => (!location || row.location === location) && (!source || row.source === source)
    && (!search || `${row.name} ${row.location} ${row.type}`.toLocaleLowerCase().includes(search)))
    .sort((a, b) => {
      if (sort === 'recent') return (Date.parse(b.drawing?.created_at) || 0) - (Date.parse(a.drawing?.created_at) || 0) || (b.drawing?.id || 0) - (a.drawing?.id || 0)
      if (sort === 'north') return b.center[1] - a.center[1] || a.key.localeCompare(b.key)
      if (sort === 'west') return a.center[0] - b.center[0] || a.key.localeCompare(b.key)
      return (sort === 'location' ? a.location.localeCompare(b.location) : 0) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key)
    })
}

// Fit geographic geometry to a small north-up preview without stretching bends.
export function roadPreviewPath(coordinates, width = 48, height = 40) {
  const lines = typeof coordinates?.[0]?.[0] === 'number' ? [coordinates] : coordinates || []
  const validLines = lines.filter(Array.isArray).map(line => line.filter(point => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]))).filter(line => line.length >= 2)
  const points = validLines.flat()
  if (!points.length) return ''
  const minLng = Math.min(...points.map(point => point[0])), maxLng = Math.max(...points.map(point => point[0]))
  const minLat = Math.min(...points.map(point => point[1])), maxLat = Math.max(...points.map(point => point[1]))
  const longitudeScale = Math.cos((minLat + maxLat) / 2 * Math.PI / 180)
  const spanX = (maxLng - minLng) * longitudeScale, spanY = maxLat - minLat
  if (!spanX && !spanY) return ''
  const scale = Math.min((width - 12) / (spanX || 1e-9), (height - 12) / (spanY || 1e-9))
  const offsetX = (width - spanX * scale) / 2, offsetY = (height - spanY * scale) / 2
  return validLines.map(line => line.map(([lng, lat], index) => `${index ? 'L' : 'M'}${(offsetX + (lng - minLng) * longitudeScale * scale).toFixed(1)},${(offsetY + (maxLat - lat) * scale).toFixed(1)}`).join(' ')).join(' ')
}
