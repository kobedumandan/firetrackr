import { dateTime, duration } from './operationalTimes'
import { isFireOperation } from './incidentOperations'
import { isDateOnly } from './incidentDate'

const known = value => value != null && !['', '-', '—', 'not recorded', 'unknown', 'unspecified', 'not applicable'].includes(String(value).trim().toLowerCase())
const sentenceValue = value => String(value).trim().replace(/[.!?]+$/, '')
const at = value => value && Number.isFinite(new Date(value).getTime()) ? dateTime(value) : null
const count = (number, singular, plural = `${singular}s`) => `${number} ${number === 1 ? singular : plural}`
const statusLabel = status => ({ pending: 'Pending', active: 'Responding', dispatched: 'Dispatched', responding: 'Responding', contained: 'Under Control', closed: 'Closed', cancelled: 'Cancelled', canceled: 'Cancelled', recalled: 'Recalled', en_route: 'En Route', on_scene: 'On Scene', completed: 'Completed' }[status] || status || '-')

export function describeIncidentSummary(incident, report) {
  const closed = incident.status === 'closed'
  const id = incident.id || `INC-${incident.fire_id}`
  const type = known(incident.dispatch_type) ? sentenceValue(incident.dispatch_type) : null
  const source = known(incident.reporter) ? sentenceValue(incident.reporter) : null
  const severity = known(incident.sev) ? sentenceValue(incident.sev) : null
  const address = known(incident.addr) ? sentenceValue(incident.addr) : null
  const area = incident.barangay_name || incident.barangay || incident.loc
  const location = [address, known(area) && (!address || !address.toLowerCase().includes(String(area).trim().toLowerCase())) ? sentenceValue(area) : null].filter(Boolean).join(', ')
  const introduction = [
    `${id} ${closed ? 'is documented in this final report with a recorded status of' : 'has a current status of'} ${statusLabel(incident.status)}.`,
    type ? `The incident ${closed ? 'was classified under' : 'is classified under'} ${type}.` : 'The response type has not yet been recorded.',
    source ? `The incident was reported via ${source}.` : 'The reporting source has not been recorded.',
    severity ? `The recorded severity ${closed ? 'was' : 'is'} ${severity}.` : 'The severity assessment has not been recorded.',
    location ? `The recorded incident location ${closed ? 'was' : 'is'} ${location}.` : 'An incident address or area has not been recorded.',
    isFireOperation(incident) && known(incident.structure) ? `The structure involved ${closed ? 'was' : 'is'} recorded as ${sentenceValue(incident.structure)}.` : '',
  ].filter(Boolean).join(' ')
  const casualty = incident.casualties
  const casualtySentence = !known(casualty) || /^unconfirmed$/i.test(String(casualty).trim())
    ? `Casualty information ${closed ? 'remained unconfirmed in the available record' : 'remains unconfirmed'}.`
    : /^(none|0|no casualties)$/i.test(String(casualty).trim())
      ? 'The incident record reports no casualties.' : `The incident record lists the casualty information as: ${sentenceValue(casualty)}.`
  const explanation = [
    isDateOnly(incident.reported_at) ? `The recorded incident date was ${at(incident.reported_at)}.` : at(incident.reported_at) ? `The recorded report time was ${at(incident.reported_at)} (Philippine time).` : 'The report time has not been recorded.',
    isFireOperation(incident) && known(incident.alarm) ? `The ${closed ? 'recorded alarm level was' : 'current alarm level is'} ${sentenceValue(incident.alarm)}.` : '',
    casualtySentence,
    known(report?.casualties) && String(report.casualties).trim() !== String(casualty || '').trim() ? `The overall incident report separately states: ${sentenceValue(report.casualties)}.` : '',
    at(incident.operation_completed_at) ? `Operation completion was recorded at ${at(incident.operation_completed_at)}.` : '',
    closed && at(report?.closed_at || incident.closed_at) ? `Administrative closure was recorded at ${at(report?.closed_at || incident.closed_at)}.` : '',
    closed ? 'This account reflects the records available for the closed incident.' : 'This interim account reflects the information available at export and may change as teams submit further reports.',
  ].filter(Boolean).join(' ')
  return { introduction, explanation }
}

export function describeRespondingTeam(unit) {
  const name = unit.team_name || unit.team || `Dispatch ${unit.dispatch_id}`
  const trucks = unit.truck_platenums || []
  return {
    introduction: [
      `${name}${known(unit.station_name) ? ` from ${sentenceValue(unit.station_name)}` : ''} is listed under DISP-${unit.dispatch_id}.`,
      `The recorded assignment status is ${statusLabel(unit.dispatch_status)}.`,
      trucks.length ? `The assigned ${trucks.length === 1 ? 'vehicle is' : 'vehicles are'} ${trucks.join(', ')}.` : 'No vehicle identification is recorded for this assignment.',
    ].join(' '),
    explanation: [
      at(unit.dispatch_at) ? `Dispatch was recorded at ${at(unit.dispatch_at)}.` : 'A dispatch time has not been recorded.',
      at(unit.arrived_at) ? `Arrival was recorded at ${at(unit.arrived_at)}.` : 'Arrival has not been recorded for this assignment.',
      at(unit.cleared_at) ? `Clearance was recorded at ${at(unit.cleared_at)}.` : 'Clearance has not been recorded for this assignment.',
      `The roster below lists ${count(unit.members?.length || 0, 'crew member')} from the available assignment data; it does not independently verify each person’s arrival.`,
    ].join(' '),
  }
}

export function describeReportSection(title, group, rows, { incident, dispatches, fieldReports, report, analysis }) {
  const values = Object.fromEntries(rows)
  if (group === 'summary') return describeIncidentSummary(incident, report)
  if (group === 'units') {
    const arrived = dispatches.filter(unit => at(unit.arrived_at)).length
    const cleared = dispatches.filter(unit => at(unit.cleared_at)).length
    return {
      introduction: `${incident.id || `INC-${incident.fire_id}`} has ${count(dispatches.length, 'recorded response assignment')}. The team blocks below identify each assignment, its station and vehicles, followed by the listed crew and team roles.`,
      explanation: `${count(arrived, 'assignment')} ${arrived === 1 ? 'has' : 'have'} a recorded arrival and ${count(cleared, 'assignment')} ${cleared === 1 ? 'has' : 'have'} recorded clearance. These counts describe available milestones; assignments without those records are not assumed to have arrived or cleared.`,
    }
  }
  if (group === 'unitReports') return {
    introduction: values['Report status'] === 'Not yet submitted'
      ? `${title} has no field submission available at the time of export. Its report status is Not yet submitted; findings and recommendations cannot be summarized from an absent report.`
      : `${values.Report || 'This field report'} was submitted${known(values.Author) ? ` by ${sentenceValue(values.Author)}` : ''}${values['Submitted at'] !== '-' ? ` at ${values['Submitted at']}` : ', with no submission time recorded'}. ${title.includes('attribution unavailable') ? 'Its responding team has not been verified.' : `It is associated with ${title.split(' / ').slice(1).join(' / ')}.`}`,
    explanation: values['Report status'] === 'Not yet submitted' ? 'The missing submission remains visible in this report. It does not establish that the team had no findings or that its report has been reviewed.'
      : `The field account records ${known(values.Casualties) ? `the casualty observation as ${sentenceValue(values.Casualties)}` : 'no casualty observation'}. ${known(values.Recommendations) ? 'Recommendations are included below the narrative for follow-up review.' : 'No recommendations were recorded in this submission.'} Findings are retained under their original author and are not added together as casualty totals.`,
  }
  if (title === 'Fire operation times') return {
    introduction: `The available fire-operation milestones for ${incident.id || `INC-${incident.fire_id}`} are shown below. ${values['Suppression started'] !== '-' ? `Suppression began at the recorded time of ${values['Suppression started']}.` : 'A suppression-start time has not been recorded.'}`,
    explanation: `${values['Fire out'] !== '-' ? `Fire out was recorded at ${values['Fire out']}.` : 'A fire-out time is not available in the report.'} ${values['Suppression duration'] !== '-' ? `The recorded suppression duration is ${values['Suppression duration']}.` : 'A suppression duration cannot be stated from the available milestones.'} Operational milestones remain separate from administrative closure.`,
  }
  if (group === 'overallReport') return {
    introduction: report ? `The overall report for ${incident.id || `INC-${incident.fire_id}`} is ${values.Report}, attributed to ${values.Author}. Its review status is ${values['Report status']}. The narrative below contains the consolidated account recorded for this incident.`
      : `No overall incident report has been submitted for ${incident.id || `INC-${incident.fire_id}`} in the available record. The section is retained so that the missing consolidated account is visible in this ${incident.status === 'closed' ? 'final' : 'interim'} export.`,
    explanation: `${count(fieldReports.length, 'field submission')} ${fieldReports.length === 1 ? 'is' : 'are'} available separately in this incident record. ${report?.reviewed_at ? `Review of the overall report was recorded at ${at(report.reviewed_at) || '-'}.` : 'No completed review of the overall report is recorded.'} ${report ? 'Its findings should be read alongside the attributed field submissions.' : 'No consolidated findings are inferred from the missing report.'}`,
  }
  if (title === 'Response milestone history') return {
    introduction: `The incident history contains ${count(analysis?.events?.length || 0, 'recorded event')}. Each entry below retains its available occurrence time, source and verification indicator, with a dispatch reference where recorded.`,
    explanation: `${count(analysis?.events?.filter(event => event.verified).length || 0, 'event')} ${analysis?.events?.filter(event => event.verified).length === 1 ? 'is' : 'are'} marked verified in the available history. Unverified entries remain identified as such and are not treated as confirmed observations.`,
  }
  if (title.startsWith('Unit response analysis')) return {
    introduction: `${title.split(' / ').slice(1).join(' / ')} is associated with ${values.Dispatch}. ${values.Travel !== '-' ? `The recorded travel duration is ${values.Travel}.` : 'A measured travel duration is not available.'} ${values['Call-to-arrival'] !== '-' ? `Call-to-arrival is recorded as ${values['Call-to-arrival']}.` : 'Call-to-arrival is not available for this unit.'}`,
    explanation: values['Actual minus planned travel'] === 'Not comparable' ? `The actual and planned travel times are not comparable for this unit. ${known(values['Comparison note']) ? sentenceValue(values['Comparison note']) + '.' : 'A valid comparison requires a compatible recorded departure context.'}`
      : `The recorded actual-minus-planned travel difference is ${values['Actual minus planned travel']}. Positive values indicate travel took longer than planned, while negative values indicate it took less time. This comparison does not establish the cause of any difference.`,
  }
  const demo = analysis?.timing_basis === 'synthetic_demo'
  return {
    introduction: `${demo ? 'This section uses synthetic demonstration timing rather than measured response times.' : 'This section summarizes the incident’s first response. Preparation and travel use the first-arriving truck’s recorded times, rather than averages across responding units. Report processing measures report receipt to that truck’s dispatch; suppression is measured once for the whole incident. The analytics dashboard separately averages valid per-truck preparation and travel times.'} ${Number.isFinite(analysis?.durations?.cta) ? `Call-to-arrival is ${duration(analysis.durations.cta)}.` : 'Call-to-arrival cannot be calculated from the available milestones.'} ${Number.isFinite(analysis?.durations?.operation) ? `The overall operational interval is ${duration(analysis.durations.operation)}.` : 'The overall operational interval is not available.'}`,
    explanation: `${incident.status === 'closed' ? 'These values reflect the closed incident records available at export.' : 'These values are preliminary because the incident remains open.'} ${count(analysis?.units?.length || 0, 'vehicle record')} ${analysis?.units?.length === 1 ? 'is' : 'are'} available for unit-level analysis. Missing durations remain a dash, and unavailable values are not treated as zero.`,
  }
}
