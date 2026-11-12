import { useEffect, useState } from 'react'
import { updateIncident } from '../api'
import { incidentStage } from '../utils/incidentOperations'
import '../styles/EditFormModal.css'
import '../styles/ConfirmModal.css'
import {
  SEVERITIES, ALARMS, DISPATCH_TYPES, statusMetaOf, supportsFireAlarm,
  ICON_CLOSE, ICON_MINUS, ICON_PLUS, ICON_LOCK,
} from './incidentFormOptions'
import {
  Icon, Field, SectionHead, Segmented, StatusSteps, Callout,
  ReviewChanges, StructureTypeField,
} from './incidentForm'

// Review order and display labels for every editable field.
const FIELD_META = [
  ['record_kind',           'Record kind'],
  ['fire_status',           'Status'],
  ['fire_severity',         'Severity'],
  ['fire_alarm_level',      'Alarm level'],
  ['fire_structure_type',   'Structure type'],
  ['fire_dispatch_type',    'Dispatch type'],
  ['fire_units_assigned',   'Units assigned'],
  ['fire_location_name',    'Area / Barangay'],
  ['fire_address',          'Street address'],
  ['fire_reporter_name',    'Reported by'],
  ['fire_reporter_contact', 'Contact number'],
]

export default function EditIncidentModal({ incident, onClose, onSubmit }) {
  const [initial] = useState(() => ({
    record_kind:           incident.record_kind || 'unknown',
    fire_location_name:    incident.loc        || '',
    fire_address:          incident.addr       || '',
    fire_severity:         incident.sev        || 'Minor',
    fire_status:           incident.status     || 'pending',
    fire_alarm_level:      supportsFireAlarm(incident.dispatch_type) ? incident.alarm || '1st Alarm' : null,
    fire_structure_type:   supportsFireAlarm(incident.dispatch_type) ? incident.structure || 'Residential' : null,
    fire_dispatch_type:    incident.dispatch_type || '',
    fire_units_assigned:   incident.units      ?? 0,
    fire_reporter_name:    incident.reporter_name ?? (incident.reporter && incident.reporter !== '—' ? incident.reporter : ''),
    fire_reporter_contact: incident.reporter_contact || '',
  }))
  const [form, setForm] = useState(initial)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  const displayStatus  = incidentStage(incident) === 'operation_complete' ? 'operation_complete' : form.fire_status
  const statusMeta     = statusMetaOf(displayStatus, { ...incident, dispatch_type: form.fire_dispatch_type })
  const showFireAlarm  = supportsFireAlarm(form.fire_dispatch_type)

  // Outcome fields are managed in the dedicated after-action report modal.
  const effective = {
    ...form,
    fire_alarm_level: showFireAlarm ? form.fire_alarm_level || '1st Alarm' : null,
    fire_structure_type: showFireAlarm ? form.fire_structure_type || 'Residential' : null,
    fire_units_assigned: Number(form.fire_units_assigned) || 0,
  }
  // PATCH only what changed, including an explicitly cleared contact.
  const changes = Object.fromEntries(
    Object.entries(effective).filter(([k, v]) =>
      v !== initial[k],
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
    if (showFireAlarm && effective.fire_structure_type === 'Other' && isChanged('fire_structure_type')) {
      setError('Specify the structure type when Other is selected.')
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
      <div className="apm-panel eim-panel edit-form-modal incident-edit-modal" role="dialog" aria-modal="true" aria-labelledby="eim-title">

        <div className="cfm-head">
          <span className="cfm-badge">
            <Icon d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56ZM619-619l-28-29 57 57-29-28Z" className="cfm-badge-icon" />
          </span>
          <div className="cfm-head-text">
            <div className="apm-eyebrow">EDIT INCIDENT</div>
            <div id="eim-title" className="cfm-title">{form.fire_location_name.trim() || 'Untitled location'}</div>
          </div>
          <button className="eim-close" onClick={onClose} aria-label="Close" disabled={saving}>
            <Icon d={ICON_CLOSE} />
          </button>
          <div className="eim-subtitle">
            <span className="eim-chip eim-chip-code">{incident.id}</span>
            <span className="eim-chip">{statusMeta.label}</span>
            <span className="eim-chip">{form.fire_severity}</span>
            {showFireAlarm && <span className="eim-chip">{form.fire_alarm_level || '1st Alarm'}</span>}
          </div>
        </div>

        <form id="eim-form" className="eim-body" onSubmit={handleSubmit}>
          {/* ── Status progression ── */}
          <section className="eim-section">
            <SectionHead title="Status" desc="Where this incident is in its lifecycle" changed={isChanged('fire_status')} />
            <StatusSteps
              value={displayStatus}
              incident={{ ...incident, dispatch_type: form.fire_dispatch_type }}
              includeOperationComplete
              disabledValues={displayStatus === 'operation_complete' || ['closed', 'cancelled', 'canceled', 'recalled'].includes(incident.status) ? ['pending', 'dispatched', 'contained', 'closed'] : ['closed']}
              onChange={v => set('fire_status', v)}
              hint={statusMeta.hint.replace(/\.$/, '')}
            />
            <Callout>Record team release, operation completion and Review &amp; Close in the incident's Response &amp; Reporting section.</Callout>
          </section>

          {/* ── Assessment ── */}
          <section className="eim-section">
            <SectionHead title="Assessment" desc="Incident seriousness and the response assigned to it" />

            <Field label="Dispatch type" changed={isChanged('fire_dispatch_type')}>
              <select aria-label="Dispatch type" value={form.fire_dispatch_type} onChange={e => set('fire_dispatch_type', e.target.value)}>
                <option value="">Unspecified</option>
                {DISPATCH_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Severity" required changed={isChanged('fire_severity')}>
              <Segmented label="Severity" options={SEVERITIES} value={form.fire_severity} onChange={v => set('fire_severity', v)} />
              <span className="frm-hint">Overall incident seriousness, used for incident sorting and reporting across operation types.</span>
            </Field>

            {showFireAlarm && <Field label="Alarm level" changed={isChanged('fire_alarm_level')}>
              <Segmented label="Alarm level" options={ALARMS} value={form.fire_alarm_level || '1st Alarm'} onChange={v => set('fire_alarm_level', v)} />
            </Field>}

            <div className="eim-row">
              {showFireAlarm && <StructureTypeField value={effective.fire_structure_type} onChange={value => set('fire_structure_type', value)} changed={isChanged('fire_structure_type')} />}
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

          {/* ── Location ── */}
          <section className="eim-section">
            <SectionHead title="Location" desc="The pin can't be moved; only the labels can" />
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
            <SectionHead title="Reporter" desc="Who called it in" />
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
                  type="tel"
                  placeholder="e.g. 09171234567"
                  value={form.fire_reporter_contact}
                  onChange={e => set('fire_reporter_contact', e.target.value)}
                />
              </Field>
            </div>
          </section>

          <section className="eim-section eim-record-kind">
            <Field label="Record kind" changed={isChanged('record_kind')}>
              <select value={form.record_kind} onChange={e => set('record_kind', e.target.value)}>
                {['operational', 'drill', 'test', 'unknown'].map(kind => (
                  <option key={kind} value={kind}>{kind.charAt(0).toUpperCase() + kind.slice(1)}</option>
                ))}
              </select>
            </Field>
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
          before: key === 'fire_status' ? statusMetaOf(initial[key], { ...incident, dispatch_type: initial.fire_dispatch_type }).label : fmt ? fmt(initial[key]) : initial[key],
          after: key === 'fire_status' ? statusMetaOf(changes[key], { ...incident, dispatch_type: form.fire_dispatch_type }).label : fmt ? fmt(changes[key]) : changes[key],
        }))}
        note="Operational completion and report closure are recorded separately in Response & Reporting."
        saving={saving}
        error={error}
        onBack={() => { setError(null); setReviewing(false) }}
        onConfirm={confirmSave}
      />
    )}
    </>
  )
}
