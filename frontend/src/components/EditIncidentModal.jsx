import { useEffect, useState } from 'react'
import { updateIncident } from '../api'
import {
  STATUSES, SEVERITIES, ALARMS, STRUCTURES, DISPATCH_TYPES, statusMetaOf,
  ICON_CLOSE, ICON_MINUS, ICON_PLUS, ICON_LOCK,
} from './incidentFormOptions'
import {
  Icon, Field, SectionHead, Segmented, StatusSteps, CasualtyPicker, Callout, LockedNote,
  ReviewChanges,
} from './incidentForm'

// Review order and display labels for every editable field.
const FIELD_META = [
  ['fire_status',           'Status', v => STATUSES.find(s => s.value === v)?.label ?? v],
  ['fire_severity',         'Severity'],
  ['fire_alarm_level',      'Alarm level'],
  ['fire_structure_type',   'Structure type'],
  ['fire_dispatch_type',    'Dispatch type'],
  ['fire_units_assigned',   'Units assigned'],
  ['fire_casualties',       'Casualties'],
  ['fire_remarks',          'Remarks', null, true],
  ['fire_location_name',    'Area / Barangay'],
  ['fire_address',          'Street address'],
  ['fire_reporter_name',    'Reported by'],
  ['fire_reporter_contact', 'Contact number'],
]

export default function EditIncidentModal({ incident, onClose, onSubmit }) {
  const [initial] = useState(() => ({
    fire_location_name:    incident.loc        || '',
    fire_address:          incident.addr       || '',
    fire_severity:         incident.sev        || 'Minor',
    fire_status:           incident.status     || 'pending',
    fire_alarm_level:      incident.alarm      || '1st Alarm',
    fire_structure_type:   incident.structure  || 'Residential',
    fire_dispatch_type:    incident.dispatch_type || '',
    fire_casualties:       incident.casualties || 'None',
    fire_units_assigned:   incident.units      ?? 0,
    fire_reporter_name:    incident.reporter && incident.reporter !== '—' ? incident.reporter : '',
    fire_reporter_contact: '',
    fire_remarks:          incident.remarks    || '',
  }))
  const [form, setForm] = useState(initial)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  const showCasualties = form.fire_status === 'closed' || form.fire_status === 'contained'
  const showRemarks    = form.fire_status === 'closed'
  const closingNow     = form.fire_status === 'closed' && initial.fire_status !== 'closed'
  const statusMeta     = statusMetaOf(form.fire_status)

  // Values as they'd be saved — gated fields reset when their section is hidden.
  const effective = {
    ...form,
    fire_units_assigned: Number(form.fire_units_assigned) || 0,
    fire_casualties:     showCasualties ? form.fire_casualties : 'None',
    fire_remarks:        showRemarks ? form.fire_remarks : '',
  }
  // PATCH only what changed; a blank contact means "keep the stored one".
  const changes = Object.fromEntries(
    Object.entries(effective).filter(([k, v]) =>
      k === 'fire_reporter_contact' ? v.trim() !== '' : v !== initial[k],
    ),
  )
  const changeCount = Object.keys(changes).length
  const isChanged = field => field in changes

  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Escape' || saving) return
      if (reviewing) setReviewing(false)
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving, reviewing])

  function set(field, value) {
    setError(null)
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function stepUnits(delta) {
    set('fire_units_assigned', Math.max(0, (Number(form.fire_units_assigned) || 0) + delta))
  }

  // Save opens the review step; nothing is sent until it's confirmed.
  function handleSubmit(e) {
    e.preventDefault()
    if (!form.fire_location_name.trim()) {
      setError('Area / Barangay name is required.')
      return
    }
    if (changeCount === 0) return
    setError(null)
    setReviewing(true)
  }

  async function confirmSave() {
    setSaving(true)
    try {
      const updated = await updateIncident(incident.fire_id, changes)
      onSubmit(updated)
    } catch (ex) {
      setError(ex.message)
      setSaving(false)
    }
  }

  return (
    <>
    <div className="apm-overlay" onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="apm-panel eim-panel" role="dialog" aria-modal="true" aria-labelledby="eim-title">

        <div className="eim-header">
          <div className="eim-header-main">
            <div className="apm-eyebrow">EDIT INCIDENT</div>
            <div id="eim-title" className="eim-title">{form.fire_location_name.trim() || 'Untitled location'}</div>
            <div className="eim-subtitle">
              <span className="eim-chip eim-chip-code">{incident.id}</span>
              <span className="eim-chip">{statusMeta.label}</span>
              <span className="eim-chip">{form.fire_severity}</span>
              <span className="eim-chip">{form.fire_alarm_level}</span>
            </div>
          </div>
          <button className="eim-close" onClick={onClose} aria-label="Close" disabled={saving}>
            <Icon d={ICON_CLOSE} />
          </button>
        </div>

        <form id="eim-form" className="eim-body" onSubmit={handleSubmit}>

          {/* ── Status progression ── */}
          <section className="eim-section">
            <SectionHead title="Status" desc="Where this incident is in its lifecycle." changed={isChanged('fire_status')} />
            <StatusSteps value={form.fire_status} onChange={v => set('fire_status', v)} />
            {closingNow && (
              <Callout>When you save, active crews and trucks on this incident are released and it is added to the heatmap.</Callout>
            )}
          </section>

          {/* ── Assessment ── */}
          <section className="eim-section">
            <SectionHead title="Assessment" desc="How serious the fire is and what's committed to it." />

            <Field label="Dispatch type" changed={isChanged('fire_dispatch_type')}>
              <select value={form.fire_dispatch_type} onChange={e => set('fire_dispatch_type', e.target.value)}>
                <option value="">Unspecified</option>
                {DISPATCH_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Severity" required changed={isChanged('fire_severity')}>
              <Segmented label="Severity" options={SEVERITIES} value={form.fire_severity} onChange={v => set('fire_severity', v)} />
            </Field>

            <Field label="Alarm level" changed={isChanged('fire_alarm_level')}>
              <Segmented label="Alarm level" options={ALARMS} value={form.fire_alarm_level} onChange={v => set('fire_alarm_level', v)} />
            </Field>

            <div className="eim-row">
              <Field label="Structure type" changed={isChanged('fire_structure_type')}>
                <select value={form.fire_structure_type} onChange={e => set('fire_structure_type', e.target.value)}>
                  {STRUCTURES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Units assigned" changed={isChanged('fire_units_assigned')}>
                <div className="eim-stepper">
                  <button type="button" onClick={() => stepUnits(-1)} disabled={Number(form.fire_units_assigned) <= 0} aria-label="Decrease units">
                    <Icon d={ICON_MINUS} />
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={form.fire_units_assigned}
                    onChange={e => set('fire_units_assigned', e.target.value)}
                    aria-label="Units assigned"
                  />
                  <button type="button" onClick={() => stepUnits(1)} aria-label="Increase units">
                    <Icon d={ICON_PLUS} />
                  </button>
                </div>
              </Field>
            </div>
          </section>

          {/* ── Outcome (unlocks as the incident progresses) ── */}
          <section className="eim-section">
            <SectionHead title="Outcome" desc="Recorded once the fire is contained." />
            {showCasualties ? (
              <>
                <Field label="Casualties" changed={isChanged('fire_casualties')}>
                  <CasualtyPicker value={form.fire_casualties} onChange={v => set('fire_casualties', v)} />
                </Field>
                {showRemarks && (
                  <Field label="Remarks / report" changed={isChanged('fire_remarks')}>
                    <textarea
                      placeholder="Cause, investigation findings, or post-incident notes"
                      value={form.fire_remarks}
                      onChange={e => set('fire_remarks', e.target.value)}
                      rows={3}
                    />
                  </Field>
                )}
              </>
            ) : (
              <LockedNote>
                Set the status to <strong>Contained</strong> or <strong>Closed</strong> to record casualties and remarks.
              </LockedNote>
            )}
          </section>

          {/* ── Location ── */}
          <section className="eim-section">
            <SectionHead title="Location" desc="The pin can't be moved; only the labels can." />
            <div className="eim-row">
              <Field label="Area / Barangay" required changed={isChanged('fire_location_name')}>
                <input
                  placeholder="e.g. Brgy. Kakar, Panabo"
                  value={form.fire_location_name}
                  onChange={e => set('fire_location_name', e.target.value)}
                  aria-invalid={!form.fire_location_name.trim()}
                />
              </Field>
              <Field label="Street address" changed={isChanged('fire_address')}>
                <input
                  placeholder="e.g. 12 Rizal St."
                  value={form.fire_address}
                  onChange={e => set('fire_address', e.target.value)}
                />
              </Field>
            </div>
            <div className="eim-coords">
              <Icon d={ICON_LOCK} />
              <span className="eim-coords-val">
                {Number(incident.latitude).toFixed(6)}, {Number(incident.longitude).toFixed(6)}
              </span>
            </div>
          </section>

          {/* ── Reporter ── */}
          <section className="eim-section">
            <SectionHead title="Reporter" desc="Who called it in." />
            <div className="eim-row">
              <Field label="Reported by" changed={isChanged('fire_reporter_name')}>
                <input
                  placeholder="e.g. BFP Hotline · 911"
                  value={form.fire_reporter_name}
                  onChange={e => set('fire_reporter_name', e.target.value)}
                />
              </Field>
              <Field label="Contact number" changed={isChanged('fire_reporter_contact')}>
                <input
                  placeholder="Leave blank to keep current"
                  value={form.fire_reporter_contact}
                  onChange={e => set('fire_reporter_contact', e.target.value)}
                />
              </Field>
            </div>
          </section>

          {error && !reviewing && <div className="apm-error">{error}</div>}
        </form>

        <div className="eim-footer">
          <span className={`eim-changes ${changeCount ? 'has' : ''}`}>
            {changeCount === 0 ? 'No changes yet' : `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'}`}
          </span>
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" form="eim-form" className="apm-btn-submit" disabled={changeCount === 0}>
              Review &amp; save
            </button>
          </div>
        </div>

      </div>
    </div>

    {reviewing && (
      <ReviewChanges
        code={incident.id}
        rows={FIELD_META.filter(([key]) => key in changes).map(([key, label, fmt, long]) => ({
          key,
          label,
          long,
          before: fmt ? fmt(initial[key]) : initial[key],
          after: fmt ? fmt(changes[key]) : changes[key],
          // The stored contact isn't loaded into the form, so there's no old value to show.
          beforeText: key === 'fire_reporter_contact' ? 'Previous number' : null,
        }))}
        note={closingNow && 'Closing this incident releases its active crews and trucks and adds it to the heatmap.'}
        saving={saving}
        error={error}
        onBack={() => { setError(null); setReviewing(false) }}
        onConfirm={confirmSave}
      />
    )}
    </>
  )
}
