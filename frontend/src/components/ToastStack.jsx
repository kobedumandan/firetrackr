// Transient alerts, bottom-right.
//
// Rendered from App.jsx at top level rather than from inside TopBar: .topbar
// sets position: relative + z-index: var(--z-topbar), which opens a stacking
// context that would trap any descendant below the map's own layers no matter
// how large a z-index it asked for.
import { createContext, useContext, useEffect, useId, useRef } from "react";
import { Toaster, toast } from "sonner";
import { kindMeta, CloseIcon, NotificationDescription } from "./notificationUi";
import { TOAST_MS } from "../hooks/useNotifications";
import useNotificationClock from "../hooks/useNotificationClock";
import { formatNotificationAge } from "../utils/notificationTime";
import { notificationDescription, notificationTitle, notificationWorkflowKind } from "../utils/notificationContent";
import { hasTrackerLocation } from "../utils/trackerStatus";
import "../styles/Notifications.css";

const ToastContext = createContext(null);

function NotificationToast({ notification }) {
  const { toasts, onDismiss, onOpenPanel, onOpenIncident, onOpenDetails,
    onViewLastLocation, trackerTargets, activeFireIds } = useContext(ToastContext);
  // Resolve actions and data at render time without restarting Sonner's timer.
  const n = toasts.find(item => item.id === notification.id) || notification;
  const now = useNotificationClock(true);
  const workflowKind = notificationWorkflowKind(n);
  const { Icon, accent, label } = kindMeta(n.kind, n.incident, workflowKind);
  const description = notificationDescription(n);
  const critical = n.severity === "critical";
  const details = n.kind === "workflow";
  const detailsLabel = workflowKind === 'suppression_start' ? 'View response analysis' : 'View details';
  const offline = n.kind === "deviceOffline";
  const tracker = n.tracker || trackerTargets?.get(n.id);
  const openable = Boolean(
    offline ? onViewLastLocation && tracker?.per_id != null && hasTrackerLocation(tracker)
      : n.fireId != null && (details ? onOpenDetails : onOpenIncident && activeFireIds?.has(n.fireId)),
  );
  return (
    <div
      className={`toast${critical ? " critical" : ""}`}
      data-kind={n.kind}
      data-workflow-kind={workflowKind}
      style={{
        "--n-accent": `var(--accent-${accent}-rgb)`,
      }}
      /* Critical alerts interrupt a screen reader; the rest wait for a
         pause. Matches how adm-banner announces itself. */
      role={critical ? "alert" : "status"}
      aria-live={critical ? "assertive" : "polite"}
    >
      <div className="toast-icon">
        <Icon className="toast-icon-svg" />
      </div>
      <div className="toast-body">
        <div className="toast-meta">
          <div className="toast-kind">{label}</div>
          {critical && n.kind !== "newIncident" && n.kind !== "escalation" && <span className="toast-crit">Critical</span>}
          <time
            className="toast-time"
            dateTime={n.at}
            title={n.at ? new Date(n.at).toLocaleString() : undefined}
            aria-live="off"
          >
            {formatNotificationAge(n.at, now)}
          </time>
        </div>
        <div className="toast-title">{notificationTitle(n)}</div>
        {description && <div className="toast-sub"><NotificationDescription kind={n.kind} text={description} /></div>}
        <div className="toast-actions">
          {openable && (
            <button
              type="button"
              className="toast-btn"
              onClick={() => {
                onDismiss(n.id);
                if (offline) onViewLastLocation(tracker);
                else if (details) onOpenDetails(n.fireId, workflowKind);
                else onOpenIncident(n.fireId);
              }}
            >
              {offline ? "View last location" : details ? detailsLabel : "View on map"}
            </button>
          )}
          <button type="button" className="toast-btn" onClick={onOpenPanel}>
            All alerts
          </button>
        </div>
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(n.id)}
        aria-label="Dismiss alert"
      >
        <CloseIcon className="toast-close-svg" />
      </button>
    </div>
  );
}

export default function ToastStack(props) {
  const { toasts, onDismiss } = props;
  const toasterId = useId();
  const registered = useRef(new Map());

  useEffect(() => {
    const ids = registered.current;
    const current = new Set(toasts.map(n => n.id));
    for (const [id, sonnerId] of ids) {
      if (!current.has(id)) {
        ids.delete(id);
        toast.dismiss(sonnerId);
      }
    }
    // The store is newest-first; publish oldest-first so Sonner keeps that order.
    for (const n of [...toasts].reverse()) {
      if (ids.has(n.id)) continue;
      const sonnerId = `${toasterId}-${n.id}`;
      ids.set(n.id, sonnerId);
      const forget = () => {
        if (ids.has(n.id)) onDismiss?.(n.id);
      };
      toast.custom(() => <NotificationToast notification={n} />, {
        id: sonnerId,
        toasterId,
        duration: n.severity === "critical" ? Infinity : TOAST_MS,
        onDismiss: forget,
        onAutoClose: forget,
      });
    }
  }, [toasts, onDismiss, toasterId]);

  useEffect(() => {
    const ids = registered.current;
    return () => {
      const sonnerIds = [...ids.values()];
      ids.clear();
      sonnerIds.forEach(id => toast.dismiss(id));
    };
  }, []);

  return (
    <ToastContext.Provider value={props}>
      <Toaster
        id={toasterId}
        className="toast-stack"
        position="bottom-right"
        visibleToasts={3}
        gap={10}
        offset={18}
        mobileOffset={16}
        duration={TOAST_MS}
        containerAriaLabel="Alerts"
        style={{ "--width": "360px", zIndex: "calc(var(--z-modal) + 1)" }}
      />
    </ToastContext.Provider>
  );
}
