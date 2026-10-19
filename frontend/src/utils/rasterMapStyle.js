import { REGION_BOUNDARY, TILE_OPTIONS } from '../data/mapConfig'
import { EMPTY_GEOJSON, rasterTileUrls } from './commandMapData'
import { PANABO_BOUNDARY_COLOR } from './mapOverlayColors'
import { HEATMAP_FADE_STOPS } from './heatmapOpacity'

export function rasterMapStyle() {
  return {
    version: 8,
    sources: {
      'command-overlays': { type: 'geojson', data: EMPTY_GEOJSON },
      'command-roads': { type: 'geojson', data: EMPTY_GEOJSON, tolerance: 0.2 },
      'command-heat': { type: 'geojson', data: EMPTY_GEOJSON },
      'command-boundary': { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: REGION_BOUNDARY } }, tolerance: 0 },
    },
    layers: [
      { id: 'command-background', type: 'background', paint: { 'background-color': '#111820' } },
      { id: 'command-heat', type: 'fill', source: 'command-heat', paint: {
        'fill-color': ['get', 'color'], 'fill-antialias': true,
        // MapLibre's 512-pixel zoom is one below Leaflet's 256-pixel zoom.
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], ...HEATMAP_FADE_STOPS.flatMap(([zoom, factor]) => [zoom - 1, ['*', ['get', 'opacity'], factor]])],
      } },
      { id: 'command-roads', type: 'line', source: 'command-roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': ['get', 'color'], 'line-width': ['get', 'weight'], 'line-opacity': ['get', 'opacity'],
      } },
      { id: 'command-fills', type: 'fill', source: 'command-overlays', filter: ['==', ['geometry-type'], 'Polygon'], paint: {
        'fill-color': ['get', 'fillColor'], 'fill-opacity': ['get', 'fillOpacity'],
      } },
      { id: 'command-lines', type: 'line', source: 'command-overlays', filter: ['!=', ['geometry-type'], 'Point'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': ['get', 'color'], 'line-width': ['get', 'weight'], 'line-opacity': ['get', 'opacity'],
        'line-dasharray': ['case', ['get', 'dashed'], ['literal', [2, 2]], ['literal', [1, 0]]],
      } },
      { id: 'command-points', type: 'circle', source: 'command-overlays', filter: ['==', ['geometry-type'], 'Point'], paint: {
        'circle-radius': ['get', 'radius'], 'circle-color': ['get', 'fillColor'], 'circle-opacity': ['get', 'opacity'],
      } },
      { id: 'command-boundary', type: 'line', source: 'command-boundary', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': PANABO_BOUNDARY_COLOR, 'line-width': 3.5, 'line-opacity': 1,
      } },
    ],
  }
}

export function selectRasterStyle(map, id) {
  const option = TILE_OPTIONS.find(option => option.id === id) || TILE_OPTIONS[1]
  const sourceId = `basemap-${option.id}`
  if (!map.getSource(sourceId)) {
    const layer = option.layers[0]
    map.addSource(sourceId, { type: 'raster', tiles: rasterTileUrls(layer), tileSize: 256,
      maxzoom: 19, attribution: layer.attribution })
    map.addLayer({ id: sourceId, type: 'raster', source: sourceId,
      paint: { 'raster-fade-duration': 160, 'raster-resampling': 'linear' } }, 'command-heat')
  }
  for (const option of TILE_OPTIONS) {
    const layerId = `basemap-${option.id}`
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, 'visibility', layerId === sourceId ? 'visible' : 'none')
  }
}
