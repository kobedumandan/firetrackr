// Leaflet-equivalent zoom: keep the overview strong, then reveal road detail.
export const HEATMAP_FADE_STOPS = [[14, 1], [16, 0.2], [18, 0.06]]

export function heatmapOpacity(zoom, base = 0.65) {
  if (!Number.isFinite(zoom) || zoom <= HEATMAP_FADE_STOPS[0][0]) return base
  for (let i = 1; i < HEATMAP_FADE_STOPS.length; i++) {
    const [start, from] = HEATMAP_FADE_STOPS[i - 1], [end, to] = HEATMAP_FADE_STOPS[i]
    if (zoom <= end) return base * (from + (to - from) * (zoom - start) / (end - start))
  }
  return base * HEATMAP_FADE_STOPS.at(-1)[1]
}
