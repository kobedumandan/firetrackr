// The alert history behind the rail's bell. A toast is gone in seconds; this
// is what a dispatcher who looked away comes back to.
import { useEffect, useMemo, useRef, useState } from "react";
import { kindMeta, BellIcon, CloseIcon, NotificationDescription } from "./notificationUi";
import useNotificationClock from "../hooks/useNotificationClock";
import { formatNotificationAge } from "../utils/notificationTime";
import { notificationDescription, notificationTitle, notificationWorkflowKind } from "../utils/notificationContent";
import { hasTrackerLocation } from "../utils/trackerStatus";
import "../styles/Notifications.css";

const TABS = [
  { key: "all", label: "All" },
  { key: "incidents", label: "Incidents" },
  { key: "dispatch", label: "Dispatch" },
  { key: "devices", label: "Tracking" },
  { key: "models", label: "Models" },
];

export default function NotificationPanel({
  items,
  onClose,
  onDismiss,
  onClear,
  onOpenIncident,
  onOpenDetails,
  onViewLastLocation,
  trackerTargets,
  activeFireIds,
}) {
  const panelRef = useRef(null);
  const [tab, setTab] = useState("all");
  const now = useNotificationClock();

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
            const workflowKind = notificationWorkflowKind(n);
            const { Icon, accent, label } = kindMeta(n.kind, n.incident, workflowKind);
            const description = notificationDescription(n);
            const details = n.kind === "workflow";
            const detailsLabel = workflowKind === 'suppression_start' ? 'View response analysis' : 'View details';
            const offline = n.kind === "deviceOffline";
            const tracker = n.tracker || trackerTargets?.get(n.id);
            // Detail links remain available after an incident leaves the map.
            const openable = Boolean(
              offline ? onViewLastLocation && tracker?.per_id != null && hasTrackerLocation(tracker)
                : n.fireId != null && (details ? onOpenDetails : onOpenIncident && activeFireIds?.has(n.fireId)),
            );
            const open = () => {
              if (offline) onViewLastLocation(tracker);
              else if (details) onOpenDetails(n.fireId, workflowKind);
              else onOpenIncident(n.fireId);
            };
            return (
              <div
                key={n.id}
                className={`notif-item${n.read ? "" : " unread"}${openable ? " openable" : ""}`}
                data-kind={n.kind}
                data-workflow-kind={workflowKind}
                style={{ "--n-accent": `var(--accent-${accent}-rgb)` }}
                onClick={openable ? open : undefined}
                role={openable ? "button" : undefined}
                tabIndex={openable ? 0 : undefined}
                onKeyDown={
                  openable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          open();
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
                    <div className="notif-item-kind">{label}</div>
                    {n.severity === "critical" && n.kind !== "newIncident" && n.kind !== "escalation" && (
                      <span className="notif-item-crit">Critical</span>
                    )}
                    <time
                      className="notif-item-time"
                      dateTime={n.at}
                      title={n.at ? new Date(n.at).toLocaleString() : undefined}
                      aria-live="off"
                    >
                      {formatNotificationAge(n.at, now)}
                    </time>
                  </div>
                  <div className="notif-item-title">{notificationTitle(n)}</div>
                  {description && <div className="notif-item-sub"><NotificationDescription kind={n.kind} text={description} /></div>}
                  {openable && (
                    <div className="notif-item-link">
                      {offline ? "View last location" : details ? detailsLabel : "View on map"}
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
