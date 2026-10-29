import { useState, useEffect } from 'react'
import AppModal from './AppModal'
import {
  fetchStations, fetchPersonnel, fetchShifts, fetchTrucks, fetchTeams,
  updateTeam, addTeamMember, updateTeamMember, removeTeamMember,
} from '../api'
import { TEAM_STATUSES, MEMBER_ROLES, statusMeta, assignableTrucks } from './resourceFormOptions'
import { ICON_CLOSE, ICON_PLUS } from './incidentFormOptions'
import {
  Icon, Field, SectionHead, Segmented, FormStatus, LockedNote, ReviewChanges,
} from './incidentForm'

const idStr = v => (v != null && v !== '' ? String(v) : '')
const toId  = v => (v ? Number(v) : null)

const FIELD_META = [
  ['team_name',   'Team name'],
  ['team_code',   'Team code'],
  ['shift_id',    'Shift'],
  ['station_id',  'Home station'],
  ['truck_id',    'Truck'],
  ['team_status', 'Status'],
]

export default function EditTeamModal({ team, onClose, onSubmit }) {
  const [initial] = useState(() => ({
    team_name:   team.team_name || '',
    team_code:   team.team_code || '',
    team_status: team.team_status === 'active' ? 'dispatched' : (team.team_status || 'standby'),
    station_id:  idStr(team.station_id),
    shift_id:    idStr(team.shift_id),
    truck_id:    idStr(team.truck_id),
  }))
  const [initialMembers] = useState(() =>
    (team.members || []).map(m => ({ ...m, member_role: m.member_role || '' }))
  )
  const [form, setForm]                 = useState(initial)
  const [members, setMembers]           = useState(initialMembers)
  const [stations, setStations]         = useState([])
  const [shifts, setShifts]             = useState([])
  const [trucks, setTrucks]             = useState([])
  const [teams, setTeams]               = useState([])
  const [allPersonnel, setAllPersonnel] = useState([])
  const [addSelect, setAddSelect]       = useState('')
  const [addRole, setAddRole]           = useState('')
  const [error, setError]               = useState('')
  const [saving, setSaving]             = useState(false)
  const [reviewing, setReviewing]       = useState(false)

  useEffect(() => {
    fetchStations().then(setStations).catch(() => {})
    fetchShifts().then(setShifts).catch(() => {})
    fetchTrucks().then(setTrucks).catch(() => {})
    fetchTeams().then(setTeams).catch(() => {})
    fetchPersonnel().then(setAllPersonnel).catch(() => {})
  }, [])

  function set(field, val) {
    setForm(f => ({ ...f, [field]: val }))
    setError('')
  }

  // Station or shift changes can make the picked truck invalid; clear it.
  function setSlot(field, val) {
    setForm(f => ({ ...f, [field]: val, truck_id: truckLocked ? f.truck_id : '' }))
    setError('')
  }

  function setMemberRole(perId, role) {
    setMembers(prev => prev.map(m => m.per_id === perId ? { ...m, member_role: role } : m))
  }

  function addMember() {
    const p = allPersonnel.find(p => p.per_id === Number(addSelect))
    if (!p) return
    setMembers(prev => [...prev, { per_id: p.per_id, name: p.name, initials: p.initials, rank: p.rank, member_role: addRole }])
    setAddSelect('')
    setAddRole('')
  }

  function removeMember(perId) {
    setMembers(prev => prev.filter(m => m.per_id !== perId))
  }

  // ── What changed ──
  const trimmed = { ...form, team_name: form.team_name.trim(), team_code: form.team_code.trim() }
  const changes = Object.fromEntries(Object.entries(trimmed).filter(([k, v]) => v !== initial[k]))
  const isChanged = field => field in changes

  const initialById = new Map(initialMembers.map(m => [m.per_id, m]))
  const currentIds  = new Set(members.map(m => m.per_id))
  const removed     = initialMembers.filter(m => !currentIds.has(m.per_id))
  const added       = members.filter(m => !initialById.has(m.per_id))
  const roleChanged = members.filter(m => initialById.has(m.per_id) && initialById.get(m.per_id).member_role !== m.member_role)
  const memberChangeCount = removed.length + added.length + roleChanged.length
  const changeCount = Object.keys(changes).length + memberChangeCount

  // ── Derived options ──
  const shiftId   = toId(form.shift_id)
  const stationId = toId(form.station_id)
  const truckOptions = assignableTrucks(trucks, teams, { stationId, shiftId, selfTeamId: team.team_id })
  const currentTeam = teams.find(t => t.team_id === team.team_id) || team
  const truckLocked = currentTeam.has_active_dispatch ?? ['active', 'dispatched', 'en_route', 'on_scene'].includes(currentTeam.team_status)
  const shiftOptions = [{ value: '', label: 'None' }, ...shifts.map(s => ({ value: String(s.shift_id), label: s.shift_name }))]
  // The backend refuses a shift change while the team has members.
  const shiftLocked = members.length > 0
  const available = allPersonnel.filter(p =>
    !currentIds.has(p.per_id) &&
    (p.team_id == null || p.team_id === team.team_id) &&
    (shiftId === null || p.shift_id === shiftId)
  )

  const stationName = id => stations.find(s => String(s.station_id) === id)?.station_name ?? (id ? `Station #${id}` : '')
  const shiftName   = id => shifts.find(s => String(s.shift_id) === id)?.shift_name ?? (id ? `Shift #${id}` : '')
  const truckName   = id => trucks.find(t => String(t.truck_id) === id)?.truck_platenum ?? (id ? `Truck #${id}` : '')
  const statusLabel = v => statusMeta(TEAM_STATUSES, v).label
  const fmt = { station_id: stationName, shift_id: shiftName, truck_id: truckName, team_status: statusLabel }

  function handleSubmit(e) {
    e.preventDefault()
    if (!trimmed.team_name) { setError('Team name is required.'); return }
    if (changeCount === 0) return
    setReviewing(true)
  }

  async function confirmSave() {
    setSaving(true)
    setError('')
    try {
      // Removals first: the backend rejects a shift change while the team
      // still has members, so they must land before updateTeam runs.
      await Promise.all(removed.map(m => removeTeamMember(team.team_id, m.per_id)))

      let updated = team
      if (Object.keys(changes).length) {
        const payload = {}
        for (const [k, v] of Object.entries(changes)) {
          payload[k] = ['station_id', 'shift_id', 'truck_id'].includes(k) ? toId(v) : v
        }
        updated = await updateTeam(team.team_id, payload)
      }

      // Adds/role changes after the shift change so new members validate
      // against the team's new shift.
      await Promise.all([
        ...added.map(m => addTeamMember(team.team_id, { per_id: m.per_id, member_role: m.member_role || null })),
        ...roleChanged.map(m => updateTeamMember(team.team_id, m.per_id, { member_role: m.member_role || null })),
      ])

      onSubmit({ ...updated, member_count: members.length, members })
    } catch (err) {
      setError(err.message)
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
    ...added.map(m => ({ key: `add-${m.per_id}`, label: 'Member added', beforeText: 'Not on team', after: [m.name, m.member_role].filter(Boolean).join(' · ') })),
    ...removed.map(m => ({ key: `rm-${m.per_id}`, label: 'Member removed', before: m.name, after: 'Off the team' })),
    ...roleChanged.map(m => ({
      key: `role-${m.per_id}`,
      label: `${m.name}'s role`,
      before: initialById.get(m.per_id).member_role || 'No role',
      after: m.member_role || 'No role',
    })),
  ]

  const releasingTruck = isChanged('truck_id') && initial.truck_id && !changes.truck_id

  return (
    <>
      <AppModal
        eyebrow="EDIT TEAM"
        title={trimmed.team_name || 'Untitled team'}
        subtitle={[initial.team_code, stationName(initial.station_id), shiftName(initial.shift_id)].filter(Boolean).join(' · ') || null}
        onClose={onClose}
        width={620}
        className="eim-panel"
        dismissible={!saving && !reviewing}
      >
        <form onSubmit={handleSubmit}>
          <div className="eim-body">
            <section className="eim-section">
              <SectionHead title="Team" desc="What dispatchers will see it as." />
              <div className="eim-row">
                <Field label="Team name" required changed={isChanged('team_name')}>
                  <input
                    placeholder="e.g. Alpha Response Team"
                    value={form.team_name}
                    onChange={e => set('team_name', e.target.value)}
                    aria-invalid={!trimmed.team_name || undefined}
                  />
                </Field>
                <Field label="Team code" changed={isChanged('team_code')}>
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
              <Field label="Shift" changed={isChanged('shift_id')}>
                {shiftLocked ? (
                  <LockedNote>
                    <strong>{shiftName(form.shift_id) || 'No shift'}</strong>. Remove every member to change the shift.
                  </LockedNote>
                ) : (
                  <Segmented label="Shift" options={shiftOptions} value={form.shift_id} onChange={v => setSlot('shift_id', v)} />
                )}
              </Field>
              <div className="eim-row">
                <Field label="Home station" changed={isChanged('station_id')}>
                  <select value={form.station_id} onChange={e => setSlot('station_id', e.target.value)}>
                    <option value="">No station</option>
                    {stations.map(s => (
                      <option key={s.station_id} value={s.station_id}>{s.station_name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Truck" changed={isChanged('truck_id')}>
                  {truckLocked ? <LockedNote><strong>{team.truck_platenum || truckName(initial.truck_id) || 'No truck assigned'}</strong>. Truck assignment is locked until this team's dispatch ends.</LockedNote> : <select value={form.truck_id} onChange={e => set('truck_id', e.target.value)} disabled={stationId === null}>
                    <option value="">
                      {stationId === null
                        ? 'Pick a station first'
                        : truckOptions.length === 0 ? 'No free trucks at this station' : 'No truck'}
                    </option>
                    {truckOptions.map(t => (
                      <option key={t.truck_id} value={t.truck_id}>{t.truck_platenum}</option>
                    ))}
                  </select>}
                </Field>
              </div>
            </section>

            <section className="eim-section">
              <SectionHead title="Status" desc="Whether it can take dispatches." changed={isChanged('team_status')} />
              <Segmented label="Status" options={TEAM_STATUSES} value={form.team_status} onChange={v => set('team_status', v)} />
              <div className="frm-hint">{statusMeta(TEAM_STATUSES, form.team_status).hint}</div>
            </section>

            <section className="eim-section">
              <SectionHead
                title="Members"
                desc={`${members.length} ${members.length === 1 ? 'person' : 'people'}${shiftId !== null ? ` · ${shiftName(form.shift_id)} only` : ''}`}
                changed={memberChangeCount > 0}
              />
              {members.length > 0 ? (
                <ul className="lim-units">
                  {members.map(m => {
                    const isNew = !initialById.has(m.per_id)
                    const roleEdited = !isNew && initialById.get(m.per_id).member_role !== m.member_role
                    return (
                      <li key={m.per_id} className="lim-unit frm-member">
                        <span className="lim-unit-av frm-initials">{m.initials}</span>
                        <span className="lim-unit-info">
                          <span className="lim-unit-name">
                            {m.name}
                            {isNew && <span className="frm-tag">New</span>}
                          </span>
                          {m.rank && m.rank !== '—' && <span className="lim-unit-sub">{m.rank}</span>}
                        </span>
                        <select
                          className={`frm-role-select ${roleEdited ? 'changed' : ''}`}
                          value={m.member_role}
                          onChange={e => setMemberRole(m.per_id, e.target.value)}
                          aria-label={`Role for ${m.name}`}
                        >
                          <option value="">No role</option>
                          {MEMBER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button type="button" className="lim-unit-rm" onClick={() => removeMember(m.per_id)} aria-label={`Remove ${m.name}`}>
                          <Icon d={ICON_CLOSE} />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <div className="frm-empty">No members yet. Add people on this team&apos;s shift below.</div>
              )}

              <div className="lim-unit-add frm-member-add">
                <select value={addSelect} onChange={e => setAddSelect(e.target.value)} disabled={available.length === 0}>
                  <option value="">
                    {available.length ? 'Choose a person to add' : shiftId !== null ? 'No one free on this shift' : 'No one free'}
                  </option>
                  {available.map(p => (
                    <option key={p.per_id} value={p.per_id}>
                      {p.name}{p.rank && p.rank !== '—' ? ` · ${p.rank}` : ''}
                    </option>
                  ))}
                </select>
                <select className="frm-add-role" value={addRole} onChange={e => setAddRole(e.target.value)} disabled={!addSelect} aria-label="Role for the new member">
                  <option value="">No role</option>
                  {MEMBER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button type="button" className="lim-unit-add-btn" onClick={addMember} disabled={!addSelect}>
                  <Icon d={ICON_PLUS} /> Add
                </button>
              </div>
            </section>

            {error && !reviewing && <div className="apm-error">{error}</div>}
          </div>

          <div className="eim-footer">
            <FormStatus changeCount={changeCount} />
            <div className="eim-footer-actions">
              <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
              <button type="submit" className="apm-btn-submit" disabled={changeCount === 0 || !trimmed.team_name}>
                Review &amp; save
              </button>
            </div>
          </div>
        </form>
      </AppModal>

      {reviewing && (
        <ReviewChanges
          code={initial.team_code || initial.team_name}
          rows={rows}
          note={releasingTruck && `${truckName(initial.truck_id)} will no longer be assigned to this team.`}
          saving={saving}
          error={error}
          onBack={() => { setError(''); setReviewing(false) }}
          onConfirm={confirmSave}
        />
      )}
    </>
  )
}
