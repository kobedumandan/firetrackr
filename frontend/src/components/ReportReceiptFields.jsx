import { Field, SectionHead } from './incidentForm'
import { manilaInput } from '../utils/operationalTimes'

export default function ReportReceiptFields({ receivedAt, kind, onReceipt, onKind }) {
  return <section className="eim-section">
    <SectionHead title="Report receipt" desc="Confirm when the emergency report was received. Leave blank if unknown; this is separate from when the incident happened." />
    <div className="eim-row">
      <Field label="Received at · Philippine time">
        <input type="datetime-local" step="1" value={receivedAt || ''} onChange={e => onReceipt(e.target.value)} />
        <button type="button" className="eim-link-btn" onClick={() => onReceipt(manilaInput())}>Report received now</button>
      </Field>
      <Field label="Response classification">
        <select value={kind || ''} onChange={e => onKind(e.target.value)}>
          <option value="">Not yet verified</option><option value="fire">Fire</option><option value="medical">Medical</option><option value="rescue">Rescue</option><option value="other">Other</option>
        </select>
      </Field>
    </div>
  </section>
}
