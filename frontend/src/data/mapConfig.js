import { PANABO_BOUNDARY } from './panaboBoundary'
import { NEW_CORELLA_BOUNDARY } from './newCorellaBoundary'

/**
 * Region switching — LOCAL DEVELOPMENT ONLY.
 *
 * Production is always Panabo City: the system was built for and proposed to
 * BFP Panabo City. New Corella exists purely so a developer can exercise the
 * app without being physically in Panabo, and is backed by an OpenStreetMap
 * road network rather than Panabo's digitised QGIS one. Never set VITE_REGION
 * on a deployed build.
 *
 * Select with VITE_REGION in the frontend .env, and keep it in step with the
 * backend's REGION variable — they must name the same place or the map will
 * show one municipality while the router plans over another. The live backend
 * value is reported by GET /api/routing/status as `region`.
 */
export const REGIONS = {
  panabo: {
    key: 'panabo',
    label: 'Panabo City',
    center: [7.307, 125.635],
    zoom: 12,
    bounds: { latMin: 7.15, latMax: 7.50, lngMin: 125.50, lngMax: 125.90 },
    boundary: PANABO_BOUNDARY,
  },
  new_corella: {
    key: 'new_corella',
    label: 'New Corella',
    // Derived from the OSM boundary relation by fetch_osm_roads.py; the bbox
    // is padded ~15% so a pin right on the municipal edge is still accepted.
    center: [7.6029, 125.8516],
    zoom: 13,
    bounds: { latMin: 7.481, latMax: 7.734, lngMin: 125.750, lngMax: 125.958 },
    boundary: NEW_CORELLA_BOUNDARY,
  },
}

const _requested = (import.meta.env.VITE_REGION || 'panabo').trim().toLowerCase()
if (!REGIONS[_requested]) {
  console.warn(
    `[mapConfig] Unknown VITE_REGION="${_requested}" — falling back to "panabo". ` +
    `Valid regions: ${Object.keys(REGIONS).join(', ')}`,
  )
}

export const REGION = REGIONS[_requested] ? _requested : 'panabo'
export const REGION_CONFIG   = REGIONS[REGION]
export const REGION_LABEL    = REGION_CONFIG.label
export const REGION_BOUNDARY = REGION_CONFIG.boundary

export const MAP_CENTER = REGION_CONFIG.center
export const MAP_ZOOM   = REGION_CONFIG.zoom
export const MAP_BOUNDS = REGION_CONFIG.bounds

/** True when (lat, lng) falls inside the active region's bounding box. */
export function withinRegion(lat, lng) {
  return (
    lat >= MAP_BOUNDS.latMin && lat <= MAP_BOUNDS.latMax &&
    lng >= MAP_BOUNDS.lngMin && lng <= MAP_BOUNDS.lngMax
  )
}

// ── Back-compat aliases ──────────────────────────────────────────────────────
// These predate region switching and are still imported across the map
// components. They now follow the ACTIVE region, so despite the name they are
// not Panabo-specific. Prefer the MAP_*/withinRegion names in new code.
export const PANABO_CENTER = MAP_CENTER
export const PANABO_ZOOM   = MAP_ZOOM
export const PANABO_BOUNDS = MAP_BOUNDS
export const withinPanabo  = withinRegion

/**
 * Style for the out-of-jurisdiction mask — the fill that dims everything
 * outside the active region's boundary on picker maps.
 *
 * It has to invert with the theme: a near-black scrim reads as "dimmed" over a
 * dark basemap, but as a hole punched in the page over a light one. Shared here
 * because the station, edit-station and log-incident pickers all draw it.
 */
export function maskStyle(theme) {
  return theme === 'light'
    ? { fillColor: '#f0f3f7', fillOpacity: 0.78, stroke: false }
    : { fillColor: '#060810', fillOpacity: 0.72, stroke: false }
}

export const TILE_OPTIONS = [
  {
    id: 'street',
    label: 'Light',
    thumb: 'https://a.basemaps.cartocdn.com/rastertiles/voyager/5/27/15.png',
    layers: [
      {
        url: `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${import.meta.env.VITE_CARTO_MAP_API_KEY}`,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      },
    ],
  },
  {
    id: 'dark',
    label: 'Dark',
    thumb: 'https://a.basemaps.cartocdn.com/dark_all/5/27/15.png',
    layers: [
      {
        url: `https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=${import.meta.env.VITE_CARTO_MAP_API_KEY}`,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
      },
    ],
  },
  {
    id: 'satellite',
    label: 'Satellite',
    thumb: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/5/15/27',
    layers: [
      {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
        maxZoom: 19,
        maxNativeZoom: 17,
      },
    ],
  },
]

// Google 3D has its own renderer; keep raster-only picker maps unchanged.
export const COMMAND_BASEMAP_OPTIONS = [
  ...TILE_OPTIONS,
  { id: 'google-3d', label: 'Photorealistic 3D', title: 'Google photorealistic map with tilt and rotation' },
]

/**
 * Layers of one TILE_OPTIONS entry, for maps that render a basemap without
 * offering a switcher (the metrics choropleth, the planning coverage map).
 * They follow the page theme instead:
 *
 *   tileLayersFor(theme === 'light' ? 'street' : 'dark')
 *
 * Unknown ids fall back to 'dark' so a typo can never blank the basemap.
 */
export function tileLayersFor(id) {
  if (id === 'google-3d') return []
  const opt = TILE_OPTIONS.find((t) => t.id === id)
  return (opt ?? TILE_OPTIONS.find((t) => t.id === 'dark')).layers
}
