import { dateTime, duration, ALL_METRICS } from './operationalTimes'
import { incidentControl, isFireOperation } from './incidentOperations'
import { describeReportSection, describeRespondingTeam } from './incidentReportNarratives'
import { buildStageBreakdown } from './reportAnalysisLayout'
import { milestoneTable } from './reportMilestones'

const missing = value => value == null || ['', '—', '-', 'not recorded'].includes(String(value).trim().toLowerCase()) ? '-' : String(value)
const time = value => value && Number.isFinite(new Date(value).getTime()) ? dateTime(value) : '-'

// A document model keeps report attribution and missing-data rules separate from PDF layout.
export function buildIncidentReport({ incident, dispatches, fieldReports = [], report, analysis = null, generatedAt = new Date() }, options = {}) {
  const closed = incident.status === 'closed'
  const sections = []
  let group = 'summary'
  const add = (title, rows) => {
    const normalized = rows.map(([label, value]) => [label, missing(value)])
    const section = { title, group, ...describeReportSection(title, group, normalized, { incident, dispatches, fieldReports, report, analysis }), rows: normalized }
    if (group === 'unitReports') section.blockHeader = normalized.find(([label]) => label === 'Author')?.[1] || 'Awaiting Team Report'
    sections.push(section)
    return section
  }
  add('Incident summary', [
    ['Incident', incident.id || `INC-${incident.fire_id}`], ['Status', incident.status],
    ['Location', incident.loc], ['Address', incident.addr], ['Barangay / area', incident.barangay_name || incident.barangay || incident.loc],
    ['Coordinates', incident.latitude != null && incident.longitude != null ? `${incident.latitude}, ${incident.longitude}` : null],
    ['Dispatch type', incident.dispatch_type],
    ['Structure type', incident.structure], ['Severity', incident.sev], ['Alarm level', incident.alarm],
    ['Reported via', incident.reporter], [incident.occurrence_precision === 'date_only' ? 'Incident date' : 'Reported at', time(incident.reported_at)],
    ...(incident.data_source ? [['Data source', `${incident.data_source} · ${incident.source_record_id}`]] : []),
    ['Casualties', incident.casualties], ['Operation completed', time(incident.operation_completed_at)],
    ['Closed at', time(report?.closed_at || incident.closed_at)], ['Remarks', incident.remarks],
  ])
  const reportRows = item => [
    ['Report', `#${item.report_id}${item.revision != null ? ` / Revision ${item.revision}` : ''}`],
    ['Author', [item.author_rank, item.author].filter(Boolean).join(' ') || 'Unknown author'],
    ['Submitted at', time(item.submitted_at)], ['Reviewed at', time(item.reviewed_at)],
    ['Reported cause', item.cause], ['Casualties', item.casualties], ['Damage estimate', item.damage_estimate],
    ['Narrative', item.narrative], ['Recommendations', item.recommendations],
    ['Scene photos', `${item.photos?.length || 0} recorded; available in the incident details page`],
  ]
  group = 'units'
  const responding = add('Responding units', [])
  responding.teams = dispatches.map(unit => ({
    title: unit.team_name || unit.team || `Dispatch ${unit.dispatch_id}`,
    reference: `DISP-${unit.dispatch_id}`,
    ...describeRespondingTeam(unit),
    rows: [
      ['Station', unit.station_name], ['Status', unit.dispatch_status], ['Trucks', unit.truck_platenums?.join(', ')],
      ['Dispatched', time(unit.dispatch_at)], ['Arrived', time(unit.arrived_at)], ['Cleared', time(unit.cleared_at)],
    ].map(([label, value]) => [label, missing(value)]),
    crew: (unit.members || []).map(member => ({
      name: missing([member.rank, member.name].filter(Boolean).join(' ')),
      role: missing(member.member_role),
    })),
  }))
  for (const unit of dispatches) {
    const reports = fieldReports.filter(item => item.dispatch_id === unit.dispatch_id)
    group = 'unitReports'
    if (!reports.length) add(`Unit report / DISP-${unit.dispatch_id}`, [['Report status', 'Not yet submitted']])
    reports.forEach(item => add(`Unit report / DISP-${unit.dispatch_id}`, reportRows(item)))
    group = 'units'
  }
  // Preserve legacy reports without guessing which responding team authored them.
  group = 'unitReports'
  fieldReports.filter(item => !dispatches.some(unit => unit.dispatch_id === item.dispatch_id))
    .forEach(item => add(`Field report / ${item.dispatch_id != null ? `DISP-${item.dispatch_id}` : 'Unit attribution unavailable'}`, reportRows(item)))
  const reportBlocks = sections.filter(section => section.group === 'unitReports')
  reportBlocks.forEach(block => {
    const dispatchId = Number(/DISP-(\d+)/.exec(block.title)?.[1])
    const team = dispatches.find(unit => unit.dispatch_id === dispatchId)
    const teamName = team?.team_name || team?.team || (Number.isFinite(dispatchId) ? `Dispatch ${dispatchId}` : 'Team Attribution Unavailable')
    block.blockHeader = block.rows.some(([label, value]) => label === 'Report status' && value === 'Not yet submitted')
      ? `Awaiting Team Report — ${teamName}` : `${block.blockHeader} — ${teamName}`
  })
  const firstReportIndex = sections.findIndex(section => section.group === 'unitReports')
  if (firstReportIndex >= 0) sections.splice(firstReportIndex, reportBlocks.length)
  const groupedReports = add('Unit reports', [])
  groupedReports.reportBlocks = reportBlocks
  delete groupedReports.blockHeader
  const submitted = reportBlocks.filter(block => !block.rows.some(([label, value]) => label === 'Report status' && value === 'Not yet submitted')).length
  groupedReports.introduction = `${fieldReports.length} field ${fieldReports.length === 1 ? 'submission is' : 'submissions are'} available across ${dispatches.length} assigned ${dispatches.length === 1 ? 'team' : 'teams'}. Each team’s report appears below in its own block, headed by its recorded author or its awaiting-report status.`
  groupedReports.explanation = `${submitted} submitted report ${submitted === 1 ? 'block is' : 'blocks are'} included. Missing team reports remain identified by team name; submissions without a verified team association retain their original attribution separately.`
  group = 'overallReport'
  add('Overall incident report', report ? [
    ['Report status', closed && report.reviewed_at ? 'Reviewed' : 'Draft / pending review'], ...reportRows(report),
  ] : [['Report status', 'Not yet submitted']])
  const timing = report?.operational_timing
  if (timing && isFireOperation(incident)) add('Fire operation times', [
    ['Suppression started', time(timing.suppression_started_at)],
    [incidentControl(incident).label, time(timing.controlled_at)], ['Fire out', time(timing.fire_out_at)],
    ['Suppression duration', duration(timing.suppression_seconds, '-')],
  ])
  if (analysis) {
    group = 'analysis'
    const metricRows = values => ALL_METRICS.map(metric => [metric.label,
      metric.key === 'suppression' && !isFireOperation(incident) ? 'Not applicable' : duration(values?.[metric.key], '-')])
    const overview = add('Response analysis', metricRows(analysis.durations))
    overview.stageBreakdown = buildStageBreakdown(analysis.durations, isFireOperation(incident))
    for (const unit of analysis.units || []) {
      const section = add(`Unit response analysis / ${unit.team || 'Unit'} / ${unit.truck || unit.id}`, [
      ['Dispatch', `DISP-${unit.dispatch_id}`], ['Dispatched', time(unit.dispatch_at)],
      ['Departed', time(unit.departed_at)], ['Arrived', time(unit.arrived_at)], ['Cleared', time(unit.cleared_at)],
      ...metricRows(unit.durations).filter(([label]) => label !== 'Suppression'), ['Planned travel time', duration(unit.eta_seconds, '-')],
      ['Actual minus planned travel', unit.eta_comparable && Number.isFinite(unit.difference_seconds)
        ? `${unit.difference_seconds > 0 ? '+' : unit.difference_seconds < 0 ? '-' : ''}${duration(unit.difference_seconds)}` : 'Not comparable'],
      ['Comparison note', unit.eta_comparison_note],
    ])
      section.blockHeader = `${unit.team || 'Unit'} / ${unit.truck || unit.id}`
      section.stageBreakdown = buildStageBreakdown(unit.durations, isFireOperation(incident), true)
    }
    if (analysis.events?.length) {
      const history = add('Response milestone history', [])
      history.table = { columns: ['Action', 'Time', 'Source'], rows: milestoneTable(analysis.events, dispatches) }
    }
  }
  return {
    title: options.title?.trim() || `${closed ? 'Final' : 'Interim'} Incident Report`,
    classification: closed ? 'Final Incident Report' : 'Interim Incident Report',
    location: missing(incident.loc || incident.addr),
    status: incident.status,
    incidentId: incident.id || `INC-${incident.fire_id}`,
    generatedAt: time(generatedAt),
    sections: sections.filter(section => options[section.group] !== false),
    signatures: options.signatures || false,
    preparedBy: options.preparedBy?.trim() || '',
    notedBy: options.notedBy?.trim() || '',
  }
}

export function reportSectionContent(section) {
  const prose = new Set(['Narrative', 'Recommendations', 'Remarks', 'Crew', 'Comparison note'])
  return {
    facts: section.rows.filter(([label]) => !prose.has(label) && !(section.stageBreakdown && ['Report processing', 'Preparation', 'Travel', 'Suppression'].includes(label)) && !(section.blockHeader && label === 'Author')),
    paragraphs: section.rows.filter(([label]) => prose.has(label)),
  }
}
