import { useState, useId } from "react";
import "../styles/RightSidebar.css";
import "../styles/CommandIncidentPanel.css";
import AnalysisIcon from "./AnalysisIcon";
import DispatchModal from "./DispatchModal";
import EscalateAlarmModal from "./EscalateAlarmModal";
import IncidentTimeline from "./IncidentTimeline";

function TimeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="meta-icon"
      fill="currentColor"
    >
      <path d="m612-292 56-56-148-148v-184h-80v216l172 172ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-400Zm0 320q133 0 226.5-93.5T800-480q0-133-93.5-226.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160Z" />
    </svg>
  );
}

function FireGeneralIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="sev-icon"
      fill="currentColor"
    >
      <path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z" />
    </svg>
  );
}

function FireTruckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="fire_truck_icon"
      fill="currentColor"
    >
      <path d="M195-155q-35-35-35-85h-40q-33 0-56.5-23.5T40-320v-200h440v-160q0-33 23.5-56.5T560-760h80v-40q0-17 11.5-28.5T680-840h40q17 0 28.5 11.5T760-800v40h22q26 0 47 15t29 40l58 172q2 6 3 12.5t1 13.5v267H800q0 50-35 85t-85 35q-50 0-85-35t-35-85H400q0 50-35 85t-85 35q-50 0-85-35Zm113.5-56.5Q320-223 320-240t-11.5-28.5Q297-280 280-280t-28.5 11.5Q240-257 240-240t11.5 28.5Q263-200 280-200t28.5-11.5Zm400 0Q720-223 720-240t-11.5-28.5Q697-280 680-280t-28.5 11.5Q640-257 640-240t11.5 28.5Q663-200 680-200t28.5-11.5ZM120-440v120h71q17-19 40-29.5t49-10.5q26 0 49 10.5t40 29.5h111v-120H120Zm440 120h31q17-19 40-29.5t49-10.5q26 0 49 10.5t40 29.5h71v-120H560v120Zm0-200h276l-54-160H560v160ZM40-560v-60h40v-80H40v-60h400v60h-40v80h40v60H40Zm100-60h70v-80h-70v80Zm130 0h70v-80h-70v80Zm210 180H120h360Zm80 0h280-280Z" />
    </svg>
  );
}

function SwitchAltRouteIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="sev-icon"
      fill="currentColor"
    >
      <path d="M440-80v-200q0-56-17-83t-45-53l57-57q12 11 23 23.5t22 26.5q14-19 28.5-33.5T538-485q38-35 69-81t33-161l-63 63-57-56 160-160 160 160-56 56-64-63q-2 143-44 203.5T592-425q-32 29-52 56.5T520-280v200h-80ZM248-633q-4-20-5.5-44t-2.5-50l-64 63-56-56 160-160 160 160-57 56-63-62q0 21 2 39.5t4 34.5l-78 19Zm86 176q-20-21-38.5-49T263-575l77-19q10 27 23 46t28 34l-57 57Z" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="minimize_icon"
      fill="currentColor"
    >
      <path d="M440-440v240h-80v-160H200v-80h240Zm160-320v160h160v80H520v-240h80Z" />
    </svg>
  );
}
function MaximizeIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="maximize_icon"
      fill="currentColor"
    >
      <path d="M200-200v-240h80v160h160v80H200Zm480-320v-160H520v-80h240v240h-80Z" />
    </svg>
  );
}

function fmtTimestamp(isoStr) {
  return fmtTime(isoStr);
}

function SkeletonDetail() {
  return (
    <>
      <div className="detail-header">
        <div
          className="skel"
          style={{ width: 130, height: 12, borderRadius: 3, marginBottom: 10 }}
        />
        <div
          className="skel"
          style={{
            width: "82%",
            height: 17,
            borderRadius: 3,
            marginBottom: 10,
          }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          <div
            className="skel"
            style={{ width: 72, height: 22, borderRadius: 6 }}
          />
          <div
            className="skel"
            style={{ width: 72, height: 22, borderRadius: 6 }}
          />
          <div
            className="skel"
            style={{ width: 72, height: 22, borderRadius: 6 }}
          />
        </div>
      </div>
      <div className="detail-body">
        {[1, 2, 3, 4, 5].map((n) => (
          <div key={n} className="detail-row">
            <div
              className="skel"
              style={{ width: 76, height: 12, borderRadius: 3 }}
            />
            <div
              className="skel"
              style={{ width: 110, height: 12, borderRadius: 3 }}
            />
          </div>
        ))}
      </div>
      <div className="detail-actions">
        <div
          className="skel"
          style={{ width: "100%", height: 34, borderRadius: 4 }}
        />
        <div
          className="skel"
          style={{ width: "100%", height: 30, borderRadius: 4 }}
        />
        <div
          className="skel"
          style={{ width: "100%", height: 30, borderRadius: 4 }}
        />
      </div>
    </>
  );
}

function NormalViewIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="view-mode-icon"
      fill="currentColor"
    >
      <path d="m600-120-240-84-186 72q-20 8-37-4.5T120-170v-560q0-13 7.5-23t20.5-15l212-72 240 84 186-72q20-8 37 4.5t17 33.5v560q0 13-7.5 23T812-192l-212 72Zm-40-98v-468l-160-56v468l160 56Zm80 0 120-40v-474l-120 46v468Zm-440-10 120-46v-468l-120 40v474Zm440-458v468-468Zm-320-56v468-468Z" />
    </svg>
  );
}

function ObstructionsViewIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="view-mode-icon"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2.5" y="8.5" width="19" height="7" rx="1.2" />
      <line x1="8" y1="8.5" x2="5" y2="15.5" />
      <line x1="13" y1="8.5" x2="10" y2="15.5" />
      <line x1="18" y1="8.5" x2="15" y2="15.5" />
    </svg>
  );
}

function ConstraintsViewIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="view-mode-icon"
      fill="currentColor"
    >
      <path d="M120-120v-200h160l160-160v-128q-36-13-58-43.5T360-720q0-50 35-85t85-35q50 0 85 35t35 85q0 38-22 68.5T520-608v128l160 160h160v200H640v-122L480-402 320-242v122H120Z" />
    </svg>
  );
}

function HeatmapViewIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="view-mode-icon"
      fill="currentColor"
    >
      <path d="M480-120q-83 0-141.5-58.5T280-320q0-48 21-89.5t59-70.5v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q38 29 59 70.5t21 89.5q0 83-58.5 141.5T480-120Zm0-80q50 0 85-35t35-85q0-29-12.5-54T552-416l-32-24v-280q0-17-11.5-28.5T480-760q-17 0-28.5 11.5T440-720v280l-32 24q-23 17-35.5 42T360-320q0 50 35 85t85 35Zm0-120Z" />
    </svg>
  );
}

function BarangayViewIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="view-mode-icon"
      fill="currentColor"
    >
      <path d="M280-280h160v-200h80v200h160v-280L480-680 280-560v280Zm-80 80v-400l280-168 280 168v400H520v-200h-80v200H200Zm280-300Z" />
    </svg>
  );
}

function IncidentTabIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="sidebar-tab-icon"
      fill="currentColor"
    >
      <path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z" />
    </svg>
  );
}

function RoutingTabIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="sidebar-tab-icon"
      fill="currentColor"
    >
      <path d="M247-167q-47-47-47-113v-327q-35-13-57.5-43.5T120-720q0-50 35-85t85-35q50 0 85 35t35 85q0 39-22.5 69.5T280-607v327q0 33 23.5 56.5T360-200q33 0 56.5-23.5T440-280v-400q0-66 47-113t113-47q66 0 113 47t47 113v327q35 13 57.5 43.5T840-240q0 50-35 85t-85 35q-50 0-85-35t-35-85q0-39 22.5-70t57.5-43v-327q0-33-23.5-56.5T600-760q-33 0-56.5 23.5T520-680v400q0 66-47 113t-113 47q-66 0-113-47Zm-7-513q17 0 28.5-11.5T280-720q0-17-11.5-28.5T240-760q-17 0-28.5 11.5T200-720q0 17 11.5 28.5T240-680Zm480 480q17 0 28.5-11.5T760-240q0-17-11.5-28.5T720-280q-17 0-28.5 11.5T680-240q0 17 11.5 28.5T720-200ZM240-720Zm480 480Z" />
    </svg>
  );
}

function TimelineTabIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="sidebar-tab-icon"
      fill="currentColor"
    >
      <path d="M120-240q-33 0-56.5-23.5T40-320q0-33 23.5-56.5T120-400h10.5q4.5 0 9.5 2l182-182q-2-5-2-9.5V-600q0-33 23.5-56.5T400-680q33 0 56.5 23.5T480-600q0 2-2 20l102 102q5-2 9.5-2h21q4.5 0 9.5 2l142-142q-2-5-2-9.5V-640q0-33 23.5-56.5T840-720q33 0 56.5 23.5T920-640q0 33-23.5 56.5T840-560h-10.5q-4.5 0-9.5-2L678-420q2 5 2 9.5v10.5q0 33-23.5 56.5T600-320q-33 0-56.5-23.5T520-400v-10.5q0-4.5 2-9.5L420-522q-5 2-9.5 2H400q-2 0-20-2L198-340q2 5 2 9.5v10.5q0 33-23.5 56.5T120-240Z" />
    </svg>
  );
}

// Statuses POST /api/dispatch/{id}/full-reroute accepts; anything else 409s,
// so the button is hidden rather than offered and then refused.
const REROUTABLE_STATUSES = new Set(["dispatched", "en_route", "on_scene"]);

// Each route answers a different question, so the label has to say which one —
// "Alt 1" tells the dispatcher nothing about why they would pick it.
const ROUTE_LABELS = {
  recommended: "Recommended",
  fastest: "Fastest",
  alternative: "Alternative",
  fallback: "Direct line",
};
const ROUTE_HINTS = {
  recommended: "Avoids roads the model flags as risky",
  fastest: "Shortest travel time, model ignored",
};

const TABS = [
  { key: "Incident", Icon: IncidentTabIcon },
  { key: "Routing", Icon: RoutingTabIcon },
  { key: "Timeline", Icon: TimelineTabIcon },
];

function fmtTime(isoStr) {
  if (!isoStr) return "Not recorded";
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return "Not recorded";
  return d.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function fullTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Not recorded";
}

const roleOf = (member) => String(member.member_role || "").toLowerCase().replaceAll("_", " ").trim();
const isTeamLeader = (member) => roleOf(member) === "team leader";
const readableStatus = (status) => ({ pending: "Pending", active: "Active", dispatched: "Dispatched", en_route: "En route", on_scene: "On scene", contained: "Contained", closed: "Closed", cancelled: "Cancelled", canceled: "Cancelled", recalled: "Recalled", completed: "Completed" }[status] || (status ? String(status).replaceAll("_", " ") : "Not recorded"));

function AssignedTeam({ dispatch }) {
  const members = [...(dispatch.members || [])].sort((a, b) => Number(isTeamLeader(b)) - Number(isTeamLeader(a)));
  const leader = members.find(isTeamLeader);
  return <article className="dispatch-team-card ci-team-card">
    <header className="dispatch-team-header"><span className="ci-team-icon"><FireTruckIcon /></span><div className="dispatch-team-meta"><h4 className="dispatch-team-name">{dispatch.team_name || "Unnamed team"}</h4><span className="dispatch-team-station">{dispatch.station_name || "Station not recorded"}{dispatch.team_code ? ` · ${dispatch.team_code}` : ''}</span></div><span className="ci-dispatch-status" data-status={dispatch.dispatch_status}>{readableStatus(dispatch.dispatch_status)}</span></header>
    <div className="ci-team-context">{dispatch.truck_platenums?.length > 0 && <span>{dispatch.truck_platenums.join(" · ")}</span>}<span>Dispatched {fmtTime(dispatch.dispatch_at)}{dispatch.dispatch_at ? ' PHT' : ''}</span>{leader && <span className="ci-lead-preview">Team leader · {leader.name || "Name not recorded"}</span>}</div>
    {members.length ? <details className="ci-roster"><summary><span>Team roster<span className="ci-count">{members.length}</span></span><AnalysisIcon name="chevron" /></summary><div className="dispatch-members">{members.map((member) => <div key={member.per_id} className={`dispatch-member-row${isTeamLeader(member) ? ' dispatch-member-leader' : ''}`}><span className="dispatch-member-av">{member.initials || '?'}</span><div className="dispatch-member-info"><span className="dispatch-member-name">{member.name || "Name not recorded"}</span><span className="dispatch-member-rank">{member.rank || "Rank not recorded"}</span></div><span className="ci-member-role">{roleOf(member) || "Role not recorded"}</span></div>)}<p className="ci-roster-note">Current team membership; attendance is not confirmed here.</p></div></details> : <p className="ci-roster-unavailable">Team roster not recorded.</p>}
  </article>;
}

function SevChip({ sev }) {
  const s = (sev || "").toLowerCase();
  if (s === "critical")
    return (
      <span className="detail-chip sev-chip chip-fire">
        <FireGeneralIcon />
        {sev}
      </span>
    );
  if (s === "moderate")
    return (
      <span className="detail-chip sev-chip chip-amber">
        <FireGeneralIcon />
        {sev}
      </span>
    );
  return (
    <span className={`detail-chip sev-chip chip-${s === "minor" ? "green" : "normal"}`}>
      <FireGeneralIcon />
      {sev || "Severity not recorded"}
    </span>
  );
}

function StatusChip({ status }) {
  const tone = ["contained", "closed", "on_scene"].includes(status) ? "green" : ["dispatched", "en_route", "pending"].includes(status) ? "amber" : status === "active" ? "fire" : "normal";
  return <span className={`detail-chip ci-status chip-${tone}`}><span className="ci-status-dot" />{readableStatus(status)}</span>;
}

export default function RightSidebar({
  incident = null,
  incidentRoutes = [],
  incidentDispatches = [],
  livePersonnelLocations = [],
  onSelectRoute,
  onFullReroute,
  loading = false,
  collapsed = false,
  onToggleCollapse,
  onDispatched,
  viewMode = "normal",
  onViewModeChange,
  focusNonce = 0,
  onLayerToolsHostChange,
  constraintEditing = false,
}) {
  const viewModeButtons = (
    <div
      className={`view-mode-toggles ${
        collapsed ? "view-mode-toggles--top" : "view-mode-toggles--below"
      }`}
    >
      {[
        { key: "normal", label: "Normal", Icon: NormalViewIcon },
        { key: "gnn", label: "GNN Constraints", Icon: ConstraintsViewIcon },
        {
          key: "obstructions",
          label: "Road Obstructions",
          Icon: ObstructionsViewIcon,
        },
        { key: "heatmap", label: "Heatmap", Icon: HeatmapViewIcon },
        { key: "barangay", label: "Barangays", Icon: BarangayViewIcon },
      ].map(({ key, label, Icon }) => (
        <button
          key={key}
          className={`view-mode-btn${viewMode === key ? " active" : ""}`}
          onClick={() => onViewModeChange?.(key)}
          disabled={constraintEditing && key !== 'gnn'}
          title={label}
          aria-label={label}
        >
          <Icon />
        </button>
      ))}
    </div>
  );

  const tabId = useId();
  const [tabSelection, setTabSelection] = useState({ key: "Incident", focusNonce });
  const activeTab = tabSelection.focusNonce === focusNonce ? tabSelection.key : "Incident";
  const setActiveTab = (key) => setTabSelection({ key, focusNonce });
  const onTabKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex(tab => tab.key === activeTab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    setActiveTab(TABS[next].key);
    event.currentTarget.querySelectorAll('[role="tab"]')[next]?.focus();
  };
  const canRespond = incident && !["contained", "closed", "cancelled", "canceled", "recalled"].includes(incident.status);
  const highestAlarm = ["3rd Alarm", "General Alarm"].includes(incident?.alarm);
  const headerTime = incident?.report_received_at || incident?.reported_at;
  const [showDispatch, setShowDispatch] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [rerouteConfirm, setRerouteConfirm] = useState(null); // dispatch_id awaiting confirm
  const [rerouteLoading, setRerouteLoading] = useState(false);
  // Kept separate from rerouteConfirm above: that one belongs to the deviation
  // panel, and a shared key would open both confirmations at once whenever a
  // deviated unit is on the same dispatch.
  const [forceRerouteConfirm, setForceRerouteConfirm] = useState(null);
  const [forceRerouteBusy, setForceRerouteBusy] = useState(null);
  const [routeSwitchBusy, setRouteSwitchBusy] = useState(null);
  const [routeSwitchError, setRouteSwitchError] = useState(null);

  if (constraintEditing) {
    return <div className="right-sidebar-dock right-sidebar-dock--collapsed">
      {viewModeButtons}
      <div ref={onLayerToolsHostChange} className="command-map-layer-slot" />
    </div>;
  }

  if (collapsed) {
    return (
        <div className="right-sidebar-dock right-sidebar-dock--collapsed ci-dock">
        <div className="right-sidebar-dock-top">
        <button
          className="right-sidebar-float-btn"
          onClick={onToggleCollapse}
          title="Expand details panel"
          aria-label="Expand incident view"
        >
          <MaximizeIcon />
          Incident view
        </button>
        {viewModeButtons}
        </div>
        <div ref={onLayerToolsHostChange} className="command-map-layer-slot" />
      </div>
    );
  }

  return (
    <>
      <div className="right-sidebar-dock ci-dock">
      <aside className="sidebar-right ci-sidebar" aria-label="Incident view">
        <div className="sidebar-tabs">
          <div className="ci-panel-heading"><span className="ci-eyebrow">Command</span><h2 className="sidebar-section-header">Incident view</h2></div>
          <button
            className="sidebar-collapse-btn--right"
            onClick={onToggleCollapse}
            title="Collapse"
            aria-label="Collapse incident view"
          >
            <MinimizeIcon />
          </button>
        </div>

        {incident && (
          <>
            <div className="detail-header">
              <div className="detail-tag">
                <span className="ci-incident-id">{incident.id}</span>
                <StatusChip status={incident.status} />
              </div>
              <h3 className="detail-title" title={incident.loc}>{incident.loc || "Location not recorded"}</h3>
              {incident.addr && <p className="ci-address" title={incident.addr}>{incident.addr}</p>}
              <div className="detail-status-row">
                <SevChip sev={incident.sev} />
                <span className="detail-chip ci-alarm-chip"><AnalysisIcon name="preparation" />{incident.alarm || "Alarm not recorded"}</span>
              </div>
              <div className="ci-report-time"><TimeIcon /><span>{incident.report_received_at ? "Report received" : "Incident time"}</span><time dateTime={headerTime || undefined} title={fullTime(headerTime)}>{fmtTime(headerTime)}{headerTime ? ' PHT' : ''}</time></div>
            </div>

            <div className="sidebar-tabs--below">
              <div className="sidebar-tabs-wrap" role="tablist" aria-label="Incident detail sections" onKeyDown={onTabKeyDown}>
                {TABS.map(({ key, Icon }) => (
                  <button
                    key={key}
                    className={`sidebar-tab${activeTab === key ? " active" : ""}`}
                    onClick={() => setActiveTab(key)}
                    title={key}
                    aria-label={key}
                    role="tab"
                    id={`${tabId}-${key}`}
                    aria-controls={`${tabId}-panel`}
                    aria-selected={activeTab === key}
                    tabIndex={activeTab === key ? 0 : -1}
                  >
                    <Icon />
                    <span>{key}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="ci-content" id={`${tabId}-panel`} role={incident ? "tabpanel" : undefined} aria-labelledby={incident ? `${tabId}-${activeTab}` : undefined} tabIndex={incident ? 0 : undefined}>
        {loading && !incident && <div className="ci-loading" role="status" aria-label="Loading incident details"><SkeletonDetail /></div>}
        {!loading && !incident && <div className="ci-empty"><span><AnalysisIcon name="handling" /></span><h3>No incident selected</h3><p>Select an incident from the map or incident list to review its details and response teams.</p></div>}

        {/* ── Routing tab ───────────────────────────────────────────────────── */}
        {incident &&
          activeTab === "Routing" &&
          (() => {
            const deviatedPersonnel = livePersonnelLocations.filter((p) => {
              if (!p.is_deviated) return false;
              const d = incidentDispatches.find(
                (d) => d.dispatch_id === p.dispatch_id
              );
              return !!d;
            });

            return (
              <div className="detail-body">
                {incidentDispatches.length === 0 && <div className="ci-empty-inline">No teams assigned yet. Route options will appear after dispatch.</div>}
                {incidentDispatches.length > 0 && (
                  <>
                    <div className="detail-section-title">Dispatch routing</div>
                    <div className="routing-panel">
                      <div className="routing-title">Route overview</div>
                      <div className="routing-row">
                        <span className="routing-row-label">Incident</span>
                        <span className="routing-row-value">{incident.loc}</span>
                      </div>
                      <div className="routing-row">
                        <span className="routing-row-label">Coordinates</span>
                        <span className="routing-row-value">
                          {incident.latitude?.toFixed(5)},{" "}
                          {incident.longitude?.toFixed(5)}
                        </span>
                      </div>
                      <div className="routing-row">
                        <span className="routing-row-label">Team assignments</span>
                        <span className="routing-row-value highlight">
                          {incidentDispatches.length}
                        </span>
                      </div>
                    </div>
                  </>
                )}

                {/* Routes are grouped per dispatch. We iterate the DISPATCHES
                    rather than the routes so a dispatch that came back with no
                    computed path still gets a block — that is exactly the case
                    where the dispatcher needs the reroute button. */}
                {incidentDispatches.map((d) => {
                  const sorted = incidentRoutes
                    .filter((r) => r.dispatch_id === d.dispatch_id)
                    .sort((a, b) => a.rank - b.rank);
                  const teamName = d.team_name || sorted[0]?.teamName || "";
                  const canReroute = REROUTABLE_STATUSES.has(d.dispatch_status);
                  // A fallback entry is the straight station→incident line the
                  // map draws when routing produced nothing — not a real route.
                  const hasRealRoute = sorted.some(
                    (r) => r.routeType !== "fallback"
                  );
                  const confirming = forceRerouteConfirm === d.dispatch_id;

                  return (
                    <div key={d.dispatch_id}>
                      <div className="detail-section-title">
                        Routes · {teamName}
                      </div>

                      {sorted.map((r) => (
                        <div
                          key={r.id}
                          className={`route-option${
                            r.isSelected ? " route-option--selected" : ""
                          }`}
                        >
                          <div className="route-option-info">
                            <span className="route-option-label">
                              {ROUTE_LABELS[r.routeType] ?? `Alt ${r.rank - 1}`}
                            </span>
                            {ROUTE_HINTS[r.routeType] && (
                              <div className="route-option-hint">
                                {ROUTE_HINTS[r.routeType]}
                              </div>
                            )}
                            <div className="route-option-metrics">
                              {r.etaMinutes != null && (
                                <span className="route-option-eta">
                                  ETA: ~{r.etaMinutes} min
                                </span>
                              )}
                              {r.distanceKm != null && (
                                <span className="route-option-dist">
                                  Dist: {r.distanceKm.toFixed(2)} km
                                </span>
                              )}
                            </div>
                          </div>
                          {!r.isSelected && r.route_id != null && (
                            <button
                              className="route-option-btn"
                              disabled={routeSwitchBusy !== null}
                              onClick={async () => {
                                setRouteSwitchBusy(d.dispatch_id);
                                setRouteSwitchError(null);
                                try { await onSelectRoute?.(d.dispatch_id, r.route_id); }
                                catch (error) { setRouteSwitchError({ dispatchId: d.dispatch_id, message: error.message }); }
                                finally { setRouteSwitchBusy(null); }
                              }}
                            >
                              <SwitchAltRouteIcon />
                              {routeSwitchBusy === d.dispatch_id ? 'Recalculating…' : 'Switch'}
                            </button>
                          )}
                          {r.isSelected && (
                            <span className="route-option-active">Selected</span>
                          )}
                        </div>
                      ))}

                      {routeSwitchError?.dispatchId === d.dispatch_id && <p className="apm-error" role="alert">{routeSwitchError.message}</p>}

                      {!hasRealRoute && (
                        <div className="route-empty-note">
                          No routed path was computed for this dispatch — the map
                          is showing a straight line to the incident. Force a
                          reroute to plan over the road network.
                        </div>
                      )}

                      {canReroute &&
                        (confirming ? (
                          <div className="route-reroute-confirm">
                            <div className="route-reroute-warning">
                              ⚠ This replaces every route for this dispatch,
                              planned from the crew's current position.
                            </div>
                            <div className="route-reroute-actions">
                              <button
                                className="btn-dispatch"
                                disabled={forceRerouteBusy === d.dispatch_id}
                                onClick={async () => {
                                  setForceRerouteBusy(d.dispatch_id);
                                  try {
                                    await onFullReroute?.(
                                      d.dispatch_id,
                                      d.fire_id
                                    );
                                    setForceRerouteConfirm(null);
                                  } finally {
                                    setForceRerouteBusy(null);
                                  }
                                }}
                              >
                                {forceRerouteBusy === d.dispatch_id
                                  ? "Rerouting…"
                                  : "Confirm Reroute"}
                              </button>
                              <button
                                className="btn-secondary"
                                disabled={forceRerouteBusy === d.dispatch_id}
                                onClick={() => setForceRerouteConfirm(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            className="btn-secondary route-reroute-btn"
                            onClick={() =>
                              setForceRerouteConfirm(d.dispatch_id)
                            }
                          >
                            ↺ Force Reroute
                          </button>
                        ))}
                    </div>
                  );
                })}

                {incidentDispatches.length === 0 && <div className="ci-empty ci-empty--inline"><span><AnalysisIcon name="travel" /></span><h3>No dispatch routes yet</h3><p>Assigned teams and their route choices appear here after dispatch.</p></div>}

                {deviatedPersonnel.map((p) => {
                  const dispatch = incidentDispatches.find(
                    (d) => d.dispatch_id === p.dispatch_id
                  );
                  return (
                    <div
                      key={p.per_id}
                      className="routing-panel"
                      style={{
                        marginTop: 10,
                        borderColor: "rgba(255,176,32,0.4)",
                      }}
                    >
                      <div
                        className="routing-title"
                        style={{ color: "var(--accent-amber, #ffb020)" }}
                      >
                        ⚠ DEVIATION ACTIVE
                      </div>
                      <div className="routing-row">
                        <span className="routing-row-label">Unit</span>
                        <span className="routing-row-value">{p.name}</span>
                      </div>
                      <div className="routing-row">
                        <span className="routing-row-label">Status</span>
                        <span
                          className="routing-row-value"
                          style={{ color: "var(--accent-amber, #ffb020)" }}
                        >
                          Off Route — branch path active
                        </span>
                      </div>
                      {p.deviation_detected_at && (
                        <div className="routing-row">
                          <span className="routing-row-label">Detected</span>
                          <span className="routing-row-value">
                            {fmtTimestamp(p.deviation_detected_at)}
                          </span>
                        </div>
                      )}

                      {rerouteConfirm === p.dispatch_id ? (
                        <div
                          style={{
                            marginTop: 10,
                            padding: "10px",
                            background: "rgba(255,77,26,0.08)",
                            borderRadius: 6,
                            border: "1px solid rgba(255,77,26,0.3)",
                          }}
                        >
                          <div
                            style={{
                              color: "var(--accent-fire)",
                              fontSize: 12,
                              marginBottom: 8,
                            }}
                          >
                            ⚠ This replaces the current route entirely. Use only
                            if the branch path is insufficient.
                          </div>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              className="btn-dispatch"
                              style={{ flex: 1, fontSize: 12 }}
                              disabled={rerouteLoading}
                              onClick={() => {
                                setRerouteLoading(true);
                                onFullReroute?.(p.dispatch_id);
                                setRerouteConfirm(null);
                                setRerouteLoading(false);
                              }}
                            >
                              {rerouteLoading
                                ? "Rerouting…"
                                : "Confirm Reroute"}
                            </button>
                            <button
                              className="btn-secondary"
                              style={{ flex: 1, fontSize: 12 }}
                              onClick={() => setRerouteConfirm(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="btn-secondary"
                          style={{ width: "100%", marginTop: 10, fontSize: 12 }}
                          onClick={() => setRerouteConfirm(p.dispatch_id)}
                        >
                          ↺ Full Reroute from Current Position
                        </button>
                      )}
                      {dispatch && (
                        <div
                          style={{
                            color: "var(--text-muted)",
                            fontSize: 11,
                            marginTop: 6,
                          }}
                        >
                          Team: {dispatch.team_name}
                          {dispatch.team_code ? ` · ${dispatch.team_code}` : ""}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}

        {incident && activeTab === "Incident" && (
          <div className="detail-body ci-incident-body">
            <section className="ci-response-summary" aria-label="Response overview">
              <AnalysisIcon name="travel" />
              <div><strong>{incidentDispatches.length} {incidentDispatches.length === 1 ? 'team assigned' : 'teams assigned'}</strong><span>{incidentDispatches.length ? `${incidentDispatches.filter(d => d.dispatch_status === 'on_scene').length} on scene · ${incidentDispatches.filter(d => d.dispatch_status === 'en_route').length} en route` : 'No units have been assigned to this incident.'}</span></div>
              {incidentDispatches.length > 0 && <button className="ci-text-button" onClick={() => { setActiveTab('Routing'); document.getElementById(`${tabId}-Routing`)?.focus(); }}>View routes<AnalysisIcon name="chevron" /></button>}
            </section>
            <section className="ci-section">
              <h4>Incident details</h4>
              <dl className="ci-facts">
                {incident.addr && <div className="ci-full-address"><dt>Address</dt><dd>{incident.addr}</dd></div>}
                <div><dt>Dispatch type</dt><dd>{incident.dispatch_type || 'Unspecified'}</dd></div>
                <div><dt>Structure</dt><dd>{incident.structure || 'Not recorded'}</dd></div>
                <div><dt>Reported by</dt><dd>{incident.reporter || 'Not recorded'}</dd></div>
                <div><dt>Casualties</dt><dd className={incident.casualties && incident.casualties.toLowerCase() !== 'none' ? 'ci-caution' : undefined}>{incident.casualties || 'Not recorded'}</dd></div>
              </dl>
              <details className="ci-report-details"><summary>Report timestamps <AnalysisIcon name="chevron" /></summary><dl className="ci-facts ci-time-facts"><div><dt>Incident time · PHT</dt><dd>{fullTime(incident.reported_at)}</dd></div><div><dt>Report received · PHT</dt><dd>{fullTime(incident.report_received_at)}</dd></div></dl></details>
            </section>
            {incident.remarks && <section className="ci-section ci-notes"><h4>Incident notes</h4><p>{incident.remarks}</p></section>}
            <section className="ci-section ci-assigned-teams"><h4>Assigned teams<span className="ci-count">{incidentDispatches.length}</span></h4>
              {incidentDispatches.length ? incidentDispatches.map(dispatch => <AssignedTeam key={dispatch.dispatch_id} dispatch={dispatch} />) : <p className="ci-section-empty">Assigned teams and their rosters will appear here after dispatch.</p>}
            </section>
          </div>
        )}

        {incident && activeTab === "Timeline" && (
          <IncidentTimeline incident={incident} liveDispatches={incidentDispatches} />
        )}

        </div>
        {canRespond && (
          <div className="detail-actions ci-action-footer">
            <span className="ci-action-label">Response actions</span>
            <button
              className="btn-dispatch"
              onClick={() => setShowDispatch(true)}
            >
              Dispatch unit
            </button>
            <button
              className="btn-secondary"
              onClick={() => setShowEscalate(true)}
              disabled={highestAlarm}
              title={
                highestAlarm
                  ? "Already at the highest alarm level"
                  : "Raise the alarm level and dispatch more units"
              }
            >
              Escalate alarm
            </button>
          </div>
        )}
      </aside>
      {viewModeButtons}
      <div ref={onLayerToolsHostChange} className="command-map-layer-slot" />
      </div>

      {showDispatch && incident && (
        <DispatchModal
          incident={incident}
          onClose={() => setShowDispatch(false)}
          onDispatched={(result) => {
            setShowDispatch(false);
            onDispatched?.(result);
          }}
        />
      )}

      {showEscalate && incident && (
        <EscalateAlarmModal
          incident={incident}
          onClose={() => setShowEscalate(false)}
          onDispatched={(result) => onDispatched?.(result)}
        />
      )}
    </>
  );
}
