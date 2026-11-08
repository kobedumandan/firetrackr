import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "../styles/AppModal.css";
import "../styles/ConfirmModal.css";

// Badge icons (Material Symbols, 0 -960 960 960).
const ICONS = {
  delete: "M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z",
  logout: "M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h280v80H200v560h280v80H200Zm440-160-55-58 102-102H360v-80h327L585-622l55-58 200 200-200 200Z",
  release: "M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z",
};

/**
 * Reusable confirmation dialog (destructive actions, sign out, team release).
 *
 * Props:
 *   className    – optional panel class for scoped styling
 *   eyebrow      – small mono label above the title (default "CONFIRM")
 *   title        – heading text
 *   message      – body text / node describing the consequence
 *   details      – optional [{ label, value }] summarising the affected record
 *   icon         – badge icon: "delete" (default) | "logout" | "release"
 *   confirmLabel – confirm button text (default "Delete")
 *   confirmDisabled – disables confirmation when the action is unavailable
 *   cancelLabel  – cancel button text (default "Cancel")
 *   onConfirm    – async fn run when confirmed; may throw to show an inline error
 *   onClose      – fn to dismiss the dialog
 */
export default function ConfirmModal({
  className = "",
  eyebrow = "CONFIRM",
  title = "Are you sure?",
  message,
  details,
  icon = "delete",
  confirmLabel = "Delete",
  confirmDisabled = false,
  cancelLabel = "Cancel",
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err?.message || "Something went wrong.");
      setBusy(false);
    }
  }

  return createPortal(
    <div className="apm-overlay cfm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`apm-panel cfm-panel${className ? ` ${className}` : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="cfm-title" aria-describedby="cfm-message">
        <div className="cfm-head">
          <span className="cfm-badge">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" className="cfm-badge-icon" fill="currentColor" aria-hidden="true">
              <path d={ICONS[icon] || ICONS.delete} />
            </svg>
          </span>
          <div className="cfm-head-text">
            {eyebrow && <div className="apm-eyebrow">{eyebrow}</div>}
            <div id="cfm-title" className="cfm-title">{title}</div>
          </div>
        </div>

        <div className="cfm-body">
          {details?.length > 0 && (
            <dl className="cfm-details">
              {details.map((d) => (
                <div key={d.label} className="cfm-detail">
                  <dt>{d.label}</dt>
                  <dd>{d.value || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
          <p id="cfm-message" className="cfm-message">{message}</p>
          {error && <div className="apm-error cfm-error">{error}</div>}
        </div>

        <div className="cfm-actions">
          <button className="apm-btn-cancel" onClick={onClose} disabled={busy} autoFocus>
            {cancelLabel}
          </button>
          <button className="cfm-btn-danger" onClick={handleConfirm} disabled={busy || confirmDisabled}>
            {busy ? <span className="apm-spinner" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
