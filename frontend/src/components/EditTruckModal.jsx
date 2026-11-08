import { useState, useEffect } from 'react'
import AppModal from './AppModal'
import '../styles/DispatchModal.css'
import '../styles/PersonnelFormModal.css'
import '../styles/EditFormModal.css'
import { fetchStations, updateTruck } from '../api'
import { TRUCK_STATUSES, statusMeta } from './resourceFormOptions'
import { Icon, Field, SectionHead, Segmented, FormStatus, ReviewChanges } from './incidentForm'

export default function EditTruckModal({ truck, onClose, onSubmit }) {
  const [initial] = useState(() => ({
    truck_platenum: truck.truck_platenum || '',
    truck_status:   truck.truck_status   || 'available',
    station_id:     truck.station_id != null ? String(truck.station_id) : '',
  }))
  const [form, setForm]         = useState(initial)
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [stations, setStations] = useState([])
  const [readinessNote, setReadinessNote] = useState('')

  useEffect(() => {
    fetchStations().then(setStations).catch(() => {})
  }, [])

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }))
    setError('')
  }

  const plate       = form.truck_platenum.trim()
  const effective   = { ...form, truck_platenum: plate }
  const changes     = Object.fromEntries(Object.entries(effective).filter(([k, v]) => v !== initial[k]))
  const changeCount = Object.keys(changes).length
  const isChanged   = field => field in changes
  const restoring = initial.truck_status !== 'available' && form.truck_status === 'available'

  const stationName = id => stations.find(s => String(s.station_id) === String(id))?.station_name ?? (id ? `Station #${id}` : '')
  const statusLabel = v => statusMeta(TRUCK_STATUSES, v).label

  function handleSubmit(e) {
    e.preventDefault()
    if (!plate) { setError('Plate number is required.'); return }
    if (restoring && !readinessNote.trim()) { setError('Record the resolution/readiness reason.'); return }
    if (changeCount === 0) return
    setReviewing(true)
  }

  async function confirmSave() {
    setSaving(true)
    setError('')
    try {
      const payload = {}
      if (isChanged('truck_platenum')) payload.truck_platenum = plate
      if (isChanged('truck_status'))   payload.truck_status   = form.truck_status
      if (restoring) payload.readiness_note = readinessNote.trim()
      if (isChanged('station_id'))     payload.station_id     = form.station_id ? Number(form.station_id) : null
      const updated = await updateTruck(truck.truck_id, payload)
      onSubmit(updated)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const rows = [
    ['truck_platenum', 'Plate number', v => v],
    ['station_id',     'Home station', stationName],
    ['truck_status',   'Status',       statusLabel],
  ]
    .filter(([key]) => isChanged(key))
    .map(([key, label, fmt]) => ({ key, label, before: fmt(initial[key]), after: fmt(changes[key]) }))
  if (restoring) rows.push({ key: 'readiness_note', label: 'Readiness confirmation', before: '', after: readinessNote.trim() })

  return (
    <>
      <AppModal
        variant="badged"
        icon={<Icon d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56ZM619-619l-28-29 57 57-29-28Z" className="cfm-badge-icon" />}
        eyebrow="EDIT TRUCK"
        title={plate || 'Untitled truck'}
        subtitle={stationName(initial.station_id) || 'No home station'}
        onClose={onClose}
        width={680}
        className="eim-panel edit-form-modal resource-form-modal"
        dismissible={!saving && !reviewing}
      >
        <form onSubmit={handleSubmit}>
          <div className="eim-body">
            <section className="eim-section">
              <SectionHead title="Truck" desc="Plate number and home station" />
              <div className="eim-row">
                <Field label="Plate number" required changed={isChanged('truck_platenum')}>
                  <input
                    className="frm-plate"
                    placeholder="e.g. ABC-1234"
                    value={form.truck_platenum}
                    onChange={e => set('truck_platenum', e.target.value.toUpperCase())}
                    aria-invalid={!plate || undefined}
                    autoFocus
                  />
                </Field>
                <Field label="Home station" changed={isChanged('station_id')}>
                  <select value={form.station_id} onChange={e => set('station_id', e.target.value)}>
                    <option value="">No station</option>
                    {stations.map(s => (
                      <option key={s.station_id} value={s.station_id}>{s.station_name}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </section>

            <section className="eim-section">
              <SectionHead title="Status" desc="Whether it can be sent out" changed={isChanged('truck_status')} />
              <Segmented label="Status" options={TRUCK_STATUSES.map(option => ({ ...option, disabled: ['dispatched', 'on_scene', 'returning'].includes(option.value) || ['dispatched', 'on_scene', 'returning'].includes(initial.truck_status) }))} value={form.truck_status} onChange={v => set('truck_status', v)} />
              {restoring && <Field label="Resolution / readiness reason" required><input value={readinessNote} onChange={event => setReadinessNote(event.target.value)} maxLength={255} placeholder="Who confirmed readiness and what was resolved?" /></Field>}
            </section>

            {error && !reviewing && <div className="apm-error">{error}</div>}
          </div>

          <div className="eim-footer">
            <FormStatus changeCount={changeCount} />
            <div className="eim-footer-actions">
              <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="apm-btn-submit" disabled={changeCount === 0 || !plate}>
                Review &amp; save
              </button>
            </div>
          </div>
        </form>
      </AppModal>

      {reviewing && (
        <ReviewChanges
          code={initial.truck_platenum}
          rows={rows}
          saving={saving}
          error={error}
          onBack={() => { setError(''); setReviewing(false) }}
          onConfirm={confirmSave}
        />
      )}
    </>
  )
}
