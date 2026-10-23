import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function ConstraintEdgeSaveDialog({ constraintType, edgeCount, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const panel = useRef(null)
  const type = constraintType === 'narrow_road' ? 'Narrow road' : 'Traffic area'
  useEffect(() => {
    const previous = document.activeElement
    panel.current?.querySelector('input')?.focus()
    return () => previous?.focus?.()
  }, [])
  function keyDown(event) {
    if (event.key === 'Escape' && !lock.current) onCancel()
    if (event.key !== 'Tab') return
    const controls = [...panel.current.querySelectorAll('input:not(:disabled), button:not(:disabled)')]
    if (!controls.length) { event.preventDefault(); return }
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setSaving(true); setError('')
    try { await onSave({ name: name.trim() || null }) }
    catch (failure) { setError(failure.message || 'Could not save selected edges.'); setSaving(false); lock.current = false }
  }
  return createPortal(<div className="constraint-save-overlay" onKeyDown={keyDown}>
    <form ref={panel} className="constraint-save-dialog" role="dialog" aria-modal="true" aria-labelledby="edge-save-title" aria-describedby="edge-save-description" aria-busy={saving} onSubmit={submit}>
      <h2 id="edge-save-title" className="constraint-save-title">Save selected road edges?</h2>
      <p id="edge-save-description">Save {edgeCount} edge{edgeCount === 1 ? '' : 's'} as {type.toLowerCase()}. These constraints will be stored in the database and used for new routes.</p>
      <label className="constraint-field"><span>Name (optional)</span><input maxLength={255} value={name} disabled={saving} onChange={event => setName(event.target.value)} placeholder="Use road names" /></label>
      {error && <p role="alert" className="constraint-help">{error}</p>}
      <div className="constraint-save-actions"><button type="submit" className="constraint-save-btn" disabled={saving}>{saving ? 'Saving…' : 'Confirm and save'}</button>
        <button type="button" className="constraint-cancel-btn" disabled={saving} onClick={onCancel}>Back to selection</button></div>
    </form>
  </div>, document.body)
}
