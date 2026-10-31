import { formatDateTime } from './incidentRegister'

// Snapshot matching rows and their scope once, independently of live refreshes.
export function createResourceExport(resource, headers, rows, { filters = [['Scope', 'Current filters']], sort = 'Current page order' } = {}) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const name = resource[0].toUpperCase() + resource.slice(1)
  const statusIndex = headers.indexOf('Status')
  const counts = new Map()
  if (statusIndex !== -1) {
    rows.forEach(row => {
      const status = row[statusIndex]
      if (status) counts.set(status, (counts.get(status) ?? 0) + 1)
    })
  }
  return {
    name,
    title: `${name} register`,
    fileName: `${resource}-${date}`,
    generatedAt: formatDateTime(new Date()),
    columns: headers.map((label, index) => ({
      key: String(index), label,
      width: /address|crew|email|incident|updated/i.test(label) ? 1.8 : /name|station|commander|reports to|designation/i.test(label) ? 1.5 : 1,
    })),
    rows: rows.map(row => [...row]),
    filters: filters.map(part => [...part]),
    sort,
    summary: [{ label: 'Listed', value: rows.length }, ...[...counts].map(([label, value]) => ({ label, value }))],
  }
}

// Use the same document contract as the Incident register PDF/Word/CSV writers.
export function buildResourceRegister(resource, options) {
  const columns = resource.columns.filter(column => options.columns.includes(column.key))
  return {
    title: options.title.trim() || resource.title,
    subject: resource.title,
    letterhead: ['Republic of the Philippines', 'Bureau of Fire Protection', options.office.trim()].filter(Boolean),
    filters: resource.filters,
    sort: resource.sort,
    generatedAt: resource.generatedAt,
    preparedBy: options.preparedBy.trim(),
    notedBy: options.notedBy.trim(),
    summary: options.showSummary ? resource.summary : null,
    showSignatures: options.showSignatures,
    total: resource.rows.length,
    truncated: false,
    columns,
    rows: resource.rows.map(row => ({
      cells: columns.map(column => {
        const value = row[Number(column.key)]
        const text = String(value ?? '')
        // Escape only spreadsheet output; PDF/Word retain the original text.
        return options.format === 'csv' && typeof value === 'string' && /^\s*[=+\-@]/.test(text) ? `'${text}` : text
      }),
    })),
  }
}
