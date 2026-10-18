import { setGooglePolygonPaths } from './googleMapGeometry'
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

export function createGoogleBarangayOverlay(map, library) {
  let cachedData
  let selectedData
  let labelsVisible = true
  let active = true
  let polygons = []
  let labels = []

  const detach = () => [...polygons, ...labels].forEach(element => element.remove())
  const attach = () => {
    if (!active || !selectedData) return
    polygons.forEach(element => { if (element.parentNode !== map) map.append(element) })
    labels.forEach(element => {
      if (labelsVisible) {
        if (element.parentNode !== map) map.append(element)
      } else element.remove()
    })
  }
  const build = data => {
    polygons = []
    labels = []
    const Polygon = library.Polygon3DElement || library.Polygon3DInteractiveElement
    const Marker = library.Marker3DElement || library.Marker3DInteractiveElement
    for (const barangay of prepareBarangays(data)) {
      for (const polygon of barangay.rings) {
        if (!Polygon || !polygon[0]?.length) continue
        const element = new Polygon({
          altitudeMode: 'RELATIVE_TO_GROUND', drawsOccludedSegments: true,
          strokeColor: BARANGAY_BOUNDARY_COLOR, strokeWidth: 2,
          fillColor: BARANGAY_FILL_COLOR, zIndex: 5,
        })
        setGooglePolygonPaths(element, {
          path: coordinates(polygon[0]),
          innerPaths: polygon.slice(1).map(coordinates),
        })
        polygons.push(element)
      }
      if (Marker && barangay.center) {
        const population = barangay.population == null ? '' : ` · Est. pop. ${Number(barangay.population).toLocaleString('en-US')}`
        labels.push(new Marker({
          position: barangay.center, altitudeMode: 'RELATIVE_TO_GROUND',
          label: `${barangay.name}${population}`, sizePreserved: true,
          drawsWhenOccluded: true, zIndex: 6,
        }))
      }
    }
  }

  return {
    sync(data, showLabels = true) {
      if (selectedData === data && labelsVisible === showLabels) return
      detach()
      selectedData = data
      labelsVisible = showLabels
      if (!data) return
      if (cachedData !== data) {
        cachedData = data
        build(data)
      }
      attach()
    },
    setActive(value) { active = value; if (value) attach() },
    dispose() { detach(); polygons = []; labels = [] },
  }
}
