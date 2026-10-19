import { setGoogleLinePath, setGooglePolygonPaths } from './googleMapGeometry'
import { BARANGAY_BOUNDARY_COLOR, BARANGAY_FILL_COLOR } from './mapOverlayColors'

const prepared = new WeakMap()

function ringsFor(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates]
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function centerOf(rings) {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity
  for (const polygon of rings) for (const ring of polygon) for (const [lng, lat] of ring) {
    west = Math.min(west, lng); east = Math.max(east, lng)
    south = Math.min(south, lat); north = Math.max(north, lat)
  }
  return Number.isFinite(west) ? { lat: (south + north) / 2, lng: (west + east) / 2, altitude: 12 } : null
}

export function prepareBarangays(data) {
  if (!data?.features) return []
  if (prepared.has(data)) return prepared.get(data)
  const result = data.features.map((feature, index) => {
    const rings = ringsFor(feature.geometry)
    const properties = feature.properties || {}
    return {
      id: properties.brgy_id ?? properties.adm4_psgc ?? properties.brgy_name ?? index,
      name: properties.brgy_name || properties.adm4_en || 'Unnamed barangay',
      population: properties.brgy_estpopulation,
      rings,
      center: centerOf(rings),
    }
  }).filter(feature => feature.rings.length)
  prepared.set(data, result)
  return result
}

const coordinates = ring => ring.map(([lng, lat]) => ({ lat, lng, altitude: 3 }))

export function createGoogleBarangayOverlay(map, library, onWarning = () => {}) {
  let cachedData
  let selectedData
  let labelsVisible = true
  let active = true
  let polygons = []
  let labels = []
  let labelsBuilt = false

  const detach = () => [...polygons, ...labels].forEach(element => element.remove())
  const build = data => {
    const Polygon = library.Polygon3DElement || library.Polygon3DInteractiveElement
    const Line = library.Polyline3DElement || library.Polyline3DInteractiveElement
    const next = []
    const options = {
      altitudeMode: 'RELATIVE_TO_GROUND', drawsOccludedSegments: true,
      strokeColor: BARANGAY_BOUNDARY_COLOR, strokeWidth: 2, zIndex: 5,
    }
    try {
      for (const barangay of prepareBarangays(data)) {
        for (const polygon of barangay.rings) {
          if (!polygon[0]?.length) continue
          let element
          try {
            if (!Polygon) throw new Error('Google polygon rendering is unavailable')
            element = new Polygon({ ...options, fillColor: BARANGAY_FILL_COLOR })
            setGooglePolygonPaths(element, {
              path: coordinates(polygon[0]), innerPaths: polygon.slice(1).map(coordinates),
            })
            map.append(element)
            next.push(element)
          } catch (error) {
            element?.remove()
            if (!Line) throw error
            // If the SDK rejects a polygon, keep its boundaries visible using
            // the line renderer already used by roads and city limits.
            for (const ring of polygon) {
              const line = new Line(options)
              next.push(line)
              const path = coordinates(ring)
              const first = path[0], last = path.at(-1)
              if (first.lat !== last.lat || first.lng !== last.lng) path.push({ ...first })
              setGoogleLinePath(line, path)
              map.append(line)
            }
          }
        }
      }
    } catch (error) {
      next.forEach(element => element.remove())
      throw error
    }
    polygons = next
    labels = []
    labelsBuilt = false
    // Cache only a successful build; failures must remain retryable.
    cachedData = data
  }
  const buildLabels = data => {
    const Marker = library.Marker3DElement || library.Marker3DInteractiveElement
    let warning
    for (const barangay of prepareBarangays(data)) {
      if (Marker && barangay.center) {
        let label
        try {
          const population = barangay.population == null ? '' : ` · Est. pop. ${Number(barangay.population).toLocaleString('en-US')}`
          label = new Marker({
            position: barangay.center, altitudeMode: 'RELATIVE_TO_GROUND',
            label: `${barangay.name}${population}`, sizePreserved: true,
            drawsWhenOccluded: true, zIndex: 6,
          })
          map.append(label)
          labels.push(label)
        } catch (error) {
          label?.remove()
          warning = error
        }
      }
    }
    labelsBuilt = true
    if (warning) onWarning(warning)
  }
  const attach = () => {
    if (!active || !selectedData) return
    if (cachedData !== selectedData) build(selectedData)
    polygons.forEach(element => { if (element.parentNode !== map) map.append(element) })
    if (labelsVisible && !labelsBuilt) buildLabels(selectedData)
    labels.forEach(element => {
      if (labelsVisible) {
        if (element.parentNode !== map) map.append(element)
      } else element.remove()
    })
  }

  return {
    sync(data, showLabels = true) {
      if (selectedData !== data) detach()
      selectedData = data
      labelsVisible = showLabels
      if (!data) return
      attach()
    },
    setActive(value) { active = value; if (value) attach(); else detach() },
    dispose() { detach(); polygons = []; labels = [] },
  }
}
