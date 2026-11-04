import { inRing } from './heatmap'

function onRing(point, ring) {
  const [x, y] = point
  return ring.some(([ax, ay], index) => {
    const [bx, by] = ring[(index + 1) % ring.length]
    return (x - ax) * (by - ay) === (y - ay) * (bx - ax)
      && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
      && y >= Math.min(ay, by) && y <= Math.max(ay, by)
  })
}

// Leaflet supplies latitude/longitude; GeoJSON rings use longitude/latitude.
export function barangayNameForPoint(boundaries, lat, lng) {
  if (lat === '' || lat == null || lng === '' || lng == null
    || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return ''
  const point = [Number(lng), Number(lat)]
  for (const feature of boundaries?.features || []) {
    const geometry = feature.geometry
    const polygons = geometry?.type === 'MultiPolygon' ? geometry.coordinates
      : geometry?.type === 'Polygon' ? [geometry.coordinates] : []
    // Match the backend's ST_Contains: boundary edges and holes are excluded.
    if (polygons.some(([outer, ...holes]) => outer?.length >= 3
      && inRing(point, outer) && !onRing(point, outer)
      && !holes.some(hole => inRing(point, hole) || onRing(point, hole)))) {
      return feature.properties?.brgy_name || ''
    }
  }
  return ''
}
