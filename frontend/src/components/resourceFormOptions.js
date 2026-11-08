// Option lists, validators and icons shared by the personnel / team / truck
// add and edit modals.

export const TRUCK_STATUSES = [
  { value: 'available',   label: 'Available',   tone: 'green', hint: 'Ready to be assigned to a dispatch.' },
  { value: 'dispatched',  label: 'Dispatched',  tone: 'amber', hint: 'Out on a dispatch right now.' },
  { value: 'on_scene',    label: 'On Scene',    tone: 'amber', hint: 'Assigned to an operation on scene.' },
  { value: 'returning',   label: 'Returning',   tone: 'amber', hint: 'Awaiting confirmed physical return and readiness.' },
  { value: 'maintenance', label: 'Maintenance', tone: 'amber', hint: 'In the shop. Not dispatchable until it\'s back.' },
  { value: 'unavailable', label: 'Unavailable', tone: 'fire',  hint: 'Out of service. Not dispatchable.' },
]

export const TEAM_STATUSES = [
  { value: 'standby',    label: 'Standby',    tone: 'green', hint: 'Ready to be dispatched.' },
  { value: 'dispatched', label: 'Dispatched', tone: 'amber', hint: 'Out on a dispatch right now.' },
  { value: 'on_scene',   label: 'On Scene',   tone: 'amber', hint: 'Assigned to an operation on scene.' },
  { value: 'returning',  label: 'Returning',  tone: 'amber', hint: 'Awaiting truck return and readiness.' },
  { value: 'inactive',   label: 'Inactive',   tone: 'fire',  hint: 'Not taking dispatches.' },
]

export const RANKS = [
  'Fire Officer I',
  'Fire Officer II',
  'Fire Officer III',
  'Senior Fire Officer',
  'Fire Inspector',
]

export const DESIGNATIONS = [
  'Station Commander',
  'Deputy Station Commander',
  'Chief of Operations',
  'Administrative Officer',
  'Suppression Personnel',
  'Driver / Operator',
  'Rescue Personnel',
  'Investigation Officer',
  'Training Officer',
]

export const MEMBER_ROLES = ['Team Leader', 'Firefighter', 'Driver', 'Medical Officer', 'Communications Officer']

export const statusMeta = (list, value) => list.find(s => s.value === value) || list[0]

// Philippine mobile or landline; spaces and dashes allowed. '' is valid (optional).
export function phoneError(value) {
  const v = value.trim()
  if (!v) return null
  if (/[a-zA-Z]/.test(v)) return 'Numbers only.'
  const digits = v.replace(/[\s-]/g, '')
  if (!/^(\+639\d{9}|09\d{9}|(\+63|0)\d{1,2}\d{7,8})$/.test(digits)) {
    return 'Use a PH number, e.g. 0917 000 0000 or +63 917 000 0000.'
  }
  return null
}

export function emailError(value) {
  const v = value.trim()
  if (!v) return null
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'That doesn\'t look like an email address.'
}

// Password + confirmation. Both empty is valid when the password is optional.
export function passwordErrors(password, confirm, { required }) {
  if (!required && !password && !confirm) return {}
  return {
    password: password.length > 0 && password.length < 8 ? 'At least 8 characters.' : null,
    confirm: confirm.length > 0 && confirm !== password ? 'Doesn\'t match the password.' : null,
  }
}

export const ICON_EYE     = 'M607.5-372.5Q660-425 660-500t-52.5-127.5Q555-680 480-680t-127.5 52.5Q300-575 300-500t52.5 127.5Q405-320 480-320t127.5-52.5Zm-204-51Q372-455 372-500t31.5-76.5Q435-608 480-608t76.5 31.5Q588-545 588-500t-31.5 76.5Q525-392 480-392t-76.5-31.5ZM214-281.5Q94-363 40-500q54-137 174-218.5T480-800q146 0 266 81.5T920-500q-54 137-174 218.5T480-200q-146 0-266-81.5ZM480-500Zm207.5 160.5Q782-399 832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280q113 0 207.5-59.5Z'
export const ICON_EYE_OFF = 'm644-428-58-58q9-47-27-88t-93-32l-58-58q17-8 34.5-12t37.5-4q75 0 127.5 52.5T660-500q0 20-4 37.5T644-428Zm128 126-58-56q38-29 67.5-63.5T832-500q-50-101-143.5-160.5T480-720q-29 0-57 4t-55 12l-62-62q41-17 84-25.5t90-8.5q151 0 269 83.5T920-500q-23 59-60.5 109.5T772-302Zm20 246L624-222q-35 11-70.5 16.5T480-200q-151 0-269-83.5T40-500q21-53 53-98.5t73-81.5L56-792l56-56 736 736-56 56ZM222-624q-29 26-53 57t-41 67q50 101 143.5 160.5T480-280q20 0 39-2.5t39-5.5l-36-38q-11 3-21 4.5t-21 1.5q-75 0-127.5-52.5T300-500q0-11 1.5-21t4.5-21l-84-82Zm319 93Zm-151 75Z'
export const ICON_KEY     = 'M280-400q-33 0-56.5-23.5T200-480q0-33 23.5-56.5T280-560q33 0 56.5 23.5T360-480q0 33-23.5 56.5T280-400Zm0 160q-100 0-170-70T40-480q0-100 70-170t170-70q67 0 121.5 33t86.5 87h352l120 120-180 180-80-60-80 60-85-60h-47q-32 54-86.5 87T280-240Zm0-80q56 0 98.5-34t56.5-86h125l58 41 82-61 71 55 75-75-40-40H435q-14-52-56.5-86T280-640q-66 0-113 47t-47 113q0 66 47 113t113 47Z'

// Trucks a team can take: at its station, and not already held by another team
// on the same shift (a truck can be shared across shifts, not within one).
export function assignableTrucks(trucks, teams, { stationId, shiftId, selfTeamId = null }) {
  if (stationId == null) return []
  const taken = new Set(
    teams
      .filter(t => t.team_id !== selfTeamId && t.truck_id != null && shiftId != null && t.shift_id === shiftId)
      .map(t => t.truck_id)
  )
  return trucks.filter(t => t.station_id === stationId && !taken.has(t.truck_id))
}

export const STATION_TYPES = [
  { value: 'main', label: 'Main station' },
  { value: 'sub',  label: 'Sub-station' },
]

export const STATION_STATUSES = [
  { value: 'operational', label: 'Operational', tone: 'green', hint: 'In service. Counts toward coverage, and its teams can be auto-dispatched.' },
  { value: 'inactive',    label: 'Inactive',    tone: 'fire',  hint: 'Out of service. Left out of coverage, and its teams aren\'t auto-dispatched or recommended. You can still dispatch them by hand.' },
]
