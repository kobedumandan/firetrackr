// Shared building blocks for the modernized modals (incident log/edit and the
// resource add/edit forms), so every form stays visually and behaviourally
// identical. Styles live in AppModal.css (eim-*).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import '../styles/AppModal.css'
import {
  STATUSES, OPERATION_COMPLETE_STATUS, CASUALTIES, STRUCTURES, statusMetaOf,
  ICON_CHECK, ICON_WARN, ICON_LOCK, ICON_CLOSE, ICON_ARROW,
} from './incidentFormOptions'
import { ICON_EYE, ICON_EYE_OFF } from './resourceFormOptions'

export function Icon({ d, className = 'eim-icon' }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" className={className} fill="currentColor" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}
export function Field({ label, required, changed, children, className = '' }) {
  return (
    <div className={`apm-field ${className}`}>
      <label>
        {label}
        {required && <span className="apm-required"> *</span>}
        {changed && <span className="eim-dot" title="Edited" />}
      </label>
      {children}
    </div>
  )
}

export function SectionHead({ title, desc, changed }) {
  return (
    <div className="eim-section-head">
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {changed && <span className="eim-dot" title="Edited" />}
    </div>
  )
}

export function StructureTypeField({ value, onChange, changed }) {
  const [selection, setSelection] = useState(() => STRUCTURES.includes(value) ? value : 'Other')
  const [description, setDescription] = useState(() => STRUCTURES.includes(value) ? '' : value || '')

  return (
    <div>
      <Field label="Structure type" changed={changed}>
        <select aria-label="Structure type" value={selection} onChange={event => {
          const next = event.target.value
          setSelection(next)
          onChange(next === 'Other' ? description.trim() || 'Other' : next)
        }}>
          {STRUCTURES.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
      </Field>
      {selection === 'Other' && <Field label="Specify structure type" required>
        <input
          aria-label="Specify structure type"
          placeholder="Enter the structure or site type"
          required
          maxLength={100}
          value={description}
          onChange={event => {
            setDescription(event.target.value)
            onChange(event.target.value.trim() || 'Other')
          }}
        />
      </Field>}
    </div>
  )
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="eim-seg" role="radiogroup" aria-label={label}>
      {options.map(o => {
        const opt = typeof o === 'string' ? { value: o } : o
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            className={`eim-seg-btn tone-${opt.tone || 'fire'} ${active ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label || opt.value}
          </button>
        )
      })}
    </div>
  )
}

/* Editors can display operational completion between control and closure;
   recording it remains a separate workflow action. Intake keeps stored statuses. */
export function StatusSteps({ value, onChange, incident, includeOperationComplete = false, disabledValues = [], hint = statusMetaOf(value, incident).hint }) {
  const statuses = includeOperationComplete
    ? [...STATUSES.slice(0, -1), OPERATION_COMPLETE_STATUS, STATUSES.at(-1)]
    : STATUSES
  const idx = statuses.findIndex(s => s.value === value)
  return (
    <>
      <div className={`eim-steps ${value === 'closed' ? 'complete' : ''}`} style={{ gridTemplateColumns: `repeat(${statuses.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label="Status">
        {statuses.map((s, i) => {
          const state = i < idx ? 'done' : i === idx ? 'current' : 'todo'
          return (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={i === idx}
              disabled={s.disabled || disabledValues.includes(s.value)}
              className={`eim-step ${state}`}
              onClick={() => onChange(s.value)}
            >
              <span className="eim-step-node">
                {state === 'done' ? <Icon d={ICON_CHECK} className="eim-step-icon" /> : i + 1}
              </span>
              <span className="eim-step-label">{statusMetaOf(s.value, incident).label}</span>
            </button>
          )
        })}
      </div>
      <div className="eim-hint">{hint}</div>
    </>
  )
}

export function CasualtyPicker({ value, onChange }) {
  return (
    <div className="eim-chips" role="radiogroup" aria-label="Casualties">
      {CASUALTIES.map(c => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          className={`eim-pick ${value === c ? 'active' : ''}`}
          onClick={() => onChange(c)}
        >
          {c}
        </button>
      ))}
    </div>
  )
}

export function Callout({ children }) {
  return (
    <div className="eim-callout">
      <div className="eim-callout-icon"><Icon d={ICON_WARN} /></div>
      <span>{children}</span>
    </div>
  )
}

export function LockedNote({ children }) {
  return (
    <div className="eim-locked">
      <Icon d={ICON_LOCK} />
      <span>{children}</span>
    </div>
  )
}

/* Inline validation message under a field. */
export function FieldError({ children }) {
  return children ? <div className="frm-field-err" role="alert">{children}</div> : null
}

function DiffValue({ value, kind }) {
  const empty = value === '' || value == null
  return (
    <span className={`eim-diff-val ${kind} ${empty ? 'empty' : ''}`}>
      {empty ? 'Empty' : String(value)}
    </span>
  )
}

/**
 * "Save these changes?" step shown over an edit form before anything is sent.
 *
 *   code     – optional record id shown as the first chip
 *   rows     – [{ key, label, before, after, long?, beforeText? }]
 *              beforeText replaces the old value (e.g. a secret that isn't shown)
 *   note     – optional callout content (a consequence worth pausing on)
 */
export function ReviewChanges({ code, rows, note, saving, error, onBack, onConfirm, className = '', icon }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onBack() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, saving])

  const subtitle = <div className="eim-subtitle">
    {code && <span className="eim-chip eim-chip-code">{code}</span>}
    <span className="eim-chip">{rows.length} {rows.length === 1 ? 'field' : 'fields'} updated</span>
  </div>

  return createPortal(
    <div className="apm-overlay eim-review-overlay" onMouseDown={e => e.target === e.currentTarget && !saving && onBack()}>
      <div className={`apm-panel eim-review ${className}`} role="alertdialog" aria-modal="true" aria-labelledby="eim-review-title">
        <div className={icon ? 'cfm-head dpm-header' : 'eim-header'}>
          {icon && <span className="cfm-badge" aria-hidden="true">{icon}</span>}
          <div className={icon ? 'cfm-head-text' : 'eim-header-main'}>
            <div className="apm-eyebrow">REVIEW CHANGES</div>
            <div id="eim-review-title" className={icon ? 'cfm-title' : 'eim-title'}>Save these changes?</div>
            {!icon && subtitle}
          </div>
          <button className="eim-close" onClick={onBack} aria-label="Back to editing" disabled={saving}>
            <Icon d={ICON_CLOSE} />
          </button>
          {icon && subtitle}
        </div>

        <div className="eim-review-body">
          <ul className="eim-diff">
            {rows.map((r, i) => (
              <li key={r.key} className={`eim-diff-row ${r.long ? 'long' : ''}`} style={{ '--i': i }}>
                <span className="eim-diff-label">{r.label}</span>
                <div className="eim-diff-values">
                  {r.beforeText
                    ? <span className="eim-diff-val before empty">{r.beforeText}</span>
                    : <DiffValue value={r.before} kind="before" />}
                  <Icon d={ICON_ARROW} className="eim-diff-arrow" />
                  <DiffValue value={r.after} kind="after" />
                </div>
              </li>
            ))}
          </ul>

          {note && <Callout>{note}</Callout>}
          {error && <div className="apm-error">{error}</div>}
        </div>

        <div className="eim-footer">
          <button type="button" className="eim-link-btn" onClick={onBack} disabled={saving}>Back to editing</button>
          <button type="button" className="apm-btn-submit" onClick={onConfirm} disabled={saving} autoFocus>
            {saving ? <span className="apm-spinner" /> : 'Confirm & save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* Footer status line: what's still missing on a create form, or how many
   unsaved edits there are on an edit form. */
export function FormStatus({ missing, changeCount }) {
  if (missing !== undefined) {
    return (
      <span className={`eim-changes ${missing.length ? '' : 'ready'}`}>
        {missing.length ? `Still needed: ${missing.join(', ')}` : 'Ready to save'}
      </span>
    )
  }
  return (
    <span className={`eim-changes ${changeCount ? 'has' : ''}`}>
      {changeCount === 0 ? 'No changes yet' : `${changeCount} unsaved ${changeCount === 1 ? 'change' : 'changes'}`}
    </span>
  )
}

/* Password input with a show/hide toggle. */
export function PasswordInput({ value, onChange, placeholder, invalid, autoComplete = 'new-password' }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="apm-input-wrap">
      <input
        type={shown ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        aria-invalid={invalid || undefined}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="apm-eye"
        aria-label={shown ? 'Hide password' : 'Show password'}
        onClick={() => setShown(v => !v)}
      >
        <Icon d={shown ? ICON_EYE_OFF : ICON_EYE} className="apm-eye-icon" />
      </button>
    </div>
  )
}
