import { isFireOperation } from './incidentOperations'

const severityLabel = value => value ? `${value.replace(/\s+severity$/i, '').trim()} Severity` : ''
const alarmLabel = value => /^(1st|2nd|3rd|General) Alarm$/.test(value?.trim()) ? value.trim() : ''
const titleCase = value => value.toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase())

export function offlineAlertContent(tracker) {
  const name = tracker.name?.trim() || `Personnel ${tracker.per_id}`
  const minutes = Number.isFinite(tracker.age_minutes) ? Math.max(1, Math.round(tracker.age_minutes)) : null
  return {
    title: `${titleCase(name)} Tracker Offline`,
    body: minutes == null ? 'No new GPS locations received'
      : `No new GPS locations received for ${minutes} minute${minutes === 1 ? '' : 's'}`,
  }
}

export function incidentAlertDescription(incident) {
  return [
    severityLabel(incident?.sev),
    isFireOperation(incident) && alarmLabel(incident?.alarm),
  ].filter(Boolean).join(' | ')
}

export function onSceneAlertContent(arrival, location) {
  const name = arrival.personnel_name?.trim()
    || (arrival.per_id != null ? `Personnel #${arrival.per_id}` : arrival.team_name?.trim() || 'Unit')
  const role = (arrival.member_role?.trim() || (arrival.personnel_name || arrival.per_id != null ? 'Personnel' : 'Unit'))
    .replace(/[_-]+/g, ' ').toLowerCase().replace(/\b[a-z]/g, letter => letter.toUpperCase())
  return { title: `${role} On Scene`, body: `${name} | Arrived at ${location || 'Unknown Location'}` }
}

function legacyOnSceneAlert(notification) {
  if (notification.kind !== 'onScene' || notification.body?.includes(' | Arrived at ')) return null
  const title = notification.title?.match(/^(?:(Team leader) )?(.+) on scene$/i)
  if (!title) return null
  const location = notification.body?.match(/(?:^| · )Arrived at (.+)$/)?.[1]
  const personnel = title[1] || notification.body?.includes(' · ') || notification.body === 'Personnel arrival confirmed.'
  return onSceneAlertContent({
    member_role: title[1] || (personnel ? 'Personnel' : 'Unit'),
    personnel_name: title[2],
  }, location)
}

const WORKFLOW_ALERTS = {
  suppression_start: {
    title: 'Suppression Started', detail: 'Suppression start time recorded',
    legacy: 'Suppression start time recorded.',
  },
  fire_out: {
    title: 'Fire Out', detail: 'Awaiting team release authorization and clearance',
    legacy: 'Fire Out recorded. Team release still requires authorization and clearance.',
  },
  release_authorized: {
    title: 'Release Authorized', detail: 'Awaiting leader confirmation',
    legacy: 'Team release authorized. Awaiting actual clearance.',
  },
  team_cleared: {
    title: 'Team Cleared', detail: 'Returning to station',
    legacy: 'Team cleared the scene. Assigned trucks are returning.',
  },
  truck_ready: {
    title: 'Truck Ready', detail: 'Ready and On Standby',
    legacy: 'Truck return and readiness confirmed.',
  },
  truck_not_ready: {
    title: 'Truck Not Ready', detail: 'Unavailable for dispatch',
    legacy: 'Truck returned and is not ready for dispatch.',
  },
  operation_complete: {
    title: 'Operation Complete', detail: 'Awaiting incident report review',
    legacy: 'Operation complete. Awaiting incident report review.',
  },
  incident_closed: {
    title: 'Incident Closed', detail: 'Incident report reviewed',
    legacy: 'Incident report reviewed. Incident closed.',
  },
  report_corrected: {
    title: 'Report Corrected', detail: 'Dispatcher review required',
    legacy: 'Incident report corrected. Dispatcher review is required.',
  },
  report_reviewed: {
    title: 'Report Reviewed', detail: 'Corrected incident report reviewed',
    legacy: 'Corrected incident report reviewed.',
  },
}

const WORKFLOW_TITLES = new Map(Object.entries(WORKFLOW_ALERTS).map(([kind, content]) => [content.title, kind]))
const LEGACY_WORKFLOW_KINDS = new Map(Object.entries(WORKFLOW_ALERTS).map(([kind, content]) => [content.legacy, kind]))

export function notificationWorkflowKind(notification) {
  if (notification.kind !== 'workflow') return null
  return LEGACY_WORKFLOW_KINDS.get(notification.body) || WORKFLOW_TITLES.get(notification.title) || null
}

export function workflowAlertContent(event) {
  const content = WORKFLOW_ALERTS[event.kind]
  if (!content) return null
  const context = event.team_name?.trim() || event.incident?.loc?.trim()
  return { title: content.title, body: [context, content.detail].filter(Boolean).join(' | ') }
}

function workflowNotificationContent(notification) {
  const kind = notificationWorkflowKind(notification)
  if (!kind) return null
  const current = WORKFLOW_ALERTS[kind].title === notification.title
  const separator = notification.body?.lastIndexOf(' | ') ?? -1
  const context = current
    ? separator >= 0 ? notification.body.slice(0, separator) : ''
    : /^response update$/i.test(notification.title || '') ? '' : notification.title
  return workflowAlertContent({ kind, team_name: context })
}

export function notificationTitle(notification) {
  if (notification.kind === 'deviceOffline') return notification.tracker
    ? offlineAlertContent(notification.tracker).title : titleCase(notification.title || 'Tracking offline')
  return legacyOnSceneAlert(notification)?.title || workflowNotificationContent(notification)?.title || notification.title
}

export function notificationDescription(notification) {
  if (notification.kind === 'deviceOffline') {
    if (notification.tracker) return offlineAlertContent(notification.tracker).body
    const minutes = notification.body?.match(/^No location for (\d+(?:\.\d+)?) min$/)?.[1]
    return minutes ? offlineAlertContent({ age_minutes: Number(minutes) }).body : notification.body || ''
  }
  if (notification.kind === 'onScene') return legacyOnSceneAlert(notification)?.body || notification.body || ''
  if (notification.kind === 'workflow') return workflowNotificationContent(notification)?.body || notification.body || ''
  if (notification.kind !== 'newIncident') return notification.body || ''
  if (notification.incident) return incidentAlertDescription(notification.incident)

  // Alerts retained across a hot update can predate the incident snapshot.
  // Normalize their old severity/alarm summary without changing other messages.
  const legacy = notification.body?.match(/^\s*(Minor|Moderate|Critical)(?:\s+Severity)?(?:\s*[·|]\s*(.*))?\s*$/i)
  if (!legacy) return notification.body || ''
  return [severityLabel(legacy[1]), alarmLabel(legacy[2])].filter(Boolean).join(' | ')
}
