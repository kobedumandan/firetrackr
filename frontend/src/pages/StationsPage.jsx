import { useState, useMemo, useEffect, useCallback } from "react";
import "../styles/StationsPage.css";
import KpiCard from "../components/KpiCard";
import { fetchStations, createStation, deleteStation, fetchPersonnel, fetchTeams, fetchTrucks } from "../api";
import AddStationModal from "../components/AddStationModal";
import EditStationModal from "../components/EditStationModal";
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

const stationKey = (id) => `STA-${String(id).padStart(3, "0")}`;

function dbToStation(s) {
  return {
    id: stationKey(s.station_id),
    numericId: s.station_id,
    code: `BFP-${s.station_id}`,
    name: s.station_name,
    type: s.station_type || "main",
    parent: s.parent_station_id ? stationKey(s.parent_station_id) : null,
    district: s.station_barangay || "—",
    address: s.station_address || "—",
    status: s.station_status || "operational",
    contact: s.station_contact || "—",
    commanderId: s.station_commander_id || null,
    commander: s.commander_name || "—",
    latitude: s.station_latitude ?? null,
    longitude: s.station_longitude ?? null,
    subs: [],
    personnelList: [],
    teamsList: [],
    trucksList: [],
    personnel: 0,
  };
}

const TABS = ["all", "main", "sub"];
const TAB_LABELS = { all: "All", main: "Main Stations", sub: "Substations" };

// Status pills keep to the three accents: green = ready, amber = committed,
// fire = on scene / out of service; anything else is neutral.
const TONE = {
  personnel: { standby: "green", dispatched: "amber", onscene: "fire", offduty: "muted" },
  team: { standby: "green", dispatched: "amber", active: "amber", inactive: "muted" },
  truck: { available: "green", dispatched: "amber", maintenance: "amber", unavailable: "fire" },
};
const LABEL = { onscene: "On scene", offduty: "Off duty" };

function Pill({ kind, status }) {
  const tone = TONE[kind][status] || "muted";
  const live = status === "dispatched" || status === "onscene";
  const label = LABEL[status] || (status ? status.charAt(0).toUpperCase() + status.slice(1) : "—");
  return (
    <span className={`sta-pill sta-pill-${tone}`}>
      {live && <span className="sta-pill-dot" />}
      {label}
    </span>
  );
}

function Sym({ name }) {
  return <span className="material-symbols-outlined">{name}</span>;
}

const clean = (v) => (v && v !== "—" ? v : null);

function trucksReady(s) {
  return s.trucksList.filter((t) => t.status === "available").length;
}

// ── Left list ────────────────────────────────────────────────────────────────

function StationRow({ s, parentName, nested, selected, onSelect }) {
  const isMain = s.type === "main";
  const inactive = s.status === "inactive";
  return (
    <button
      type="button"
      className={`sta-row${nested ? " nested" : ""}${selected ? " selected" : ""}${inactive ? " inactive" : ""}`}
      onClick={() => onSelect(s.id)}
      aria-current={selected || undefined}
    >
      <span className={`sta-row-icon ${isMain ? "is-main" : "is-sub"}`}>
        <Sym name={isMain ? "apartment" : "location_on"} />
      </span>
      <span className="sta-row-text">
        <span className="sta-row-name">
          {s.name}
          {inactive && <span className="sta-pill sta-pill-muted">Inactive</span>}
        </span>
        <span className="sta-row-meta">
          <span className="sta-mono">{s.code}</span>
          {clean(s.district) && <span>{s.district}</span>}
          {parentName && <span>Under {parentName}</span>}
        </span>
      </span>
      <span className="sta-row-counts" aria-label={`${s.personnel} personnel, ${s.trucksList.length} trucks`}>
        <span title="Personnel"><Sym name="group" />{s.personnel}</span>
        <span title="Trucks"><Sym name="fire_truck" />{s.trucksList.length}</span>
      </span>
    </button>
  );
}

/* Main stations with their sub-stations nested underneath. Subs whose parent
   is filtered out (or missing) still show, with an "Under …" hint. */
function StationTree({ list, stations, selectedId, onSelect, flat }) {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const visible = new Set(list.map((s) => s.id));
  const nameOf = (id) => byId.get(id)?.name;

  if (flat) {
    return list.map((s) => (
      <StationRow key={s.id} s={s} parentName={s.parent ? nameOf(s.parent) : null}
        selected={selectedId === s.id} onSelect={onSelect} />
    ));
  }

  const rows = [];
  for (const s of list) {
    if (s.type === "sub" && s.parent && visible.has(s.parent)) continue; // drawn under its parent
    rows.push(
      <StationRow key={s.id} s={s}
        parentName={s.type === "sub" && s.parent ? nameOf(s.parent) : null}
        selected={selectedId === s.id} onSelect={onSelect} />
    );
    if (s.type === "main") {
      const kids = list.filter((k) => k.parent === s.id);
      if (kids.length) {
        rows.push(
          <div key={`${s.id}-kids`} className="sta-tree-kids">
            {kids.map((k) => (
              <StationRow key={k.id} s={k} nested selected={selectedId === k.id} onSelect={onSelect} />
            ))}
          </div>
        );
      }
    }
  }
  return rows;
}

// ── Right detail ─────────────────────────────────────────────────────────────

function Section({ title, count, children, empty }) {
  return (
    <section className="sta-sec">
      <h3 className="sta-sec-title">
        {title}
        {count != null && <span className="sta-sec-count">{count}</span>}
      </h3>
      {empty ? <div className="sta-sec-empty">{empty}</div> : children}
    </section>
  );
}

function StatTile({ label, value, sub }) {
  return (
    <div className="sta-stat">
      <div className="sta-stat-label">{label}</div>
      <div className="sta-stat-value">{value}</div>
      {sub && <div className="sta-stat-sub">{sub}</div>}
    </div>
  );
}

function CopyValue({ text, mono }) {
  const [copied, setCopied] = useState(false);
  if (!text) return <span className="sta-field-value sta-dim">—</span>;
  function copy() {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <span className={`sta-field-value${mono ? " sta-mono" : ""}`}>
      {text}
      <button type="button" className="sta-copy" onClick={copy} title="Copy" aria-label={`Copy ${text}`}>
        <Sym name={copied ? "check" : "content_copy"} />
      </button>
    </span>
  );
}

function StationDetail({ s, stations, onSelectStation, onEdit, onDelete, onViewOnMap }) {
  if (!s) {
    return (
      <div className="sta-empty-detail">
        <div className="sta-empty-icon"><Sym name="apartment" /></div>
        <div className="sta-empty-title">No station selected</div>
        <div className="sta-empty-sub">Pick one from the list to see its teams, trucks and people.</div>
      </div>
    );
  }

  const isMain = s.type === "main";
  const inactive = s.status === "inactive";
  const subs = isMain ? s.subs.map((id) => stations.find((x) => x.id === id)).filter(Boolean) : [];
  const parent = !isMain && s.parent ? stations.find((x) => x.id === s.parent) : null;
  const hasCoords = s.latitude != null && s.longitude != null;
  const commander = s.personnelList.find((p) => p.per_id === s.commanderId);
  const onStandby = s.personnelList.filter((p) => p.status === "standby").length;
  const teamsReady = s.teamsList.filter((t) => t.status === "standby").length;
  const ready = trucksReady(s);
  const deployed = s.trucksList.filter((t) => t.status === "dispatched").length;

  return (
    <div className="sta-detail-scroll">
      {/* ── Hero ── */}
      <div className={`sta-hero${inactive ? " inactive" : ""}`}>
        <div className="sta-hero-top">
          <div className="sta-hero-left">
            <div className={`sta-hero-icon ${isMain ? "is-main" : "is-sub"}`}>
              <Sym name={isMain ? "apartment" : "location_on"} />
            </div>
            <div className="sta-hero-text">
              <div className="sta-hero-eyebrow">{s.code}</div>
              <div className="sta-hero-name">{s.name}</div>
              {clean(s.address) && <div className="sta-hero-addr">{s.address}</div>}
              <div className="sta-hero-chips">
                <span className="sta-pill sta-pill-muted">{isMain ? "Main station" : "Sub-station"}</span>
                <span className={`sta-pill ${inactive ? "sta-pill-muted" : "sta-pill-green"}`}>
                  {inactive ? "Inactive" : "Operational"}
                </span>
                {parent && (
                  <button type="button" className="sta-pill sta-pill-link" onClick={() => onSelectStation(parent.id)}>
                    Reports to {parent.name}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="sta-hero-actions">
            <button type="button" className="act-btn" onClick={onViewOnMap} disabled={!hasCoords}
              title={hasCoords ? "Show on the Command map" : "No location on record"}>
              <Sym name="map" />
              View on map
            </button>
            <button type="button" className="act-icon-btn" onClick={onEdit} title="Edit station" aria-label="Edit station">
              <EditIcon />
            </button>
            <button type="button" className="act-icon-btn danger" onClick={onDelete} title="Delete station" aria-label="Delete station">
              <RemoveIcon />
            </button>
          </div>
        </div>

        {inactive && (
          <div className="sta-hero-note">
            <Sym name="info" />
            Marked inactive: left out of coverage, and its teams aren&apos;t auto-dispatched or recommended.
          </div>
        )}

        <div className="sta-stats">
          <StatTile label="Personnel" value={s.personnel} sub={`${onStandby} on standby`} />
          <StatTile label="Teams" value={s.teamsList.length} sub={`${teamsReady} ready`} />
          <StatTile label="Trucks" value={`${ready}/${s.trucksList.length}`} sub={deployed ? `${deployed} deployed` : "available"} />
          {isMain
            ? <StatTile label="Sub-stations" value={subs.length} sub="under command" />
            : <StatTile label="Parent" value={parent ? parent.code : "—"} sub={parent ? parent.name : "none set"} />}
        </div>
      </div>

      {/* ── Details ── */}
      <Section title="Details">
        <div className="sta-fields">
          <div className="sta-field">
            <span className="sta-field-label">Barangay</span>
            <span className="sta-field-value">{clean(s.district) || <span className="sta-dim">—</span>}</span>
          </div>
          <div className="sta-field">
            <span className="sta-field-label">Contact</span>
            <CopyValue text={clean(s.contact)} mono />
          </div>
          <div className="sta-field">
            <span className="sta-field-label">Commander</span>
            {commander || clean(s.commander) ? (
              <span className="sta-field-value sta-person">
                <span className="sta-av sm">{commander?.initials || "—"}</span>
                {commander?.name || s.commander}
              </span>
            ) : (
              <button type="button" className="sta-link" onClick={onEdit}>Assign a commander</button>
            )}
          </div>
          <div className="sta-field">
            <span className="sta-field-label">Coordinates</span>
            <CopyValue text={hasCoords ? `${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}` : null} mono />
          </div>
        </div>
      </Section>

      {/* ── Command chain ── */}
      {isMain ? (
        <Section title="Sub-stations" count={subs.length} empty={subs.length === 0 && "No sub-stations report to this station."}>
          <div className="sta-list-rows">
            {subs.map((sub) => (
              <button key={sub.id} type="button" className="sta-line clickable" onClick={() => onSelectStation(sub.id)}>
                <span className="sta-line-icon"><Sym name="location_on" /></span>
                <span className="sta-line-text">
                  <span className="sta-line-name">{sub.name}</span>
                  <span className="sta-line-sub">{[sub.code, clean(sub.district)].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="sta-line-meta">{sub.personnel} people · {sub.trucksList.length} trucks</span>
                {sub.status === "inactive" && <span className="sta-pill sta-pill-muted">Inactive</span>}
                <span className="sta-line-chev"><Sym name="chevron_right" /></span>
              </button>
            ))}
          </div>
        </Section>
      ) : null}

      {/* ── Teams ── */}
      <Section title="Response teams" count={s.teamsList.length} empty={s.teamsList.length === 0 && "No teams are based here."}>
        <div className="sta-list-rows">
          {s.teamsList.map((t) => (
            <div key={t.team_id} className="sta-line">
              <span className="sta-line-icon"><Sym name="groups" /></span>
              <span className="sta-line-text">
                <span className="sta-line-name">{t.name}</span>
                <span className="sta-line-sub">{[t.code, t.shift].filter(Boolean).join(" · ") || "—"}</span>
              </span>
              <span className="sta-line-meta">{t.members} {t.members === 1 ? "member" : "members"}</span>
              <Pill kind="team" status={t.status} />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Trucks ── */}
      <Section title="Fire trucks" count={s.trucksList.length} empty={s.trucksList.length === 0 && "No trucks are assigned here."}>
        <div className="sta-list-rows">
          {s.trucksList.map((t) => (
            <div key={t.truck_id} className="sta-line">
              <span className="sta-line-icon"><Sym name="fire_truck" /></span>
              <span className="sta-line-text">
                <span className="sta-line-name sta-mono">{t.plate}</span>
              </span>
              <Pill kind="truck" status={t.status} />
            </div>
          ))}
        </div>
      </Section>

      {/* ── Personnel ── */}
      <Section title="Personnel" count={s.personnelList.length} empty={s.personnelList.length === 0 && "No one is assigned to this station yet."}>
        <div className="sta-list-rows">
          {s.personnelList.map((p) => (
            <div key={p.per_id} className="sta-line">
              <span className="sta-av">{p.initials}</span>
              <span className="sta-line-text">
                <span className="sta-line-name">
                  {p.name}
                  {p.per_id === s.commanderId && <span className="sta-pill sta-pill-fire">Commander</span>}
                </span>
                <span className="sta-line-sub">{clean(p.rank) || "—"}</span>
              </span>
              <Pill kind="personnel" status={p.status} />
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function exportCsv(rows, stations) {
  const nameOf = (id) => stations.find((s) => s.id === id)?.name || "";
  const header = ["Code", "Name", "Type", "Reports to", "Status", "Barangay", "Address", "Contact", "Commander", "Personnel", "Teams", "Trucks", "Trucks available", "Latitude", "Longitude"];
  const esc = (v) => {
    const t = v == null ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = rows.map((s) => [
    s.code, s.name, s.type === "main" ? "Main" : "Sub", s.parent ? nameOf(s.parent) : "",
    s.status, clean(s.district), clean(s.address), clean(s.contact), clean(s.commander),
    s.personnel, s.teamsList.length, s.trucksList.length, trucksReady(s), s.latitude ?? "", s.longitude ?? "",
  ].map(esc).join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `stations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StationsPage({ onShowOnMap, initialStationId = null }) {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState(() => initialStationId == null ? null : stationKey(initialStationId));
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const { width: listWidth, handleProps: resizeHandle } = useSplitPane({
    storageKey: "stations.listWidth", side: "left", initial: 340, min: 260, minMain: 480,
  });

  const loadStations = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const [data, personnel, teams, trucks] = await Promise.all([fetchStations(), fetchPersonnel(), fetchTeams(), fetchTrucks()]);
      const mapped = data.map(dbToStation);
      const byNum = new Map(mapped.map((s) => [s.numericId, s]));

      mapped.forEach((s) => {
        if (s.type === "sub" && s.parent) {
          const parentStation = mapped.find((x) => x.id === s.parent);
          if (parentStation) parentStation.subs.push(s.id);
        }
      });
      teams.forEach((t) => {
        byNum.get(t.station_id)?.teamsList.push({
          team_id: t.team_id,
          name: t.team_name,
          code: t.team_code,
          shift: clean(t.shift_name),
          status: t.team_status,
          members: t.member_count,
        });
      });
      trucks.forEach((t) => {
        byNum.get(t.station_id)?.trucksList.push({
          truck_id: t.truck_id,
          plate: t.truck_platenum,
          status: t.truck_status,
        });
      });
      personnel.forEach((p) => {
        const station = byNum.get(p.station_id);
        if (!station) return;
        const first = (p.name || "").split(" ")[0] || "";
        const last = (p.name || "").split(" ").slice(1).join(" ");
        station.personnelList.push({
          per_id: p.per_id,
          name: p.name,
          initials: ((first[0] || "") + (last[0] || "")).toUpperCase() || "??",
          rank: p.rank,
          status: p.status,
        });
        station.personnel = station.personnelList.length;
      });

      setStations(mapped);
      setSelectedId((cur) => (cur && mapped.some((s) => s.id === cur) ? cur : mapped[0]?.id ?? null));
    } catch (ex) {
      setFetchError(ex.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStations();
  }, [loadStations]);

  async function handleAddStation(body) {
    await createStation(body);
    await loadStations();
  }

  const stats = useMemo(() => {
    const trucks = stations.flatMap((s) => s.trucksList);
    return {
      total: stations.length,
      main: stations.filter((s) => s.type === "main").length,
      sub: stations.filter((s) => s.type === "sub").length,
      operational: stations.filter((s) => s.status !== "inactive").length,
      personnel: stations.reduce((acc, s) => acc + s.personnel, 0),
      trucks: trucks.length,
      trucksReady: trucks.filter((t) => t.status === "available").length,
    };
  }, [stations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stations.filter((s) => {
      const mq = !q || [s.name, s.code, s.district, s.commander, s.address]
        .some((v) => (v || "").toLowerCase().includes(q));
      const ms = !statusFilter || s.status === statusFilter;
      const mt = activeTab === "all" || s.type === activeTab;
      return mq && ms && mt;
    });
  }, [stations, search, statusFilter, activeTab]);

  const selected = stations.find((s) => s.id === selectedId) || null;
  // Nesting only makes sense when both kinds are listed and nothing is being searched.
  const flat = activeTab !== "all" || search.trim() !== "";

  async function confirmDelete() {
    await deleteStation(deleting.numericId);
    if (selectedId === deleting.id) setSelectedId(null);
    await loadStations();
  }

  return (
    <div className="sta-page">
      {/* PAGE HEADER */}
      <div className="sta-header">
        <div className="sta-title-row">
          <div className="sta-title">
            Stations
            <UnfoldIcon />
          </div>
          <div className="sta-header-actions">
            <button className="sta-btn-secondary table-export-btn" onClick={() => exportCsv(filtered, stations)} disabled={filtered.length === 0}>
              <ExportIcon />
              Export
            </button>
            <button className="sta-btn-primary" onClick={() => setShowAddModal(true)}>
              <AddIcon />
              Add Station
            </button>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="sta-body">
        <div className="sta-section-row">
          <div className="sta-section-label">Overview</div>
          <div className="sta-status-tabs">
            {TABS.map((t) => (
              <button
                key={t}
                className={`sta-status-tab${activeTab === t ? " active" : ""}`}
                onClick={() => setActiveTab(t)}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="kpi-row sta-stat-row">
          {[
            { key: "total", accent: "fire", icon: "apartment", label: "Stations", value: stats.total, sub: `${stats.main} main · ${stats.sub} sub` },
            { key: "ops", accent: "green", icon: "check_circle", label: "Operational", value: stats.operational, sub: stats.total - stats.operational ? `${stats.total - stats.operational} inactive` : "All in service" },
            { key: "personnel", accent: "amber", icon: "groups", label: "Personnel", value: stats.personnel, sub: "Across all stations" },
            { key: "trucks", accent: "fire", icon: "fire_truck", label: "Trucks ready", value: `${stats.trucksReady}/${stats.trucks}`, sub: "Available to dispatch" },
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
      <div className="sta-toolbar">
        <div className="sta-search-wrap">
          <span className="sta-search-icon"><Sym name="search" /></span>
          <input
            type="text"
            placeholder="Search name, code, barangay, commander…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="sta-filter-select"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="operational">Operational</option>
          <option value="inactive">Inactive</option>
        </select>
        <span className="sta-result-count">
          {filtered.length} of {stations.length} station{stations.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* CONTENT AREA */}
      <div className="sta-content">
        <div className="sta-list" style={{ width: listWidth }}>
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`sta-row sta-row-skel${i % 3 ? " nested" : ""}`}>
                <span className="sta-skel sta-skel-icon" />
                <span className="sta-row-text">
                  <span className="sta-skel sta-skel-line" />
                  <span className="sta-skel sta-skel-line short" />
                </span>
              </div>
            ))
          ) : fetchError ? (
            <div className="sta-list-state error">
              <Sym name="error" />
              <span>{fetchError}</span>
              <button type="button" className="sta-link" onClick={loadStations}>Try again</button>
            </div>
          ) : stations.length === 0 ? (
            <div className="sta-list-state">
              <Sym name="apartment" />
              <span>No stations yet.</span>
              <button type="button" className="sta-link" onClick={() => setShowAddModal(true)}>Add the first station</button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="sta-list-state">
              <Sym name="search_off" />
              <span>No stations match these filters.</span>
              <button type="button" className="sta-link" onClick={() => { setSearch(""); setStatusFilter(""); setActiveTab("all"); }}>
                Clear filters
              </button>
            </div>
          ) : (
            <StationTree list={filtered} stations={stations} selectedId={selectedId} onSelect={setSelectedId} flat={flat} />
          )}
        </div>

        <div className="split-resizer" {...resizeHandle} />

        <div className="sta-detail">
          <StationDetail
            s={selected}
            stations={stations}
            onSelectStation={setSelectedId}
            onEdit={() => setShowEditModal(true)}
            onDelete={() => setDeleting(selected)}
            onViewOnMap={() => onShowOnMap?.(selected)}
          />
        </div>
      </div>

      {showAddModal && (
        <AddStationModal
          onClose={() => setShowAddModal(false)}
          onAdd={handleAddStation}
          stations={stations}
        />
      )}

      {showEditModal && selected && (
        <EditStationModal
          station={selected}
          stations={stations}
          onClose={() => setShowEditModal(false)}
          onSaved={loadStations}
        />
      )}

      {deleting && (
        <ConfirmModal
          eyebrow="DELETE STATION"
          title={`Delete ${deleting.name}?`}
          details={[
            { label: "Station", value: `${deleting.code} · ${deleting.type === "main" ? "Main" : "Sub-station"}` },
            { label: "Barangay", value: clean(deleting.district) },
            { label: "Assigned", value: `${deleting.personnel} personnel · ${deleting.teamsList.length} teams · ${deleting.trucksList.length} trucks` },
          ]}
          message="Personnel, teams and trucks assigned to it must be moved first. This can't be undone."
          confirmLabel="Delete station"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
