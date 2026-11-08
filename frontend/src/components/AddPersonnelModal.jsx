import { useState, useEffect } from 'react'
import AppModal from './AppModal'
import '../styles/DispatchModal.css'
import '../styles/PersonnelFormModal.css'
import { ICON_PLUS } from './incidentFormOptions'
import { fetchStations } from '../api'
import { RANKS, DESIGNATIONS, phoneError, emailError, passwordErrors } from './resourceFormOptions'
import { Icon, Field, SectionHead, FieldError, FormStatus, PasswordInput } from './incidentForm'

export default function AddPersonnelModal({ onClose, onSubmit }) {
  const [form, setForm] = useState({
    per_firstname:    '',
    per_lastname:     '',
    per_contact:      '',
    per_rank:         '',
    per_designation:  '',
    station_id:       '',
    user_email:       '',
    user_password:    '',
    confirm_password: '',
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

  const fullName = `${form.per_firstname.trim()} ${form.per_lastname.trim()}`.trim()
  const errs = {
    contact: phoneError(form.per_contact),
    email:   emailError(form.user_email),
    ...passwordErrors(form.user_password, form.confirm_password, { required: true }),
  }
  const missing = [
    !form.per_firstname.trim() && 'first name',
    !form.per_lastname.trim() && 'last name',
    !form.per_rank && 'rank',
    !form.user_email.trim() && 'email',
    !form.user_password && 'password',
    form.user_password && !form.confirm_password && 'password confirmation',
  ].filter(Boolean)
  const invalid = Object.values(errs).some(Boolean)

  async function handleSubmit(e) {
    e.preventDefault()
    if (missing.length || invalid) return
    setSaving(true)
    try {
      await onSubmit({
        per_firstname:   form.per_firstname.trim(),
        per_lastname:    form.per_lastname.trim(),
        per_contact:     form.per_contact.trim(),
        per_rank:        form.per_rank,
        per_designation: form.per_designation.trim(),
        station_id:      form.station_id || null,
        user_email:      form.user_email.trim(),
        user_password:   form.user_password,
        user_role:       'personnel',
      })
    } catch (ex) {
      // Server-side rejection (duplicate email, validation).
      setError(ex.message || 'Could not save. Please try again.')
      setSaving(false)
    }
  }

  return (
    <AppModal
      variant="badged"
      icon={<Icon d={ICON_PLUS} className="cfm-badge-icon" />}
      eyebrow="NEW PERSONNEL"
      title={fullName || 'Add personnel'}
      onClose={onClose}
      width={600}
      className="eim-panel personnel-form-modal"
      dismissible={!saving}
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="eim-body">
          <section className="eim-section">
            <SectionHead title="Identity" desc="Name and how to reach them." />
            <div className="eim-row">
              <Field label="First name" required>
                <input
                  placeholder="e.g. Juan"
                  value={form.per_firstname}
                  onChange={e => set('per_firstname', e.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Last name" required>
                <input
                  placeholder="e.g. Dela Cruz"
                  value={form.per_lastname}
                  onChange={e => set('per_lastname', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Contact number" className="frm-half">
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
            <SectionHead title="Service" desc="Rank, role and home station." />
            <div className="eim-row">
              <Field label="Rank" required>
                <select value={form.per_rank} onChange={e => set('per_rank', e.target.value)}>
                  <option value="">Choose a rank</option>
                  {RANKS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </Field>
              <Field label="Designation">
                <select value={form.per_designation} onChange={e => set('per_designation', e.target.value)}>
                  <option value="">None</option>
                  {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Home station" className="frm-half">
              <select value={form.station_id} onChange={e => set('station_id', e.target.value)}>
                <option value="">No station yet</option>
                {stations.map(s => (
                  <option key={s.station_id} value={s.station_id}>{s.station_name}</option>
                ))}
              </select>
            </Field>
          </section>

          <section className="eim-section">
            <SectionHead title="Account" desc="They sign in to the mobile app with these." />
            <Field label="Email" required>
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
            <div className="eim-row">
              <Field label="Password" required>
                <PasswordInput
                  placeholder="At least 8 characters"
                  value={form.user_password}
                  onChange={e => set('user_password', e.target.value)}
                  invalid={!!errs.password}
                />
                <FieldError>{errs.password}</FieldError>
              </Field>
              <Field label="Confirm password" required>
                <PasswordInput
                  placeholder="Type it again"
                  value={form.confirm_password}
                  onChange={e => set('confirm_password', e.target.value)}
                  invalid={!!errs.confirm}
                />
                <FieldError>{errs.confirm}</FieldError>
              </Field>
            </div>
          </section>

          {error && <div className="apm-error">{error}</div>}
        </div>

        <div className="eim-footer">
          <FormStatus missing={missing} />
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="apm-btn-submit" disabled={saving || missing.length > 0 || invalid}>
              {saving ? <span className="apm-spinner" /> : 'Add personnel'}
            </button>
          </div>
        </div>
      </form>
    </AppModal>
  )
}
