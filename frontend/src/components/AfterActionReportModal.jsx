import { useState } from 'react'
import AppModal from './AppModal'
import { saveIncidentReport } from '../api'
import { Field, SectionHead, FormStatus, LockedNote, ReviewChanges } from './incidentForm'
import '../styles/EditFormModal.css'
import '../styles/AfterActionReport.css'

const FIELDS = [
  ['cause', 'Reported cause'],
  ['casualties', 'Casualties'],
  ['damage_estimate', 'Damage estimate'],
  ['remarks', 'Incident remarks', true],
  ['narrative', 'Narrative', true],
  ['recommendations', 'Recommendations', true],
]
const text = value => value == null || value === '—' ? '' : String(value)

export default function AfterActionReportModal({ incident, report, onClose, onSaved }) {
  const [initial] = useState(() => ({
    cause: text(report?.cause),
    casualties: text(report?.casualties ?? incident.casualties),
    damage_estimate: text(report?.damage_estimate),
    remarks: text(incident.remarks),
    narrative: text(report?.narrative ?? incident.remarks),
    recommendations: text(report?.recommendations),
  }))
  const [form, setForm] = useState(initial)
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const creating = !report
  const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]))
  const changes = FIELDS.filter(([key]) => values[key] !== initial[key].trim())
  const blocked = !values.narrative || (!creating && changes.length === 0)
  const rows = (creating ? FIELDS.filter(([key]) => values[key] !== '') : changes).map(([key, label, long]) => ({
    key, label, long, before: creating ? '' : initial[key], after: values[key],
  }))
  const closing = incident.status === 'contained'

  function set(key, value) {
    setForm(previous => ({ ...previous, [key]: value }))
    setError('')
  }
  function handleSubmit(event) {
    event.preventDefault()
    if (blocked) return
    setError('')
    setReviewing(true)
  }
  async function confirmSave() {
    setSaving(true)
    setError('')
    try {
      const result = await saveIncidentReport(incident.fire_id, {
        report_id: report?.report_id ?? null,
        ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null])),
      })
      onSaved(result)
    } catch (failure) {
      setError(failure.message)
      setSaving(false)
    }
  }

  return <>
    <AppModal
      eyebrow={creating ? 'ADD AFTER-ACTION REPORT' : 'EDIT AFTER-ACTION REPORT'}
      title={incident.loc || incident.id || 'Incident report'}
      subtitle={incident.id}
      width={620}
      className="eim-panel edit-form-modal"
      onClose={onClose}
      dismissible={!saving && !reviewing}
      manageFocus
    >
      <form onSubmit={handleSubmit} inert={reviewing || undefined}>
        <div className="eim-body">
          <fieldset className="aar-editor-fields" disabled={saving}>
            <section className="eim-section">
              <SectionHead title="Outcome" desc="Cause, casualties and estimated damage" />
              <Field label="Reported cause" changed={changes.some(([key]) => key === 'cause')}>
                <input aria-label="Reported cause" data-autofocus value={form.cause} onChange={event => set('cause', event.target.value)} placeholder="e.g. Electrical fault" maxLength={255} />
              </Field>
              <div className="eim-row">
                <Field label="Casualties" changed={changes.some(([key]) => key === 'casualties')}>
                  <input aria-label="Casualties" value={form.casualties} onChange={event => set('casualties', event.target.value)} placeholder="e.g. No injuries reported" maxLength={255} />
                </Field>
                <Field label="Damage estimate" changed={changes.some(([key]) => key === 'damage_estimate')}>
                  <input aria-label="Damage estimate" value={form.damage_estimate} onChange={event => set('damage_estimate', event.target.value)} placeholder="e.g. PHP 150,000" maxLength={100} />
                </Field>
              </div>
              <Field label="Incident remarks" changed={changes.some(([key]) => key === 'remarks')}>
                <textarea aria-label="Incident remarks" value={form.remarks} onChange={event => set('remarks', event.target.value)} placeholder="Additional incident notes" rows={2} />
              </Field>
            </section>
            <section className="eim-section">
              <SectionHead title="Report" desc="Account of the response and follow-up actions" />
              <Field label="Narrative" required changed={changes.some(([key]) => key === 'narrative')}>
                <textarea aria-label="Narrative" value={form.narrative} onChange={event => set('narrative', event.target.value)} placeholder="Describe the response, actions taken and outcome" rows={5} required />
              </Field>
              <Field label="Recommendations" changed={changes.some(([key]) => key === 'recommendations')}>
                <textarea aria-label="Recommendations" value={form.recommendations} onChange={event => set('recommendations', event.target.value)} placeholder="Recommended follow-up or prevention measures" rows={3} />
              </Field>
              {report && <LockedNote>
                {report.author ? <>Originally filed by <strong>{report.author}</strong>. </> : null}
                Corrections are recorded under your administrator account
              </LockedNote>}
            </section>
          </fieldset>
          {error && !reviewing && <div className="apm-error" role="alert">{error}</div>}
        </div>
        <div className="eim-footer">
          {creating ? <FormStatus missing={values.narrative ? [] : ['narrative']} /> : <FormStatus changeCount={changes.length} />}
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="apm-btn-submit" disabled={blocked || saving}>Review &amp; save</button>
          </div>
        </div>
      </form>
    </AppModal>
    {reviewing && <ReviewChanges
      code={incident.id}
      rows={rows}
      note={closing ? 'Filing this report closes the incident and releases all responding teams and trucks.' : null}
      saving={saving}
      error={error}
      onBack={() => { setError(''); setReviewing(false) }}
      onConfirm={confirmSave}
    />}
  </>
}
