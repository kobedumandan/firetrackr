import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EVERY_DAY, WEEKDAYS, scheduleError } from '../utils/constraintSchedule'

export default function ConstraintEdgeSaveDialog({ constraintType, edgeCount, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [severity, setSeverity] = useState('slight')
  const [allDay, setAllDay] = useState(true)
  const [days, setDays] = useState(EVERY_DAY)
  const [windows, setWindows] = useState([{ start: '08:00', end: '10:00' }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const panel = useRef(null)
  const isTraffic = constraintType === 'traffic_area'
  const type = isTraffic ? 'Traffic congestion' : 'Narrow road'
  useEffect(() => {
    const previous = document.activeElement
    panel.current?.querySelector('input')?.focus()
    return () => previous?.focus?.()
  }, [])
  function keyDown(event) {
    if (event.key === 'Escape' && !lock.current) onCancel()
    if (event.key !== 'Tab') return
    const controls = [...panel.current.querySelectorAll('input:not(:disabled), select:not(:disabled), button:not(:disabled)')]
    if (!controls.length) { event.preventDefault(); return }
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    const schedule = { all_day: allDay, days, windows: allDay ? [] : windows }
    const problem = isTraffic ? scheduleError(schedule) : ''
    if (problem) { setError(problem); return }
    lock.current = true; setSaving(true); setError('')
    try { await onSave({ name: name.trim() || null,
      ...(isTraffic ? { traffic_schedule: schedule } : { narrow_severity: severity }) }) }
    catch (failure) { setError(failure.message || 'Could not save selected edges.'); setSaving(false); lock.current = false }
  }
  return createPortal(<div className="constraint-save-overlay" onKeyDown={keyDown}>
    <form ref={panel} className="constraint-save-dialog" role="dialog" aria-modal="true" aria-labelledby="edge-save-title" aria-describedby="edge-save-description" aria-busy={saving} onSubmit={submit}>
      <h2 id="edge-save-title" className="constraint-save-title">Save selected road edges?</h2>
      <p id="edge-save-description">Save {edgeCount} edge{edgeCount === 1 ? '' : 's'} as {type.toLowerCase()}. These constraints will be stored in the database and used for new routes.</p>
      <label className="constraint-field"><span>{isTraffic ? 'Traffic label (optional)' : 'Name (optional)'}</span><input maxLength={255} value={name} disabled={saving} onChange={event => setName(event.target.value)} placeholder={isTraffic ? 'e.g. Traffic due to road renovation' : 'Use road names'} /></label>
      {!isTraffic && <fieldset className="constraint-options" disabled={saving}><legend>Narrow-road severity</legend>
        <label><input type="radio" name="narrow-severity" value="slight" checked={severity === 'slight'} onChange={() => setSeverity('slight')} />Slight</label>
        <label><input type="radio" name="narrow-severity" value="severe" checked={severity === 'severe'} onChange={() => setSeverity('severe')} />Severe</label>
      </fieldset>}
      {isTraffic && <>
        <fieldset className="constraint-options" disabled={saving}><legend>Repeat on (Asia/Manila)</legend>
          <label><input type="checkbox" checked={days.length === 7} onChange={event => setDays(event.target.checked ? EVERY_DAY : [])} />Every day</label>
          <div className="constraint-weekdays">{WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" checked={days.includes(index)} onChange={() => setDays(previous => previous.includes(index) ? previous.filter(value => value !== index) : [...previous, index].sort())} />{day}</label>)}</div>
        </fieldset>
        <fieldset className="constraint-options" disabled={saving}><legend>Active hours</legend>
          <label><input type="checkbox" checked={allDay} onChange={event => setAllDay(event.target.checked)} />All day</label>
          {!allDay && <><div className="constraint-time-ranges">{windows.map((window, index) => <div className="constraint-time-range" key={index}>
            <label>From<input aria-label={`Start time ${index + 1}`} type="time" required value={window.start} onChange={event => setWindows(previous => previous.map((item, i) => i === index ? { ...item, start: event.target.value } : item))} /></label>
            <label>To<input aria-label={`End time ${index + 1}`} type="time" required value={window.end} onChange={event => setWindows(previous => previous.map((item, i) => i === index ? { ...item, end: event.target.value } : item))} /></label>
            <button type="button" aria-label={`Remove time range ${index + 1}`} disabled={windows.length === 1 || saving} onClick={() => setWindows(previous => previous.filter((_, i) => i !== index))}>Remove</button>
          </div>)}</div>
          <button type="button" disabled={windows.length >= 8 || saving} onClick={() => setWindows(previous => [...previous, { start: '', end: '' }])}>Add time range</button>
          <p className="constraint-help">Up to 8 ranges. An end time earlier than the start continues into the next day. End times are excluded.</p></>}
        </fieldset>
        <p className="constraint-help">The traffic penalty applies only during these hours on the selected days. The saved edge remains visible for review.</p>
      </>}
      {error && <p role="alert" className="constraint-help">{error}</p>}
      <div className="constraint-save-actions"><button type="submit" className="constraint-save-btn" disabled={saving}>{saving ? 'Saving…' : 'Confirm and save'}</button>
        <button type="button" className="constraint-cancel-btn" disabled={saving} onClick={onCancel}>Back to selection</button></div>
    </form>
  </div>, document.body)
}
