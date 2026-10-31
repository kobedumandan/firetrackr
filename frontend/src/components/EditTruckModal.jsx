import { useState, useEffect } from 'react'
import AppModal from './AppModal'
import '../styles/EditFormModal.css'
import { fetchStations, updateTruck } from '../api'
import { TRUCK_STATUSES, statusMeta } from './resourceFormOptions'
import { Field, SectionHead, Segmented, FormStatus, ReviewChanges } from './incidentForm'

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

  const stationName = id => stations.find(s => String(s.station_id) === String(id))?.station_name ?? (id ? `Station #${id}` : '')
  const statusLabel = v => statusMeta(TRUCK_STATUSES, v).label

  function handleSubmit(e) {
    e.preventDefault()
    if (!plate) { setError('Plate number is required.'); return }
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

  return (
    <>
      <AppModal
        eyebrow="EDIT TRUCK"
        title={plate || 'Untitled truck'}
        subtitle={stationName(initial.station_id) || 'No home station'}
        onClose={onClose}
        width={520}
        className="eim-panel edit-form-modal"
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
              <Segmented label="Status" options={TRUCK_STATUSES} value={form.truck_status} onChange={v => set('truck_status', v)} />
              <div className="frm-hint">{statusMeta(TRUCK_STATUSES, form.truck_status).hint.replace(/\.$/, '')}</div>
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
