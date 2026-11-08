import { useRef, useState } from 'react'
import AppModal from './AppModal'
import { IntakeSection, IntakeDisclosure, IntakeReceipt } from './IncidentIntakeSection'
import { manilaInput } from '../utils/operationalTimes'
import { useIncidentBarangay } from '../hooks/useIncidentBarangay'
import '../styles/AppModal.css'
import '../styles/DispatchModal.css'
import '../styles/LogIncidentModal.css'
import { SEVERITIES, ALARMS, DISPATCH_TYPES, supportsFireAlarm, defaultResponseKind, ICON_PIN, ICON_BOLT, ICON_PLUS } from './incidentFormOptions'
import { Icon, Field, Segmented, StructureTypeField } from './incidentForm'

const CHANNELS = ['911 Call', 'BFP Hotline', 'Walk-in', 'Dispatcher']

/**
 * Log Incident from the map: the pin is already placed, so this is the live,
 * fast path (always Pending). The full form with a map picker and past-incident
 * mode lives in LogIncidentModal on the Incidents page.
 *
 * onRepick(draft) – optional; closes the form so the dispatcher can click a new
 *                   spot, handing back what was typed so it can be restored.
 */
export default function NewIncidentModal({ location, initial, onSubmit, onCancel, onRepick }) {
  const [form, setForm] = useState(() => ({
    locationName: '',
    address:      '',
    severity:     'Minor',
    alarm:        '1st Alarm',
    structure:    'Residential',
    dispatchType: 'Firefighting Operations',
    reporter:     '911 Call',
    mobile:       '',
    autoDispatch: true,
    locationSource: 'manual',
    receivedAt: manilaInput(),
    recordKind: 'operational',
    ...(initial || {}),
    responseKind: initial?.responseKind ?? defaultResponseKind(initial?.dispatchType || 'Firefighting Operations'),
    ...(initial?.locationSource === 'report' ? { reporter: 'SMS Report' } : {}),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)
  const submitting = useRef(false)
  const { detecting, hint: barangayHint, detectedName, markEdited } = useIncidentBarangay(
    location[0], location[1], setForm, 'locationName',
  )

  function set(field, val) {
    if (field === 'locationName') markEdited()
    setForm(f => ({ ...f, [field]: val, ...(field === 'dispatchType' ? { responseKind: defaultResponseKind(val) } : {}) })); setError(null)
  }

  const fromReporter = form.locationSource === 'report'
  const showFireAlarm = supportsFireAlarm(form.dispatchType)
  const missing = [
    !form.locationName.trim() && 'area name',
    showFireAlarm && (!form.structure.trim() || form.structure === 'Other') && 'structure type',
  ].filter(Boolean)

  async function handleSubmit(e) {
    e.preventDefault()
    if (missing.length || submitting.current || detecting) return
    submitting.current = true
    setSaving(true)
    try {
      await onSubmit({
        locationName: form.locationName.trim(),
        address:      form.address.trim(),
        severity:     form.severity,
        alarm:        showFireAlarm ? form.alarm : null,
        structure:    showFireAlarm ? form.structure.trim() : null,
        dispatchType: form.dispatchType,
        reporter:     form.reporter,
        mobile:       form.mobile.trim(),
        coords:       location,
        autoDispatch: form.autoDispatch,
        locationSource: form.locationSource,
        reporterToken: form.reporterToken,
        reportReceivedAt: form.receivedAt ? new Date(`${form.receivedAt}+08:00`).toISOString() : null,
        responseKind: form.responseKind || null,
        recordKind: form.recordKind,
      })
    } catch (err) {
      setError(err.message || 'Failed to log incident')
      setSaving(false)
      submitting.current = false
    }
  }

  return (
    <AppModal
      variant="badged"
      icon={<Icon d={ICON_PLUS} className="cfm-badge-icon" />}
      eyebrow="NEW INCIDENT"
      title="Log a new incident"
      subtitle="Confirm the location and assessment, then choose how to dispatch."
      onClose={onCancel}
      width={680}
      className="eim-panel intake-panel log-incident-modal"
      dismissible={!saving}
      manageFocus
    >
        <form id="nim-form" className="eim-body intake-scroll" onSubmit={handleSubmit} aria-busy={saving}>
          <fieldset className="intake-fields" disabled={saving}>

          {/* ── Location ── */}
          <IntakeSection title="Location" desc={fromReporter ? 'Pinned from the reporter\'s phone.' : 'Confirm the pin and barangay'} className="lim-location">
            <div className="eim-coords pinned nim-pin">
              <Icon d={ICON_PIN} />
              <span className="eim-coords-val">{location[0].toFixed(5)}, {location[1].toFixed(5)}</span>
              {fromReporter && <span className="nim-pin-tag">Reporter GPS</span>}
              {onRepick && (
                <button
                  type="button"
                  className="eim-link-btn nim-pin-move"
                  onClick={() => onRepick({ ...form, locationName: form.locationName === detectedName ? '' : form.locationName })}
                  disabled={saving}
                >
                  Move pin
                </button>
              )}
            </div>
            <div className="eim-row">
              <Field label="Area / Barangay" required>
                <div className="barangay-input-wrap">
                <input
                  placeholder="Filled automatically from the map pin"
                  value={form.locationName}
                  onChange={e => set('locationName', e.target.value)}
                  aria-label="Area / Barangay"
                  aria-describedby="nim-barangay-hint"
                  aria-busy={detecting}
                  required
                  data-autofocus
                />
                {detecting && <span className="apm-spinner barangay-input-spinner" aria-hidden="true" />}
                </div>
                <span id="nim-barangay-hint" className="frm-hint" aria-live="polite">{barangayHint}</span>
              </Field>
              <Field label="Street / landmark">
                <input
                  placeholder="e.g. 123 Rizal St., near the church"
                  value={form.address}
                  onChange={e => set('address', e.target.value)}
                  aria-label="Street / landmark"
                />
              </Field>
            </div>
          </IntakeSection>

          {/* ── Assessment ── */}
          <IntakeSection title="Assessment" desc="Confirm the initial report" className="lim-assessment">
            <Field label="Dispatch type">
              <select aria-label="Dispatch type" value={form.dispatchType} onChange={e => set('dispatchType', e.target.value)}>
                {DISPATCH_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Severity" required>
              <Segmented label="Severity" options={SEVERITIES} value={form.severity} onChange={v => set('severity', v)} />
              <span className="frm-hint">Overall incident seriousness, used for incident sorting and reporting across operation types.</span>
            </Field>
            <div className="eim-row">
              {showFireAlarm && <Field label="Alarm level">
                <Segmented
                  label="Alarm level"
                  options={ALARMS.map(a => ({ value: a, label: a.replace(' Alarm', '') }))}
                  value={form.alarm}
                  onChange={v => set('alarm', v)}
                />
              </Field>}
              {showFireAlarm && <StructureTypeField value={form.structure} onChange={value => set('structure', value)} />}
            </div>
          </IntakeSection>

          <IntakeSection title="Dispatch" desc="Choose what happens when you log">
            <label className={`nim-toggle ${form.autoDispatch ? 'on' : ''}`}>
              <span className="nim-toggle-icon"><Icon d={ICON_BOLT} /></span>
              <span className="nim-toggle-text">
                <span className="nim-toggle-title">Auto-dispatch an available team</span>
                <span className="nim-toggle-desc">
                  {form.autoDispatch
                    ? 'Automatically assign an available team after logging.'
                    : 'Save as Pending, then dispatch from the incident panel.'}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                aria-label="Auto-dispatch an available team"
                className="nim-switch"
                checked={form.autoDispatch}
                onChange={e => set('autoDispatch', e.target.checked)}
              />
            </label>
          </IntakeSection>

          {/* ── Reporter ── */}
          <IntakeDisclosure title="Reporter details" summary={[form.reporter, form.mobile].filter(Boolean).join(' · ') || 'Optional · add a channel and contact number'} defaultOpen={fromReporter || Boolean(initial?.mobile)}>
            <Field label="Reported via">
              {fromReporter ? <>
                <input aria-label="Reported via" value="SMS Report" readOnly />
                <span className="frm-hint">From the reporter's shared location.</span>
              </> : (
              <div className="eim-chips" role="radiogroup" aria-label="Reported via">
                {CHANNELS.map(c => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={form.reporter === c}
                    className={`eim-pick ${form.reporter === c ? 'active' : ''}`}
                    onClick={() => set('reporter', c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
              )}
            </Field>
            <Field label="Reporter mobile #" className="nim-mobile">
              <input
                type="tel"
                inputMode="tel"
                placeholder="e.g. 09XX-XXX-XXXX"
                value={form.mobile}
                onChange={e => set('mobile', e.target.value)}
                aria-label="Reporter mobile number"
              />
              <span className="frm-hint">Optional. Add a number for follow-up if available.</span>
            </Field>
          </IntakeDisclosure>
          <IntakeReceipt dispatchType={form.dispatchType} receivedAt={form.receivedAt} kind={form.responseKind} onReceipt={v => set('receivedAt', v)} onKind={v => set('responseKind', v)} recordKind={form.recordKind} onRecordKind={v => set('recordKind', v)} />
          </fieldset>
        </form>

        {error && <div className="apm-error intake-error" role="alert">{error}</div>}

        <div className="eim-footer">
          <span className={`eim-changes ${detecting || missing.length ? '' : 'ready'}`} role="status">
            {detecting ? 'Detecting barangay…' : missing.length ? `Still needed: ${missing.join(' and ')}` : 'Ready to log'}
          </span>
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="submit" form="nim-form" className="apm-btn-submit" disabled={saving || detecting || missing.length > 0}>
              {saving ? <><span className="apm-spinner" /> Logging…</> : form.autoDispatch ? 'Log & dispatch' : 'Log incident'}
            </button>
          </div>
        </div>

    </AppModal>
  )
}
