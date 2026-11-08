import { useState, useEffect } from 'react'
import AppModal from './AppModal'
import '../styles/DispatchModal.css'
import '../styles/PersonnelFormModal.css'
import { ICON_PLUS } from './incidentFormOptions'
import { fetchStations, fetchShifts, fetchTrucks, fetchTeams, createTeam } from '../api'
import { TEAM_STATUSES, statusMeta, assignableTrucks } from './resourceFormOptions'
import { Icon, Field, SectionHead, Segmented, FormStatus } from './incidentForm'

const toId = v => (v ? Number(v) : null)

export default function AddTeamModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    team_name:   '',
    team_code:   '',
    team_status: 'standby',
    station_id:  '',
    shift_id:    '',
    truck_id:    '',
  })
  const [stations, setStations] = useState([])
  const [shifts, setShifts]     = useState([])
  const [trucks, setTrucks]     = useState([])
  const [teams, setTeams]       = useState([])
  const [error, setError]       = useState('')
  const [saving, setSaving]     = useState(false)

  useEffect(() => {
    fetchStations().then(setStations).catch(() => {})
    fetchShifts().then(setShifts).catch(() => {})
    fetchTrucks().then(setTrucks).catch(() => {})
    fetchTeams().then(setTeams).catch(() => {})
  }, [])

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }))
    setError('')
  }

  // A truck belongs to a station and a shift slot; changing either can make
  // the picked truck invalid, so clear it.
  function setSlot(field, val) {
    setForm(f => ({ ...f, [field]: val, truck_id: '' }))
    setError('')
  }

  const name    = form.team_name.trim()
  const missing = [!name && 'team name'].filter(Boolean)
  const stationId = toId(form.station_id)
  const options = assignableTrucks(trucks, teams, { stationId, shiftId: toId(form.shift_id) })
  const shiftOptions = [{ value: '', label: 'None' }, ...shifts.map(s => ({ value: String(s.shift_id), label: s.shift_name }))]

  function handleSubmit(e) {
    e.preventDefault()
    if (missing.length) return
    setSaving(true)
    createTeam({
      team_name:   name,
      team_code:   form.team_code.trim() || null,
      team_status: form.team_status,
      station_id:  stationId,
      shift_id:    toId(form.shift_id),
      truck_id:    toId(form.truck_id),
    })
      .then(team => onSubmit(team))
      .catch(err => { setSaving(false); setError(err.message) })
  }

  return (
    <AppModal
      variant="badged"
      icon={<Icon d={ICON_PLUS} className="cfm-badge-icon" />}
      eyebrow="NEW TEAM"
      title={name || 'Create a team'}
      onClose={onClose}
      width={600}
      className="eim-panel team-form-modal"
      dismissible={!saving}
    >
      <form onSubmit={handleSubmit}>
        <div className="eim-body">
          <section className="eim-section">
            <SectionHead title="Team" desc="What dispatchers will see it as." />
            <div className="eim-row">
              <Field label="Team name" required>
                <input
                  placeholder="e.g. Alpha Response Team"
                  value={form.team_name}
                  onChange={e => set('team_name', e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Team code">
                <input
                  className="frm-plate"
                  placeholder="e.g. TM-A1"
                  value={form.team_code}
                  onChange={e => set('team_code', e.target.value.toUpperCase())}
                />
              </Field>
            </div>
          </section>

          <section className="eim-section">
            <SectionHead title="Assignment" desc="Where and when it works, and what it rides." />
            <Field label="Shift">
              <Segmented label="Shift" options={shiftOptions} value={form.shift_id} onChange={v => setSlot('shift_id', v)} />
            </Field>
            <div className="eim-row">
              <Field label="Home station">
                <select value={form.station_id} onChange={e => setSlot('station_id', e.target.value)}>
                  <option value="">No station yet</option>
                  {stations.map(s => (
                    <option key={s.station_id} value={s.station_id}>{s.station_name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Truck">
                <select value={form.truck_id} onChange={e => set('truck_id', e.target.value)} disabled={stationId === null}>
                  <option value="">
                    {stationId === null
                      ? 'Pick a station first'
                      : options.length === 0 ? 'No free trucks at this station' : 'No truck'}
                  </option>
                  {options.map(t => (
                    <option key={t.truck_id} value={t.truck_id}>{t.truck_platenum}</option>
                  ))}
                </select>
              </Field>
            </div>
          </section>

          <section className="eim-section">
            <SectionHead title="Status" desc="Whether it can take dispatches." />
            <Segmented label="Status" options={TEAM_STATUSES.filter(option => !['dispatched', 'on_scene', 'returning'].includes(option.value))} value={form.team_status} onChange={v => set('team_status', v)} />
            <div className="frm-hint">{statusMeta(TEAM_STATUSES, form.team_status).hint}</div>
          </section>

          {error && <div className="apm-error">{error}</div>}
        </div>

        <div className="eim-footer">
          <FormStatus missing={missing} />
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="apm-btn-submit" disabled={saving || missing.length > 0}>
              {saving ? <span className="apm-spinner" /> : 'Create team'}
            </button>
          </div>
        </div>
      </form>
    </AppModal>
  )
}
