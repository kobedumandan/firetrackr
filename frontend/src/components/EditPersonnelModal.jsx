import { useState, useEffect } from 'react'
import AppModal from './AppModal'
import '../styles/EditFormModal.css'
import { fetchStations, fetchTeams, fetchShifts, updatePersonnel } from '../api'
import { RANKS, DESIGNATIONS, phoneError, emailError, passwordErrors, ICON_KEY } from './resourceFormOptions'
import {
  Icon, Field, SectionHead, Segmented, FieldError, FormStatus, PasswordInput, Callout, LockedNote,
  ReviewChanges,
} from './incidentForm'

const idStr = v => (v != null && v !== '' ? String(v) : '')

// Review order and labels.
const FIELD_META = [
  ['per_firstname',   'First name'],
  ['per_lastname',    'Last name'],
  ['per_contact',     'Contact number'],
  ['per_rank',        'Rank'],
  ['per_designation', 'Designation'],
  ['station_id',      'Home station'],
  ['shift_id',        'Shift'],
  ['user_email',      'Email'],
]

export default function EditPersonnelModal({ personnel, onClose, onSubmit }) {
  const [initial] = useState(() => {
    const parts = (personnel.name || '').split(' ')
    return {
      per_firstname:   parts[0] || '',
      per_lastname:    parts.slice(1).join(' '),
      per_contact:     personnel.phone       || '',
      per_rank:        personnel.rank        || '',
      per_designation: personnel.designation || '',
      station_id:      idStr(personnel.station_id),
      shift_id:        idStr(personnel.shift_id),
      user_email:      personnel.email       || '',
    }
  })
  const [form, setForm]           = useState(initial)
  const [pwdOpen, setPwdOpen]     = useState(false)
  const [pwd, setPwd]             = useState({ password: '', confirm: '' })
  const [error, setError]         = useState('')
  const [saving, setSaving]       = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [stations, setStations]   = useState([])
  const [teams, setTeams]         = useState([])
  const [shifts, setShifts]       = useState([])

  useEffect(() => {
    fetchStations().then(setStations).catch(() => {})
    fetchTeams().then(setTeams).catch(() => {})
    fetchShifts().then(setShifts).catch(() => {})
  }, [])

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }))
    setError('')
  }

  function closePassword() {
    setPwdOpen(false)
    setPwd({ password: '', confirm: '' })
  }

  const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]))
  const changes = Object.fromEntries(Object.entries(trimmed).filter(([k, v]) => v !== initial[k]))
  const pwdSet  = pwdOpen && pwd.password !== ''
  const changeCount = Object.keys(changes).length + (pwdSet ? 1 : 0)
  const isChanged   = field => field in changes

  const errs = {
    contact: phoneError(form.per_contact),
    email:   emailError(form.user_email),
    ...(pwdOpen ? passwordErrors(pwd.password, pwd.confirm, { required: false }) : {}),
  }
  const missingName = !trimmed.per_firstname || !trimmed.per_lastname
  const pwdIncomplete = pwdOpen && (pwd.password || pwd.confirm) && (!pwd.password || !pwd.confirm)
  const blocked = missingName || !trimmed.per_rank || Object.values(errs).some(Boolean) || pwdIncomplete

  const stationName = id => stations.find(s => String(s.station_id) === id)?.station_name ?? (id ? `Station #${id}` : '')
  const shiftName   = id => shifts.find(s => String(s.shift_id) === id)?.shift_name ?? (id ? `Shift #${id}` : '')
  const shiftOptions = [{ value: '', label: 'None' }, ...shifts.map(s => ({ value: String(s.shift_id), label: s.shift_name }))]

  // Team membership is managed on the Teams page; flag a shift that no longer matches it.
  const team = personnel.team_id != null ? teams.find(t => t.team_id === personnel.team_id) : null
  const teamName = personnel.team_name && personnel.team_name !== '—' ? personnel.team_name : null
  const shiftMismatch = team && team.shift_id != null && form.shift_id !== '' && String(team.shift_id) !== form.shift_id

  const fullName = `${trimmed.per_firstname} ${trimmed.per_lastname}`.trim()
  const subtitle = [initial.per_rank, teamName].filter(Boolean)

  function handleSubmit(e) {
    e.preventDefault()
    if (blocked || changeCount === 0) return
    setReviewing(true)
  }

  async function confirmSave() {
    setSaving(true)
    setError('')
    try {
      const payload = {}
      for (const [k, v] of Object.entries(changes)) {
        payload[k] = k === 'station_id' || k === 'shift_id' ? (v ? Number(v) : null) : v
      }
      if (pwdSet) payload.user_password = pwd.password
      const updated = await updatePersonnel(personnel.per_id, payload)
      onSubmit(updated)
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  const fmt = { station_id: stationName, shift_id: shiftName }
  const rows = [
    ...FIELD_META.filter(([key]) => isChanged(key)).map(([key, label]) => ({
      key,
      label,
      before: fmt[key] ? fmt[key](initial[key]) : initial[key],
      after:  fmt[key] ? fmt[key](changes[key]) : changes[key],
    })),
    ...(pwdSet ? [{ key: 'pwd', label: 'Password', beforeText: 'Current password', after: 'New password' }] : []),
  ]

  return (
    <>
      <AppModal
        eyebrow="EDIT PERSONNEL"
        title={fullName || 'Unnamed personnel'}
        subtitle={subtitle.length > 0 ? subtitle.map((part, index) => (
          <span key={index}>
            {index > 0 && <span className="edit-form-separator" aria-hidden="true"> | </span>}
            {part}
          </span>
        )) : null}
        onClose={onClose}
        width={600}
        className="eim-panel edit-form-modal"
        dismissible={!saving && !reviewing}
      >
        <form onSubmit={handleSubmit} noValidate>
          <div className="eim-body">
            <section className="eim-section">
              <SectionHead title="Identity" desc="Name and how to reach them" />
              <div className="eim-row">
                <Field label="First name" required changed={isChanged('per_firstname')}>
                  <input
                    placeholder="e.g. Juan"
                    value={form.per_firstname}
                    onChange={e => set('per_firstname', e.target.value)}
                    aria-invalid={!trimmed.per_firstname || undefined}
                  />
                </Field>
                <Field label="Last name" required changed={isChanged('per_lastname')}>
                  <input
                    placeholder="e.g. Dela Cruz"
                    value={form.per_lastname}
                    onChange={e => set('per_lastname', e.target.value)}
                    aria-invalid={!trimmed.per_lastname || undefined}
                  />
                </Field>
              </div>
              <Field label="Contact number" className="frm-half" changed={isChanged('per_contact')}>
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="e.g. 0917 000 0000"
                  value={form.per_contact}
                  onChange={e => set('per_contact', e.target.value)}
                  aria-invalid={!!errs.contact || undefined}
                />
                <FieldError>{errs.contact}</FieldError>
              </Field>
            </section>

            <section className="eim-section">
              <SectionHead title="Service" desc="Rank, role, station and shift" />
              <div className="eim-row">
                <Field label="Rank" required changed={isChanged('per_rank')}>
                  <select value={form.per_rank} onChange={e => set('per_rank', e.target.value)}>
                    <option value="">Choose a rank</option>
                    {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Field>
                <Field label="Designation" changed={isChanged('per_designation')}>
                  <select value={form.per_designation} onChange={e => set('per_designation', e.target.value)}>
                    <option value="">None</option>
                    {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </Field>
              </div>
              <div className="eim-row">
                <Field label="Home station" changed={isChanged('station_id')}>
                  <select value={form.station_id} onChange={e => set('station_id', e.target.value)}>
                    <option value="">No station</option>
                    {stations.map(s => (
                      <option key={s.station_id} value={s.station_id}>{s.station_name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Shift" changed={isChanged('shift_id')}>
                  <Segmented label="Shift" options={shiftOptions} value={form.shift_id} onChange={v => set('shift_id', v)} />
                </Field>
              </div>
              {shiftMismatch && (
                <Callout>
                  {teamName} runs on {shiftName(String(team.shift_id))}. Move them to a matching team on the Teams page too
                </Callout>
              )}
              <LockedNote>
                {teamName
                  ? <>Member of <strong>{teamName}</strong>. Team assignments are managed on the Teams page</>
                  : <>Not on a team. Add them from the Teams page</>}
              </LockedNote>
            </section>

            <section className="eim-section">
              <SectionHead title="Account" desc="Mobile app sign-in" changed={isChanged('user_email') || pwdSet} />
              <Field label="Email" changed={isChanged('user_email')}>
                <input
                  type="email"
                  placeholder="name@bfp.gov.ph"
                  value={form.user_email}
                  onChange={e => set('user_email', e.target.value)}
                  aria-invalid={!!errs.email || undefined}
                  autoComplete="off"
                />
                <FieldError>{errs.email}</FieldError>
              </Field>

              {pwdOpen ? (
                <div className="frm-pwd">
                  <div className="eim-row">
                    <Field label="New password" changed={pwdSet}>
                      <PasswordInput
                        placeholder="At least 8 characters"
                        value={pwd.password}
                        onChange={e => { setPwd(p => ({ ...p, password: e.target.value })); setError('') }}
                        invalid={!!errs.password}
                      />
                      <FieldError>{errs.password}</FieldError>
                    </Field>
                    <Field label="Confirm new password">
                      <PasswordInput
                        placeholder="Type it again"
                        value={pwd.confirm}
                        onChange={e => { setPwd(p => ({ ...p, confirm: e.target.value })); setError('') }}
                        invalid={!!errs.confirm}
                      />
                      <FieldError>{errs.confirm}</FieldError>
                    </Field>
                  </div>
                  <button type="button" className="eim-link-btn" onClick={closePassword}>
                    Keep the current password
                  </button>
                </div>
              ) : (
                <button type="button" className="frm-reveal" onClick={() => setPwdOpen(true)}>
                  <Icon d={ICON_KEY} />
                  Set a new password
                </button>
              )}
            </section>

            {error && !reviewing && <div className="apm-error">{error}</div>}
          </div>

          <div className="eim-footer">
            <FormStatus changeCount={changeCount} />
            <div className="eim-footer-actions">
              <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="apm-btn-submit" disabled={changeCount === 0 || blocked}>
                Review &amp; save
              </button>
            </div>
          </div>
        </form>
      </AppModal>

      {reviewing && (
        <ReviewChanges
          code={fullName}
          rows={rows}
          note={pwdSet && 'They\'ll need the new password the next time they sign in to the mobile app.'}
          saving={saving}
          error={error}
          onBack={() => { setError(''); setReviewing(false) }}
          onConfirm={confirmSave}
        />
      )}
    </>
  )
}
