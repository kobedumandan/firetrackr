import { useState, useEffect } from 'react'
import AppModal from './AppModal'
import '../styles/DispatchModal.css'
import '../styles/PersonnelFormModal.css'
import { ICON_PLUS } from './incidentFormOptions'
import { fetchStations } from '../api'
import { TRUCK_STATUSES, statusMeta } from './resourceFormOptions'
import { Icon, Field, SectionHead, Segmented, FormStatus } from './incidentForm'

export default function AddTruckModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    truck_platenum: '',
    truck_status:   'available',
    station_id:     '',
  })
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)
  const [stations, setStations] = useState([])

  useEffect(() => {
    fetchStations().then(setStations).catch(() => {})
  }, [])

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }))
    setError('')
  }

  const plate   = form.truck_platenum.trim()
  const missing = [!plate && 'plate number'].filter(Boolean)

  async function handleSubmit(e) {
    e.preventDefault()
    if (missing.length) return
    setSaving(true)
    setError('')
    try {
      await onSubmit({
        truck_platenum: plate,
        truck_status:   form.truck_status,
        station_id:     form.station_id ? Number(form.station_id) : null,
      })
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <AppModal
      variant="badged"
      icon={<Icon d={ICON_PLUS} className="cfm-badge-icon" />}
      eyebrow="NEW TRUCK"
      title={plate || 'Add a truck'}
      onClose={onClose}
      width={520}
      className="eim-panel resource-form-modal add-truck-modal"
      dismissible={!saving}
    >
      <form onSubmit={handleSubmit}>
        <div className="eim-body">
          <section className="eim-section">
            <SectionHead title="Truck" desc="Plate number and home station." />
            <div className="eim-row">
              <Field label="Plate number" required>
                <input
                  className="frm-plate"
                  placeholder="e.g. ABC-1234"
                  value={form.truck_platenum}
                  onChange={e => set('truck_platenum', e.target.value.toUpperCase())}
                  autoFocus
                />
              </Field>
              <Field label="Home station">
                <select value={form.station_id} onChange={e => set('station_id', e.target.value)}>
                  <option value="">No station yet</option>
                  {stations.map(s => (
                    <option key={s.station_id} value={s.station_id}>{s.station_name}</option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <section className="eim-section">
            <SectionHead title="Status" desc="Whether it can be sent out." />
            <Segmented label="Status" options={TRUCK_STATUSES.filter(option => !['dispatched', 'on_scene', 'returning'].includes(option.value))} value={form.truck_status} onChange={v => set('truck_status', v)} />
            <div className="frm-hint">{statusMeta(TRUCK_STATUSES, form.truck_status).hint}</div>
          </section>

          {error && <div className="apm-error">{error}</div>}
        </div>

        <div className="eim-footer">
          <FormStatus missing={missing} />
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="apm-btn-submit" disabled={saving || missing.length > 0}>
              {saving ? <span className="apm-spinner" /> : 'Add truck'}
            </button>
          </div>
        </div>
      </form>
    </AppModal>
  )
}
