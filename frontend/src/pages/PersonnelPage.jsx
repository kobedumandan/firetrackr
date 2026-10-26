import { useState, useMemo, useEffect } from "react";
import "../styles/PersonnelPage.css";
import KpiCard from "../components/KpiCard";
import AddPersonnelModal from "../components/AddPersonnelModal";
import EditPersonnelModal from "../components/EditPersonnelModal";
import ConfirmModal from "../components/ConfirmModal";
import { fetchPersonnel, createPersonnel, deletePersonnel } from "../api";
import { isOnCurrentShift } from "../utils/shift";
import useSplitPane from "../hooks/useSplitPane";

function ExportIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="per-meta-icon"
      fill="currentColor"
    >
      <path d="m648-140 112-112v92h40v-160H640v40h92L620-168l28 28Zm-448 20q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v268q-19-9-39-15.5t-41-9.5v-243H200v560h242q3 22 9.5 42t15.5 38H200Zm0-120v40-560 243-3 280Zm80-40h163q3-21 9.5-41t14.5-39H280v80Zm0-160h244q32-30 71.5-50t84.5-27v-3H280v80Zm0-160h400v-80H280v80ZM720-40q-83 0-141.5-58.5T520-240q0-83 58.5-141.5T720-440q83 0 141.5 58.5T920-240q0 83-58.5 141.5T720-40Z" />
    </svg>
  );
}
function AddIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="per-meta-icon"
      fill="currentColor"
    >
      <path d="M440-120v-320H120v-80h320v-320h80v320h320v80H520v320h-80Z" />
    </svg>
  );
}

function UnfoldIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="unfold_icon"
      fill="currentColor"
    >
      <path d="M480-120 300-300l58-58 122 122 122-122 58 58-180 180ZM358-598l-58-58 180-180 180 180-58 58-122-122-122 122Z" />
    </svg>
  );
}

function BoltIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="per-bolt-icon"
      fill="currentColor"
    >
      <path d="m422-232 207-248H469l29-227-185 267h139l-30 208ZM320-80l40-280H160l360-520h80l-40 320h240L400-80h-80Zm151-390Z" />
    </svg>
  );
}
function RemoveIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="action_icons"
      fill="currentColor"
    >
      <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="action_icons"
      fill="currentColor"
    >
      <path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z" />
    </svg>
  );
}

const STATUS_TABS = ["all", "dispatched", "onscene", "standby", "offduty"];
const TAB_LABELS = {
  all: "All",
  dispatched: "Dispatched",
  onscene: "On Scene",
  standby: "Standby",
  offduty: "Off Duty",
};

/* One accent per status, shared by the pill, the avatar tile and the hero tag
   — the same colours the KPI cards above use for each status. Dispatched is
   amber everywhere in the app; on scene takes red, the most urgent state. */
const STATUS_TONE = {
  dispatched: "amber",
  onscene: "fire",
  standby: "blue",
  offduty: "muted",
};
const toneOf = (s) => STATUS_TONE[s] ?? "muted";

const TRACKING = {
  online: { label: "Live", tone: "green", live: true },
  active: { label: "IoT", tone: "green", live: true },
  sms: { label: "SMS", tone: "blue", live: false },
  offline: { label: "Offline", tone: "muted", live: false },
};

function StatusPill({ status }) {
  return (
    <span className={`per-status-pill per-tone-${toneOf(status)}`}>
      {(status === "dispatched" || status === "onscene") && (
        <span className="per-blink-dot" />
      )}
      {TAB_LABELS[status] ?? status}
    </span>
  );
}

function TrackingChip({ type }) {
  const t = TRACKING[type] ?? TRACKING.offline;
  return (
    <span className={`per-track per-track-${t.tone}`}>
      <BoltIcon />
      {t.label}
    </span>
  );
}

function Avatar({ p, size = "md" }) {
  return (
    <div className={`per-av per-av-${size} per-tile-${toneOf(p.status)}`}>
      {p.initials}
    </div>
  );
}

function ageLabel(mins) {
  if (mins == null) return "No signal yet";
  if (mins < 1) return "Just now";
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function PersonnelDetail({ p, loc, tracking, onShowOnMap, onEdit, onDelete }) {
  if (!p) {
    return (
      <div className="per-no-selection">
        <div className="per-no-sel-icon">
          <span className="material-symbols-outlined">badge</span>
        </div>
        <div className="per-no-sel-text">Select a person to view details</div>
      </div>
    );
  }

  const tone = toneOf(p.status);
  const t = TRACKING[tracking] ?? TRACKING.offline;
  const onShift = isOnCurrentShift(p.shift_name);
  const deployed = p.incident && p.incident !== "—";

  return (
    <div className="per-detail-scroll">
      {/* Hero */}
      <div className="per-detail-hero">
        <div className="per-hero-top">
          <div className="per-hero-left">
            <Avatar p={p} size="lg" />
            <div className="per-hero-text">
              <div className={`per-hero-tag per-text-${tone}`}>
                {p.rank !== "—" ? p.rank : "Personnel"}
              </div>
              <div className="per-hero-name">{p.name}</div>
              <div className="per-hero-code">
                {p.station !== "—" ? p.station : "No station"}
              </div>
            </div>
          </div>
          <StatusPill status={p.status} />
        </div>

        <div className="per-detail-actions">
          <button
            type="button"
            className="act-btn"
            onClick={onShowOnMap}
            disabled={!loc}
            title={loc ? "Show on the Command map" : "No location reported"}
          >
            <span className="material-symbols-outlined">map</span>
            Track on map
          </button>
          <button type="button" className="act-icon-btn" onClick={onEdit} title="Edit personnel" aria-label="Edit personnel">
            <EditIcon />
          </button>
          <button type="button" className="act-icon-btn danger" onClick={onDelete} title="Delete personnel" aria-label="Delete personnel">
            <RemoveIcon />
          </button>
        </div>

        <div className="per-detail-grid">
          <div className="per-detail-stat">
            <div className="per-ds-label">Tracking</div>
            <div className={`per-ds-value per-text-${t.tone === "muted" ? "plain" : t.tone}`}>
              {t.label}
            </div>
            <div className="per-ds-sub">{ageLabel(loc?.age_minutes).toUpperCase()}</div>
          </div>
          <div className="per-detail-stat">
            <div className="per-ds-label">Shift</div>
            <div className="per-ds-value">
              {p.shift_name && p.shift_name !== "—" ? p.shift_name : "—"}
            </div>
            <div className="per-ds-sub">
              {!p.shift_name || p.shift_name === "—"
                ? "NOT ASSIGNED"
                : onShift
                ? "ON DUTY NOW"
                : "OFF SHIFT"}
            </div>
          </div>
        </div>
      </div>

      {tracking !== "offline" && loc?.is_deviated && (
        <div className="per-alert">
          <span className="material-symbols-outlined">wrong_location</span>
          <div>
            <div className="per-alert-title">Off route</div>
            <div className="per-alert-sub">
              Left the dispatch route
              {loc.deviation_detected_at
                ? ` at ${new Date(loc.deviation_detected_at).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" })}`
                : ""}
              .
            </div>
          </div>
        </div>
      )}

      {/* Assignment */}
      <div className="per-info-section">
        <div className="per-info-title">Assignment</div>
        <div className="per-assign">
          <div className={`per-assign-icon ${deployed ? "per-tile-fire" : "per-tile-muted"}`}>
            <span className="material-symbols-outlined">
              {deployed ? "local_fire_department" : "groups"}
            </span>
          </div>
          <div className="per-assign-info">
            <div className="per-assign-name">
              {p.team_name && p.team_name !== "—" ? p.team_name : "No team"}
            </div>
            <div className="per-assign-sub">
              {deployed ? `Responding to ${p.incident}` : "Not on an active incident"}
            </div>
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="per-info-section">
        <div className="per-info-title">Personnel Information</div>
        <div className="per-info-grid">
          <div className="per-info-row">
            <span className="per-info-label">Phone</span>
            <span className="per-info-value is-mono">{p.phone}</span>
          </div>
          <div className="per-info-row">
            <span className="per-info-label">Email</span>
            <span className="per-info-value">{p.email || "—"}</span>
          </div>
          <div className="per-info-row">
            <span className="per-info-label">Station</span>
            <span className="per-info-value">{p.station}</span>
          </div>
          <div className="per-info-row">
            <span className="per-info-label">Designation</span>
            <span className="per-info-value">{p.designation || "—"}</span>
          </div>
          <div className="per-info-row">
            <span className="per-info-label">Joined</span>
            <span className="per-info-value">{p.joined}</span>
          </div>
        </div>
      </div>

      {/* Location */}
      <div className="per-info-section">
        <div className="per-info-title">Last Known Location</div>
        {loc ? (
          <div className="per-info-grid">
            <div className="per-info-row">
              <span className="per-info-label">Coordinates</span>
              <span className="per-info-value is-mono">
                {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
              </span>
            </div>
            <div className="per-info-row">
              <span className="per-info-label">Source</span>
              <span className="per-info-value">
                {loc.source ? loc.source.toUpperCase() : "—"}
              </span>
            </div>
            <div className="per-info-row">
              <span className="per-info-label">Last Ping</span>
              <span className="per-info-value">{ageLabel(loc.age_minutes)}</span>
            </div>
            <div className="per-info-row">
              <span className="per-info-label">Signal</span>
              <span className="per-info-value">{loc.is_stale ? "Stale" : "Fresh"}</span>
            </div>
          </div>
        ) : (
          <div className="per-info-empty">No location has been reported by this person yet.</div>
        )}
      </div>
    </div>
  );
}

export default function PersonnelPage({ onShowOnMap, livePersonnelLocations = [] }) {
  const [personnel, setPersonnel] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeStatus, setActiveStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [stationFilter, setStationFilter] = useState("");
  const [rankFilter, setRankFilter] = useState("");
  const [sortCol, setSortCol] = useState("name");
  const [sortDir, setSortDir] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("list");
  const [showAddModal, setShowAddModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { width: detailWidth, handleProps: resizeHandle } = useSplitPane({ storageKey: "personnel.detailWidth", minMain: 687 });

  useEffect(() => {
    fetchPersonnel()
      .then((data) => {
        setPersonnel(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Latest live location per personnel, keyed by per_id.
  const locByPerId = useMemo(() => {
    const m = new Map();
    for (const loc of livePersonnelLocations) m.set(loc.per_id, loc);
    return m;
  }, [livePersonnelLocations]);

  // Personnel actively streaming a fresh (non-stale) location are "online",
  // regardless of their IoT device_status.
  const onlineSet = useMemo(() => {
    const s = new Set();
    for (const loc of livePersonnelLocations) {
      if (!loc.is_stale) s.add(loc.per_id);
    }
    return s;
  }, [livePersonnelLocations]);

  // Resolve the tracking badge type for a row: "online" wins, else IoT status.
  const trackingType = (p) => (onlineSet.has(p.per_id) ? "online" : p.iot);

  // Personnel whose assigned shift isn't the currently active A/B shift are
  // shown as off-duty (gray), regardless of their stored status.
  const shiftedPersonnel = useMemo(
    () =>
      personnel.map((p) =>
        (p.on_duty ?? isOnCurrentShift(p.shift_name)) ? p : { ...p, status: "offduty" }
      ),
    [personnel]
  );

  const stats = useMemo(
    () => ({
      dispatched: shiftedPersonnel.filter((p) => p.status === "dispatched").length,
      onscene: shiftedPersonnel.filter((p) => p.status === "onscene").length,
      standby: shiftedPersonnel.filter((p) => p.status === "standby").length,
      offduty: shiftedPersonnel.filter((p) => p.status === "offduty").length,
      iot: shiftedPersonnel.filter(
        (p) => p.iot === "active" || onlineSet.has(p.per_id)
      ).length,
    }),
    [shiftedPersonnel, onlineSet]
  );

  // Filter options come from the roster itself, so a new station or rank shows
  // up without a code change.
  const stationOptions = useMemo(
    () => [...new Set(personnel.map((p) => p.station).filter((s) => s && s !== "—"))].sort(),
    [personnel]
  );
  const rankOptions = useMemo(
    () => [...new Set(personnel.map((p) => p.rank).filter((r) => r && r !== "—"))].sort(),
    [personnel]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const rows = shiftedPersonnel.filter((p) => {
      const mq =
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        p.rank.toLowerCase().includes(q) ||
        (p.team_name || "").toLowerCase().includes(q);
      const ms = !stationFilter || p.station === stationFilter;
      const mr = !rankFilter || p.rank === rankFilter;
      const mst = activeStatus === "all" || p.status === activeStatus;
      return mq && ms && mr && mst;
    });

    const STATUS_ORDER = { dispatched: 0, onscene: 1, standby: 2, offduty: 3 };
    const key = (p) =>
      sortCol === "status" ? STATUS_ORDER[p.status] ?? 9 : (p[sortCol] ?? "");
    rows.sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });

    return rows;
  }, [shiftedPersonnel, search, stationFilter, rankFilter, activeStatus, sortCol, sortDir]);

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => d * -1);
    else {
      setSortCol(col);
      setSortDir(1);
    }
  }

  function arrow(col) {
    if (sortCol !== col) return "↕";
    return sortDir === 1 ? "↑" : "↓";
  }

  function openDrawer(id) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  async function confirmDelete() {
    const target = deleting;
    await deletePersonnel(target.per_id);
    setPersonnel((prev) => prev.filter((p) => p.per_id !== target.per_id));
    if (selectedId === target.id) setSelectedId(null);
  }

  const selected = shiftedPersonnel.find((p) => p.id === selectedId);

  const emptyMessage = error
    ? `Failed to load personnel: ${error}`
    : "No personnel match your filters";

  const sortableTh = (col, label, width) => (
    <th
      style={{ width }}
      className={sortCol === col ? "sort-active" : ""}
      onClick={() => handleSort(col)}
    >
      {label} <span className="per-sort-arrow">{arrow(col)}</span>
    </th>
  );

  return (
    <>
      <div className="per-page">
        {/* PAGE HEADER */}
        <div className="per-header">
          <div className="per-title-row">
            <div className="per-title">
              Personnel
              <UnfoldIcon />
            </div>
            <div className="per-header-actions">
              <button className="per-btn-secondary table-export-btn">
                <ExportIcon />
                Export
              </button>
              <button
                className="per-btn-primary"
                onClick={() => setShowAddModal(true)}
              >
                <AddIcon />
                Add Personnel
              </button>
            </div>
          </div>
        </div>

        {/* BODY */}
        <div className="per-body">
          <div className="per-section-row">
            <div className="per-section-label">Roster Overview</div>
            <div className="per-status-tabs">
              {STATUS_TABS.map((s) => (
                <button
                  key={s}
                  className={`per-status-tab${activeStatus === s ? " active" : ""}`}
                  onClick={() => setActiveStatus(s)}
                >
                  {TAB_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* STAT CARDS */}
          <div className="kpi-row per-stat-row">
            {[
              { key: "dispatched", accent: "amber", icon: "local_fire_department", label: "Dispatched", value: stats.dispatched, sub: "En Route Now" },
              { key: "onscene", accent: "fire", icon: "location_on", label: "On Scene", value: stats.onscene, sub: "At Incident Site" },
              { key: "standby", accent: "blue", icon: "shield", label: "Standby", value: stats.standby, sub: "Ready to Deploy" },
              { key: "offduty", accent: "muted", icon: "bedtime", label: "Off Duty", value: stats.offduty, sub: "Not On Current Shift" },
              { key: "iot", accent: "green", icon: "sensors", label: "Live Tracking", value: stats.iot, sub: "Reporting Location" },
            ].map((c) => (
              <KpiCard
                key={c.key}
                accent={c.accent}
                icon={<span className="material-symbols-outlined">{c.icon}</span>}
                label={c.label}
                value={c.value}
                sub={c.sub}
                loading={loading}
              />
            ))}
          </div>
        </div>

        {/* TOOLBAR */}
        <div className="per-toolbar">
          <div className="per-search-wrap">
            <span className="per-search-icon">⌕</span>
            <input
              type="text"
              placeholder="Search name, ID, rank, team..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="per-filter-select"
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value)}
          >
            <option value="">All Stations</option>
            {stationOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            className="per-filter-select"
            value={rankFilter}
            onChange={(e) => setRankFilter(e.target.value)}
          >
            <option value="">All Ranks</option>
            {rankOptions.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <span className="per-result-count">
            {loading
              ? "LOADING…"
              : `${filtered.length} RECORD${filtered.length !== 1 ? "S" : ""}`}
          </span>
          <div className="per-view-toggle" role="group" aria-label="Layout">
            {[
              { key: "list", icon: "view_list", label: "List view" },
              { key: "grid", icon: "grid_view", label: "Grid view" },
            ].map((v) => (
              <button
                key={v.key}
                className={`per-view-btn${view === v.key ? " active" : ""}`}
                onClick={() => setView(v.key)}
                title={v.label}
                aria-label={v.label}
                aria-pressed={view === v.key}
              >
                <span className="material-symbols-outlined">{v.icon}</span>
              </button>
            ))}
          </div>
        </div>

        {/* CONTENT */}
        <div className="per-content">
          <div className="per-table-pagination-wrap">
            {/* TABLE VIEW */}
            {view === "list" && (
              <div className="per-table-wrap">
                <table className="per-table">
                  <thead>
                    <tr>
                      {sortableTh("name", "Personnel", 220)}
                      {sortableTh("status", "Status", 115)}
                      {sortableTh("station", "Station", 130)}
                      {sortableTh("team_name", "Team", 130)}
                      <th style={{ width: 90 }} className="per-th-static">Tracking</th>
                      <th style={{ width: 120 }} className="per-th-static">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="per-row-skel">
                            <td>
                              <div className="per-av-wrap">
                                <span className="per-skel" style={{ width: 34, height: 34, borderRadius: 11, flexShrink: 0 }} />
                                <div>
                                  <span className="per-skel" style={{ width: 110, height: 12, marginBottom: 6 }} />
                                  <span className="per-skel" style={{ width: 70, height: 9 }} />
                                </div>
                              </div>
                            </td>
                            <td><span className="per-skel" style={{ width: 70, height: 18, borderRadius: 20 }} /></td>
                            <td><span className="per-skel" style={{ width: 80, height: 11 }} /></td>
                            <td><span className="per-skel" style={{ width: 80, height: 11 }} /></td>
                            <td><span className="per-skel" style={{ width: 50, height: 18, borderRadius: 20 }} /></td>
                            <td>
                              <div className="per-row-actions">
                                <span className="per-skel" style={{ width: 42, height: 22 }} />
                                <span className="per-skel" style={{ width: 38, height: 22 }} />
                              </div>
                            </td>
                          </tr>
                        ))
                      : filtered.map((p) => (
                          <tr
                            key={p.id}
                            className={selectedId === p.id ? "selected" : ""}
                            onClick={() => openDrawer(p.id)}
                          >
                            <td>
                              <div className="per-av-wrap">
                                <Avatar p={p} />
                                <div className="per-av-text">
                                  <div className="per-row-name">{p.name}</div>
                                  <div className="per-row-sub">
                                    {p.rank !== "—" ? p.rank : "—"}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <StatusPill status={p.status} />
                            </td>
                            <td>
                              <span className={`per-row-meta${p.station === "—" ? " is-empty" : ""}`}>
                                {p.station}
                              </span>
                            </td>
                            <td>
                              <div className="per-row-meta">
                                {p.team_name && p.team_name !== "—" ? p.team_name : <span className="per-muted">—</span>}
                              </div>
                              {p.incident !== "—" && (
                                <span className="per-row-incident">
                                  <span className="material-symbols-outlined">local_fire_department</span>
                                  <span className="per-row-incident-text">{p.incident}</span>
                                </span>
                              )}
                            </td>
                            <td>
                              <TrackingChip type={trackingType(p)} />
                            </td>
                            <td>
                              <div className="per-row-actions" onClick={(e) => e.stopPropagation()}>
                                <button className="per-btn-view" onClick={() => openDrawer(p.id)}>
                                  View
                                </button>
                                <button
                                  className="per-btn-ghost"
                                  onClick={() => onShowOnMap?.(p.per_id)}
                                  disabled={!locByPerId.has(p.per_id)}
                                  title={locByPerId.has(p.per_id) ? undefined : "No location reported"}
                                >
                                  Map
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
                {!loading && filtered.length === 0 && (
                  <div className={`per-empty${error ? " is-error" : ""}`}>{emptyMessage}</div>
                )}
              </div>
            )}

            {/* GRID VIEW */}
            {view === "grid" && (
              <div className="per-grid-wrap">
                {loading ? (
                  <div className="per-grid">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="per-card is-skel">
                        <div className="per-card-top">
                          <span className="per-skel" style={{ width: 40, height: 40, borderRadius: 12 }} />
                          <span className="per-skel" style={{ width: 64, height: 18, borderRadius: 20 }} />
                        </div>
                        <span className="per-skel" style={{ width: "70%", height: 13, marginBottom: 6 }} />
                        <span className="per-skel" style={{ width: "45%", height: 9 }} />
                        <hr className="per-card-divider" />
                        <div className="per-card-row">
                          <span className="per-skel" style={{ width: 40, height: 9 }} />
                          <span className="per-skel" style={{ width: 70, height: 9 }} />
                        </div>
                        <div className="per-card-row">
                          <span className="per-skel" style={{ width: 40, height: 9 }} />
                          <span className="per-skel" style={{ width: 60, height: 9 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className={`per-empty${error ? " is-error" : ""}`}>{emptyMessage}</div>
                ) : (
                  <div className="per-grid">
                    {filtered.map((p) => (
                      <div
                        key={p.id}
                        className={`per-card${selectedId === p.id ? " selected" : ""}`}
                        onClick={() => openDrawer(p.id)}
                      >
                        <div className="per-card-top">
                          <Avatar p={p} size="card" />
                          <StatusPill status={p.status} />
                        </div>
                        <div className="per-card-name">{p.name}</div>
                        <div className="per-card-id">
                          {p.rank !== "—" ? `${p.rank} · ` : ""}{p.id}
                        </div>
                        <hr className="per-card-divider" />
                        <div className="per-card-row">
                          <span className="per-card-field-label">Station</span>
                          <span className="per-card-field-val">{p.station}</span>
                        </div>
                        <div className="per-card-row">
                          <span className="per-card-field-label">Team</span>
                          <span className="per-card-field-val">{p.team_name || "—"}</span>
                        </div>
                        <div className="per-card-row">
                          <span className="per-card-field-label">Incident</span>
                          <span className={`per-card-field-val${p.incident !== "—" ? " per-text-fire" : ""}`}>
                            {p.incident}
                          </span>
                        </div>
                        <div className="per-card-bottom">
                          <TrackingChip type={trackingType(p)} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="split-resizer" {...resizeHandle} />

          {/* DETAILS PANEL */}
          <div className="per-detail" style={{ width: detailWidth }}>
            <PersonnelDetail
              p={selected}
              loc={selected ? locByPerId.get(selected.per_id) : null}
              tracking={selected ? trackingType(selected) : null}
              onShowOnMap={() => onShowOnMap?.(selected.per_id)}
              onEdit={() => setEditTarget(selected)}
              onDelete={() => setDeleting(selected)}
            />
          </div>
        </div>
      </div>

      {showAddModal && (
        <AddPersonnelModal
          onClose={() => setShowAddModal(false)}
          onSubmit={async (data) => {
            // Errors propagate: AddPersonnelModal catches and renders them
            // inline, and keeps the form open with the entered values intact.
            const newPerson = await createPersonnel(data);
            setPersonnel((prev) => [...prev, newPerson]);
            setShowAddModal(false);
          }}
        />
      )}

      {editTarget && (
        <EditPersonnelModal
          personnel={editTarget}
          onClose={() => setEditTarget(null)}
          onSubmit={() => {
            setEditTarget(null);
            // Selection is kept so the pane shows the edit that was just made.
            fetchPersonnel().then((data) => setPersonnel(data)).catch(() => {});
          }}
        />
      )}

      {deleting && (
        <ConfirmModal
          eyebrow="DELETE PERSONNEL"
          title={`Delete ${deleting.name}?`}
          message={
            <>
              This will permanently remove personnel{" "}
              <strong>{deleting.name}</strong>, their login account, devices,
              and team assignments. This action cannot be undone.
            </>
          }
          confirmLabel="Delete Personnel"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
