// Incident register: the one document model every export format renders from.
// The PDF, DOCX and CSV writers never look at API rows directly — they take the
// `doc` built here, so the three files can't drift apart in content.
import { fetchIncidents } from '../api'
import { REGION_LABEL } from '../data/mapConfig'

// Server caps page_size at 100; the export walks pages until it has them all.
const FETCH_PAGE = 100
// A register longer than this is a filter mistake, not a report.
export const MAX_ROWS = 5000

const PERIOD_LABELS = { all: 'All time', day: 'Today', month: 'This month', year: 'This year' }
const SORT_LABELS = {
  id: 'Incident no.', loc: 'Location', sev: 'Severity', reported_at: 'Date reported', units: 'Units',
}

// `width` is a relative weight; each writer scales it to its own page width.
export const COLUMNS = [
  { key: 'id',          label: 'Incident No.',  width: 1.25, on: true },
  { key: 'reported_at', label: 'Date Reported', width: 1.35, on: true },
  { key: 'loc',         label: 'Location',      width: 2.0,  on: true },
  { key: 'addr',        label: 'Address',       width: 2.0,  on: false },
  { key: 'dispatch_type', label: 'Dispatch Type', width: 1.6, on: true },
  { key: 'structure',   label: 'Structure',     width: 1.3,  on: true },
  { key: 'sev',         label: 'Severity',      width: 0.9,  on: true },
  { key: 'alarm',       label: 'Alarm',         width: 0.9,  on: true },
  { key: 'status',      label: 'Status',        width: 0.95, on: true },
  { key: 'units',       label: 'Units',         width: 0.6,  on: true, align: 'center' },
  { key: 'casualties',  label: 'Casualties',    width: 1.2,  on: true },
  { key: 'reporter',    label: 'Reporter',      width: 1.3,  on: false },
  { key: 'coords',      label: 'Coordinates',   width: 1.45, on: false },
  { key: 'remarks',     label: 'Remarks',       width: 2.2,  on: false },
]

export const DEFAULT_COLUMNS = COLUMNS.filter(c => c.on).map(c => c.key)

const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : '')

export function formatDateTime(value) {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

function cellValue(inc, key) {
  switch (key) {
    case 'reported_at': return formatDateTime(inc.reported_at)
    case 'status':      return cap(inc.status)
    case 'units':       return String(inc.units ?? 0)
    case 'coords':
      return inc.latitude != null && inc.longitude != null
        ? `${inc.latitude.toFixed(5)}, ${inc.longitude.toFixed(5)}` : '—'
    default: {
      const v = inc[key]
      return v == null || v === '' ? '—' : String(v)
    }
  }
}

/** Every incident matching the Incidents page filters, in its sort order. */
export async function fetchAllIncidents(query, { signal } = {}) {
  const items = []
  let stats = null
  let total = 0
  for (let page = 1; ; page++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const data = await fetchIncidents({ ...query, page, pageSize: FETCH_PAGE })
    if (page === 1) { stats = data.stats; total = data.total }
    items.push(...data.items)
    if (!data.items.length || items.length >= Math.min(total, MAX_ROWS)) break
  }
  return { items: items.slice(0, MAX_ROWS), total, stats }
}

/** Human-readable description of the filters, for the document header. */
export function describeQuery(query) {
  const parts = [
    ['Period', PERIOD_LABELS[query.period] ?? 'All time'],
    ['Status', query.status && query.status !== 'all' ? cap(query.status) : 'All'],
  ]
  if (query.sev) parts.push(['Severity', query.sev])
  if (query.alarm) parts.push(['Alarm', query.alarm])
  if (query.search) parts.push(['Search', `“${query.search}”`])
  const sort = `${SORT_LABELS[query.sortCol] ?? 'Date reported'} (${query.sortDir === 1 ? 'ascending' : 'descending'})`
  return { parts, sort }
}

export function defaultOptions(user) {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(' ')
  return {
    format: 'pdf',
    title: 'Fire Incident Register',
    office: `${REGION_LABEL} Fire Station`,
    preparedBy: name,
    notedBy: '',
    paper: 'a4',
    orientation: 'landscape',
    columns: DEFAULT_COLUMNS,
    showSummary: true,
    showSignatures: true,
    fileName: `incident-register-${new Date().toISOString().slice(0, 10)}`,
  }
}

/**
 * Build the format-agnostic document.
 *   data    – result of fetchAllIncidents
 *   query   – the Incidents page query (filters + sort)
 *   options – the modal's settings
 */
export function buildRegister(data, query, options) {
  const columns = COLUMNS.filter(c => options.columns.includes(c.key))
  const s = data.stats ?? {}
  const { parts, sort } = describeQuery(query)
  return {
    title: options.title.trim() || 'Fire Incident Register',
    letterhead: ['Republic of the Philippines', 'Bureau of Fire Protection', options.office.trim()].filter(Boolean),
    filters: parts,
    sort,
    generatedAt: formatDateTime(new Date()),
    preparedBy: options.preparedBy.trim(),
    notedBy: options.notedBy.trim(),
    // Counts reflect the period filter but not the status tab — the same rule
    // the Incidents page KPI cards follow — so the numbers match the screen.
    summary: options.showSummary ? [
      { label: 'Listed', value: data.items.length },
      { label: 'Pending', value: s.pending ?? 0 },
      { label: 'Dispatched', value: s.dispatched ?? 0 },
      { label: 'Contained', value: s.contained ?? 0 },
      { label: 'Closed', value: s.closed ?? 0 },
    ] : null,
    showSignatures: options.showSignatures,
    truncated: data.total > data.items.length,
    total: data.total,
    columns,
    rows: data.items.map(inc => ({
      cells: columns.map(c => cellValue(inc, c.key)),
      sev: inc.sev,
    })),
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function csvCell(v) {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function registerToCsv(doc) {
  const lines = [doc.columns.map(c => csvCell(c.label)).join(',')]
  for (const r of doc.rows) lines.push(r.cells.map(csvCell).join(','))
  // BOM so Excel opens UTF-8 (ñ, en-dashes) correctly instead of as ANSI.
  return new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
}

// ── Shared helpers ───────────────────────────────────────────────────────────
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFileName(name, ext) {
  const base = (name || 'incident-register').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(pdf|docx|csv)$/i, '')
  return `${base || 'incident-register'}.${ext}`
}
