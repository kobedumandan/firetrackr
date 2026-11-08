// Shared notification presentation — the toast stack and the bell panel both
// render the same item shape, so the icon and accent for each kind live here
// rather than being duplicated (and drifting) in two files.
import "../styles/Notifications.css";
import { incidentControl, isFireOperation } from '../utils/incidentOperations';
import { ICON_TRUCK } from './incidentFormOptions';

function Glyph({ className, children }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className={className}
      fill="currentColor"
    >
      {children}
    </svg>
  );
}

export function NotificationDescription({ kind, text }) {
  const separator = ['newIncident', 'onScene', 'workflow'].includes(kind) ? text.indexOf(' | ') : -1;
  if (separator < 0) return text;
  return (
    <>
      {text.slice(0, separator)}{" "}
      <span className="notif-separator" aria-hidden="true">|</span>{" "}
      {text.slice(separator + 3)}
    </>
  );
}

export function BellIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="M160-200v-80h80v-280q0-83 50-147.5T420-792v-28q0-25 17.5-42.5T480-880q25 0 42.5 17.5T540-820v28q80 20 130 84.5T720-560v280h80v80H160Zm320-300Zm0 420q-33 0-56.5-23.5T400-160h160q0 33-23.5 56.5T480-80ZM320-280h320v-280q0-66-47-113t-113-47q-66 0-113 47t-47 113v280Z" />
    </Glyph>
  );
}

export function CloseIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z" />
    </Glyph>
  );
}

function FireIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z" />
    </Glyph>
  );
}

function BeaconIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="M200-80v-80h560v80H200Zm40-120v-240q0-100 70-170t170-70q100 0 170 70t70 170v240H240Zm80-80h320v-160q0-66-47-113t-113-47q-66 0-113 47t-47 113v160ZM440-760v-160h80v160h-80ZM160-440H0v-80h160v80Zm800 0H800v-80h160v80ZM224-680 112-792l56-56 112 112-56 56Zm512 0-56-56 112-112 56 56-112 112Z" />
    </Glyph>
  );
}

function EscalationIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="m40-120 440-760 440 760H40Zm138-80h604L480-720 178-200Zm302-40q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm-40-120h80v-200h-80v200Zm40-100Z" />
    </Glyph>
  );
}

function ResolvedIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
    </Glyph>
  );
}

function ContainedIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="m438-338 226-226-57-57-169 169-84-84-57 57 141 141Zm42 258q-139-35-229.5-159.5T160-516v-244l320-120 320 120v244q0 152-90.5 276.5T480-80Zm0-84q104-33 172-132t68-220v-189l-240-90-240 90v189q0 121 68 220t172 132Zm0-316Z" />
    </Glyph>
  );
}

function ReportIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z" />
    </Glyph>
  );
}

function OnSceneIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="M480-480q33 0 56.5-23.5T560-560q0-33-23.5-56.5T480-640q-33 0-56.5 23.5T400-560q0 33 23.5 56.5T480-480Zm0 294q122-112 181-203.5T720-552q0-109-69.5-178.5T480-800q-101 0-170.5 69.5T240-552q0 71 59 162.5T480-186Zm0 106Q319-217 239.5-334.5T160-552q0-150 96.5-239T480-880q127 0 223.5 89T800-552q0 100-79.5 217.5T480-80Zm0-480Z" />
    </Glyph>
  );
}

function FireTruckIcon({ className }) {
  return <Glyph className={className}><path d={ICON_TRUCK} /></Glyph>;
}

function OfflineIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m2 2 20 20M8.5 16.5a5 5 0 0 1 7 0M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5A15 15 0 0 1 22 8.8M5 12a10 10 0 0 1 5.2-2.8M16.5 11.2A10 10 0 0 1 19 12M12 20h.01" />
    </svg>
  );
}

function NoUnitIcon({ className }) {
  return (
    <Glyph className={className}>
      <path d="M480-280q17 0 28.5-11.5T520-320q0-17-11.5-28.5T480-360q-17 0-28.5 11.5T440-320q0 17 11.5 28.5T480-280Zm-40-160h80v-240h-80v240Zm40 360q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z" />
    </Glyph>
  );
}

/* Accent token per kind. Written as a token NAME so the glyph colour can
   be derived from it in CSS via --n-accent — no colour literals here or
   in the stylesheet. `group` is the bell panel's filter tab. */
const KIND_META = {
  newIncident:        { Icon: BeaconIcon,      accent: "fire",   label: "New Incident",         group: "incidents" },
  escalation:         { Icon: EscalationIcon,  accent: "fire",   label: "Alarm Escalation",     group: "incidents" },
  contained:          { Icon: ContainedIcon,   accent: "emerald", label: "Situation Under Control", group: "incidents" },
  resolution:         { Icon: ResolvedIcon,    accent: "green",  label: "Resolved",             group: "incidents" },
  reportFiled:        { Icon: ReportIcon,      accent: "purple", label: "Report Filed",         group: "incidents" },
  workflow:           { Icon: OnSceneIcon,     accent: "slate",  label: "Response Update",      group: "dispatch" },
  onScene:            { Icon: OnSceneIcon,     accent: "amber",  label: "On Scene",             group: "dispatch" },
  autoDispatchFailed: { Icon: NoUnitIcon,      accent: "red",    label: "Auto-Dispatch Failed", group: "dispatch" },
  deviceOffline:      { Icon: OfflineIcon,     accent: "slate",  label: "Tracking offline",     group: "devices" },
  modelUpdates:       { Icon: ReportIcon,      accent: "blue",   label: "Model Update",         group: "models" },
  connectionRecovery: { Icon: BellIcon,        accent: "amber",  label: "Connection Recovery",  group: "dispatch" },
};

export function kindMeta(kind, incident, workflowKind) {
  if (kind === 'workflow' && workflowKind === 'suppression_start') {
    return { ...KIND_META.workflow, accent: 'amber' };
  }
  if (kind === 'workflow' && ['truck_ready', 'truck_not_ready'].includes(workflowKind)) {
    return { ...KIND_META.workflow, Icon: FireTruckIcon, accent: workflowKind === 'truck_ready' ? 'green' : 'slate' };
  }
  if (kind === 'newIncident' && isFireOperation(incident)) {
    return { ...KIND_META.newIncident, Icon: FireIcon };
  }
  if (kind === 'contained') return { ...KIND_META.contained, label: incidentControl(incident).label };
  return KIND_META[kind] ?? { Icon: BellIcon, accent: "slate", label: "Alert", group: "other" };
}
