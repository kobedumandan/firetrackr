import { useState, useEffect, useRef } from 'react'
import AppModal from './AppModal'
import '../styles/DispatchModal.css'
import '../styles/LogIncidentModal.css'
import { IntakeSection, IntakeDisclosure, IntakeReceipt } from './IncidentIntakeSection'
import { manilaInput } from '../utils/operationalTimes'
import { incidentControl } from '../utils/incidentOperations'
import { fetchTeams } from '../api'
import { useIncidentBarangay } from '../hooks/useIncidentBarangay'
import {
  SEVERITIES, ALARMS, DISPATCH_TYPES, supportsFireAlarm, defaultResponseKind,
  ICON_CLOSE, ICON_TRUCK, ICON_PLUS,
} from './incidentFormOptions'
import {
  Icon, Field, SectionHead, Segmented, StatusSteps, CasualtyPicker, LockedNote, StructureTypeField,
} from './incidentForm'
import { MapPicker, PinStatus } from './MapPicker'

const EMPTY = {
  fire_location_name:    '',
  fire_address:          '',
  fire_latitude:         '',
  fire_longitude:        '',
  fire_severity:         'Minor',
  fire_status:           'pending',
  fire_alarm_level:      '1st Alarm',
  fire_structure_type:   'Residential',
  fire_dispatch_type:    'Firefighting Operations',
  fire_casualties:       'Unconfirmed',
  fire_units_assigned:   0,
  fire_reporter_name:    '',
  fire_reporter_contact: '',
  fire_location_source:  'manual',
  fire_remarks:          '',
}

const REPORT_MODES = [
  { value: 'live', label: 'Live report' },
  { value: 'past', label: 'Past incident' },
]

const teamLabel = t => `${t.team_name}${t.team_code ? ` · ${t.team_code}` : ''}`

export default function LogIncidentModal({ onClose, onSubmit }) {
  const [form, setForm]         = useState(EMPTY)
  const [mapError, setMapError] = useState(null)
  const [error, setError]       = useState(null)
  const [saving, setSaving]     = useState(false)
  const submitting = useRef(false)
  // Live reports always start Pending; a past incident (logbook backfill, a call
  // handled offline) picks its own status and records when it happened.
  const [mode, setMode]             = useState('live')
  const [occurredAt, setOccurredAt] = useState('')
  const [receivedAt, setReceivedAt] = useState(() => manilaInput())
  const [recordKind, setRecordKind] = useState('operational')
  const [responseKind, setResponseKind] = useState(() => defaultResponseKind(EMPTY.fire_dispatch_type))

  const [allTeams, setAllTeams]     = useState([])
  const [units, setUnits]           = useState([])   // array of team objects
  const [unitSelect, setUnitSelect] = useState('')
  const { detecting, hint: barangayHint, markEdited } = useIncidentBarangay(
    form.fire_latitude, form.fire_longitude, setForm, 'fire_location_name',
  )

  useEffect(() => {
    if (mode !== 'past') return
    fetchTeams().then(setAllTeams).catch(() => {})
  }, [mode])

  const isPast         = mode === 'past'
  const showFireAlarm   = supportsFireAlarm(form.fire_dispatch_type)
  const nowLocal       = manilaInput().slice(0, 16)
  const futureTime     = isPast && occurredAt !== '' && occurredAt > nowLocal
  const showUnits      = form.fire_status !== 'pending'
  const showCasualties = form.fire_status === 'contained' || form.fire_status === 'closed'
  const showRemarks    = form.fire_status === 'closed'
  const hasPin         = form.fire_latitude !== '' && form.fire_longitude !== ''
  const availableTeams = allTeams.filter(t => !units.some(u => u.team_id === t.team_id))

  const missing = [
    !hasPin && 'map pin',
    !form.fire_location_name.trim() && 'area name',
    isPast && !occurredAt && 'incident time',
    showFireAlarm && (!form.fire_structure_type.trim() || form.fire_structure_type === 'Other') && 'structure type',
  ].filter(Boolean)

  function set(field, value) {
    if (field === 'fire_location_name') markEdited()
    if (field === 'fire_dispatch_type') setResponseKind(defaultResponseKind(value))
    setError(null)
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleModeChange(value) {
    if (value === mode) return
    setError(null)
    setMode(value)
    setReceivedAt(value === 'past' ? '' : manilaInput())
    setRecordKind(value === 'past' ? 'unknown' : 'operational')
    if (value === 'past') {
      // Backfilled records are usually finished incidents.
      setForm(prev => ({ ...prev, fire_status: 'closed' }))
    } else {
      setForm(prev => ({ ...prev, fire_status: 'pending', fire_casualties: 'Unconfirmed', fire_remarks: '' }))
      setUnits([])
      setOccurredAt('')
    }
  }

  function handleStatusChange(value) {
    set('fire_status', value)
    if (value === 'pending') setUnits([])
  }

  function addUnit() {
    const team = allTeams.find(t => t.team_id === Number(unitSelect))
    if (!team) return
    setUnits(prev => [...prev, team])
    setUnitSelect('')
  }

  function removeUnit(teamId) {
    setUnits(prev => prev.filter(t => t.team_id !== teamId))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting.current || detecting) return
    if (!hasPin) {
      setError('Pick the incident location on the map.')
      return
    }
    if (!form.fire_location_name.trim()) {
      setError('Area / Barangay name is required.')
      return
    }
    if (showFireAlarm && (!form.fire_structure_type.trim() || form.fire_structure_type === 'Other')) {
      setError('Specify the structure type when Other is selected.')
      return
    }
    if (isPast && !occurredAt) {
      setError('Enter when the incident happened.')
      return
    }
    if (futureTime) {
      setError("Incident time can't be in the future.")
      return
    }
    submitting.current = true
    setSaving(true)
    try {
      await onSubmit({
        ...form,
        fire_structure_type: showFireAlarm ? form.fire_structure_type.trim() : null,
        fire_alarm_level: showFireAlarm ? form.fire_alarm_level : null,
        report_received_at: receivedAt ? new Date(`${receivedAt}+08:00`).toISOString() : null,
        response_kind: responseKind || null,
        record_kind: recordKind,
        fire_latitude:       parseFloat(form.fire_latitude),
        fire_longitude:      parseFloat(form.fire_longitude),
        fire_units_assigned: showUnits ? units.length : 0,
        fire_casualties:     showCasualties ? form.fire_casualties : null,
        fire_remarks:        showRemarks ? form.fire_remarks : '',
        ...(isPast ? { fire_incident_datetime: new Date(`${occurredAt}+08:00`).toISOString() } : {}),
      })
    } catch (ex) {
      setError(ex.message || 'Failed to log incident')
      setSaving(false)
      submitting.current = false
    }
  }

  return (
    <AppModal
      variant="badged"
      icon={<Icon d={ICON_PLUS} className="cfm-badge-icon" />}
      eyebrow={isPast ? 'PAST INCIDENT' : 'NEW INCIDENT'}
      title={isPast ? 'Record a past incident' : 'Log a new incident'}
      subtitle={isPast ? 'Record the location, assessment and known outcome.' : 'Pin the location, confirm the assessment and log the report.'}
      onClose={onClose}
      width={1160}
      className="eim-panel lim-panel-split intake-panel log-incident-modal"
      dismissible={!saving}
      manageFocus
    >
        <fieldset className="intake-fields intake-mode" disabled={saving} aria-label="Report type">
          <Segmented label="Report type" options={REPORT_MODES} value={mode} onChange={handleModeChange} />
          <span className="intake-mode-note">{isPast ? 'For logbook entries and incidents handled offline.' : 'Starts as Pending. Dispatch a crew after logging.'}</span>
        </fieldset>

        <div className="lim-layout">
          {/* ── Left rail: map picker ── */}
          <aside className="lim-rail-map intake-location" aria-label="Incident location" inert={saving}>
            <IntakeSection title="Location" desc="Pin the incident to detect its barangay">
            <MapPicker
              lat={form.fire_latitude}
              lng={form.fire_longitude}
              onChange={(lat, lng) => {
                setError(null)
                setForm(prev => ({
                  ...prev, fire_latitude: lat, fire_longitude: lng,
                  fire_location_name: prev.fire_latitude === '' || (prev.fire_latitude === lat && prev.fire_longitude === lng) ? prev.fire_location_name : '',
                }))
              }}
              onBoundsError={setMapError}
            />
            <PinStatus
              lat={form.fire_latitude}
              lng={form.fire_longitude}
              error={mapError}
              emptyText="No pin yet. Click inside the boundary to mark the incident."
            />
            <div className="eim-row">
              <Field label="Area / Barangay" required>
                <div className="barangay-input-wrap">
                <input
                  placeholder="Filled automatically from the map pin"
                  aria-label="Area / Barangay"
                  aria-describedby="lim-barangay-hint"
                  aria-busy={detecting}
                  form="lim-form"
                  required
                  value={form.fire_location_name}
                  onChange={e => set('fire_location_name', e.target.value)}
                  data-autofocus
                />
                {detecting && <span className="apm-spinner barangay-input-spinner" aria-hidden="true" />}
                </div>
                <span id="lim-barangay-hint" className="frm-hint" aria-live="polite">{barangayHint}</span>
              </Field>
              <Field label="Street / landmark">
                <input
                  placeholder="e.g. Rizal St., near the church"
                  aria-label="Street / landmark"
                  form="lim-form"
                  value={form.fire_address}
                  onChange={e => set('fire_address', e.target.value)}
                />
              </Field>
            </div>
            </IntakeSection>
          </aside>

        {/* ── Right rail: details ── */}
        <form id="lim-form" className="eim-body lim-rail-form" onSubmit={handleSubmit} aria-busy={saving}>
          <fieldset className="intake-fields" disabled={saving}>
          {isPast && (
            <IntakeSection title="Incident history" desc="Use Philippine time">
              <Field label="When did it happen? · Philippine time" required>
                <input
                  type="datetime-local"
                  aria-label="Incident time in Philippine time"
                  value={occurredAt}
                  max={nowLocal}
                  onChange={e => { setError(null); setOccurredAt(e.target.value) }}
                  aria-invalid={futureTime}
                />
                {futureTime && <span className="frm-field-err">Incident time can't be in the future.</span>}
              </Field>
              <StatusSteps value={form.fire_status} incident={form} onChange={handleStatusChange} />
            </IntakeSection>
          )}

          {/* ── Assessment ── */}
          <IntakeSection title="Assessment" desc="Confirm the initial report" className="lim-assessment">
            <Field label="Dispatch type">
              <select aria-label="Dispatch type" value={form.fire_dispatch_type} onChange={e => set('fire_dispatch_type', e.target.value)}>
                {DISPATCH_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </Field>
            <Field label="Severity" required>
              <Segmented label="Severity" options={SEVERITIES} value={form.fire_severity} onChange={v => set('fire_severity', v)} />
              <span className="frm-hint">Overall incident seriousness, used for incident sorting and reporting across operation types.</span>
            </Field>
            <div className="eim-row">
              {showFireAlarm && <Field label="Alarm level">
                <Segmented label="Alarm level" options={ALARMS.map(a => ({ value: a, label: a.replace(' Alarm', '') }))} value={form.fire_alarm_level} onChange={v => set('fire_alarm_level', v)} />
              </Field>}
              {showFireAlarm && <StructureTypeField value={form.fire_structure_type} onChange={value => set('fire_structure_type', value)} />}
            </div>
          </IntakeSection>

          {!isPast && <div className="intake-status-note"><span className="eim-chip">Pending</span><span>Log the report, then assign a crew from the incident panel.</span></div>}

          {isPast && (<>
          {/* ── Units ── */}
          <section className="eim-section">
            <SectionHead title="Units" desc={showUnits ? `${units.length} ${units.length === 1 ? 'team' : 'teams'} on this incident` : 'Teams already responding.'} />
            {showUnits ? (
              <>
                {units.length > 0 && (
                  <ul className="lim-units">
                    {units.map(t => (
                      <li key={t.team_id} className="lim-unit">
                        <span className="lim-unit-av"><Icon d={ICON_TRUCK} /></span>
                        <span className="lim-unit-info">
                          <span className="lim-unit-name">{teamLabel(t)}</span>
                          {t.station_name && t.station_name !== '—' && <span className="lim-unit-sub">{t.station_name}</span>}
                        </span>
                        <button type="button" className="lim-unit-rm" onClick={() => removeUnit(t.team_id)} aria-label={`Remove ${t.team_name}`}>
                          <Icon d={ICON_CLOSE} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="lim-unit-add">
                  <select value={unitSelect} onChange={e => setUnitSelect(e.target.value)} disabled={availableTeams.length === 0}>
                    <option value="">{availableTeams.length ? 'Choose a team to add' : 'No more teams available'}</option>
                    {availableTeams.map(t => (
                      <option key={t.team_id} value={t.team_id}>
                        {teamLabel(t)}{t.station_name && t.station_name !== '—' ? ` (${t.station_name})` : ''}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="lim-unit-add-btn" onClick={addUnit} disabled={!unitSelect}>
                    <Icon d={ICON_PLUS} /> Add
                  </button>
                </div>
              </>
            ) : (
              <LockedNote>Units can be added once the status is past <strong>Pending</strong>.</LockedNote>
            )}
          </section>

          {/* ── Outcome ── */}
          <section className="eim-section">
            <SectionHead title="Outcome" desc="Recorded once the situation is under control." />
            {showCasualties ? (
              <>
                <Field label="Casualties">
                  <CasualtyPicker value={form.fire_casualties} onChange={v => set('fire_casualties', v)} />
                </Field>
                {showRemarks && (
                  <Field label="Remarks / report">
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
                Set the status to <strong>{incidentControl(form).label}</strong> or <strong>Closed</strong> to record casualties and remarks.
              </LockedNote>
            )}
          </section>
          </>)}

          {/* ── Reporter ── */}
          <IntakeDisclosure title="Reporter details" summary={[form.fire_reporter_name, form.fire_reporter_contact].filter(Boolean).join(' · ') || 'Optional · add the caller and contact number'}>
            <div className="eim-row">
              <Field label="Reported by">
                <input
                  placeholder="e.g. BFP Hotline · 911"
                  value={form.fire_reporter_name}
                  onChange={e => set('fire_reporter_name', e.target.value)}
                  aria-label="Reported by"
                />
              </Field>
              <Field label="Contact number">
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="e.g. 09XX-XXX-XXXX"
                  value={form.fire_reporter_contact}
                  onChange={e => set('fire_reporter_contact', e.target.value)}
                  aria-label="Contact number"
                />
                <span className="frm-hint">Optional. Add a number for follow-up if available.</span>
              </Field>
            </div>
          </IntakeDisclosure>
          <IntakeReceipt key={mode} dispatchType={form.fire_dispatch_type} defaultOpen={isPast} receivedAt={receivedAt} kind={responseKind} onReceipt={setReceivedAt} onKind={setResponseKind} recordKind={recordKind} onRecordKind={setRecordKind} />
          </fieldset>
        </form>
        </div>

        {error && <div className="apm-error intake-error" role="alert">{error}</div>}

        <div className="eim-footer">
          <span className={`eim-changes ${detecting || missing.length || futureTime ? '' : 'ready'}`} role="status">
            {detecting ? 'Detecting barangay…' : futureTime ? 'Incident time is in the future' : missing.length ? `Still needed: ${missing.join(' and ')}` : 'Ready to log'}
          </span>
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" form="lim-form" className="apm-btn-submit" disabled={saving || detecting || missing.length > 0 || futureTime}>
              {saving ? <><span className="apm-spinner" /> Logging…</> : isPast ? 'Record incident' : 'Log incident'}
            </button>
          </div>
        </div>

    </AppModal>
  )
}
