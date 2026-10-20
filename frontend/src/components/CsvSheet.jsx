const PREVIEW_CSV_ROWS = 100

export default function CsvSheet({ doc, emptyMessage = "No incidents match these filters." }) {
  if (!doc) return null
  const shown = doc.rows.slice(0, PREVIEW_CSV_ROWS)
  return (
    <div className="xpm-sheet-wrap">
      <table className="xpm-sheet">
        <thead>
          <tr>
            <th className="xpm-sheet-n" aria-label="Row" />
            {doc.columns.map(c => <th key={c.key}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={i}>
              <td className="xpm-sheet-n">{i + 1}</td>
              {r.cells.map((v, j) => <td key={j}>{v}</td>)}
            </tr>
          ))}
          {!shown.length && (
            <tr><td className="xpm-sheet-empty" colSpan={doc.columns.length + 1}>{emptyMessage}</td></tr>
          )}
        </tbody>
      </table>
      {doc.rows.length > PREVIEW_CSV_ROWS && (
        <div className="xpm-more">Showing {PREVIEW_CSV_ROWS} of {doc.rows.length} rows. The file includes all of them.</div>
      )}
    </div>
  )
}
