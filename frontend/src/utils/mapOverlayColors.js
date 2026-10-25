export const PANABO_BOUNDARY_COLOR = '#ff5a1f'
export const BARANGAY_BOUNDARY_COLOR = '#ff8a4c'
export const BARANGAY_FILL_COLOR = 'rgba(255, 138, 76, 0.08)'
// Fallbacks match the shipped baseline export; the active model's API palette
// takes priority when available, including before a saved road reload finishes.
const CONSTRAINT_COLORS = {
  normal: '#B0BEC5',
  narrow_road_slight: '#FFA726',
  narrow_road: '#FF7043',
  narrow_road_severe: '#BF360C',
  traffic_school: '#FDD835',
  traffic_school_peak: '#FDD835',
  traffic_general: '#E53935',
  traffic_highway: '#6D4C41',
  traffic_market: '#FB8C00',
  traffic_pnm: '#43A047',
  traffic_nightmarket: '#8E24AA',
  construction: '#D32F2F',
}
export const NARROW_ROAD_COLOR = CONSTRAINT_COLORS.narrow_road
export const TRAFFIC_AREA_COLOR = CONSTRAINT_COLORS.traffic_general

export function roadConstraintColor(type, severity, styleConfig) {
  const key = type === 'narrow_road' && ['slight', 'severe'].includes(severity)
    ? `narrow_road_${severity}` : type === 'traffic_area' ? 'traffic_general' : type
  return styleConfig?.[key]?.color || CONSTRAINT_COLORS[key] || NARROW_ROAD_COLOR
}
