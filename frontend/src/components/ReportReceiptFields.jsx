import { useId } from 'react'
import { Field, SectionHead } from './incidentForm'
import { manilaInput } from '../utils/operationalTimes'
import '../styles/ReportReceiptFields.css'

const RECORD_KINDS = [
  { value: 'operational', label: 'Operational' },
  { value: 'drill', label: 'Drill' },
  { value: 'test', label: 'Test' },
  { value: 'unknown', label: 'Unknown' },
]

export default function ReportReceiptFields({ receivedAt, kind, onReceipt, onKind, recordKind, onRecordKind, dispatchType }) {
  const noteId = useId()
  const classificationLocked = dispatchType === 'Firefighting Operations' || dispatchType === 'Emergency Medical Services (EMS)'

  return (
    <section className="eim-section receipt-section">
      <SectionHead title="Report receipt" />
      <div className="receipt-time">
        <Field label={<><span>Received at</span><span className="receipt-timezone">Philippine time</span></>} className="receipt-time-field">
          <div className="receipt-time-controls">
            <input
              type="datetime-local"
              aria-label="Received at in Philippine time"
              aria-describedby={noteId}
              step="1"
              value={receivedAt || ''}
              onChange={e => onReceipt(e.target.value)}
            />
            <div className="receipt-time-actions">
              <button type="button" className="receipt-action" aria-label="Report received now" onClick={() => onReceipt(manilaInput())}>Now</button>
              <button type="button" className="receipt-action" aria-label="Receipt time unknown" aria-pressed={!receivedAt} onClick={() => onReceipt('')}>Unknown</button>
            </div>
          </div>
        </Field>
        <p id={noteId} className="receipt-note">When the report reached BFP. Leave unknown if unverified; incident time is recorded separately.</p>
      </div>
      <div className={`receipt-classification${onRecordKind ? '' : ' receipt-classification-single'}`}>
        <Field label="Response classification">
          <select aria-label="Response classification" value={kind || ''} onChange={e => onKind(e.target.value)} disabled={classificationLocked}>
            <option value="">Not yet verified</option>
            {(!dispatchType || dispatchType === 'Firefighting Operations') && <option value="fire">Fire</option>}
            <option value="medical">Medical</option>
            <option value="rescue">Rescue</option>
            <option value="other">Other</option>
          </select>
          <span className="frm-hint">{classificationLocked ? 'Set automatically from dispatch type.' : 'Confirm the response type when known.'}</span>
        </Field>
        {onRecordKind && (
          <Field label="Record kind">
            <select aria-label="Record kind" value={recordKind || 'unknown'} onChange={e => onRecordKind(e.target.value)}>
              {RECORD_KINDS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
        )}
      </div>
    </section>
  )
}
