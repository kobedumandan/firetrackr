// Shared building blocks for the modernized modals (incident log/edit and the
// resource add/edit forms), so every form stays visually and behaviourally
// identical. Styles live in AppModal.css (eim-*).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import '../styles/AppModal.css'
import {
  STATUSES, CASUALTIES, statusMetaOf,
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

/* Pending → Dispatched → Contained → Closed. Done steps recede, the ongoing
   step is amber, and a closed incident reads as fully done. */
export function StatusSteps({ value, onChange, hint = statusMetaOf(value).hint }) {
  const idx = STATUSES.findIndex(s => s.value === value)
  return (
    <>
      <div className={`eim-steps ${value === 'closed' ? 'complete' : ''}`} role="radiogroup" aria-label="Status">
        {STATUSES.map((s, i) => {
          const state = i < idx ? 'done' : i === idx ? 'current' : 'todo'
          return (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={i === idx}
              className={`eim-step ${state}`}
              onClick={() => onChange(s.value)}
            >
              <span className="eim-step-node">
                {state === 'done' ? <Icon d={ICON_CHECK} className="eim-step-icon" /> : i + 1}
              </span>
              <span className="eim-step-label">{s.label}</span>
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
      <Icon d={ICON_WARN} />
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
export function ReviewChanges({ code, rows, note, saving, error, onBack, onConfirm }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onBack() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBack, saving])

  return createPortal(
    <div className="apm-overlay eim-review-overlay" onMouseDown={e => e.target === e.currentTarget && !saving && onBack()}>
      <div className="apm-panel eim-review" role="alertdialog" aria-modal="true" aria-labelledby="eim-review-title">
        <div className="eim-header">
          <div className="eim-header-main">
            <div className="apm-eyebrow">REVIEW CHANGES</div>
            <div id="eim-review-title" className="eim-title">Save these changes?</div>
            <div className="eim-subtitle">
              {code && <span className="eim-chip eim-chip-code">{code}</span>}
              <span className="eim-chip">{rows.length} {rows.length === 1 ? 'field' : 'fields'} updated</span>
            </div>
          </div>
          <button className="eim-close" onClick={onBack} aria-label="Back to editing" disabled={saving}>
            <Icon d={ICON_CLOSE} />
          </button>
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
