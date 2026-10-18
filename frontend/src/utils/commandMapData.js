export const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] }
const constraintCache = new WeakMap()

// Convert once per API response. Both renderers use the same colors and labels.
export function constraintFeatures(data) {
  if (!data) return EMPTY_GEOJSON
  if (constraintCache.has(data)) return constraintCache.get(data)
  const features = (data.constraints?.features || []).flatMap((feature, index) => {
    const props = feature.properties || {}
    const parts = feature.geometry?.type === 'MultiLineString'
      ? feature.geometry.coordinates : feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : []
    return parts.filter(part => part.length >= 2).map((coordinates, part) => ({
      type: 'Feature', id: `${props.road_id ?? index}-${index}-${part}`,
      geometry: { type: 'LineString', coordinates },
      properties: {
        color: props.map_color || '#b0bec5', weight: Math.max(2, props.map_weight || 2),
        opacity: props.map_opacity ?? 0.85, normal: props.display_constraint_type === 'normal',
        title: [props.display_label || props.display_constraint_type, props.name, props.barangay,
          `Avoidance ×${props.routing_multiplier ?? 1}`, props.hover_confidence_text].filter(Boolean).join(' · '),
      },
    }))
  }).sort((a, b) => Number(b.properties.normal) - Number(a.properties.normal))
  const result = { type: 'FeatureCollection', features }
  constraintCache.set(data, result)
  return result
}

// Provider URLs remain HTTP-cacheable; never persist or prefetch Google tiles.
export function rasterTileUrls(layer, hd = true) {
  const subdomains = typeof layer.subdomains === 'string' ? [...layer.subdomains] : layer.subdomains || ['a']
  return (layer.url.includes('{s}') ? subdomains : ['a']).map(subdomain =>
    layer.url.replace('{s}', subdomain).replace('{r}', hd ? '@2x' : '').replace(/\?key=(undefined|$)/, ''),
  )
}

// During camera motion, update the readout at most once per animation frame.
export function frameThrottle(callback) {
  let frame = null
  let latest
  const run = (...args) => {
    latest = args
    if (frame !== null) return
    frame = requestAnimationFrame(() => { frame = null; callback(...latest) })
  }
  run.cancel = () => { if (frame !== null) cancelAnimationFrame(frame); frame = null }
  return run
}
