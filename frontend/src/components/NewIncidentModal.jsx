import { useState, useEffect } from 'react'
import '../styles/AppModal.css'
import { SEVERITIES, ALARMS, STRUCTURES, DISPATCH_TYPES, ICON_CLOSE, ICON_PIN, ICON_BOLT } from './incidentFormOptions'
import { Icon, Field, SectionHead, Segmented } from './incidentForm'

const CHANNELS = ['911 Call', 'BFP Hotline', 'SMS Report', 'Walk-in', 'Dispatcher']

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
    severity:     'Moderate',
    alarm:        '1st Alarm',
    structure:    'Residential',
    dispatchType: 'Firefighting Operations',
    reporter:     '911 Call',
    mobile:       '',
    autoDispatch: true,
    locationSource: 'manual',
    ...(initial || {}),
  }))
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, saving])

  function set(field, val) { setForm(f => ({ ...f, [field]: val })); setError(null) }

  const fromReporter = form.locationSource === 'report'
  const missing = form.locationName.trim() ? [] : ['area name']

  async function handleSubmit(e) {
    e.preventDefault()
    if (missing.length) return
    setSaving(true)
    try {
      await onSubmit({
        locationName: form.locationName.trim(),
        address:      form.address.trim(),
        severity:     form.severity,
        alarm:        form.alarm,
        structure:    form.structure,
        dispatchType: form.dispatchType,
        reporter:     form.reporter,
        mobile:       form.mobile.trim(),
        coords:       location,
        autoDispatch: form.autoDispatch,
        locationSource: form.locationSource,
        reporterToken: form.reporterToken,
      })
    } catch (err) {
      setError(err.message || 'Failed to log incident')
      setSaving(false)
    }
  }

  return (
    <div className="apm-overlay" onMouseDown={e => e.target === e.currentTarget && !saving && onCancel()}>
      <div className="apm-panel eim-panel nim-panel" role="dialog" aria-modal="true" aria-labelledby="nim-title">

        <div className="eim-header">
          <div className="eim-header-main">
            <div className="apm-eyebrow">NEW INCIDENT</div>
            <div id="nim-title" className="eim-title">{form.locationName.trim() || 'Log a new incident'}</div>
          </div>
          <button className="eim-close" onClick={onCancel} aria-label="Close" disabled={saving}>
            <Icon d={ICON_CLOSE} />
          </button>
        </div>

        <form id="nim-form" className="eim-body" onSubmit={handleSubmit}>

          {/* ── Location ── */}
          <section className="eim-section">
            <SectionHead title="Location" desc={fromReporter ? 'Pinned from the reporter\'s phone.' : 'Name the spot you pinned.'} />
            <div className="eim-coords pinned nim-pin">
              <Icon d={ICON_PIN} />
              <span className="eim-coords-val">{location[0].toFixed(5)}, {location[1].toFixed(5)}</span>
              {fromReporter && <span className="nim-pin-tag">Reporter GPS</span>}
              {onRepick && (
                <button
                  type="button"
                  className="eim-link-btn nim-pin-move"
                  onClick={() => onRepick(form)}
                  disabled={saving}
                >
                  Move pin
                </button>
              )}
            </div>
            <div className="eim-row">
              <Field label="Area / Barangay" required>
                <input
                  placeholder="e.g. Brgy. San Francisco, Panabo"
                  value={form.locationName}
                  onChange={e => set('locationName', e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Street / landmark">
                <input
                  placeholder="e.g. 123 Rizal St., near the church"
                  value={form.address}
                  onChange={e => set('address', e.target.value)}
                />
              </Field>
            </div>
          </section>

          {/* ── Assessment ── */}
          <section className="eim-section">
            <SectionHead title="Assessment" desc="How serious the fire looks from the report." />
            <Field label="Dispatch type">
              <select value={form.dispatchType} onChange={e => set('dispatchType', e.target.value)}>
                {DISPATCH_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Severity" required>
              <Segmented label="Severity" options={SEVERITIES} value={form.severity} onChange={v => set('severity', v)} />
            </Field>
            <div className="eim-row">
              <Field label="Alarm level">
                <Segmented
                  label="Alarm level"
                  options={ALARMS.map(a => ({ value: a, label: a.replace(' Alarm', '') }))}
                  value={form.alarm}
                  onChange={v => set('alarm', v)}
                />
              </Field>
              <Field label="Structure type">
                <select value={form.structure} onChange={e => set('structure', e.target.value)}>
                  {STRUCTURES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </section>

          {/* ── Reporter ── */}
          <section className="eim-section">
            <SectionHead title="Reporter" desc="How the report came in." />
            <Field label="Reported via">
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
            </Field>
            <Field label="Reporter mobile #" className="nim-mobile">
              <input
                type="tel"
                inputMode="tel"
                placeholder="e.g. 09XX-XXX-XXXX"
                value={form.mobile}
                onChange={e => set('mobile', e.target.value)}
              />
            </Field>
          </section>

          {/* ── Dispatch ── */}
          <section className="eim-section">
            <SectionHead title="Dispatch" />
            <label className={`nim-toggle ${form.autoDispatch ? 'on' : ''}`}>
              <span className="nim-toggle-icon"><Icon d={ICON_BOLT} /></span>
              <span className="nim-toggle-text">
                <span className="nim-toggle-title">Auto-dispatch the nearest team</span>
                <span className="nim-toggle-desc">
                  {form.autoDispatch
                    ? 'The closest available crew is sent as soon as you log this.'
                    : 'Logged as Pending. Dispatch a crew yourself from the incident panel.'}
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="nim-switch"
                checked={form.autoDispatch}
                onChange={e => set('autoDispatch', e.target.checked)}
              />
            </label>
          </section>

          {error && <div className="apm-error">{error}</div>}
        </form>

        <div className="eim-footer">
          <span className={`eim-changes ${missing.length ? '' : 'ready'}`}>
            {missing.length ? `Still needed: ${missing.join(' and ')}` : 'Ready to log'}
          </span>
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="submit" form="nim-form" className="apm-btn-submit" disabled={saving || missing.length > 0}>
              {saving ? <span className="apm-spinner" /> : form.autoDispatch ? 'Log & dispatch' : 'Log incident'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
