const ACTIVE_DISPATCH_STATUSES = new Set(['dispatched', 'en_route', 'on_scene']);

export function isClearedDispatch(dispatch) {
  // The clearance event confirms release before a reload supplies its timestamp.
  return Boolean(dispatch?.cleared_at || dispatch?.clearance_confirmed);
}

export function isActiveDispatch(dispatch) {
  return ACTIVE_DISPATCH_STATUSES.has(dispatch?.dispatch_status) && !isClearedDispatch(dispatch);
}

// A known operation type takes precedence over a legacy response classification.
// Unclassified incidents use neutral language until a fire response is confirmed.
export function isFireOperation(incident) {
  if (incident?.effective_response_kind) return incident.effective_response_kind === 'fire';
  const type = (incident?.dispatch_type || incident?.fire_dispatch_type || incident?.incident_record?.dispatch_type || '').trim();
  if (type) return type === 'Firefighting Operations';
  return (incident?.response_kind || incident?.operational_timing?.response_kind) === 'fire';
}

const FIRE_CONTROL = {
  label: 'Fire Contained',
  action: 'Mark Fire as Contained',
  message: 'Confirm the fire is under control. Your team may still need to remain on scene. Dispatchers will be notified.',
  notice: 'Fire marked contained. Crews remain on scene until cleared.',
};
const SITUATION_CONTROL = {
  label: 'Situation Under Control',
  action: 'Mark Situation Under Control',
  message: 'Confirm the situation is under control. Your team may still need to remain on scene. Dispatchers will be notified.',
  notice: 'Situation marked under control. Crews remain on scene until cleared.',
};

export function incidentControl(incident) {
  return isFireOperation(incident) ? FIRE_CONTROL : SITUATION_CONTROL;
}

export function incidentStage(incident) {
  const status = incident?.status || incident?.fire_status || 'pending';
  if (['closed', 'cancelled', 'canceled', 'recalled'].includes(status)) return status;
  if (incident?.lifecycle_stage) return incident.lifecycle_stage;
  if (incident?.operation_completed_at) return 'operation_complete';
  return { active: 'responding', dispatched: 'responding', contained: 'under_control' }[status] || status;
}

export function incidentStatusLabel(status, incident) {
  const stage = incidentStage(incident || { status });
  if (stage === 'under_control') return incidentControl(incident).label;
  return { pending: 'Pending', responding: 'Responding', operation_complete: 'Operation Complete', closed: 'Closed', cancelled: 'Cancelled', canceled: 'Cancelled', recalled: 'Recalled' }[stage]
    || stage || 'Not recorded';
}

export function incidentStatusBadgeLabel(status, incident) {
  const label = incidentStatusLabel(status, incident);
  return label === SITUATION_CONTROL.label ? 'Under Control' : label;
}
