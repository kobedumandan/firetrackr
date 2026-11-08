import { dateTime } from './operationalTimes'

const ACTIONS = {
  status: 'Incident Status Updated', alarm: 'Alarm Level Updated', severity: 'Severity Assessment Updated',
  op_receipt: 'Incident Report Received', op_acknowledgement: 'Dispatch Acknowledged',
  op_dispatch_departure: 'Team Departed', op_departure: 'Vehicle Departed', op_arrival: 'Vehicle Arrived',
  op_suppression_start: 'Suppression Started', op_fire_control: 'Fire Contained', op_fire_out: 'Fire Out Confirmed',
  op_classification: 'Response Classification Recorded', op_clearance: 'Team Cleared',
  op_release_authorized: 'Team Release Authorized', op_truck_ready: 'Truck Readiness Confirmed',
  op_truck_not_ready: 'Truck Marked Not Ready', op_operation_complete: 'Operation Completed',
  operation_completed: 'Operation Completed', report_reviewed: 'Incident Report Reviewed',
  incident_created: 'Incident Recorded', incident_closed: 'Incident Closed',
  status_changed: 'Incident Status Updated', report_submitted: 'Incident Report Submitted',
}
const SOURCES = {
  manual: 'Manual Entry', mobile_action: 'Personnel Mobile App', personnel_confirmation: 'Personnel Confirmation',
  gps_geofence: 'Automatic GPS Detection', dispatcher_radio_instruction: 'Dispatcher Radio Instruction',
  dispatcher_radio_confirmation: 'Dispatcher Radio Confirmation', leader_confirmation: 'Team Leader Confirmation',
  driver_confirmation: 'Driver Confirmation', dispatcher_confirmation: 'Dispatcher Confirmation',
  dispatcher_review: 'Dispatcher Review', routing: 'Routing System', system: 'System',
  historical_import: 'Historical Record Import', manned_mobile: 'Driver Mobile App',
}
const humanize = value => String(value || '').replace(/^op_/, '').replace(/[_-]+/g, ' ').replace(/\b[a-z]/g, letter => letter.toUpperCase()) || '-'

export function milestoneTable(events, dispatches = []) {
  return events.map(event => {
    const team = dispatches.find(dispatch => dispatch.dispatch_id === event.dispatch_id)
    const teamName = team?.team_name || team?.team
    const action = ACTIONS[event.type] || humanize(event.type)
    const method = event.source ? SOURCES[event.source] || humanize(event.source) : ''
    return [
      `${action}${teamName ? ` — ${teamName}` : event.dispatch_id != null ? ` — Dispatch ${event.dispatch_id}` : ''}${event.verified === false ? ' (Unverified)' : ''}${event.correction ? ' (Corrected)' : ''}`,
      event.at && Number.isFinite(new Date(event.at).getTime()) ? dateTime(event.at) : '-',
      [event.actor || '', method].filter(Boolean).join(' — ') || '-',
    ]
  })
}
