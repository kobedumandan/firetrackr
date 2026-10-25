import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/PlanningPage.css";
import { MAP_CENTER, MAP_ZOOM, tileLayersFor } from "../data/mapConfig";
import { useTheme } from "../hooks/useTheme";
import KpiCard, { KPI_EMPTY } from "../components/KpiCard";
import CsvReviewModal from "../components/CsvReviewModal";
import AnalysisIcon from "../components/AnalysisIcon";
import {
  fetchCoverageIsochrones,
  fetchCoverageGaps,
  fetchBarangays,
  fetchStations,
} from "../api";

/* Status palette. Deliberately literal rather than themed: these exact hues are
   the ones `coverage_engine.BAND_COLORS` bakes into the isochrone GeoJSON, so
   the table, the choropleth and the map bands must agree on them. Changing a
   status colour means changing it in both places. */
const STATUS = {
  covered: { color: "#22c55e", rgb: "34, 197, 94", label: "Covered" },
  partial: { color: "#f59e0b", rgb: "245, 158, 11", label: "Partial" },
  gap: { color: "#ef4444", rgb: "239, 68, 68", label: "Gap" },
};
const MINUTE_OPTIONS = [3, 5, 8];
// Severity order for the Status column: worst (gap) first when ascending.
const STATUS_ORDER = { gap: 0, partial: 1, covered: 2 };
const FILTERS = [
  { key: "all", label: "All" },
  { key: "gap", label: "Gaps" },
  { key: "partial", label: "Partial" },
  { key: "covered", label: "Covered" },
];

const statusOf = (s) => STATUS[s] || { color: "var(--text-secondary)", rgb: "96, 97, 96", label: s };
// Barangay names arrive from two sources (the routing GeoJSON's `adm4_en` and
// the database's `brgy_name`); normalise before joining them.
const normName = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const fmtInt = (n) => (n == null ? null : Number(n).toLocaleString());

// Clickable, sort-aware table header cell (styled like the Incidents table).
function SortableTh({ label, sortKey, sort, onSort, align }) {
  const active = sort.key === sortKey;
  const arrow = !active ? "↕" : sort.dir === "asc" ? "↑" : "↓";
  return (
    <th
      className={`${active ? "sort-active" : ""}${align ? ` th-${align}` : ""}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button type="button" onClick={() => onSort(sortKey)} aria-label={`Sort by ${label.toLowerCase()}`}>
        {label} <span className="plan-sort-arrow" aria-hidden="true">{arrow}</span>
      </button>
    </th>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────
function ExportIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="plan-btn-icon"
      fill="currentColor"
    >
      <path d="M480-320 280-520l56-58 104 104v-286h80v286l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z" />
    </svg>
  );
}
function RefreshIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="plan-btn-icon"
      fill="currentColor"
    >
      <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="plan-search-icon">
      <path d="M784-120 532-372q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-580q0-109 75.5-184.5T380-840q109 0 184.5 75.5T640-580q0 44-14 83t-38 69l252 252-56 56ZM380-400q75 0 127.5-52.5T560-580q0-75-52.5-127.5T380-760q-75 0-127.5 52.5T200-580q0 75 52.5 127.5T380-400Z" />
    </svg>
  );
}
function LayersIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="plan-toggle-icon">
      <path d="M480-160 160-408l66-50 254 196 254-196 66 50-320 248Zm0-202L160-610l320-248 320 248-320 248Zm0-101 189-147-189-147-189 147 189 147Zm0-147Z" />
    </svg>
  );
}
function TargetKpiIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="plan-kpi-icon-svg">
      <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-160q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-160Z" />
    </svg>
  );
}
function CheckKpiIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="plan-kpi-icon-svg">
      <path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170ZM480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" />
    </svg>
  );
}
function AlertKpiIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="plan-kpi-icon-svg">
      <path d="M109-120q-11 0-20-5.5T75-140q-5-9-5.5-19.5T75-180l370-640q6-10 15.5-15t19.5-5q10 0 19.5 5t15.5 15l370 640q6 10 5.5 20.5T885-140q-5 9-14 14.5t-20 5.5H109Zm371-120q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm0-120q17 0 28.5-11.5T520-400v-120q0-17-11.5-28.5T480-560q-17 0-28.5 11.5T440-520v120q0 17 11.5 28.5T480-360Z" />
    </svg>
  );
}
function PeopleKpiIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="plan-kpi-icon-svg">
      <path d="M0-240v-63q0-43 44-70t116-27q13 0 25 .5t23 2.5q-14 21-21 44t-7 48v65H0Zm240 0v-65q0-32 17.5-58.5T307-410q32-20 76.5-30t96.5-10q53 0 97.5 10t76.5 30q32 20 49 46.5t17 58.5v65H240Zm540 0v-65q0-26-6.5-49T754-397q11-2 22.5-2.5t23.5-.5q72 0 116 26.5t44 70.5v63H780Zm-455-80h311q-10-20-55.5-35T480-370q-55 0-100 15t-55 35Zm-165-130q-33 0-56.5-23.5T80-530q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T160-450Zm640 0q-33 0-56.5-23.5T720-530q0-34 23.5-57t56.5-23q34 0 57 23t23 57q0 33-23 56.5T800-450Zm-320-40q-50 0-85-35t-35-85q0-51 35-85.5t85-34.5q51 0 85.5 34.5T600-610q0 50-34.5 85T480-490Z" />
    </svg>
  );
}

// Provenance strip icons — small enough to read as bullets, not as buttons.
function StationProvIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="plan-prov-icon">
      <path d="M160-160v-400H39l441-320 440 320H800v400H600v-260H360v260H160Z" />
    </svg>
  );
}
function NodesProvIcon() {
  // Three linked nodes — drawn from primitives rather than a glyph path so it
  // stays crisp at 11px and reads as a graph, not a generic dot cluster.
  return (
    <svg viewBox="0 0 24 24" className="plan-prov-icon" aria-hidden="true">
      <path
        d="M6 17 12 7l6 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="6" r="3" fill="currentColor" />
      <circle cx="5" cy="18" r="3" fill="currentColor" />
      <circle cx="19" cy="18" r="3" fill="currentColor" />
    </svg>
  );
}
function BandsProvIcon() {
  // Concentric rings: the literal shape of a nested isochrone band set.
  return (
    <svg viewBox="0 0 24 24" className="plan-prov-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <circle cx="12" cy="12" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.55"
      />
    </svg>
  );
}
function SpeedProvIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="plan-prov-icon">
      <path d="m422-232 207-248H469l29-227-185 267h139l-30 208ZM320-80l40-280H160l360-520h80l-40 320h240L400-80h-80Z" />
    </svg>
  );
}

// Reachability bands, widest painted first so tighter (faster) bands read on top.
function CoverageIsochroneLayer({ features }) {
  const sorted = [...features].sort(
    (a, b) => (b.properties?.max_seconds || 0) - (a.properties?.max_seconds || 0)
  );
  return (
    <>
      {sorted.map((f, i) => {
        const color = f.properties?.color || STATUS.covered.color;
        return (
          <GeoJSON
            key={`iso-${f.properties?.max_seconds ?? i}`}
            data={f}
            style={{
              color,
              weight: 1,
              opacity: 0.55,
              fillColor: color,
              fillOpacity: 0.2,
            }}
          />
        );
      })}
    </>
  );
}

/* Barangay boundaries tinted by their coverage status, so the gaps read as
   administrative units a planner can actually act on rather than as the holes
   between road corridors. Selecting one here drives the table, and vice versa. */
function BarangayChoroplethLayer({ featureCollection, gapByName, selected, onSelect }) {
  const style = useCallback(
    (feature) => {
      const name = feature.properties?.brgy_name;
      const row = gapByName.get(normName(name));
      const isSel = selected && normName(selected) === normName(name);
      if (!row) {
        return {
          color: "#94a3b8",
          weight: isSel ? 2.5 : 0.8,
          opacity: isSel ? 0.9 : 0.35,
          fillOpacity: 0,
        };
      }
      const { color } = statusOf(row.status);
      return {
        color,
        weight: isSel ? 2.5 : 1,
        opacity: isSel ? 1 : 0.5,
        fillColor: color,
        fillOpacity: isSel ? 0.3 : 0.1,
      };
    },
    [gapByName, selected]
  );

  const onEachFeature = useCallback(
    (feature, layer) => {
      const name = feature.properties?.brgy_name;
      const row = gapByName.get(normName(name));
      layer.bindTooltip(
        row ? `${name} — ${row.covered_pct}% (${statusOf(row.status).label})` : String(name || ""),
        { sticky: true, className: "plan-map-tip" }
      );
      layer.on("click", () => onSelect(name));
    },
    [gapByName, onSelect]
  );

  return (
    <GeoJSON
      // Re-keyed on the selection so Leaflet re-runs `style` for the highlight.
      key={`brgy-${gapByName.size}-${selected || "none"}`}
      data={featureCollection}
      style={style}
      onEachFeature={onEachFeature}
    />
  );
}

// Fit the map to the coverage extent once it loads.
function FitBounds({ geojson }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer?.();
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(container);
    return () => observer.disconnect();
  }, [map]);
  useEffect(() => {
    if (!geojson?.features?.length) return;
    const bounds = L.geoJSON(geojson).getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24], animate: false });
  }, [geojson, map]);
  return null;
}

// Zoom to the selected barangay when the selection comes from the table.
function FlyToSelection({ featureCollection, selected }) {
  const map = useMap();
  useEffect(() => {
    if (!selected || !featureCollection?.features?.length) return;
    const feat = featureCollection.features.find(
      (f) => normName(f.properties?.brgy_name) === normName(selected)
    );
    if (!feat) return;
    const bounds = L.geoJSON(feat).getBounds();
    if (bounds.isValid()) map.flyToBounds(bounds, { padding: [48, 48], duration: 0.6 });
  }, [selected, featureCollection, map]);
  return null;
}

export default function PlanningPage() {
  const [iso, setIso] = useState(null);
  const [minutes, setMinutes] = useState(5);
  const [gapResult, setGapResult] = useState(null);
  const [gapRetry, setGapRetry] = useState(0);
  const [barangays, setBarangays] = useState(null);
  const [stations, setStations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState(null);
  const [showBarangays, setShowBarangays] = useState(false);
  const [csvReview, setCsvReview] = useState(null);
  // Best-covered first, so the list reads covered → partial → gap top to bottom.
  const [sort, setSort] = useState({ key: "covered_pct", dir: "desc" });
  // Picks the basemap out of TILE_OPTIONS; re-renders the layer on a flip.
  const theme = useTheme();
  const rowRefs = useRef({});
  const gapKey = `${minutes}:${refreshing}:${gapRetry}`;
  const gaps = gapResult?.key === gapKey ? gapResult.rows : null;
  const gapError = gapResult?.key === gapKey ? gapResult.error : null;

  const loadCoverage = useCallback((refresh = false) => {
    // Isochrones must resolve first on a refresh: that request is what forces
    // the backend recompute, and the gaps endpoint then reads the fresh cache.
    return fetchCoverageIsochrones({ refresh })
      .then((d) => {
        setIso(d);
        setError(null);
        setLoading(false);
      })
      .catch((e) => {
        setError(e?.message || "Failed to load coverage.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadCoverage(false);
  }, [loadCoverage]);

  useEffect(() => {
    // Keep the selected band and its rows together; ignore superseded replies.
    if (refreshing) return;
    let alive = true;
    fetchCoverageGaps(minutes)
      .then((r) => { if (alive) setGapResult({ key: gapKey, rows: r?.gaps || [] }); })
      .catch((e) => { if (alive) setGapResult({ key: gapKey, error: e?.message || "Could not load barangay coverage." }); });
    return () => { alive = false; };
  }, [minutes, refreshing, gapRetry, gapKey]);

  useEffect(() => {
    fetchBarangays()
      .then(setBarangays)
      .catch(() => setBarangays(null));
    fetchStations()
      .then(setStations)
      .catch(() => setStations(null));
  }, []);

  async function handleRefresh() {
    if (refreshing) return;
    setGapRetry((revision) => revision + 1);
    setRefreshing(true);
    setLoading(true);
    await loadCoverage(true);
    // Flipping `refreshing` back re-runs the gaps effect against fresh data.
    setRefreshing(false);
  }

  // `gaps` is null until the first (or a refetched) band resolves.
  const gapsLoading = gaps === null && !gapError;
  const meta = iso?.meta || {};
  const features = useMemo(() => iso?.isochrones?.features || [], [iso]);
  const bands = useMemo(
    () =>
      [...features].sort(
        (a, b) => (a.properties?.max_seconds || 0) - (b.properties?.max_seconds || 0)
      ),
    [features]
  );

  // Population per barangay, joined by name from the boundaries table. The
  // coverage engine only knows area, so this is what turns "38% of the polygon
  // is reachable" into "roughly this many residents sit outside the band".
  const popByName = useMemo(() => {
    const m = new Map();
    for (const f of barangays?.features || []) {
      const p = f.properties || {};
      if (p.brgy_estpopulation != null) m.set(normName(p.brgy_name), p.brgy_estpopulation);
    }
    return m;
  }, [barangays]);

  const rows = useMemo(() => {
    if (!gaps) return null;
    return gaps.map((g) => {
      const population = popByName.get(normName(g.barangay)) ?? null;
      return {
        ...g,
        population,
        // Residents in the un-reachable share of the barangay. An area-weighted
        // estimate — it assumes people are spread evenly, which is rough but
        // ranks priorities far better than area alone.
        exposed: population == null ? null : Math.round(population * (1 - g.covered_pct / 100)),
      };
    });
  }, [gaps, popByName]);

  const gapByName = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) m.set(normName(r.barangay), r);
    return m;
  }, [rows]);

  const summary = useMemo(() => {
    if (!rows?.length) return null;
    const n = rows.length;
    const covered = rows.filter((g) => g.status === "covered").length;
    const gapRows = rows.filter((g) => g.status === "gap");
    const avg = rows.reduce((s, g) => s + g.covered_pct, 0) / n;
    const withPop = rows.filter((g) => g.exposed != null);
    return {
      n,
      covered,
      gapCount: gapRows.length,
      avg: Math.round(avg * 10) / 10,
      gapPopulation: gapRows.reduce((s, g) => s + (g.population || 0), 0),
      exposed: withPop.length ? withPop.reduce((s, g) => s + g.exposed, 0) : null,
      popCoverage: withPop.length,
    };
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (!rows) return rows;
    const q = normName(query);
    const filtered = rows.filter(
      (g) =>
        (filter === "all" || g.status === filter) &&
        (!q || normName(g.barangay).includes(q))
    );
    const { key, dir } = sort;
    const factor = dir === "asc" ? 1 : -1;
    return filtered.sort((a, b) => {
      let cmp;
      if (key === "barangay") {
        cmp = a.barangay.localeCompare(b.barangay);
      } else if (key === "status") {
        cmp = (STATUS_ORDER[a.status] ?? 0) - (STATUS_ORDER[b.status] ?? 0);
      } else if (key === "exposed") {
        cmp = (a.exposed ?? -1) - (b.exposed ?? -1);
      } else {
        cmp = a.covered_pct - b.covered_pct;
      }
      // Stable tie-break by name so equal values keep a consistent order.
      return cmp !== 0 ? cmp * factor : a.barangay.localeCompare(b.barangay);
    });
  }, [rows, sort, query, filter]);

  function toggleSort(key) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }
    );
  }

  // Selecting from the map scrolls the matching row into view.
  const selectBarangay = useCallback((name) => {
    setSelected((cur) => (normName(cur) === normName(name) ? null : name));
    setShowBarangays(true);
  }, []);

  useEffect(() => {
    if (!selected) return;
    rowRefs.current[normName(selected)]?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [selected]);

  function exportCsv() {
    if (!visibleRows?.length) return;
    const header = [
      "Barangay",
      `Coverage % within ${minutes} min`,
      "Status",
      "Est. population",
      "Est. residents outside band",
    ].join(",");
    const lines = visibleRows.map((g) =>
      [
        `"${g.barangay.replaceAll('"', '""')}"`,
        g.covered_pct,
        statusOf(g.status).label,
        g.population ?? "",
        g.exposed ?? "",
      ].join(",")
    );
    const csv = [header, ...lines].join("\n");
    setCsvReview({ csv, fileName: `coverage_gaps_${minutes}min.csv` });
  }

  const stationCount = meta.sources ?? (Array.isArray(stations) ? stations.length : null);

  return (
    <main className="plan-page" aria-busy={loading || gapsLoading}>
      {csvReview && <CsvReviewModal csv={csvReview.csv} fileName={csvReview.fileName} title="Coverage Planning CSV" onClose={() => setCsvReview(null)} />}
      <div className="plan-body">
        <div className="plan-workspace">
        <header className="plan-view-heading">
          <div><span className="plan-eyebrow">Station reachability</span><h1>Coverage Planning</h1><p>Explore station reachability and identify barangays with coverage gaps.</p></div>
          <div className="plan-header-actions">
            <button
              className="plan-btn"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              title="Recompute coverage from the current stations and road constraints"
            >
              <span className={refreshing ? "plan-spin-icon" : undefined}>
                <RefreshIcon />
              </span>
              {refreshing ? "Recomputing…" : "Recompute"}
            </button>
            <button className="plan-btn is-primary" onClick={exportCsv} disabled={!visibleRows?.length}>
              <ExportIcon />
              Export CSV
            </button>
          </div>
        </header>
        {error && <div className="plan-error" role="alert"><AnalysisIcon name="info" /><div><strong>Could not load coverage</strong><p>{error}</p></div><button className="plan-btn" disabled={refreshing} onClick={handleRefresh}>Retry</button></div>}

        <section className="plan-controls" aria-label="Coverage settings">
        <div className="plan-section-row">
          <div className="plan-control-copy"><span className="plan-control-icon"><AnalysisIcon name="coverage" /></span><div><h2>Response-time budget</h2><p>Compare barangay coverage at a selected road travel time.</p></div></div>
          {/* The band drives the KPIs, the gaps table and the CSV export, so it
              sits with them rather than in the page header. */}
          <div className="plan-seg" role="group" aria-label="Response-time band">
            {MINUTE_OPTIONS.map((m) => (
              <button
                key={m}
                className={`plan-seg-btn${minutes === m ? " active" : ""}`}
                onClick={() => setMinutes(m)}
                aria-pressed={minutes === m}
              >
                {m} min
              </button>
            ))}
          </div>
        </div>
        <div className="plan-controls-footer"><span><AnalysisIcon name="info" />The selected budget applies to the summary, table and CSV. The map shows all three bands.</span><span>{stationCount == null ? "Loading stations…" : `${stationCount} station${stationCount === 1 ? '' : 's'}`} · Current road network</span></div>
        </section>

        <div className="kpi-row plan-kpi-row">
          <KpiCard
            icon={<TargetKpiIcon />}
            label="Mean barangay coverage"
            value={summary ? `${summary.avg}%` : KPI_EMPTY}
            sub={`Within ${minutes} min · ${summary?.n ?? "—"} barangays`}
            accent="amber"
            loading={gapsLoading}
          />
          <KpiCard
            icon={<CheckKpiIcon />}
            label="Well-covered barangays"
            value={summary ? `${summary.covered}/${summary.n}` : KPI_EMPTY}
            sub="≥ 80% reachable in time"
            accent="green"
            loading={gapsLoading}
          />
          <KpiCard
            icon={<AlertKpiIcon />}
            label="Coverage gaps"
            value={summary ? summary.gapCount : KPI_EMPTY}
            sub="Less than 40% of the area reachable"
            accent="fire"
            loading={gapsLoading}
          />
          <KpiCard
            icon={<PeopleKpiIcon />}
            label="Residents outside the band"
            value={summary?.exposed != null ? fmtInt(summary.exposed) : KPI_EMPTY}
            sub={
              summary?.exposed != null
                ? `Area-weighted, ${summary.popCoverage}/${summary.n} barangays have population data`
                : "No barangay population data"
            }
            accent="blue"
            loading={gapsLoading}
          />
        </div>

        <div className="plan-grid">
          {/* Coverage map */}
          <div className="plan-card plan-map-card">
            <div className="plan-card-head">
              <div><h2 className="plan-card-title">Station reachability map</h2><p className="plan-card-description">Estimated 3, 5 and 8 minute road travel areas.</p></div>
              <div className="plan-head-right">
                <div className="plan-map-legend">
                  {bands.map((f) => (
                    <span key={f.properties?.max_seconds} className="plan-legend-item">
                      <span
                        className="plan-legend-swatch"
                        style={{ background: f.properties?.color }}
                      />
                      {f.properties?.label}
                    </span>
                  ))}
                </div>
                <button
                  className={`plan-toggle${showBarangays ? " active" : ""}`}
                  onClick={() => setShowBarangays((v) => !v)}
                  aria-pressed={showBarangays}
                  aria-label="Barangays"
                  data-label="Tint barangays by coverage status"
                >
                  <LayersIcon />
                  <span>Barangay status</span>
                </button>
              </div>
            </div>
            <div className="plan-map-wrap">
              {loading ? (
                <div className="plan-map-loading">
                  <span className="plan-spinner" />
                  <span className="plan-map-loading-text">{refreshing ? "Recomputing coverage…" : "Loading station reachability…"}</span>
                </div>
              ) : (
                <MapContainer
                  center={MAP_CENTER}
                  zoom={MAP_ZOOM}
                  className="plan-map"
                  zoomAnimation={false}
                  attributionControl={false}
                  scrollWheelZoom
                >
                  {tileLayersFor(theme === "light" ? "street" : "dark").map((layer, i) => (
                    <TileLayer key={`${theme}-${i}`} {...layer} />
                  ))}
                  {features.length > 0 && <CoverageIsochroneLayer features={features} />}
                  {showBarangays && barangays?.features?.length > 0 && (
                    <BarangayChoroplethLayer
                      featureCollection={barangays}
                      gapByName={gapByName}
                      selected={selected}
                      onSelect={selectBarangay}
                    />
                  )}
                  <FitBounds geojson={iso?.isochrones} />
                  <FlyToSelection featureCollection={barangays} selected={selected} />
                </MapContainer>
              )}
            </div>
            {/* Provenance: a planning figure is only as trustworthy as the run
                that produced it, so say what the run was made of. */}
            <div className="plan-provenance">
              <span>
                <StationProvIcon />
                Stations <b>{stationCount ?? "—"}</b>
              </span>
              <span className="plan-dot-sep" />
              <span>
                <BandsProvIcon />
                Bands <b>{(meta.bands_min || MINUTE_OPTIONS).join(" / ")}</b> min
              </span>
              <span className="plan-map-hint">Select a barangay to inspect its coverage.</span>
            </div>
          </div>

          {/* Coverage gaps table */}
          <div className="plan-card plan-gaps-card">
            <div className="plan-card-head">
              <div><div className="plan-table-title"><h2 className="plan-card-title">Barangay coverage</h2><span className="plan-count">{gapsLoading ? "Loading…" : `${visibleRows?.length || 0} / ${rows?.length || 0}`}</span></div><p className="plan-card-description">Area reachable within {minutes} minutes · select a row to locate it.</p></div>
            </div>
            <div className="plan-table-toolbar">
              <div className="plan-filters">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    className={`plan-chip${filter === f.key ? " active" : ""}${
                      f.key !== "all" ? ` plan-chip-${f.key}` : ""
                    }`}
                    onClick={() => setFilter(f.key)}
                    aria-pressed={filter === f.key}
                  >
                    {f.label}
                    {f.key !== "all" && rows && (
                      <span className="plan-chip-count">
                        {rows.filter((g) => g.status === f.key).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

            <div className="plan-gaps-sub">
              <label className="plan-search">
                <SearchIcon />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search barangay…"
                  aria-label="Search barangay"
                />
                {query && (
                  <button className="plan-search-clear" onClick={() => setQuery("")} aria-label="Clear barangay search">
                    ×
                  </button>
                )}
              </label>
            </div>
            </div>

            {gapError && <div className="plan-error" role="alert"><AnalysisIcon name="info" /><div><strong>Could not load barangay coverage</strong><p>{gapError}</p></div><button className="plan-btn" onClick={() => setGapRetry(n => n + 1)}>Retry barangays</button></div>}

            <div className="plan-table-wrap">
              <table className="plan-table">
                <thead>
                  <tr>
                    <SortableTh
                      label="Barangay"
                      sortKey="barangay"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableTh
                      label="Coverage"
                      sortKey="covered_pct"
                      sort={sort}
                      onSort={toggleSort}
                    />
                    <SortableTh
                      label="Residents outside"
                      sortKey="exposed"
                      sort={sort}
                      onSort={toggleSort}
                      align="right"
                    />
                    <SortableTh label="Status" sortKey="status" sort={sort} onSort={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {gapsLoading
                    ? Array.from({ length: 9 }).map((_, i) => (
                        <tr key={`sk-${i}`}>
                          <td className="plan-td-name">
                            <span className="plan-sk" style={{ width: 88, height: 11 }} />
                          </td>
                          <td className="plan-td-pct">
                            <span
                              className="plan-sk"
                              style={{ flex: 1, height: 6, borderRadius: 3 }}
                            />
                            <span className="plan-sk" style={{ width: 30, height: 11 }} />
                          </td>
                          <td className="plan-td-num">
                            <span className="plan-sk" style={{ width: 42, height: 11 }} />
                          </td>
                          <td>
                            <span className="plan-sk" style={{ width: 58, height: 11 }} />
                          </td>
                        </tr>
                      ))
                    : (visibleRows || []).map((g) => {
                        const st = statusOf(g.status);
                        const isSel = selected && normName(selected) === normName(g.barangay);
                        return (
                          <tr
                            key={g.barangay}
                            ref={(el) => {
                              rowRefs.current[normName(g.barangay)] = el;
                            }}
                            className={`plan-row${isSel ? " selected" : ""}`}
                            onClick={() => selectBarangay(g.barangay)}
                          >
                            <td className="plan-td-name"><button className="plan-barangay-link" aria-pressed={!!isSel} onClick={(e) => { e.stopPropagation(); selectBarangay(g.barangay); }}>{g.barangay}<AnalysisIcon name="chevron" /></button></td>
                            <td className="plan-td-pct">
                              <div className="plan-coverage-cell">
                              <div className="plan-bar">
                                <div
                                  className="plan-bar-fill"
                                  style={{
                                    width: `${g.covered_pct}%`,
                                    background: st.color,
                                  }}
                                />
                              </div>
                              <span className="plan-pct-num">{g.covered_pct}%</span>
                              </div>
                            </td>
                            <td className="plan-td-num" title="Estimated residents outside the band">
                              {g.exposed == null ? "—" : fmtInt(g.exposed)}
                            </td>
                            <td>
                              <span
                                className="plan-status"
                                style={{
                                  color: st.color,
                                  background: `rgba(${st.rgb}, 0.12)`,
                                }}
                              >
                                {st.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                  {!gapsLoading && !gapError && visibleRows && visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="plan-empty">
                        {rows?.length
                          ? "No barangay matches this filter."
                          : "No barangay coverage data available."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="plan-table-footer"><span>{gapsLoading ? "Loading measurements" : `${visibleRows?.length || 0} barangays shown`} · {minutes} minute budget</span>{selected ? <button className="plan-clear-selection" onClick={() => setSelected(null)}>Clear {selected}<span aria-hidden="true">×</span></button> : <span>Population estimates use area share</span>}</div>
          </div>
        </div>
        <details className="plan-method"><summary><AnalysisIcon name="info" />How to read this coverage<AnalysisIcon name="chevron" /></summary><div><p>Coverage estimates road travel from the current stations. It does not include report processing, preparation or measured live traffic. This is a planning estimate rather than a guaranteed response time.</p><p>Covered means at least 80% of a barangay's area is reachable within the selected budget; partial means 40% to below 80%; a gap means below 40%. Mean coverage gives each barangay equal weight. Residents outside the band are estimated from uncovered area, assuming population is evenly distributed; missing population stays unavailable.</p><div className="plan-method-source"><span><NodesProvIcon />Reachable road nodes: {fmtInt(meta.reachable_nodes) ?? "—"}</span><span><SpeedProvIcon />Computation: {meta.generated_ms != null ? `${meta.generated_ms} ms` : "Not recorded"}</span></div></div></details>
        </div>
      </div>
    </main>
  );
}
