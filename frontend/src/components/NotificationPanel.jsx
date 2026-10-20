// The alert history behind the rail's bell. A toast is gone in seconds; this
// is what a dispatcher who looked away comes back to.
import { useEffect, useMemo, useRef, useState } from "react";
import { kindMeta, BellIcon, CloseIcon } from "./notificationUi";
import { formatLoginStamp } from "../utils/session";
import "../styles/Notifications.css";

const TABS = [
  { key: "all", label: "All" },
  { key: "incidents", label: "Incidents" },
  { key: "dispatch", label: "Dispatch" },
  { key: "devices", label: "Devices" },
  { key: "models", label: "Models" },
];

/* Relative for the first hour — "4m ago" is what matters on a live board —
   then the same absolute stamp the toasts use. */
function relTime(iso, now) {
  const secs = Math.round((now - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(secs)) return "—";
  if (secs < 45) return "Just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return formatLoginStamp(iso);
}

export default function NotificationPanel({
  items,
  onClose,
  onDismiss,
  onClear,
  onOpenIncident,
  activeFireIds,
}) {
  const panelRef = useRef(null);
  const [tab, setTab] = useState("all");
  // Ticks the relative stamps while the panel is open; the panel only exists
  // while open, so nothing runs in the background.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Close on Escape or on a click outside — the same dismissal grammar the
  // modals already use, minus the scrim, since this is a popover and the map
  // behind it stays live.
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e) {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target) &&
        !e.target.closest(".topbar-alerts-btn")
      ) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const counts = useMemo(() => {
    const c = { all: items.length };
    items.forEach((n) => {
      const g = kindMeta(n.kind).group;
      c[g] = (c[g] ?? 0) + 1;
    });
    return c;
  }, [items]);

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);

  const visible = useMemo(
    () => (tab === "all" ? items : items.filter((n) => kindMeta(n.kind).group === tab)),
    [items, tab],
  );

  return (
    <div className="notif-panel" ref={panelRef} role="dialog" aria-label="Alerts">
      <div className="notif-panel-head">
        <div className="notif-panel-heading">
          <div className="notif-panel-title">Alerts</div>
          {unread > 0 && <span className="notif-new-chip">{unread} new</span>}
        </div>
        <button
          type="button"
          className="notif-panel-close"
          onClick={onClose}
          aria-label="Close alerts"
        >
          <CloseIcon className="notif-close-svg" />
        </button>
      </div>

      <div className="notif-tabs" role="tablist" aria-label="Filter alerts">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`notif-tab${tab === t.key ? " active" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {counts[t.key] > 0 && <span className="notif-tab-count">{counts[t.key]}</span>}
          </button>
        ))}
      </div>

      <div className="notif-list">
        {visible.length === 0 ? (
          <div className="notif-empty">
            <div className="notif-empty-icon">
              <BellIcon className="notif-empty-svg" />
            </div>
            <div className="notif-empty-title">
              {items.length === 0 ? "No alerts yet" : "Nothing in this category"}
            </div>
            <div className="notif-empty-sub">
              New incidents, escalations and unit arrivals will appear here.
            </div>
          </div>
        ) : (
          visible.map((n) => {
            const { Icon, accent, label } = kindMeta(n.kind);
            // Only an incident still on the board can be jumped to; a closed
            // one has no pin left to focus.
            const openable = Boolean(
              onOpenIncident && n.fireId != null && activeFireIds?.has(n.fireId),
            );
            return (
              <div
                key={n.id}
                className={`notif-item${n.read ? "" : " unread"}${openable ? " openable" : ""}`}
                style={{ "--n-accent": `var(--accent-${accent}-rgb)` }}
                onClick={openable ? () => onOpenIncident(n.fireId) : undefined}
                role={openable ? "button" : undefined}
                tabIndex={openable ? 0 : undefined}
                onKeyDown={
                  openable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenIncident(n.fireId);
                        }
                      }
                    : undefined
                }
              >
                <div className="notif-item-icon">
                  <Icon className="notif-item-svg" />
                </div>
                <div className="notif-item-body">
                  <div className="notif-item-meta">
                    <span className="notif-item-kind">{label}</span>
                    {n.severity === "critical" && (
                      <span className="notif-item-crit">Critical</span>
                    )}
                    <span
                      className="notif-item-time"
                      title={new Date(n.at).toLocaleString()}
                    >
                      {relTime(n.at, now)}
                    </span>
                  </div>
                  <div className="notif-item-title">{n.title}</div>
                  {n.body && <div className="notif-item-sub">{n.body}</div>}
                  {openable && (
                    <div className="notif-item-link">
                      View on map
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="notif-item-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismiss(n.id);
                  }}
                  aria-label="Remove alert"
                >
                  <CloseIcon className="notif-close-svg" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {items.length > 0 && (
        <div className="notif-panel-foot">
          <span className="notif-foot-count">
            {items.length} ALERT{items.length !== 1 ? "S" : ""} THIS SESSION
          </span>
          <button type="button" className="notif-clear" onClick={onClear}>
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
