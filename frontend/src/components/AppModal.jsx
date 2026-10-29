import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import '../styles/AppModal.css'
import '../styles/ConfirmModal.css'
import { Icon } from './incidentForm'
import { ICON_CLOSE } from './incidentFormOptions'

/**
 * Shared modal shell: overlay, panel, and the same header the incident and
 * dispatch modals use (eyebrow, title, optional subtitle, icon close button).
 * Children supply the body and footer.
 *
 *   subtitle – optional muted line under the title (string or node)
 *   width    – panel width in px (capped to the viewport by .apm-panel)
 *   className – extra panel classes (e.g. "eim-panel" for the modern form styles)
 *   dismissible – false while saving or while a nested review step owns Esc;
 *                 blocks both Esc and backdrop clicks
 *   titleId / describedBy – optional stable IDs for accessible dialog context
 *   variant / icon – use the sign-out confirmation shell with variant="confirmation"
 */
export default function AppModal({
  eyebrow, title, subtitle, onClose, children, width = 520, className = '', dismissible = true, manageFocus = false,
  titleId: suppliedTitleId, describedBy,
  variant = 'default', icon,
}) {
  const confirmation = variant === 'confirmation'
  const generatedTitleId = useId()
  const titleId = suppliedTitleId || generatedTitleId
  const panelRef = useRef(null)
  useEffect(() => {
    if (!manageFocus) return
    const previous = document.activeElement
    const panel = panelRef.current
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]')].filter(el => {
      if (el.hidden) return false
      const closedDetails = el.closest('details:not([open])')
      return !closedDetails || el === closedDetails.querySelector('summary')
    })
    focusable()[0]?.focus()
    const onTab = event => {
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0], last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    panel.addEventListener('keydown', onTab)
    return () => { panel.removeEventListener('keydown', onTab); document.body.style.overflow = before; if (previous?.isConnected) previous.focus() }
  }, [manageFocus])

  useEffect(() => {
    if (!dismissible) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, dismissible])

  return createPortal(
    <div className={`apm-overlay${confirmation ? ' cfm-overlay' : ''}`} onMouseDown={e => dismissible && e.target === e.currentTarget && onClose()}>
      <div
        className={`apm-panel apm-shell${confirmation ? ' cfm-panel' : ''} ${className}`}
        ref={panelRef}
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
      >
        {confirmation ? <div className="cfm-head">
          {icon && <span className="cfm-badge" aria-hidden="true">{icon}</span>}
          <div className="cfm-head-text">
            {eyebrow && <div className="apm-eyebrow">{eyebrow}</div>}
            <div id={titleId} className="cfm-title">{title}</div>
            {subtitle && <div className="apm-subtitle">{subtitle}</div>}
          </div>
        </div> : <div className="eim-header">
          <div className="eim-header-main">
            {eyebrow && <div className="apm-eyebrow">{eyebrow}</div>}
            <div id={titleId} className="eim-title">{title}</div>
            {subtitle && <div className="apm-subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="eim-close" onClick={onClose} aria-label="Close" disabled={!dismissible}>
            <Icon d={ICON_CLOSE} />
          </button>
        </div>}
        {children}
      </div>
    </div>,
    document.body
  )
}
