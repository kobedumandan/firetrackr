import { useMemo } from 'react'
import AppModal from './AppModal'
import CsvSheet from './CsvSheet'
import { csvReviewDocument } from '../utils/csvReview'
import { downloadBlob } from '../utils/incidentRegister'
import '../styles/ExportModal.css'
import '../styles/CsvReviewModal.css'

export default function CsvReviewModal({ csv, fileName, title, onClose }) {
  const doc = useMemo(() => csvReviewDocument(csv), [csv])
  return <AppModal eyebrow="EXPORT" title={title} subtitle="Review the CSV before downloading. The file includes all matching rows."
    width={1100} className="eim-panel csv-review-panel" onClose={onClose} manageFocus>
    <div className="csv-review-body">
      <CsvSheet doc={doc} emptyMessage="No rows match these filters." />
    </div>
    <div className="csv-review-footer">
      <span>{doc.rows.length} rows · {doc.columns.length} columns</span>
      <div><button type="button" onClick={onClose}>Cancel</button>
        <button type="button" className="csv-review-download" onClick={() => downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), fileName)}>Download CSV</button></div>
    </div>
  </AppModal>
}
