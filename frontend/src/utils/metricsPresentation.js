import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { drawMonthlyChart, drawAlarmDonut, drawCauseBars, drawBarangayMap } from './metricsCharts'
import { DEFAULT_METRICS_OPTIONS } from './metricsExportOptions'

const INK = '#182333'
const MUTED = '#58677a'

export function rankBarangays(byBarangay = {}) {
  return Object.entries(byBarangay).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10)
}

// One immutable summary snapshot supplies both the preview and the downloaded PDF.
export function buildMetricsPresentation({ summary, period, generatedAt, barangays, breakdownPeriod = period.description }, suppliedOptions = {}) {
  const options = { ...DEFAULT_METRICS_OPTIONS, ...suppliedOptions }
  const FIRE = options.accent
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [720, 405] })
  const stamp = new Date(generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })
  pdf.setProperties({ title: `${options.title} - ${period.description}`, subject: 'Incident activity presentation', author: options.preparedBy || 'FireTrackr' })
  let started = false
  let tableBottom = 0
  function page(title, subtitle) {
    if (started) pdf.addPage()
    started = true
    tableBottom = 0
    pdf.setFillColor('#ffffff'); pdf.rect(0, 0, 720, 405, 'F')
    pdf.setFillColor(FIRE); pdf.rect(30, 27, 28, 3, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor(INK); pdf.setFontSize(23)
    pdf.text(pdf.splitTextToSize(title, 660).slice(0, 1), 30, 62)
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(MUTED); pdf.setFontSize(10)
    pdf.text(subtitle, 30, 82)
  }
  function note(text, y = 340) {
    pdf.setFont('helvetica', 'normal'); pdf.setTextColor(MUTED); pdf.setFontSize(9)
    pdf.text(pdf.splitTextToSize(text, 660), 30, y)
  }
  function tableNote(text) {
    const y = Math.max(340, tableBottom + 18)
    if (y > 350) { page('Record context', period.description); note(text, 120) }
    else note(text, y)
  }
  function table(rows, headers = ['Category', 'Incidents'], bars = true) {
    if (!rows.length) { note('No data available for this reporting period.', 140); return }
    const max = Math.max(1, ...rows.map(row => Number(row[1]) || 0))
    autoTable(pdf, {
      startY: 103, margin: { left: 30, right: 30, top: 35, bottom: 65 },
      head: [bars ? [...headers, 'Relative count'] : headers],
      body: rows.map(row => bars ? [...row, ''] : row),
      theme: 'plain', styles: { font: 'helvetica', fontSize: 10, cellPadding: 3, textColor: INK, overflow: 'linebreak' },
      headStyles: { fillColor: '#edf0f4', textColor: MUTED, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: '#f8f9fb' },
      columnStyles: bars ? { 0: { cellWidth: 365 }, 1: { cellWidth: 65, halign: 'right' }, 2: { cellWidth: 230 } } : {},
      didDrawCell: ({ section, column, row, cell }) => {
        if (!bars || section !== 'body' || column.index !== 2) return
        pdf.setFillColor(FIRE)
        const width = Number(rows[row.index][1]) / max * (cell.width - 16)
        if (width > 0) pdf.roundedRect(cell.x + 8, cell.y + cell.height / 2 - 2, width, 4, 2, 2, 'F')
      },
    })
    tableBottom = pdf.lastAutoTable.finalY
  }

  if (options.overview) {
  page(options.title || 'Incident activity overview', `${period.description} | Recorded metrics`)
  const response = summary.recorded_response_minutes
  const kpis = [
    ['Recorded incidents', summary.total ?? 0],
    ['Average response time', response == null ? 'Not available' : `${response.toFixed(1)} min`],
    ['Critical incidents', summary.total > 0 && summary.unknown_severity_count === summary.total ? 'Not recorded' : summary.severity?.Critical ?? 0],
    ['Contained / closed', summary.contained ?? 0],
  ]
  kpis.forEach(([label, value], index) => {
    const x = 30 + index % 2 * 340, y = 110 + Math.floor(index / 2) * 82
    pdf.setFillColor('#f3f5f8'); pdf.roundedRect(x, y, 320, 70, 6, 6, 'F')
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(MUTED); pdf.text(label, x + 14, y + 21)
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(24); pdf.setTextColor(INK); pdf.text(String(value), x + 14, y + 51)
  })
  note(`Response: verified report receipt to first eligible arrival; receipt-date cohort. Eligible measurements: ${summary.recorded_response_quality?.valid ?? 'not available'}.`, 286)
  note(`Record context: ${summary.historical_import_count ?? 0} historical imports; ${summary.synthetic_alarm_count ?? 0} assumed alarm levels; ${summary.approximate_location_count ?? 0} estimated locations; ${summary.unknown_severity_count ?? 0} unknown severities; ${summary.unresolved_barangay_count ?? 0} unresolved barangays.`, 310)
  }

  if (options.alarms) {
  const alarmRows = Object.entries(summary.alarm_levels ?? {})
  page('Alarm levels', `${breakdownPeriod} | One count per incident`)
  if (options.alarmDonut) drawAlarmDonut(pdf, alarmRows, options.values)
  else table(alarmRows)
  tableNote('Not recorded remains explicit. Imported records may include assumed alarm levels.')
  if (options.alarmDonut && options.dataTables) { page('Alarm levels - data', breakdownPeriod); table(alarmRows) }
  }

  if (options.monthly) {
  const monthly = summary.monthly ?? []
  for (let offset = 0; offset < Math.max(1, monthly.length); offset += 12) {
    page('Monthly incident activity', `${period.key === 'all' ? 'All recorded months' : 'Last 12 months'} | Occurrence date | Months ${monthly.length ? offset + 1 : 0}-${Math.min(offset + 12, monthly.length)} of ${monthly.length}`)
    const rows = monthly.slice(offset, offset + 12)
    if (options.lineChart) drawMonthlyChart(pdf, rows, FIRE, options.values)
    else table(rows.map(row => [row.month, row.count]), ['Month', 'Incidents'])
    tableNote('Monthly context is independent of shorter reporting-period filters.')
    if (options.lineChart && options.dataTables) { page('Monthly activity - data', period.description); table(rows.map(row => [row.month, row.count]), ['Month', 'Incidents']) }
  }
  }

  if (options.barangays) {
  page('Incidents by barangay', `${breakdownPeriod} | Top 10 barangays`)
  const hasMap = options.barangayMap && barangays?.features?.length > 0
  if (hasMap) drawBarangayMap(pdf, barangays, summary.by_barangay ?? {}, options.values)
  else table(rankBarangays(summary.by_barangay), ['Barangay', 'Incidents'])
  tableNote(`${summary.breakdown_unresolved_barangay_count ?? summary.unresolved_barangay_count ?? 0} incidents have an unresolved barangay. Each resolved incident contributes once to its barangay count.`)
  if (hasMap && options.dataTables) { page('Barangay rankings - data', breakdownPeriod); table(rankBarangays(summary.by_barangay), ['Barangay', 'Incidents']) }
  }

  if (options.causes) {
  page('Top reported fire causes', `${breakdownPeriod} | Top 10 causes`)
  const causeRows = (summary.top_causes ?? []).slice(0, 10).map(row => [row.cause, row.count])
  if (options.causeChart) drawCauseBars(pdf, causeRows, FIRE, options.values)
  else table(causeRows, ['Reported cause', 'Incidents'])
  tableNote('Source cause labels, one count per incident. Missing causes appear as Not recorded.')
  if (options.causeChart && options.dataTables) { page('Reported causes - data', breakdownPeriod); table(causeRows, ['Reported cause', 'Incidents']) }
  }
  if (!started) throw new Error('Select at least one presentation section.')

  const count = pdf.getNumberOfPages()
  for (let n = 1; n <= count; n++) {
    pdf.setPage(n); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(MUTED)
    pdf.text(`FireTrackr | ${period.description} | Generated ${stamp} PHT`, 30, 385)
    pdf.text(`${n} / ${count}`, 690, 385, { align: 'right' })
    if (options.preparedBy) pdf.text(`Prepared by: ${options.preparedBy}`, 30, 370, { maxWidth: 600 })
  }
  return pdf
}
