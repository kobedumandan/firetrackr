export const PANABO_BOUNDARY_COLOR = '#ff5a1f'
export const BARANGAY_BOUNDARY_COLOR = '#ff8a4c'
export const BARANGAY_FILL_COLOR = 'rgba(255, 138, 76, 0.08)'
export const NARROW_ROAD_COLOR = '#ff6600'
export const TRAFFIC_AREA_COLOR = '#ffff00'

export function roadConstraintColor(type) {
  return type === 'traffic_area' || type === 'traffic_general' ? TRAFFIC_AREA_COLOR : NARROW_ROAD_COLOR
}
