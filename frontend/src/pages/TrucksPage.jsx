import { useState, useMemo, useEffect } from "react";
import "../styles/TrucksPage.css";
import KpiCard from "../components/KpiCard";
import AddTruckModal from "../components/AddTruckModal";
import EditTruckModal from "../components/EditTruckModal";
import ConfirmModal from "../components/ConfirmModal";
import { formatReported } from "../components/incidentUi";
import { fetchTrucks, createTruck, deleteTruck } from "../api";
import useSplitPane from "../hooks/useSplitPane";

const STATUS_OPTIONS = ["available", "dispatched", "maintenance", "unavailable"];
const STATUS_TABS = ["all", ...STATUS_OPTIONS];
const TAB_LABELS = {
  all: "All",
  available: "Available",
  dispatched: "Dispatched",
  maintenance: "Maintenance",
  unavailable: "Unavailable",
};

/* One accent per status, shared by the pill, the icon tile and the hero tag so
   the three can't drift apart. Class suffixes map to the rules in
   TrucksPage.css, which resolve every colour through a token. */
const STATUS_TONE = {
  available: "green",
  dispatched: "amber",
  maintenance: "fire",
  unavailable: "muted",
};

const truckCode = (id) => `TRK-${String(id).padStart(3, "0")}`;

/* "4m ago" reads faster than a timestamp when the question is "is this truck's
   position fresh?". The absolute time stays one hover away. */
function timeAgo(iso) {
  if (!iso) return "—";
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(secs)) return "—";
  if (secs < 60) return "Just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const hasFix = (t) => t.truck_latitude != null && t.truck_longitude != null;
const fmtCoord = (v) => (v == null ? "—" : Number(v).toFixed(5));

function ExportIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="trk-meta-icon"
      fill="currentColor"
    >
      <path d="m648-140 112-112v92h40v-160H640v40h92L620-168l28 28Zm-448 20q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v268q-19-9-39-15.5t-41-9.5v-243H200v560h242q3 22 9.5 42t15.5 38H200Zm0-120v40-560 243-3 280Zm80-40h163q3-21 9.5-41t14.5-39H280v80Zm0-160h244q32-30 71.5-50t84.5-27v-3H280v80Zm0-160h400v-80H280v80ZM720-40q-83 0-141.5-58.5T520-240q0-83 58.5-141.5T720-440q83 0 141.5 58.5T920-240q0 83-58.5 141.5T720-40Z" />
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

function AddIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="trk-meta-icon"
      fill="currentColor"
    >
      <path d="M440-120v-320H120v-80h320v-320h80v320h320v80H520v320h-80Z" />
    </svg>
  );
}

function FireTruckIcon({ className = "trk-av-svg" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className={className}
      fill="currentColor"
    >
      <path d="M195-155q-35-35-35-85h-40q-33 0-56.5-23.5T40-320v-200h440v-160q0-33 23.5-56.5T560-760h80v-40q0-17 11.5-28.5T680-840h40q17 0 28.5 11.5T760-800v40h22q26 0 47 15t29 40l58 172q2 6 3 12.5t1 13.5v267H800q0 50-35 85t-85 35q-50 0-85-35t-35-85H400q0 50-35 85t-85 35q-50 0-85-35Zm113.5-56.5Q320-223 320-240t-11.5-28.5Q297-280 280-280t-28.5 11.5Q240-257 240-240t11.5 28.5Q263-200 280-200t28.5-11.5Zm400 0Q720-223 720-240t-11.5-28.5Q697-280 680-280t-28.5 11.5Q640-257 640-240t11.5 28.5Q663-200 680-200t28.5-11.5ZM120-440v120h71q17-19 40-29.5t49-10.5q26 0 49 10.5t40 29.5h111v-120H120Zm440 120h31q17-19 40-29.5t49-10.5q26 0 49 10.5t40 29.5h71v-120H560v120Zm0-200h276l-54-160H560v160ZM40-560v-60h40v-80H40v-60h400v60h-40v80h40v60H40Zm100-60h70v-80h-70v80Zm130 0h70v-80h-70v80Zm210 180H120h360Zm80 0h280-280Z" />
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

function StatusPill({ status }) {
  return (
    <span className={`trk-status-pill trk-tone-${STATUS_TONE[status] ?? "muted"}`}>
      {status === "dispatched" && <span className="trk-blink-dot" />}
      {TAB_LABELS[status] ?? status}
    </span>
  );
}

function TruckTile({ status, size = "md" }) {
  return (
    <div className={`trk-tile trk-tile-${size} trk-tile-${STATUS_TONE[status] ?? "muted"}`}>
      <FireTruckIcon />
    </div>
  );
}

function TruckDetail({ t, onEdit, onDelete, onShowOnMap }) {
  if (!t) {
    return (
      <div className="trk-no-selection">
        <div className="trk-no-sel-icon">
          <span className="material-symbols-outlined">fire_truck</span>
        </div>
        <div className="trk-no-sel-text">Select a truck to view details</div>
      </div>
    );
  }

  const tone = STATUS_TONE[t.truck_status] ?? "muted";
  const fix = hasFix(t);

  return (
    <div className="trk-detail-scroll">
      {/* Hero */}
      <div className="trk-detail-hero">
        <div className="trk-hero-top">
          <div className="trk-hero-left">
            <TruckTile status={t.truck_status} size="lg" />
            <div>
              <div className={`trk-hero-tag trk-text-${tone}`}>
                Fire Truck · {TAB_LABELS[t.truck_status] ?? t.truck_status}
              </div>
              <div className="trk-hero-name">{t.truck_platenum}</div>
              <div className="trk-hero-code">
                {truckCode(t.truck_id)} · {t.station_name || "Unassigned"}
              </div>
            </div>
          </div>
          <StatusPill status={t.truck_status} />
        </div>

        <div className="trk-detail-grid">
          <div className="trk-detail-stat">
            <div className="trk-ds-label">Last Update</div>
            <div
              className="trk-ds-value"
              title={
                t.truck_last_updated
                  ? new Date(t.truck_last_updated).toLocaleString()
                  : undefined
              }
            >
              {timeAgo(t.truck_last_updated)}
            </div>
            <div className="trk-ds-sub">
              {t.truck_last_updated ? formatReported(t.truck_last_updated) : "NEVER REPORTED"}
            </div>
          </div>
          <div className="trk-detail-stat">
            <div className="trk-ds-label">Position</div>
            <div className="trk-ds-value">{fix ? "Fixed" : "None"}</div>
            <div className="trk-ds-sub">{fix ? "GPS COORDINATES" : "NO LOCATION ON FILE"}</div>
          </div>
        </div>
      </div>

      {/* Truck info */}
      <div className="trk-info-section">
        <div className="trk-info-title">Truck Information</div>
        <div className="trk-info-grid">
          {[
            { label: "Plate Number", value: t.truck_platenum, mono: true },
            { label: "Truck ID", value: truckCode(t.truck_id), mono: true },
            { label: "Station", value: t.station_name || "—" },
            { label: "Status", value: TAB_LABELS[t.truck_status] ?? t.truck_status },
          ].map(({ label, value, mono }) => (
            <div key={label} className="trk-info-row">
              <span className="trk-info-label">{label}</span>
              <span className={`trk-info-value${mono ? " is-mono" : ""}`}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Location */}
      <div className="trk-info-section">
        <div className="trk-info-title">Location</div>
        <div className="trk-info-grid">
          <div className="trk-info-row">
            <span className="trk-info-label">Latitude</span>
            <span className="trk-info-value is-mono">{fmtCoord(t.truck_latitude)}</span>
          </div>
          <div className="trk-info-row">
            <span className="trk-info-label">Longitude</span>
            <span className="trk-info-value is-mono">{fmtCoord(t.truck_longitude)}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="trk-detail-actions">
        <button
          type="button"
          className="act-btn"
          onClick={onShowOnMap}
          disabled={!fix || !onShowOnMap}
          title={fix ? "Show on the Command map" : "No location on file"}
        >
          <span className="material-symbols-outlined">map</span>
          Track on map
        </button>
        <button type="button" className="act-icon-btn" onClick={onEdit} title="Edit truck" aria-label="Edit truck">
          <EditIcon />
        </button>
        <button type="button" className="act-icon-btn danger" onClick={onDelete} title="Delete truck" aria-label="Delete truck">
          <RemoveIcon />
        </button>
      </div>
    </div>
  );
}

export default function TrucksPage({ refreshKey = 0, onShowOnMap }) {
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilter] = useState("all");
  const [stationFilter, setStationFilter] = useState("");
  const [sortCol, setSortCol] = useState("truck_platenum");
  const [sortDir, setSortDir] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("list");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { width: detailWidth, handleProps: resizeHandle } = useSplitPane({ storageKey: "trucks.detailWidth", minMain: 632 });

  // refreshKey is bumped by App when a dispatch completes, so a close that
  // returns a crew to standby lands here without a reload. Deliberately does
  // NOT set loading back to true — a refetch should update the rows in place,
  // not flash the skeleton over a table the user is already reading.
  useEffect(() => {
    fetchTrucks()
      .then((t) => {
        setTrucks(t);
        setFetchError(null);
        setLoading(false);
      })
      .catch((ex) => {
        setFetchError(ex.message || "Failed to load trucks");
        setLoading(false);
      });
  }, [refreshKey]);

  const stats = useMemo(
    () => ({
      total: trucks.length,
      available: trucks.filter((t) => t.truck_status === "available").length,
      dispatched: trucks.filter((t) => t.truck_status === "dispatched").length,
      maintenance: trucks.filter((t) => t.truck_status === "maintenance")
        .length,
    }),
    [trucks]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const rows = trucks.filter((t) => {
      const matchSearch =
        !q ||
        t.truck_platenum.toLowerCase().includes(q) ||
        (t.station_name || "").toLowerCase().includes(q);
      const matchStatus =
        filterStatus === "all" || t.truck_status === filterStatus;
      const matchStation =
        !stationFilter || t.station_name === stationFilter;
      return matchSearch && matchStatus && matchStation;
    });
    const key = (t) =>
      sortCol === "station_name" ? t.station_name || "" : t[sortCol] ?? "";
    rows.sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return rows;
  }, [trucks, search, filterStatus, stationFilter, sortCol, sortDir]);

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
    const truck = deleting;
    await deleteTruck(truck.truck_id);
    setTrucks((prev) => prev.filter((t) => t.truck_id !== truck.truck_id));
    if (selectedId === truck.truck_id) setSelectedId(null);
  }

  const selected = trucks.find((t) => t.truck_id === selectedId);

  const uniqueStations = useMemo(() => {
    const names = [...new Set(trucks.map((t) => t.station_name).filter(Boolean))];
    names.sort();
    return names;
  }, [trucks]);

  const emptyMessage = fetchError
    ? `Failed to load trucks: ${fetchError}`
    : "No trucks match your filters";

  return (
    <>
      <div className="trk-page">
        {/* PAGE HEADER */}
        <div className="trk-header">
          <div className="trk-title-row">
            <div className="trk-title">
              Trucks
              <UnfoldIcon />
            </div>
            <div className="trk-header-actions">
              <button className="trk-btn-secondary table-export-btn">
                <ExportIcon />
                Export
              </button>
              <button
                className="trk-btn-primary"
                onClick={() => setShowAdd(true)}
              >
                <AddIcon />
                Add Truck
              </button>
            </div>
          </div>
        </div>

        {/* BODY */}
        <div className="trk-body">
          <div className="trk-section-row">
            <div className="trk-section-label">Fleet Overview</div>
            <div className="trk-status-tabs">
              {STATUS_TABS.map((s) => (
                <button
                  key={s}
                  className={`trk-status-tab${
                    filterStatus === s ? " active" : ""
                  }`}
                  onClick={() => setFilter(s)}
                >
                  {TAB_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          {/* STAT CARDS */}
          <div className="kpi-row trk-stat-row">
            {[
              { key: "total", accent: "blue", icon: "fire_truck", label: "Total Trucks", value: stats.total, sub: "Fleet Size" },
              { key: "available", accent: "green", icon: "check_circle", label: "Available", value: stats.available, sub: "Ready to Deploy" },
              { key: "dispatched", accent: "amber", icon: "local_fire_department", label: "Dispatched", value: stats.dispatched, sub: "En Route Now" },
              { key: "maintenance", accent: "fire", icon: "build", label: "Maintenance", value: stats.maintenance, sub: "Under Repair" },
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
        <div className="trk-toolbar">
          <div className="trk-search-wrap">
            <span className="trk-search-icon">⌕</span>
            <input
              type="text"
              placeholder="Search plate number, station..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="trk-filter-select"
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value)}
          >
            <option value="">All Stations</option>
            {uniqueStations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <span className="trk-result-count">
            {loading
              ? "LOADING…"
              : `${filtered.length} RECORD${filtered.length !== 1 ? "S" : ""}`}
          </span>
          <div className="trk-view-toggle" role="group" aria-label="Layout">
            {[
              { key: "list", icon: "view_list", label: "List view" },
              { key: "grid", icon: "grid_view", label: "Grid view" },
            ].map((v) => (
              <button
                key={v.key}
                className={`trk-view-btn${view === v.key ? " active" : ""}`}
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
        <div className="trk-content">
          <div className="trk-table-pagination-wrap">
            {/* TABLE VIEW */}
            {view === "list" && (
              <div className="trk-table-wrap">
                <table className="trk-table">
                  <thead>
                    <tr>
                      <th
                        style={{ width: 200 }}
                        className={
                          sortCol === "truck_platenum" ? "sort-active" : ""
                        }
                        onClick={() => handleSort("truck_platenum")}
                      >
                        Truck{" "}
                        <span className="trk-sort-arrow">
                          {arrow("truck_platenum")}
                        </span>
                      </th>
                      <th
                        style={{ width: 120 }}
                        className={
                          sortCol === "truck_status" ? "sort-active" : ""
                        }
                        onClick={() => handleSort("truck_status")}
                      >
                        Status{" "}
                        <span className="trk-sort-arrow">
                          {arrow("truck_status")}
                        </span>
                      </th>
                      <th
                        style={{ width: 160 }}
                        className={
                          sortCol === "station_name" ? "sort-active" : ""
                        }
                        onClick={() => handleSort("station_name")}
                      >
                        Station{" "}
                        <span className="trk-sort-arrow">
                          {arrow("station_name")}
                        </span>
                      </th>
                      <th
                        style={{ width: 150 }}
                        className={
                          sortCol === "truck_last_updated" ? "sort-active" : ""
                        }
                        onClick={() => handleSort("truck_last_updated")}
                      >
                        Last Updated{" "}
                        <span className="trk-sort-arrow">
                          {arrow("truck_last_updated")}
                        </span>
                      </th>
                      <th style={{ width: 130 }} className="trk-th-static">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="trk-row-skel">
                            <td>
                              <div className="trk-av-wrap">
                                <span
                                  className="trk-skel"
                                  style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0 }}
                                />
                                <div>
                                  <span className="trk-skel" style={{ width: 54, height: 9, marginBottom: 6 }} />
                                  <span className="trk-skel" style={{ width: 96, height: 12 }} />
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="trk-skel" style={{ width: 72, height: 18, borderRadius: 20 }} />
                            </td>
                            <td>
                              <span className="trk-skel" style={{ width: 90, height: 11 }} />
                            </td>
                            <td>
                              <span className="trk-skel" style={{ width: 84, height: 11 }} />
                            </td>
                            <td>
                              <div className="trk-row-actions">
                                <span className="trk-skel" style={{ width: 42, height: 22 }} />
                                <span className="trk-skel" style={{ width: 38, height: 22 }} />
                              </div>
                            </td>
                          </tr>
                        ))
                      : filtered.map((t) => (
                          <tr
                            key={t.truck_id}
                            className={
                              selectedId === t.truck_id ? "selected" : ""
                            }
                            onClick={() => openDrawer(t.truck_id)}
                          >
                            <td>
                              <div className="trk-av-wrap">
                                <TruckTile status={t.truck_status} />
                                <div className="trk-av-text">
                                  <div className="trk-row-code">
                                    {truckCode(t.truck_id)}
                                  </div>
                                  <div className="trk-row-name">
                                    {t.truck_platenum}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <StatusPill status={t.truck_status} />
                            </td>
                            <td>
                              <span
                                className={`trk-row-meta${
                                  t.station_name ? "" : " is-empty"
                                }`}
                              >
                                {t.station_name || "Unassigned"}
                              </span>
                            </td>
                            <td>
                              <span
                                className="trk-row-time"
                                title={
                                  t.truck_last_updated
                                    ? new Date(t.truck_last_updated).toLocaleString()
                                    : undefined
                                }
                              >
                                {formatReported(t.truck_last_updated)}
                              </span>
                            </td>
                            <td>
                              <div
                                className="trk-row-actions"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <button
                                  className="trk-btn-view"
                                  onClick={() => openDrawer(t.truck_id)}
                                >
                                  View
                                </button>
                                <button
                                  className="trk-btn-ghost"
                                  onClick={() => setEditing(t)}
                                >
                                  Edit
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                  </tbody>
                </table>
                {!loading && filtered.length === 0 && (
                  <div className={`trk-empty${fetchError ? " is-error" : ""}`}>
                    {emptyMessage}
                  </div>
                )}
              </div>
            )}

            {/* GRID VIEW */}
            {view === "grid" && (
              <div className="trk-grid-wrap">
                {loading ? (
                  <div className="trk-grid">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="trk-card is-skel">
                        <div className="trk-card-top">
                          <span className="trk-skel" style={{ width: 38, height: 38, borderRadius: 11 }} />
                          <span className="trk-skel" style={{ width: 64, height: 18, borderRadius: 20 }} />
                        </div>
                        <span className="trk-skel" style={{ width: "70%", height: 13, marginBottom: 6 }} />
                        <span className="trk-skel" style={{ width: "40%", height: 9 }} />
                        <hr className="trk-card-divider" />
                        <div className="trk-card-row">
                          <span className="trk-skel" style={{ width: 40, height: 9 }} />
                          <span className="trk-skel" style={{ width: 70, height: 9 }} />
                        </div>
                        <div className="trk-card-row">
                          <span className="trk-skel" style={{ width: 40, height: 9 }} />
                          <span className="trk-skel" style={{ width: 60, height: 9 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : filtered.length === 0 ? (
                  <div className={`trk-empty${fetchError ? " is-error" : ""}`}>
                    {emptyMessage}
                  </div>
                ) : (
                  <div className="trk-grid">
                    {filtered.map((t) => (
                      <div
                        key={t.truck_id}
                        className={`trk-card${
                          selectedId === t.truck_id ? " selected" : ""
                        }`}
                        onClick={() => openDrawer(t.truck_id)}
                      >
                        <div className="trk-card-top">
                          <TruckTile status={t.truck_status} size="card" />
                          <StatusPill status={t.truck_status} />
                        </div>
                        <div className="trk-card-name">{t.truck_platenum}</div>
                        <div className="trk-card-id">{truckCode(t.truck_id)}</div>
                        <hr className="trk-card-divider" />
                        <div className="trk-card-row">
                          <span className="trk-card-field-label">Station</span>
                          <span className="trk-card-field-val">
                            {t.station_name || "Unassigned"}
                          </span>
                        </div>
                        <div className="trk-card-row">
                          <span className="trk-card-field-label">Updated</span>
                          <span className="trk-card-field-val">
                            {timeAgo(t.truck_last_updated)}
                          </span>
                        </div>
                        <div
                          className="trk-card-bottom"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            className="trk-btn-view"
                            onClick={() => openDrawer(t.truck_id)}
                          >
                            View
                          </button>
                          <button
                            className="trk-btn-ghost"
                            onClick={() => setEditing(t)}
                          >
                            Edit
                          </button>
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
          <div className="trk-detail" style={{ width: detailWidth }}>
            <TruckDetail
              t={selected}
              onEdit={() => setEditing(selected)}
              onDelete={() => setDeleting(selected)}
              onShowOnMap={onShowOnMap ? () => onShowOnMap(selected) : undefined}
            />
          </div>
        </div>
      </div>

      {showAdd && (
        <AddTruckModal
          onClose={() => setShowAdd(false)}
          onSubmit={async (data) => {
            const newTruck = await createTruck(data);
            setTrucks((prev) => [...prev, newTruck]);
            setShowAdd(false);
          }}
        />
      )}
      {editing && (
        <EditTruckModal
          truck={editing}
          onClose={() => setEditing(null)}
          onSubmit={(updated) => {
            setTrucks((prev) =>
              prev.map((t) => (t.truck_id === updated.truck_id ? updated : t))
            );
            setEditing(null);
            // Refetch for the joined station_name; the selection is kept so the
            // detail pane shows the edit that was just made.
            fetchTrucks().then((data) => setTrucks(data)).catch(() => {});
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          eyebrow="DELETE TRUCK"
          title={`Delete ${deleting.truck_platenum}?`}
          message={
            <>
              This will permanently remove truck{" "}
              <strong>{deleting.truck_platenum}</strong> from the fleet. This
              action cannot be undone.
            </>
          }
          confirmLabel="Delete Truck"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
