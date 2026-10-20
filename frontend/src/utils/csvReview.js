// Parse spreadsheet CSV, including quoted commas, escaped quotes and newlines.
export function csvReviewDocument(csv) {
  const records = []
  let row = [], cell = '', quoted = false
  const source = csv.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (!quoted && (char === ',' || char === '\n' || char === '\r')) {
      row.push(cell); cell = ''
      if (char !== ',') {
        records.push(row); row = []
        if (char === '\r' && source[i + 1] === '\n') i++
      }
    } else cell += char
  }
  if (cell || row.length) { row.push(cell); records.push(row) }
  const headers = records.shift() || []
  return {
    columns: headers.map((label, key) => ({ key, label })),
    rows: records.map(cells => ({ cells })),
  }
}
