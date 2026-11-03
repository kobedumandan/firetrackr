import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { updateStation } from '../api'
import '../styles/AppModal.css'
import '../styles/EditFormModal.css'
import { phoneError, STATION_TYPES, STATION_STATUSES, statusMeta } from './resourceFormOptions'
import { ICON_CLOSE } from './incidentFormOptions'
import { Icon, Field, SectionHead, FormStatus, LockedNote, ReviewChanges } from './incidentForm'
import { MapPicker, PinStatus } from './MapPicker'
import { StationDetailsSections } from './stationForm'

const clean = v => (v === '—' || v == null ? '' : String(v))
const fmtCoords = (lat, lng) => (lat !== '' && lng !== '' ? `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}` : '')

// Review order and labels (location is handled as one row).
const FIELD_META = [
  ['station_name',         'Station name'],
  ['station_type',         'Type'],
  ['parent_station_id',    'Reports to'],
  ['station_address',      'Street address'],
  ['station_barangay',     'Barangay'],
  ['station_contact',      'Contact number'],
  ['station_status',       'Status'],
  ['station_commander_id', 'Commander'],
]

export default function EditStationModal({ station, onClose, onSaved, stations }) {
  const numericId = parseInt(station.id.replace('STA-', ''), 10)

  const [initial] = useState(() => ({
    station_name:         station.name,
    station_type:         station.type,
    parent_station_id:    station.parent ? String(parseInt(station.parent.replace('STA-', ''), 10)) : '',
    station_address:      clean(station.address),
    station_barangay:     clean(station.district),
    station_latitude:     station.latitude ?? '',
    station_longitude:    station.longitude ?? '',
    station_contact:      clean(station.contact),
    station_status:       station.status,
    station_commander_id: station.commanderId ? String(station.commanderId) : '',
  }))
  const [form, setForm]           = useState(initial)
  const [error, setError]         = useState(null)
  const [mapError, setMapError]   = useState(null)
  const [saving, setSaving]       = useState(false)
  const [reviewing, setReviewing] = useState(false)

  useEffect(() => {
    if (reviewing) return
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving, reviewing])

  function set(field, value) {
    setError(null)
    setForm(prev => ({ ...prev, [field]: value }))
  }

  // ── What changed ──
  const effective = {
    ...form,
    station_name:     form.station_name.trim(),
    station_address:  form.station_address.trim(),
    station_barangay: form.station_barangay.trim(),
    station_contact:  form.station_contact.trim(),
    parent_station_id: form.station_type === 'sub' ? form.parent_station_id : '',
  }
  const moved = effective.station_latitude !== initial.station_latitude || effective.station_longitude !== initial.station_longitude
  const changes = Object.fromEntries(
    FIELD_META.map(([k]) => k).filter(k => effective[k] !== initial[k]).map(k => [k, effective[k]]),
  )
  const changeCount = Object.keys(changes).length + (moved ? 1 : 0)
  const isChanged = field => field in changes

  const contactError = phoneError(form.station_contact)
  const blocked =
    !effective.station_name || !effective.station_address || !effective.station_barangay || !effective.station_contact ||
    (form.station_type === 'sub' && !form.parent_station_id) || !!contactError

  // ── Display helpers ──
  const mainStations = stations.filter(s => s.type === 'main' && s.id !== station.id)
  const stationName  = id => (id ? stations.find(s => String(parseInt(s.id.replace('STA-', ''), 10)) === id)?.name ?? `Station #${id}` : '')
  const personName   = id => station.personnelList.find(p => String(p.per_id) === id)?.name ?? (id ? `Personnel #${id}` : '')
  const fmt = {
    station_type:         v => statusMeta(STATION_TYPES, v).label,
    station_status:       v => statusMeta(STATION_STATUSES, v).label,
    parent_station_id:    stationName,
    station_commander_id: personName,
  }
  const commander = station.personnelList.find(p => String(p.per_id) === form.station_commander_id)

  function handleSubmit(e) {
    e.preventDefault()
    if (blocked || changeCount === 0) return
    setReviewing(true)
  }

  async function confirmSave() {
    setSaving(true)
    setError(null)
    try {
      const body = {}
      for (const [k, v] of Object.entries(changes)) {
        body[k] = k === 'parent_station_id' || k === 'station_commander_id' ? (v ? parseInt(v, 10) : null) : v
      }
      // Switching to a main station clears its parent.
      if (isChanged('station_type') && effective.station_type === 'main') body.parent_station_id = null
      if (moved) {
        body.station_latitude  = parseFloat(effective.station_latitude)
        body.station_longitude = parseFloat(effective.station_longitude)
      }
      await updateStation(numericId, body)
      onSaved()
      onClose()
    } catch (ex) {
      setError(ex.message)
      setSaving(false)
    }
  }

  const rows = [
    ...FIELD_META.filter(([key]) => isChanged(key)).map(([key, label]) => ({
      key,
      label,
      before: fmt[key] ? fmt[key](initial[key]) : initial[key],
      after:  fmt[key] ? fmt[key](changes[key]) : changes[key],
    })),
    ...(moved ? [{
      key: 'loc',
      label: 'Map location',
      before: fmtCoords(initial.station_latitude, initial.station_longitude),
      after:  fmtCoords(effective.station_latitude, effective.station_longitude),
    }] : []),
  ]

  const hadPin = initial.station_latitude !== '' && initial.station_longitude !== ''

  return (
    <>
      {createPortal(
        <div className="apm-overlay" onMouseDown={e => e.target === e.currentTarget && !saving && !reviewing && onClose()}>
          <div className="apm-panel eim-panel lim-panel-split stn-panel edit-form-modal" role="dialog" aria-modal="true" aria-labelledby="esm-title">
            <div className="eim-header">
              <div className="eim-header-main">
                <div className="apm-eyebrow">EDIT STATION</div>
                <div id="esm-title" className="eim-title">{effective.station_name || 'Untitled station'}</div>
                <div className="apm-subtitle">
                  {[station.code, statusMeta(STATION_TYPES, initial.station_type).label, initial.station_barangay].filter(Boolean).map((part, index) => (
                    <span key={index}>
                      {index > 0 && <span className="edit-form-separator" aria-hidden="true"> | </span>}
                      {part}
                    </span>
                  ))}
                </div>
              </div>
              <button className="eim-close" onClick={onClose} aria-label="Close" disabled={saving}>
                <Icon d={ICON_CLOSE} />
              </button>
            </div>

            <div className="lim-layout">
              <aside className="lim-rail-map" aria-label="Station location">
                <MapPicker
                  lat={form.station_latitude}
                  lng={form.station_longitude}
                  onChange={(lat, lng) => setForm(prev => ({ ...prev, station_latitude: lat, station_longitude: lng }))}
                  onBoundsError={setMapError}
                  prompt="Click the map where the station is"
                  ghost={moved && hadPin ? [initial.station_latitude, initial.station_longitude] : null}
                />
                <PinStatus
                  lat={form.station_latitude}
                  lng={form.station_longitude}
                  error={mapError}
                  emptyText="No location on record. Click the map to set one"
                >
                  {moved && (
                    <>
                      <span className="stn-moved">Moved</span>
                      <button
                        type="button"
                        className="eim-link-btn stn-reset"
                        onClick={() => setForm(prev => ({ ...prev, station_latitude: initial.station_latitude, station_longitude: initial.station_longitude }))}
                      >
                        Undo
                      </button>
                    </>
                  )}
                </PinStatus>
              </aside>

              <form id="esm-form" className="eim-body lim-rail-form" onSubmit={handleSubmit}>
                <StationDetailsSections
                  form={form}
                  set={set}
                  isChanged={isChanged}
                  mainStations={mainStations}
                  contactError={contactError}
                  editing
                />

                <section className="eim-section">
                  <SectionHead title="Head of command" desc="Chosen from personnel at this station" changed={isChanged('station_commander_id')} />
                  {station.personnelList.length === 0 ? (
                    <LockedNote>No personnel at this station yet. Assign people here first, then pick a commander</LockedNote>
                  ) : (
                    <>
                      <Field label="Station commander" changed={isChanged('station_commander_id')}>
                        <select value={form.station_commander_id} onChange={e => set('station_commander_id', e.target.value)}>
                          <option value="">No commander</option>
                          {station.personnelList.map(p => (
                            <option key={p.per_id} value={String(p.per_id)}>
                              {p.rank && p.rank !== '—' ? `${p.rank} · ` : ''}{p.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      {commander && (
                        <div className="lim-unit stn-commander">
                          <span className="lim-unit-av frm-initials">{commander.initials}</span>
                          <span className="lim-unit-info">
                            <span className="lim-unit-name">{commander.name}</span>
                            {commander.rank && commander.rank !== '—' && <span className="lim-unit-sub">{commander.rank}</span>}
                          </span>
                          <span className="frm-tag stn-cmd-tag">Commander</span>
                        </div>
                      )}
                    </>
                  )}
                </section>

                {error && !reviewing && <div className="apm-error">{error}</div>}
              </form>
            </div>

            <div className="eim-footer">
              <FormStatus changeCount={changeCount} />
              <div className="eim-footer-actions">
                <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
                <button type="submit" form="esm-form" className="apm-btn-submit" disabled={changeCount === 0 || blocked}>
                  Review &amp; save
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {reviewing && (
        <ReviewChanges
          code={station.code}
          rows={rows}
          note={moved && 'Moving the station changes where its routes and coverage are measured from.'}
          saving={saving}
          error={error}
          onBack={() => { setError(null); setReviewing(false) }}
          onConfirm={confirmSave}
        />
      )}
    </>
  )
}
