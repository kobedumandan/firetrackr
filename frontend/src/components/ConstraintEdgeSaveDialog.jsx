import { useEffect, useRef, useState } from 'react'
import AppModal from './AppModal'
import { roadConstraintColor } from '../utils/mapOverlayColors'
import '../styles/ConstraintDialog.css'
import { EVERY_DAY, WEEKDAYS, scheduleError } from '../utils/constraintSchedule'

const CONDITIONS = [
  { value: 'narrow_road', label: 'Narrow road', hint: 'Limited road width' },
  { value: 'traffic_area', label: 'Traffic congestion', hint: 'Slower road movement' },
  { value: 'construction', label: 'Construction', hint: 'Road work or obstruction' },
  { value: 'normal', label: 'No constraint', hint: 'Regular road conditions' },
]

function RoadMark({ type, severity, styleConfig }) {
  return <svg className="constraint-dialog-road" viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ '--road-color': roadConstraintColor(type, severity, styleConfig) }}>
    <path d="M7 28V21c0-7 18-3 18-11V4" stroke="currentColor" strokeWidth="8" strokeLinecap="round" opacity=".15" />
    <path d="M7 28V21c0-7 18-3 18-11V4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
}

export default function ConstraintEdgeSaveDialog({ constraintType, edgeCount, initialConstraint, styleConfig, onSave, onCancel }) {
  const editing = !!initialConstraint
  const baseline = !!initialConstraint?.baseline_segment_uid
  const initialType = initialConstraint?.constraint_type || constraintType
  const legacySeverity = editing && initialConstraint.constraint_type === 'narrow_road' && !initialConstraint.narrow_severity
  const [selectedType, setSelectedType] = useState(initialType?.startsWith('traffic') ? 'traffic_area' : initialType)
  const [trafficType, setTrafficType] = useState(initialType?.startsWith('traffic_') && initialType !== 'traffic_area' ? initialType : 'traffic_general')
  const [customTiming, setCustomTiming] = useState(!!initialConstraint?.traffic_schedule)
  const [name, setName] = useState(initialConstraint?.name || '')
  const [severity, setSeverity] = useState(initialConstraint?.narrow_severity || (legacySeverity ? '' : 'slight'))
  const [allDay, setAllDay] = useState(initialConstraint?.traffic_schedule?.all_day ?? true)
  const [days, setDays] = useState(initialConstraint?.traffic_schedule?.days || EVERY_DAY)
  const [windows, setWindows] = useState(initialConstraint?.traffic_schedule?.windows?.length ? initialConstraint.traffic_schedule.windows : [{ start: '08:00', end: '10:00' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const panel = useRef(null)
  const isTraffic = selectedType === 'traffic_area'
  const isNarrow = selectedType === 'narrow_road'
  const titleId = editing ? 'constraint-edit-title' : 'edge-save-title'
  const descriptionId = editing ? 'constraint-edit-description' : 'edge-save-description'
  useEffect(() => {
    panel.current?.querySelector('.constraint-field input')?.focus()
  }, [])
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    const schedule = { all_day: allDay, days, windows: allDay ? [] : windows }
    const problem = isTraffic && (!baseline || customTiming) ? scheduleError(schedule) : ''
    if (problem) { setError(problem); return }
    lock.current = true; setSaving(true); setError('')
    const unchangedLegacySchedule = baseline ? !customTiming : editing && initialConstraint.constraint_type === 'traffic_area' && !initialConstraint.traffic_schedule && allDay && days.length === 7
    try { await onSave({ name: name.trim() || null,
      ...(editing ? { constraint_type: baseline && isTraffic ? trafficType : selectedType, narrow_severity: isNarrow ? severity || null : null,
        traffic_schedule: isTraffic && !unchangedLegacySchedule ? schedule : null }
        : isTraffic ? { traffic_schedule: schedule } : { narrow_severity: severity }) }) }
    catch (failure) { setError(failure.message || 'Could not save the constraint.'); setSaving(false); lock.current = false }
  }
  const condition = CONDITIONS.find(item => item.value === selectedType)
  return <AppModal eyebrow={editing ? 'ROAD CONSTRAINT / EDIT' : 'ROAD CONSTRAINT / ADD'}
    title={editing ? 'Edit constraint' : 'Add road constraint'} titleId={titleId} describedBy={descriptionId}
    subtitle={editing ? 'Review the condition on this road.' : 'Set the condition for your selected road edges.'}
    onClose={() => { if (!lock.current) onCancel() }} dismissible={!saving} manageFocus width={560} className="eim-panel constraint-dialog">
    <form ref={panel} className="constraint-dialog-form" aria-busy={saving} onSubmit={submit}>
      <div className="eim-body constraint-dialog-body">
        <div className="constraint-dialog-context">
          <RoadMark type={baseline && isTraffic ? trafficType : selectedType} severity={severity} styleConfig={styleConfig} />
          <div><strong>{editing ? initialConstraint.name || 'Selected road' : `${edgeCount} edge${edgeCount === 1 ? '' : 's'} selected`}</strong>
            <span>{editing ? baseline ? 'Baseline road' : 'Saved constraint' : condition?.label}</span></div>
          <span className="constraint-dialog-context-tag">{editing ? 'Editing' : 'New'}</span>
        </div>
        <p id={descriptionId} className="constraint-dialog-description">{initialConstraint?.predictionReview
          ? 'Review this prediction and choose the actual road condition. Saving records your review.'
          : baseline ? 'Your saved road condition takes priority for new routes.'
            : editing ? 'Changes apply to new routes after saving.' : 'Review the details below before adding this constraint to the map.'}</p>

        <section className="eim-section">
          {editing && <fieldset className="constraint-options" disabled={saving}>
            <legend>Road condition</legend>
            <div className="constraint-condition-grid">{CONDITIONS.filter(item => baseline || ['narrow_road', 'traffic_area'].includes(item.value)).map(item =>
              <label className="constraint-condition-card" key={item.value}>
                <input type="radio" name="constraint-type" value={item.value} checked={selectedType === item.value} onChange={() => { setSelectedType(item.value); setError('') }} />
                <RoadMark type={baseline && item.value === 'traffic_area' ? trafficType : item.value} severity={severity} styleConfig={styleConfig} /><span><strong>{item.label}</strong><small>{item.hint}</small></span>
              </label>)}</div>
          </fieldset>}
          <label className="apm-field constraint-field"><span>{isTraffic ? 'Traffic label' : 'Road name'} <small>Optional</small></span>
            <input maxLength={255} value={name} disabled={saving} onChange={event => setName(event.target.value)} placeholder={isTraffic ? 'e.g. Traffic due to road renovation' : 'e.g. Market access road'} />
          </label>
          {isNarrow && <fieldset className="constraint-options" disabled={saving}><legend>Narrow-road severity</legend>
            <div className="constraint-severity-options">{[
              ...(legacySeverity ? [{ value: '', label: 'Existing default', hint: 'Keep current severity' }] : []),
              { value: 'slight', label: 'Slight', hint: 'Some width restriction' },
              { value: 'severe', label: 'Severe', hint: 'Significant width restriction' },
            ].map(item => <label className="constraint-severity-card" key={item.value}>
              <input type="radio" name="narrow-severity" value={item.value} checked={severity === item.value} onChange={() => setSeverity(item.value)} />
              <span><strong>{item.label}</strong><small>{item.hint}</small></span>
            </label>)}</div>
          </fieldset>}
          {isTraffic && baseline && <label className="apm-field constraint-field"><span>Traffic category</span>
            <select aria-label="Traffic category" disabled={saving} value={trafficType} onChange={event => setTrafficType(event.target.value)}>
              <option value="traffic_general">General traffic</option><option value="traffic_school">School traffic</option><option value="traffic_market">Market traffic</option><option value="traffic_nightmarket">Night market</option><option value="traffic_pnm">PNM traffic</option><option value="traffic_highway">Highway traffic</option>
            </select>
          </label>}
        </section>

        {isTraffic && <section className="eim-section constraint-schedule-section">
          <div className="eim-section-head"><h3>Traffic schedule</h3><span className="constraint-timezone">PHT · Asia/Manila</span></div>
          {baseline && <div className="constraint-timing-option">
            <label className="constraint-toggle"><span>Set active hours</span><input className="nim-switch" type="checkbox" checked={customTiming} disabled={saving} onChange={event => setCustomTiming(event.target.checked)} /></label>
            {!customTiming && <p className="constraint-dialog-hint">{initialType?.startsWith('traffic') ? 'The model’s existing timing is retained.' : 'Applies all day unless you set active hours.'}</p>}
          </div>}
          {(!baseline || customTiming) && <>
            <fieldset className="constraint-options" disabled={saving}><legend>Repeat on</legend>
              <label className="constraint-toggle constraint-toggle--compact"><span>Every day</span><input className="nim-switch" type="checkbox" checked={days.length === 7} onChange={event => setDays(event.target.checked ? EVERY_DAY : [])} /></label>
              <div className="constraint-weekdays">{WEEKDAYS.map((day, index) => <label key={day}>
                <input type="checkbox" checked={days.includes(index)} onChange={() => setDays(previous => previous.includes(index) ? previous.filter(value => value !== index) : [...previous, index].sort())} /><span>{day}</span>
              </label>)}</div>
            </fieldset>
            <fieldset className="constraint-options" disabled={saving}><legend>Active hours</legend>
              <label className="constraint-toggle"><span>All day</span><input className="nim-switch" type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} /></label>
              {!allDay && <><div className="constraint-time-ranges">{windows.map((window, index) => <div className="constraint-time-range" key={index}>
                <label>From<input aria-label={`Start time ${index + 1}`} type="time" required value={window.start} onChange={event => setWindows(previous => previous.map((item, i) => i === index ? { ...item, start: event.target.value } : item))} /></label>
                <span className="constraint-time-separator" aria-hidden="true">→</span>
                <label>To<input aria-label={`End time ${index + 1}`} type="time" required value={window.end} onChange={event => setWindows(previous => previous.map((item, i) => i === index ? { ...item, end: event.target.value } : item))} /></label>
                <button className="constraint-remove-time" type="button" aria-label={`Remove time range ${index + 1}`} disabled={windows.length === 1 || saving} onClick={() => setWindows(previous => previous.filter((_, i) => i !== index))}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" /></svg>
                </button>
              </div>)}</div>
                <button className="constraint-add-time" type="button" disabled={windows.length >= 8 || saving} onClick={() => setWindows(previous => [...previous, { start: '', end: '' }])}>Add time range</button>
                <p className="constraint-dialog-hint">Up to 8 ranges. An earlier end time continues into the next day. End times are excluded.</p>
              </>}
            </fieldset>
            <p className="constraint-dialog-hint">The traffic penalty applies during the selected days and hours. The road remains visible on the map.</p>
          </>}
        </section>}
        {error && <div role="alert" className="apm-error constraint-dialog-error">{error}</div>}
      </div>
      <div className="eim-footer">
        <span className="constraint-dialog-footer-note">Applies to new routes</span>
        <div className="eim-footer-actions">
          <button type="button" className="apm-btn-cancel" disabled={saving} onClick={onCancel}>{editing ? 'Cancel' : 'Back to selection'}</button>
          <button type="submit" className="apm-btn-submit" disabled={saving}>{saving ? <><span className="apm-spinner" aria-hidden="true" /> Saving…</> : editing ? 'Save changes' : 'Confirm and save'}</button>
        </div>
      </div>
    </form>
  </AppModal>
}
