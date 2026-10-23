import { useState, useMemo, useEffect } from "react";
import "../styles/TeamsPage.css";
import KpiCard from "../components/KpiCard";
import { fetchTeams, fetchTrucks, deleteTeam } from "../api";
import { getCurrentShift, isOnCurrentShift } from "../utils/shift";
import AddTeamModal from "../components/AddTeamModal";
import EditTeamModal from "../components/EditTeamModal";
import ConfirmModal from "../components/ConfirmModal";
import useSplitPane from "../hooks/useSplitPane";

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
      className="meta-icon"
      fill="currentColor"
    >
      <path d="M440-120v-320H120v-80h320v-320h80v320h320v80H520v320h-80Z" />
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

function Sym({ name }) {
  return <span className="material-symbols-outlined">{name}</span>;
}

const clean = (v) => (v && v !== "—" ? v : null);

// "offduty" is derived: a standby crew whose shift isn't the one on duty.
// A crew on a call stays "dispatched" even after the shift turns over.
function statusOf(t) {
  const s = t.team_status === "active" ? "dispatched" : t.team_status || "standby";
  if (s === "standby" && !isOnCurrentShift(t.shift_name)) return "offduty";
  return s;
}

const STATUS_TABS = ["all", "standby", "dispatched", "offduty", "inactive"];
const TAB_LABELS = {
  all: "All",
  standby: "Ready",
  dispatched: "Dispatched",
  offduty: "Off duty",
  inactive: "Inactive",
};
const STATUS_ORDER = { standby: 0, dispatched: 1, offduty: 2, inactive: 3 };
const TONE = { standby: "green", dispatched: "amber", offduty: "muted", inactive: "muted" };
const STATUS_LABEL = { standby: "Ready", dispatched: "Dispatched", offduty: "Off duty", inactive: "Inactive" };

function Pill({ status }) {
  return (
    <span className={`tea-pill tea-pill-${TONE[status] || "muted"}`}>
      {status === "dispatched" && <span className="tea-pill-dot" />}
      {STATUS_LABEL[status] || status}
    </span>
  );
}

function ShiftChip({ name }) {
  if (!clean(name)) return <span className="tea-dim">—</span>;
  return <span className="tea-chip">{name.replace("Shift ", "")}</span>;
}

function MemberStack({ members, count, max = 4 }) {
  const shown = (members || []).slice(0, max);
  if (!count) return <span className="tea-dim">None</span>;
  return (
    <span className="tea-stack" title={`${count} ${count === 1 ? "member" : "members"}`}>
      {shown.map((m) => (
        <span key={m.per_id} className="tea-av xs">{m.initials}</span>
      ))}
      {count > max && <span className="tea-stack-more">+{count - max}</span>}
    </span>
  );
}

/* Mirrors backend auto_dispatch._eligible_teams, in the same order, so the
   first failing check is the reason the recommender skips this crew. */
function readiness(t, trucksByStation) {
  const members = t.members || [];
  const readyTrucks = (trucksByStation.get(t.station_id) || []).filter((x) => x.truck_status === "available").length;
  const busy = members.filter((m) => !["", "standby"].includes((m.member_status || "").toLowerCase())).length;
  return [
    {
      key: "station",
      ok: t.station_status !== "inactive" && t.station_latitude != null && t.station_longitude != null,
      label: "Station in service",
      fail: t.station_status === "inactive" ? "Its station is marked inactive" : "Its station has no location on record",
    },
    {
      key: "shift",
      ok: !!clean(t.shift_name) && isOnCurrentShift(t.shift_name),
      label: "On the current shift",
      fail: clean(t.shift_name) ? `${t.shift_name} is off duty` : "No shift assigned",
    },
    {
      key: "truck",
      ok: readyTrucks > 0,
      label: readyTrucks ? `${readyTrucks} truck${readyTrucks === 1 ? "" : "s"} available at the station` : "Truck available at the station",
      fail: "No available truck at its station",
    },
    {
      key: "members",
      ok: members.length > 0 && busy === 0,
      label: "Crew on standby",
      fail: members.length === 0 ? "No members assigned" : `${busy} member${busy === 1 ? " is" : "s are"} not on standby`,
    },
  ];
}

function SortTh({ col, sort, onSort, children, className = "" }) {
  const active = sort.col === col;
  return (
    <th className={`${className}${active ? " sort-active" : ""}`} onClick={() => onSort(col)}
      aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      {children}
      <span className="tea-sort-arrow">{!active ? "↕" : sort.dir === 1 ? "↑" : "↓"}</span>
    </th>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function Section({ title, count, children, empty }) {
  return (
    <section className="tea-sec">
      <h3 className="tea-sec-title">
        {title}
        {count != null && <span className="tea-sec-count">{count}</span>}
      </h3>
      {empty ? <div className="tea-sec-empty">{empty}</div> : children}
    </section>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="tea-stat">
      <div className="tea-stat-label">{label}</div>
      <div className="tea-stat-value">{value}</div>
      {sub && <div className="tea-stat-sub">{sub}</div>}
    </div>
  );
}

function TeamDetail({ t, trucksByStation, onEdit, onDelete, onViewOnMap }) {
  if (!t) {
    return (
      <div className="tea-empty-detail">
        <div className="tea-empty-icon"><Sym name="groups" /></div>
        <div className="tea-empty-title">No team selected</div>
        <div className="tea-empty-sub">Pick a team to see its crew and whether it can be auto-dispatched.</div>
      </div>
    );
  }

  const status = statusOf(t);
  const members = t.members || [];
  const checks = readiness(t, trucksByStation);
  const failing = checks.find((c) => !c.ok);
  const hasCoords = t.station_latitude != null && t.station_longitude != null;
  const onShift = clean(t.shift_name) && isOnCurrentShift(t.shift_name);
  const leader = members.find((m) => (m.member_role || "").toLowerCase() === "leader");

  return (
    <div className="tea-detail-scroll">
      {/* ── Hero ── */}
      <div className={`tea-hero${status === "standby" ? "" : " quiet"}`}>
        <div className="tea-hero-top">
          <div className={`tea-hero-icon tone-${TONE[status]}`}>
            <Sym name="groups" />
          </div>
          <div className="tea-hero-text">
            <div className="tea-hero-eyebrow">{clean(t.team_code) || "No code"}</div>
            <div className="tea-hero-name">{t.team_name}</div>
            {clean(t.station_name) && <div className="tea-hero-sub">{t.station_name}</div>}
          </div>
        </div>
        <div className="tea-hero-chips">
          <Pill status={status} />
          {clean(t.shift_name) && <span className="tea-pill tea-pill-muted">{t.shift_name}</span>}
          {t.station_status === "inactive" && <span className="tea-pill tea-pill-muted">Station inactive</span>}
        </div>
        <div className="tea-hero-actions">
          <button type="button" className="act-btn" onClick={onViewOnMap} disabled={!hasCoords}
            title={hasCoords ? "Show this team's station on the Command map" : "Its station has no location on record"}>
            <Sym name="map" />
            View on map
          </button>
          <button type="button" className="act-icon-btn" onClick={onEdit} title="Edit team" aria-label="Edit team">
            <EditIcon />
          </button>
          <button type="button" className="act-icon-btn danger" onClick={onDelete} title="Delete team" aria-label="Delete team">
            <RemoveIcon />
          </button>
        </div>

        <div className="tea-stats">
          <StatTile label="Members" value={members.length} sub={leader ? `Led by ${leader.name.split(" ")[0]}` : "No leader set"} />
          <StatTile label="Truck" value={t.truck_platenum || "—"} sub={t.truck_platenum ? "Assigned" : "None assigned"} />
          <StatTile label="Shift" value={clean(t.shift_name)?.replace("Shift ", "") || "—"} sub={!clean(t.shift_name) ? "Not set" : onShift ? "On duty now" : "Off duty"} />
        </div>
      </div>

      {/* ── Auto-dispatch readiness ── */}
      <Section title="Auto-dispatch">
        <div className={`tea-ready ${failing ? "no" : "yes"}`}>
          <Sym name={failing ? "block" : "check_circle"} />
          <div>
            <div className="tea-ready-title">{failing ? "Won't be recommended" : "Ready to be recommended"}</div>
            <div className="tea-ready-sub">
              {failing ? `${failing.fail}. You can still dispatch it by hand.` : "Meets every check the recommender runs."}
            </div>
          </div>
        </div>
        <ul className="tea-checks">
          {checks.map((c) => (
            <li key={c.key} className={c.ok ? "ok" : "bad"}>
              <Sym name={c.ok ? "check" : "close"} />
              {c.ok ? c.label : c.fail}
            </li>
          ))}
        </ul>
      </Section>

      {/* ── Details ── */}
      <Section title="Details">
        <div className="tea-fields">
          <div className="tea-field">
            <span className="tea-field-label">Station</span>
            <span className="tea-field-value">{clean(t.station_name) || <span className="tea-dim">—</span>}</span>
          </div>
          <div className="tea-field">
            <span className="tea-field-label">Code</span>
            <span className="tea-field-value tea-mono">{clean(t.team_code) || <span className="tea-dim">—</span>}</span>
          </div>
          <div className="tea-field">
            <span className="tea-field-label">Truck</span>
            {t.truck_platenum
              ? <span className="tea-field-value tea-mono">{t.truck_platenum}</span>
              : <button type="button" className="tea-link" onClick={onEdit}>Assign a truck</button>}
          </div>
          <div className="tea-field">
            <span className="tea-field-label">Created</span>
            <span className="tea-field-value">
              {t.created_at
                ? new Date(t.created_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
                : <span className="tea-dim">—</span>}
            </span>
          </div>
        </div>
      </Section>

      {/* ── Crew ── */}
      <Section
        title="Crew"
        count={members.length}
        empty={members.length === 0 && (
          <>No one is on this team yet. <button type="button" className="tea-link" onClick={onEdit}>Add members</button></>
        )}
      >
        <div className="tea-list-rows">
          {members.map((m) => (
            <div key={m.per_id} className="tea-line">
              <span className="tea-av">{m.initials}</span>
              <span className="tea-line-text">
                <span className="tea-line-name">
                  {m.name}
                  {(m.member_role || "").toLowerCase() === "leader" && <span className="tea-pill tea-pill-fire">Leader</span>}
                </span>
                <span className="tea-line-sub">
                  {[clean(m.rank), clean(m.designation)].filter(Boolean).join(" · ") || "—"}
                </span>
              </span>
              {m.member_role && m.member_role.toLowerCase() !== "leader" && (
                <span className="tea-line-meta">{m.member_role}</span>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function exportCsv(rows) {
  const header = ["Code", "Name", "Status", "Shift", "Station", "Truck", "Members", "Crew"];
  const esc = (v) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((t) => [
    clean(t.team_code), t.team_name, STATUS_LABEL[statusOf(t)], clean(t.shift_name), clean(t.station_name),
    t.truck_platenum, t.member_count, (t.members || []).map((m) => m.name).join("; "),
  ].map(esc).join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `teams-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function TeamsPage({ refreshKey = 0, onShowOnMap }) {
  const [teams, setTeams] = useState([]);
  const [trucks, setTrucks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [search, setSearch] = useState("");
  const [activeStatus, setActiveStatus] = useState("all");
  const [stationFilter, setStationFilter] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [sortCol, setSortCol] = useState("team_name");
  const [sortDir, setSortDir] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [view, setView] = useState("list");
  const { width: detailWidth, handleProps: resizeHandle } = useSplitPane({ storageKey: "teams.detailWidth", minMain: 692 });

  // refreshKey is bumped by App when a dispatch completes, so a close that
  // returns a crew to standby lands here without a reload. Deliberately does
  // NOT set loading back to true — a refetch should update the rows in place,
  // not flash the skeleton over a table the user is already reading.
  // Trucks only feed the readiness checklist, so a failure there isn't fatal.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    Promise.all([fetchTeams(), fetchTrucks().catch(() => [])])
      .then(([teamData, truckData]) => {
        setFetchError(null);
        setTeams(teamData);
        setTrucks(truckData);
      })
      .catch((ex) => setFetchError(ex.message || "Couldn't load teams."))
      .finally(() => setLoading(false));
  }, [refreshKey, attempt]);

  function retry() {
    setLoading(true);
    setFetchError(null);
    setAttempt((n) => n + 1);
  }

  const trucksByStation = useMemo(() => {
    const m = new Map();
    for (const t of trucks) {
      if (!m.has(t.station_id)) m.set(t.station_id, []);
      m.get(t.station_id).push(t);
    }
    return m;
  }, [trucks]);

  const stationOptions = useMemo(() => {
    const m = new Map();
    for (const t of teams) if (t.station_id != null && clean(t.station_name)) m.set(t.station_id, t.station_name);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [teams]);

  const stats = useMemo(() => {
    const by = { standby: 0, dispatched: 0, offduty: 0, inactive: 0 };
    for (const t of teams) by[statusOf(t)] = (by[statusOf(t)] || 0) + 1;
    return { total: teams.length, members: teams.reduce((a, t) => a + (t.member_count || 0), 0), ...by };
  }, [teams]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = teams.filter((t) => {
      const matchSearch =
        !q ||
        [t.team_name, t.team_code, t.station_name, t.truck_platenum, ...(t.members || []).map((m) => m.name)]
          .some((v) => (v || "").toLowerCase().includes(q));
      const matchStatus = activeStatus === "all" || statusOf(t) === activeStatus;
      const matchStation = !stationFilter || String(t.station_id) === stationFilter;
      return matchSearch && matchStatus && matchStation;
    });
    const key = {
      team_name: (t) => t.team_name.toLowerCase(),
      team_status: (t) => STATUS_ORDER[statusOf(t)] ?? 9,
      station: (t) => (t.station_name || "").toLowerCase(),
      members: (t) => t.member_count || 0,
    }[sortCol];
    rows.sort((a, b) => {
      const av = key(a), bv = key(b);
      if (av < bv) return -1 * sortDir;
      if (av > bv) return 1 * sortDir;
      return 0;
    });
    return rows;
  }, [teams, search, activeStatus, stationFilter, sortCol, sortDir]);

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => d * -1);
    else {
      setSortCol(col);
      setSortDir(1);
    }
  }

  function toggle(id) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  function clearFilters() {
    setSearch("");
    setActiveStatus("all");
    setStationFilter("");
  }

  function handleAdded(team) {
    setTeams((prev) => [...prev, team]);
    setShowAdd(false);
    setSelectedId(team.team_id);
  }

  function handleUpdated(updated) {
    setTeams((prev) => prev.map((t) => (t.team_id === updated.team_id ? updated : t)));
    setEditing(null);
  }

  async function confirmDelete() {
    const team = deleting;
    await deleteTeam(team.team_id);
    setTeams((prev) => prev.filter((t) => t.team_id !== team.team_id));
    if (selectedId === team.team_id) setSelectedId(null);
  }

  const sort = { col: sortCol, dir: sortDir };
  const selected = teams.find((t) => t.team_id === selectedId) || null;

  const emptyState = fetchError ? (
    <div className="tea-state error">
      <Sym name="error" />
      <span>{fetchError}</span>
      <button type="button" className="tea-link" onClick={retry}>Try again</button>
    </div>
  ) : teams.length === 0 ? (
    <div className="tea-state">
      <Sym name="groups" />
      <span>No response teams yet.</span>
      <button type="button" className="tea-link" onClick={() => setShowAdd(true)}>Add the first team</button>
    </div>
  ) : filtered.length === 0 ? (
    <div className="tea-state">
      <Sym name="search_off" />
      <span>No teams match these filters.</span>
      <button type="button" className="tea-link" onClick={clearFilters}>Clear filters</button>
    </div>
  ) : null;

  return (
    <>
      <div className="tea-page">
        {/* HEADER */}
        <div className="tea-header">
          <div className="tea-title-row">
            <div className="tea-title">
              Response Teams
              <UnfoldIcon />
            </div>
            <div className="tea-header-actions">
              <button className="tea-btn-secondary table-export-btn" onClick={() => exportCsv(filtered)} disabled={filtered.length === 0}>
                <ExportIcon />
                Export
              </button>
              <button className="tea-btn-primary" onClick={() => setShowAdd(true)}>
                <AddIcon />
                Add Team
              </button>
            </div>
          </div>
        </div>

        {/* BODY */}
        <div className="tea-body">
          <div className="tea-section-row">
            <div className="tea-section-label">Overview</div>
            <div className="tea-status-tabs">
              {STATUS_TABS.map((s) => (
                <button
                  key={s}
                  className={`tea-status-tab${activeStatus === s ? " active" : ""}`}
                  onClick={() => setActiveStatus(s)}
                >
                  {TAB_LABELS[s]}
                </button>
              ))}
            </div>
          </div>

          <div className="kpi-row tea-stat-row">
            {[
              { key: "total", accent: "fire", icon: "groups", label: "Teams", value: stats.total, sub: `${stats.members} personnel assigned` },
              { key: "ready", accent: "green", icon: "check_circle", label: "Ready", value: stats.standby, sub: `Shift ${getCurrentShift().letter} on duty` },
              { key: "dispatched", accent: "amber", icon: "local_fire_department", label: "Dispatched", value: stats.dispatched, sub: "Out on a call" },
              { key: "off", accent: "muted", icon: "bedtime", label: "Off duty", value: stats.offduty + stats.inactive, sub: stats.inactive ? `${stats.inactive} marked inactive` : "Next shift" },
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
        <div className="tea-toolbar">
          <div className="tea-search-wrap">
            <span className="tea-search-icon"><Sym name="search" /></span>
            <input
              type="text"
              placeholder="Search team, code, station, member…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="tea-filter-select"
            value={stationFilter}
            onChange={(e) => setStationFilter(e.target.value)}
            aria-label="Filter by station"
          >
            <option value="">All stations</option>
            {stationOptions.map(([id, name]) => (
              <option key={id} value={String(id)}>{name}</option>
            ))}
          </select>
          <span className="tea-result-count">
            {filtered.length} of {teams.length} team{teams.length !== 1 ? "s" : ""}
          </span>
          <div className="tea-view-toggle" role="group" aria-label="Layout">
            <button
              className={`tea-view-btn${view === "list" ? " active" : ""}`}
              onClick={() => setView("list")}
              title="List view"
              aria-pressed={view === "list"}
            >
              <Sym name="view_list" />
            </button>
            <button
              className={`tea-view-btn${view === "grid" ? " active" : ""}`}
              onClick={() => setView("grid")}
              title="Grid view"
              aria-pressed={view === "grid"}
            >
              <Sym name="grid_view" />
            </button>
          </div>
        </div>

        {/* CONTENT */}
        <div className="tea-content">
          <div className="tea-main">
            {view === "list" ? (
              <div className="tea-table-wrap">
                <table className="tea-table">
                  <thead>
                    <tr>
                      <SortTh col="team_name" sort={sort} onSort={handleSort} className="c-team">Team</SortTh>
                      <SortTh col="team_status" sort={sort} onSort={handleSort} className="c-status">Status</SortTh>
                      <th className="c-shift">Shift</th>
                      <SortTh col="station" sort={sort} onSort={handleSort} className="c-station">Station</SortTh>
                      <th className="c-truck">Truck</th>
                      <SortTh col="members" sort={sort} onSort={handleSort} className="c-members">Crew</SortTh>
                      <th className="c-actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 6 }).map((_, i) => (
                          <tr key={i} className="skel-row">
                            <td>
                              <div className="tea-team-cell">
                                <span className="tea-skel tea-skel-icon" />
                                <span className="tea-team-text">
                                  <span className="tea-skel" style={{ width: "70%", height: 11 }} />
                                  <span className="tea-skel" style={{ width: "40%", height: 8 }} />
                                </span>
                              </div>
                            </td>
                            <td><span className="tea-skel" style={{ width: 58, height: 16 }} /></td>
                            <td><span className="tea-skel" style={{ width: 22, height: 16 }} /></td>
                            <td><span className="tea-skel" style={{ width: "75%", height: 10 }} /></td>
                            <td><span className="tea-skel" style={{ width: "60%", height: 10 }} /></td>
                            <td><span className="tea-skel" style={{ width: 60, height: 20 }} /></td>
                            <td><span className="tea-skel" style={{ width: 84, height: 20 }} /></td>
                          </tr>
                        ))
                      : filtered.map((team) => {
                          const status = statusOf(team);
                          return (
                            <tr
                              key={team.team_id}
                              className={selectedId === team.team_id ? "selected" : ""}
                              onClick={() => toggle(team.team_id)}
                            >
                              <td>
                                <div className="tea-team-cell">
                                  <span className={`tea-team-icon tone-${TONE[status]}`}><Sym name="groups" /></span>
                                  <span className="tea-team-text">
                                    <span className="tea-team-name">{team.team_name}</span>
                                    <span className="tea-team-code">{clean(team.team_code) || "No code"}</span>
                                  </span>
                                </div>
                              </td>
                              <td><Pill status={status} /></td>
                              <td><ShiftChip name={team.shift_name} /></td>
                              <td>
                                <span className="tea-cell-station">
                                  {clean(team.station_name) || <span className="tea-dim">—</span>}
                                  {team.station_status === "inactive" && (
                                    <span className="tea-inactive-mark" title="Station inactive"><Sym name="block" /></span>
                                  )}
                                </span>
                              </td>
                              <td>
                                {team.truck_platenum
                                  ? <span className="tea-mono tea-cell-truck">{team.truck_platenum}</span>
                                  : <span className="tea-dim">—</span>}
                              </td>
                              <td><MemberStack members={team.members} count={team.member_count} max={3} /></td>
                              <td>
                                <div className="tea-row-actions">
                                  <button
                                    className="tea-btn-view"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedId(team.team_id);
                                    }}
                                  >
                                    View
                                  </button>
                                  <button
                                    className="tea-btn-edit"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditing(team);
                                    }}
                                  >
                                    Edit
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                  </tbody>
                </table>
                {!loading && emptyState}
              </div>
            ) : (
              <div className="tea-grid-wrap">
                {loading ? (
                  <div className="tea-grid">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div key={i} className="tea-card skel">
                        <div className="tea-card-top">
                          <span className="tea-skel tea-skel-icon" />
                          <span className="tea-skel" style={{ width: 54, height: 16 }} />
                        </div>
                        <span className="tea-skel" style={{ width: "70%", height: 12, marginBottom: 6 }} />
                        <span className="tea-skel" style={{ width: "40%", height: 9 }} />
                        <div className="tea-card-rows">
                          {[0, 1, 2].map((r) => (
                            <span key={r} className="tea-skel" style={{ width: "100%", height: 9 }} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : emptyState || (
                  <div className="tea-grid">
                    {filtered.map((team) => {
                      const status = statusOf(team);
                      return (
                        <button
                          type="button"
                          key={team.team_id}
                          className={`tea-card${selectedId === team.team_id ? " selected" : ""}`}
                          onClick={() => toggle(team.team_id)}
                          aria-pressed={selectedId === team.team_id}
                        >
                          <div className="tea-card-top">
                            <span className={`tea-team-icon lg tone-${TONE[status]}`}><Sym name="groups" /></span>
                            <Pill status={status} />
                          </div>
                          <div className="tea-card-name">{team.team_name}</div>
                          <div className="tea-card-code">{clean(team.team_code) || "No code"}</div>
                          <dl className="tea-card-rows">
                            <div><dt>Station</dt><dd>{clean(team.station_name) || "—"}</dd></div>
                            <div><dt>Shift</dt><dd>{clean(team.shift_name) || "—"}</dd></div>
                            <div><dt>Truck</dt><dd className="tea-mono">{team.truck_platenum || "—"}</dd></div>
                          </dl>
                          <div className="tea-card-bottom">
                            <MemberStack members={team.members} count={team.member_count} />
                            <span className="tea-card-count">
                              {team.member_count} {team.member_count === 1 ? "member" : "members"}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="split-resizer" {...resizeHandle} />

          <aside className="tea-detail" aria-label="Team details" style={{ width: detailWidth }}>
            <TeamDetail
              t={selected}
              trucksByStation={trucksByStation}
              onEdit={() => setEditing(selected)}
              onDelete={() => setDeleting(selected)}
              onViewOnMap={() => onShowOnMap?.(selected)}
            />
          </aside>
        </div>
      </div>

      {showAdd && (
        <AddTeamModal
          onClose={() => setShowAdd(false)}
          onSubmit={handleAdded}
        />
      )}
      {editing && (
        <EditTeamModal
          team={editing}
          onClose={() => setEditing(null)}
          onSubmit={handleUpdated}
        />
      )}
      {deleting && (
        <ConfirmModal
          eyebrow="DELETE TEAM"
          title={`Delete ${deleting.team_name}?`}
          details={[
            { label: "Team", value: [clean(deleting.team_code), clean(deleting.station_name)].filter(Boolean).join(" · ") || null },
            { label: "Crew", value: `${deleting.member_count} ${deleting.member_count === 1 ? "member" : "members"}` },
            { label: "Truck", value: deleting.truck_platenum },
          ]}
          message="Its member assignments are removed with it. The personnel themselves stay on record. This can't be undone."
          confirmLabel="Delete team"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
