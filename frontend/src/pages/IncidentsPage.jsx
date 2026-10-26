import { useState, useEffect, useRef } from "react";
import "../styles/IncidentsPage.css";
import KpiCard from "../components/KpiCard";
import LogIncidentModal from "../components/LogIncidentModal";
import EditIncidentModal from "../components/EditIncidentModal";
import ConfirmModal from "../components/ConfirmModal";
import ExportRegisterModal from "../components/ExportRegisterModal";
import IncidentDetailsPage from "./IncidentDetailsPage";
import { SeverityBadge, StatusPill, formatReported } from "../components/incidentUi";
import { fetchIncidents, createIncident, deleteIncident } from "../api";

function ExportIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="meta-icon"
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
      className="meta-icon"
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
const STATUS_TABS = ["all", "pending", "dispatched", "contained", "closed"];
const PAGE_SIZE = 15;
const PERIODS = [
  { key: "all", label: "All Time" },
  { key: "day", label: "Today" },
  { key: "month", label: "This Month" },
  { key: "year", label: "This Year" },
];

export default function IncidentsPage({ onShowOnMap, initialIncident = null, theme = "dark" }) {
  const [incidents, setIncidents] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({
    pending: 0,
    dispatched: 0,
    contained: 0,
    closed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedId, setSelectedId] = useState(initialIncident?.id || null);
  // When set, the full-page incident details view replaces the list. Holds the
  // incident itself so the view survives a list refetch that drops the row.
  const [detailsIncident, setDetailsIncident] = useState(initialIncident);
  const [showLogModal, setShowLogModal] = useState(false);
  const [editingIncident, setEditingIncident] = useState(null);
  const [deletingIncident, setDeletingIncident] = useState(null);
  // Filters frozen when Export is clicked, so the report's scope can't shift
  // under the preview while the modal is open.
  const [exportQuery, setExportQuery] = useState(null);

  // raw search input — debounced before hitting the server
  const [search, setSearch] = useState("");
  const searchTimerRef = useRef(null);

  // all server query params in one atomic object so filter + page reset is one update
  const [query, setQuery] = useState({
    page: 1,
    period: "all",
    status: "all",
    search: "",
    sev: "",
    alarm: "",
    sortCol: "reported_at",
    sortDir: -1,
  });

  // debounce the search field: update query.search + reset to page 1 after 300 ms
  useEffect(() => {
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setQuery((prev) => ({ ...prev, search, page: 1 }));
    }, 300);
    return () => clearTimeout(searchTimerRef.current);
  }, [search]);

  // update a filter key and reset to page 1 atomically
  function setFilter(key, value) {
    setQuery((prev) => ({ ...prev, [key]: value, page: 1 }));
  }

  function goToPage(p) {
    setQuery((prev) => ({
      ...prev,
      page: typeof p === "function" ? p(prev.page) : p,
    }));
  }

  // fetch whenever query changes; cancels in-flight requests on re-fire
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchIncidents({
      page: query.page,
      pageSize: PAGE_SIZE,
      period: query.period,
      status: query.status,
      search: query.search,
      sev: query.sev,
      alarm: query.alarm,
      sortCol: query.sortCol,
      sortDir: query.sortDir,
    })
      .then((data) => {
        if (cancelled) return;
        setIncidents(data.items);
        setTotal(data.total);
        setStats(data.stats);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const paginated = incidents;

  function pageNumbers() {
    const p = query.page;
    if (totalPages <= 7)
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    const pages = [];
    if (p <= 4) {
      pages.push(1, 2, 3, 4, 5, "…", totalPages);
    } else if (p >= totalPages - 3) {
      pages.push(
        1,
        "…",
        totalPages - 4,
        totalPages - 3,
        totalPages - 2,
        totalPages - 1,
        totalPages
      );
    } else {
      pages.push(1, "…", p - 1, p, p + 1, "…", totalPages);
    }
    return pages;
  }

  function handleSort(col) {
    if (query.sortCol === col) setFilter("sortDir", query.sortDir * -1);
    else setQuery((prev) => ({ ...prev, sortCol: col, sortDir: -1, page: 1 }));
  }

  function arrow(col) {
    if (query.sortCol !== col) return "↕";
    return query.sortDir === -1 ? "↓" : "↑";
  }

  async function handleLogSubmit(data) {
    // No try/catch: LogIncidentModal awaits this and renders a failure in its
    // own .apm-error. Catching here would hide it behind a blocking dialog.
    await createIncident(data);
    setShowLogModal(false);
    // force a fresh fetch from page 1 (bump _seq so the effect fires even if page was already 1)
    setQuery((prev) => ({ ...prev, page: 1, _seq: (prev._seq ?? 0) + 1 }));
  }

  function handleEditSubmit(updated) {
    setIncidents((prev) =>
      prev.map((i) => (i.fire_id === updated.fire_id ? updated : i))
    );
    setDetailsIncident((prev) =>
      prev && prev.fire_id === updated.fire_id ? updated : prev
    );
    setEditingIncident(null);
  }

  async function confirmDelete() {
    const target = deletingIncident;
    await deleteIncident(target.fire_id);
    setIncidents((prev) => prev.filter((i) => i.fire_id !== target.fire_id));
    setTotal((t) => Math.max(0, t - 1));
    if (selectedId === target.id) setSelectedId(null);
    // The record is gone — fall back to the list if we were viewing it.
    if (detailsIncident?.fire_id === target.fire_id) setDetailsIncident(null);
  }

  function openDetails(inc) {
    setSelectedId(inc.id);
    setDetailsIncident(inc);
  }

  // Prefer the live row (edits land in `incidents` first) but fall back to the
  // snapshot so the page never blanks out mid-refetch.
  const detailsView = detailsIncident
    ? incidents.find((i) => i.fire_id === detailsIncident.fire_id) ??
      detailsIncident
    : null;

  // Modals live above both the list and the details view, so render them once
  // from a shared helper reused by each return branch.
  function renderModals() {
    return (
      <>
        {showLogModal && (
          <LogIncidentModal
            onClose={() => setShowLogModal(false)}
            onSubmit={handleLogSubmit}
          />
        )}
        {editingIncident && (
          <EditIncidentModal
            incident={editingIncident}
            onClose={() => setEditingIncident(null)}
            onSubmit={handleEditSubmit}
          />
        )}
        {deletingIncident && (
          <ConfirmModal
            eyebrow="DELETE INCIDENT"
            title="Delete this incident?"
            details={[
              { label: "Incident", value: deletingIncident.id },
              { label: "Location", value: deletingIncident.loc },
              { label: "Status", value: deletingIncident.status ? deletingIncident.status[0].toUpperCase() + deletingIncident.status.slice(1) : null },
              { label: "Reported", value: formatReported(deletingIncident.reported_at) },
            ]}
            message={
              <>
                Its dispatch records and routes are removed with it.{" "}
                <strong>This can't be undone.</strong>
              </>
            }
            confirmLabel="Delete incident"
            onConfirm={confirmDelete}
            onClose={() => setDeletingIncident(null)}
          />
        )}
        {exportQuery && (
          <ExportRegisterModal query={exportQuery} onClose={() => setExportQuery(null)} />
        )}
      </>
    );
  }

  if (detailsView) {
    return (
      <>
        <IncidentDetailsPage
          incident={detailsView}
          theme={theme}
          onBack={() => setDetailsIncident(null)}
          onEdit={setEditingIncident}
          onDelete={setDeletingIncident}
          onViewOnMap={onShowOnMap}
        />
        {renderModals()}
      </>
    );
  }

  return (
    <div className="inc-page">
      {/* PAGE HEADER */}
      <div className="inc-header">
        <div className="inc-title-row">
          <div className="inc-title">
            Incidents
            <UnfoldIcon />
          </div>
          <div className="inc-header-actions">
            <button
              className="inc-btn-secondary table-export-btn"
              // The live search box, not the debounced query.search, so text
              // typed a moment before clicking is still in scope.
              onClick={() => setExportQuery({ ...query, search })}
            >
              <ExportIcon />
              Export
            </button>
            <button
              className="inc-btn-log"
              onClick={() => setShowLogModal(true)}
            >
              {/* <AddIcon /> */}
              Log Incident
            </button>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="inc-body">
        <div className="inc-section-row">
          <div className="inc-section-label">Status Overview</div>
          <div className="inc-status-tabs">
            {STATUS_TABS.map((s) => (
              <button
                key={s}
                className={`inc-status-tab${
                  query.status === s ? " active" : ""
                }`}
                onClick={() => setFilter("status", s)}
              >
                {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* STAT CARDS */}
        <div className="kpi-row inc-stat-row">
          {[
            {
              key: "pending",
              accent: "fire",
              icon: "local_fire_department",
              label: "Pending",
              value: stats.pending,
              sub: "Awaiting Dispatch",
            },
            {
              key: "dispatched",
              accent: "amber",
              icon: "fire_truck",
              label: "Dispatched",
              value: stats.dispatched,
              sub: "Units En Route",
            },
            {
              key: "contained",
              accent: "green",
              icon: "check_circle",
              label: "Contained",
              value: stats.contained,
              sub: "Fire Suppressed",
            },
            {
              key: "closed",
              accent: "blue",
              icon: "inventory_2",
              label: "Closed",
              value: stats.closed,
              sub: "This Period",
            },
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
      <div className="inc-toolbar">
        <div className="inc-search-wrap">
          <span className="inc-search-icon">⌕</span>
          <input
            type="text"
            placeholder="Search ID, location..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="inc-filter-select"
          value={query.sev}
          onChange={(e) => setFilter("sev", e.target.value)}
        >
          <option value="">All Severities</option>
          <option value="Critical">Critical</option>
          <option value="Moderate">Moderate</option>
          <option value="Minor">Minor</option>
        </select>
        <select
          className="inc-filter-select"
          value={query.alarm}
          onChange={(e) => setFilter("alarm", e.target.value)}
        >
          <option value="">All Alarm Levels</option>
          <option value="1st Alarm">1st Alarm</option>
          <option value="2nd Alarm">2nd Alarm</option>
          <option value="3rd Alarm">3rd Alarm</option>
        </select>

        {/* PERIOD FILTER */}
        <div className="inc-period-filter">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`inc-period-btn${
                query.period === p.key ? " active" : ""
              }`}
              onClick={() => setFilter("period", p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="inc-toolbar-right">
          {loading ? (
            <span className="inc-result-count">LOADING…</span>
          ) : error ? (
            <span
              className="inc-result-count"
              style={{ color: "var(--accent-fire)" }}
            >
              ERROR
            </span>
          ) : (
            <span className="inc-result-count">
              {total} RECORD{total !== 1 ? "S" : ""}
            </span>
          )}
        </div>
      </div>

      {/* TABLE */}
      <div className="content-wrap">
        <div className="inc-table-pagination-wrap">
          <div className="inc-table-wrap">
            <table className="inc-table">
              <thead>
                <tr>
                  {[
                    { col: "loc", label: "Location", w: 180 },
                    { col: "sev", label: "Severity", w: 100 },
                  ].map(({ col, label, w }) => (
                    <th
                      key={col}
                      style={{ width: w }}
                      className={query.sortCol === col ? "sort-active" : ""}
                      onClick={() => handleSort(col)}
                    >
                      {label}{" "}
                      <span className="inc-sort-arrow">{arrow(col)}</span>
                    </th>
                  ))}
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 100 }}>Alarm</th>
                  <th
                    style={{ width: 130 }}
                    className={
                      query.sortCol === "reported_at" ? "sort-active" : ""
                    }
                    onClick={() => handleSort("reported_at")}
                  >
                    Reported{" "}
                    <span className="inc-sort-arrow">
                      {arrow("reported_at")}
                    </span>
                  </th>
                  {/* <th
                    style={{ width: 70 }}
                    className={query.sortCol === "units" ? "sort-active" : ""}
                    onClick={() => handleSort("units")}
                  >
                    Units{" "}
                    <span className="inc-sort-arrow">{arrow("units")}</span>
                  </th> */}
                  <th style={{ width: 120 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: PAGE_SIZE }, (_, i) => (
                      <tr key={i}>
                        <td>
                          <span
                            className="inc-sk"
                            style={{ width: 130, height: 13, marginBottom: 5 }}
                          />
                          <span
                            className="inc-sk"
                            style={{ width: 88, height: 10 }}
                          />
                        </td>
                        <td>
                          <span
                            className="inc-sk"
                            style={{ width: 58, height: 20, borderRadius: 3 }}
                          />
                        </td>
                        <td>
                          <span
                            className="inc-sk"
                            style={{ width: 72, height: 20, borderRadius: 20 }}
                          />
                        </td>
                        <td>
                          <span
                            className="inc-sk"
                            style={{ width: 68, height: 13 }}
                          />
                        </td>
                        <td>
                          <span
                            className="inc-sk"
                            style={{ width: 90, height: 12 }}
                          />
                        </td>
                        {/* <td>
                          <span
                            className="inc-sk"
                            style={{ width: 24, height: 16, margin: "0 auto" }}
                          />
                        </td> */}
                        <td>
                          <div className="inc-row-actions">
                            <span
                              className="inc-sk"
                              style={{ width: 44, height: 24, borderRadius: 3 }}
                            />
                            <span
                              className="inc-sk"
                              style={{ width: 36, height: 24, borderRadius: 3 }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))
                  : paginated.map((inc) => (
                      <tr
                        key={inc.id}
                        className={selectedId === inc.id ? "selected" : ""}
                        onClick={() => openDetails(inc)}
                      >
                        <td>
                          <div className="inc-row-id">{inc.id}</div>
                          <div className="inc-row-loc">{inc.loc}</div>
                          {inc.addr && (
                            <div className="inc-row-addr">{inc.addr}</div>
                          )}
                        </td>
                        <td>
                          <SeverityBadge sev={inc.sev} />
                        </td>
                        <td>
                          <StatusPill status={inc.status} />
                        </td>
                        <td>
                          <span className="inc-alarm-text">{inc.alarm}</span>
                        </td>
                        <td>
                          <span className="inc-rep-time">
                            {formatReported(inc.reported_at)}
                          </span>
                        </td>
                        {/* <td>
                          <span className="inc-units-count">{inc.units}</span>
                        </td> */}
                        <td>
                          <div className="inc-row-actions">
                            <button
                              className="inc-btn-view"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDetails(inc);
                              }}
                            >
                              View
                            </button>
                            <button
                              className="inc-btn-map"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingIncident(inc);
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
            {!loading && paginated.length === 0 && (
              <div className="inc-empty-state">
                {error
                  ? `Failed to load incidents: ${error}`
                  : "No incidents match your filters"}
              </div>
            )}
          </div>
          {/* PAGINATION */}
          {!loading && total > 0 && (
            <div className="inc-pagination">
              <span className="inc-page-info">
                {(query.page - 1) * PAGE_SIZE + 1}–
                {Math.min(query.page * PAGE_SIZE, total)} of {total}
              </span>
              <div className="inc-page-controls">
                <button
                  className="inc-page-btn next-prev-btn"
                  onClick={() => goToPage((p) => p - 1)}
                  disabled={query.page === 1}
                >
                  ‹
                </button>
                {pageNumbers().map((n, i) =>
                  n === "…" ? (
                    <span key={`e${i}`} className="inc-page-ellipsis">
                      …
                    </span>
                  ) : (
                    <button
                      key={n}
                      className={`inc-page-btn${
                        query.page === n ? " active" : ""
                      }`}
                      onClick={() => goToPage(n)}
                    >
                      {n}
                    </button>
                  )
                )}
                <button
                  className="inc-page-btn next-prev-btn"
                  onClick={() => goToPage((p) => p + 1)}
                  disabled={query.page === totalPages}
                >
                  ›
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {renderModals()}
    </div>
  );
}
