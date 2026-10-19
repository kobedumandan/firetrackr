import { useState, useEffect } from 'react'
import ReportReceiptFields from './ReportReceiptFields'
import { fetchTeams } from '../api'
import {
  SEVERITIES, ALARMS, STRUCTURES,
  ICON_CLOSE, ICON_TRUCK, ICON_PLUS,
} from './incidentFormOptions'
import {
  Icon, Field, SectionHead, Segmented, StatusSteps, CasualtyPicker, LockedNote,
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
  fire_casualties:       'None',
  fire_units_assigned:   0,
  fire_reporter_name:    '',
  fire_reporter_contact: '',
  fire_location_source:  'manual',
  fire_remarks:          '',
}

// "YYYY-MM-DDTHH:mm" in local time, the format <input type="datetime-local"> uses.
function localInputValue(d) {
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
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
  // Live reports always start Pending; a past incident (logbook backfill, a call
  // handled offline) picks its own status and records when it happened.
  const [mode, setMode]             = useState('live')
  const [occurredAt, setOccurredAt] = useState('')
  const [receivedAt, setReceivedAt] = useState('')
  const [responseKind, setResponseKind] = useState('')

  const [allTeams, setAllTeams]     = useState([])
  const [units, setUnits]           = useState([])   // array of team objects
  const [unitSelect, setUnitSelect] = useState('')

  useEffect(() => {
    fetchTeams().then(setAllTeams).catch(() => {})
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  const isPast         = mode === 'past'
  const nowLocal       = localInputValue(new Date())
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
  ].filter(Boolean)

  function set(field, value) {
    setError(null)
    setForm(prev => ({ ...prev, [field]: value }))
  }

  function handleModeChange(value) {
    setError(null)
    setMode(value)
    if (value === 'past') {
      // Backfilled records are usually finished incidents.
      setForm(prev => ({ ...prev, fire_status: 'closed' }))
    } else {
      setForm(prev => ({ ...prev, fire_status: 'pending', fire_casualties: 'None', fire_remarks: '' }))
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
    if (!hasPin) {
      setError('Pick the incident location on the map.')
      return
    }
    if (!form.fire_location_name.trim()) {
      setError('Area / Barangay name is required.')
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
    setSaving(true)
    try {
      await onSubmit({
        ...form,
        report_received_at: receivedAt ? new Date(`${receivedAt}+08:00`).toISOString() : null,
        response_kind: responseKind || null,
        fire_latitude:       parseFloat(form.fire_latitude),
        fire_longitude:      parseFloat(form.fire_longitude),
        fire_units_assigned: showUnits ? units.length : 0,
        fire_casualties:     showCasualties ? form.fire_casualties : 'None',
        fire_remarks:        showRemarks ? form.fire_remarks : '',
        ...(isPast ? { fire_incident_datetime: new Date(occurredAt).toISOString() } : {}),
      })
    } catch (ex) {
      setError(ex.message)
      setSaving(false)
    }
  }

  return (
    <div className="apm-overlay" onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="apm-panel eim-panel lim-panel-split" role="dialog" aria-modal="true" aria-labelledby="lim-title">

        <div className="eim-header">
          <div className="eim-header-main">
            <div className="apm-eyebrow">{isPast ? 'PAST INCIDENT' : 'NEW INCIDENT'}</div>
            <div id="lim-title" className="eim-title">{form.fire_location_name.trim() || (isPast ? 'Record a past incident' : 'Log a new incident')}</div>
          </div>
          <button className="eim-close" onClick={onClose} aria-label="Close" disabled={saving}>
            <Icon d={ICON_CLOSE} />
          </button>
        </div>

        <div className="lim-layout">
          {/* ── Left rail: map picker ── */}
          <aside className="lim-rail-map" aria-label="Incident location">
            <MapPicker
              lat={form.fire_latitude}
              lng={form.fire_longitude}
              onChange={(lat, lng) => setForm(prev => ({ ...prev, fire_latitude: lat, fire_longitude: lng }))}
              onBoundsError={setMapError}
            />
            <PinStatus
              lat={form.fire_latitude}
              lng={form.fire_longitude}
              error={mapError}
              emptyText="No pin yet. Click inside the boundary to mark the incident."
            />
          </aside>

        {/* ── Right rail: details ── */}
        <form id="lim-form" className="eim-body lim-rail-form" onSubmit={handleSubmit}>
          <ReportReceiptFields receivedAt={receivedAt} kind={responseKind} onReceipt={setReceivedAt} onKind={setResponseKind} />

          {/* ── Report type ── */}
          <section className="eim-section">
            <SectionHead
              title="Report type"
              desc={isPast ? 'Already handled; recorded for the history.' : 'A fire happening now.'}
            />
            <Segmented label="Report type" options={REPORT_MODES} value={mode} onChange={handleModeChange} />
            {isPast ? (
              <Field label="When did it happen?" required className="lim-when">
                <input
                  type="datetime-local"
                  value={occurredAt}
                  max={nowLocal}
                  onChange={e => { setError(null); setOccurredAt(e.target.value) }}
                  aria-invalid={futureTime}
                />
              </Field>
            ) : (
              <div className="lim-live-note">
                Starts as <strong>Pending</strong> and is timestamped now. Dispatching a crew moves it forward.
              </div>
            )}
          </section>

          {/* ── Location ── */}
          <section className="eim-section">
            <SectionHead title="Location" desc="Name the area you pinned on the map." />
            <div className="eim-row">
              <Field label="Area / Barangay" required>
                <input
                  placeholder="e.g. Brgy. Kakar, Panabo"
                  value={form.fire_location_name}
                  onChange={e => set('fire_location_name', e.target.value)}
                />
              </Field>
              <Field label="Street address">
                <input
                  placeholder="e.g. 12 Rizal St."
                  value={form.fire_address}
                  onChange={e => set('fire_address', e.target.value)}
                />
              </Field>
            </div>
          </section>

          {/* ── Status (past incidents only; live reports start Pending) ── */}
          {isPast && (
            <section className="eim-section">
              <SectionHead title="Status" desc="How far the incident got." />
              <StatusSteps value={form.fire_status} onChange={handleStatusChange} />
            </section>
          )}

          {/* ── Assessment ── */}
          <section className="eim-section">
            <SectionHead title="Assessment" desc="How serious the fire looks from the report." />
            <Field label="Severity" required>
              <Segmented label="Severity" options={SEVERITIES} value={form.fire_severity} onChange={v => set('fire_severity', v)} />
            </Field>
            <div className="eim-row">
              <Field label="Alarm level">
                <Segmented label="Alarm level" options={ALARMS.map(a => ({ value: a, label: a.replace(' Alarm', '') }))} value={form.fire_alarm_level} onChange={v => set('fire_alarm_level', v)} />
              </Field>
              <Field label="Structure type">
                <select value={form.fire_structure_type} onChange={e => set('fire_structure_type', e.target.value)}>
                  {STRUCTURES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
          </section>

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
            <SectionHead title="Outcome" desc="Recorded once the fire is contained." />
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
                Set the status to <strong>Contained</strong> or <strong>Closed</strong> to record casualties and remarks.
              </LockedNote>
            )}
          </section>
          </>)}

          {/* ── Reporter ── */}
          <section className="eim-section">
            <SectionHead title="Reporter" desc="Who called it in." />
            <div className="eim-row">
              <Field label="Reported by">
                <input
                  placeholder="e.g. BFP Hotline · 911"
                  value={form.fire_reporter_name}
                  onChange={e => set('fire_reporter_name', e.target.value)}
                />
              </Field>
              <Field label="Contact number">
                <input
                  placeholder="e.g. 09XX-XXX-XXXX"
                  value={form.fire_reporter_contact}
                  onChange={e => set('fire_reporter_contact', e.target.value)}
                />
              </Field>
            </div>
          </section>

          {error && <div className="apm-error">{error}</div>}
        </form>
        </div>

        <div className="eim-footer">
          <span className={`eim-changes ${missing.length ? '' : 'ready'}`}>
            {missing.length ? `Still needed: ${missing.join(' and ')}` : 'Ready to log'}
          </span>
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" form="lim-form" className="apm-btn-submit" disabled={saving || missing.length > 0}>
              {saving ? <span className="apm-spinner" /> : isPast ? 'Record incident' : 'Log incident'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
