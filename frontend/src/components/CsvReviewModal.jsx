import { useMemo, useState } from 'react'
import AppModal from './AppModal'
import CsvSheet from './CsvSheet'
import { csvReviewDocument } from '../utils/csvReview'
import { downloadBlob } from '../utils/incidentRegister'
import '../styles/ExportModal.css'
import '../styles/CsvReviewModal.css'

export default function CsvReviewModal({ csv, fileName, title, onClose, views, initialView }) {
  const [selectedView, setSelectedView] = useState(initialView || views?.[0]?.id)
  const activeView = views?.find(view => view.id === selectedView) || views?.[0]
  const activeCsv = activeView?.csv ?? csv
  const activeFileName = activeView?.fileName ?? fileName
  const doc = useMemo(() => csvReviewDocument(activeCsv), [activeCsv])
  return <AppModal eyebrow="EXPORT" title={title} subtitle="Review the CSV before downloading. The file includes all matching rows."
    width={1100} className="eim-panel csv-review-panel" onClose={onClose} manageFocus>
    {views?.length > 1 && <div className="csv-review-views" role="group" aria-label="CSV view">
      {views.map(view => <button key={view.id} type="button" aria-pressed={view.id === activeView.id} onClick={() => setSelectedView(view.id)}>{view.label}</button>)}
    </div>}
    <div className="csv-review-body" key={activeView?.id || 'csv'}>
      <CsvSheet doc={doc} emptyMessage="No rows match these filters." />
    </div>
    <div className="csv-review-footer">
      <span>{doc.rows.length} rows · {doc.columns.length} columns</span>
      <div><button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="csv-review-download" onClick={() => downloadBlob(new Blob([activeCsv], { type: 'text/csv;charset=utf-8;' }), activeFileName)}>Download CSV</button></div>
    </div>
  </AppModal>
}
