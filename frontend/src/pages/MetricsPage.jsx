import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/MetricsPage.css";
import { fetchMetricsSummary, fetchBarangays } from "../api";
import KpiCard, { KPI_EMPTY } from "../components/KpiCard";
import { useTheme } from "../hooks/useTheme";
import { MAP_CENTER, tileLayersFor } from "../data/mapConfig";

function readCssVar(name, fallback) {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

// 4-tier choropleth colour scale (low → high): blue, green, amber, fire.
const BUCKET_COLOR_VARS = [
  { varName: "--accent-blue", fallback: "#3b82f6" },
  { varName: "--accent-green", fallback: "#22c55e" },
  { varName: "--accent-amber", fallback: "#f59e0b" },
  { varName: "--accent-fire", fallback: "#ef4444" },
];

// Build 4 count buckets scaled to the data. Real per-barangay counts are far
// smaller than the old example values, so thresholds must adapt to the max.
function buildBuckets(maxCount) {
  const m = Math.max(maxCount, 4);
  const t1 = Math.max(1, Math.round(m * 0.25));
  const t2 = Math.max(t1 + 1, Math.round(m * 0.5));
  const t3 = Math.max(t2 + 1, Math.round(m * 0.75));
  return [
    { max: t1, label: `0–${t1}` },
    { max: t2, label: `${t1 + 1}–${t2}` },
    { max: t3, label: `${t2 + 1}–${t3}` },
    { max: Infinity, label: `${t3 + 1}+` },
  ];
}

function bucketIndexFor(value, buckets) {
  for (let i = 0; i < buckets.length; i++) {
    if (value <= buckets[i].max) return i;
  }
  return buckets.length - 1;
}

// Turn a percent delta from the API into a KpiCard trend, or undefined when
// there's no baseline to compare against.
function trendOf(delta) {
  if (delta == null || !Number.isFinite(delta)) return undefined;
  return {
    dir: delta >= 0 ? "up" : "down",
    text: `${Math.abs(delta)}% vs last period`,
  };
}

const PERIODS = [
  { key: "1d", label: "1d" },
  { key: "1w", label: "1w" },
  { key: "1m", label: "1m" },
  { key: "6m", label: "6m" },
  { key: "1y", label: "1y" },
  { key: "all", label: "All" },
];

const ALARM_COLORS = ["#ffad33", "#ff4d1a", "#dc3447", "#9b59b6", "#64748b"];

function FitBarangays({ bounds }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      if (bounds) map.fitBounds(bounds, { padding: [8, 8], maxZoom: 12, animate: false });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map, bounds]);
  return null;
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

function PhoneIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="kpi-icon-svg">
      <path d="M798-120q-125 0-247-54.5T329-329Q229-429 174.5-551T120-798q0-18 12-30t30-12h162q14 0 25 9.5t13 22.5l26 140q2 16-1 27t-11 19l-97 98q20 37 47.5 71.5T386-386q31 31 65 57.5t72 48.5l94-94q9-9 23.5-13.5T669-390l138 28q14 4 23.5 14.5T840-323v161q0 18-12 30t-30 12Z" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="kpi-icon-svg">
      <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm112-192 56-56-128-128v-184h-80v216l152 152Z" />
    </svg>
  );
}
function AlertIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="kpi-icon-svg">
      <path d="M109-120q-11 0-20-5.5T75-140q-5-9-5.5-19.5T75-180l370-640q6-10 15.5-15t19.5-5q10 0 19.5 5t15.5 15l370 640q6 10 5.5 20.5T885-140q-5 9-14 14.5t-20 5.5H109Zm371-120q17 0 28.5-11.5T520-280q0-17-11.5-28.5T480-320q-17 0-28.5 11.5T440-280q0 17 11.5 28.5T480-240Zm0-120q17 0 28.5-11.5T520-400v-120q0-17-11.5-28.5T480-560q-17 0-28.5 11.5T440-520v120q0 17 11.5 28.5T480-360Z" />
    </svg>
  );
}
function MapIcon() {
  return (
    <svg viewBox="0 -960 960 960" fill="currentColor" className="kpi-icon-svg">
      <path d="m600-120-240-84-186 72q-20 8-37-4.5T120-170v-560q0-13 7.5-23t20.5-15l186-72q11-4 21-4t21 4l240 84 186-72q20-8 37 4.5t17 33.5v560q0 13-7.5 23T828-192l-186 72q-11 4-21 4t-21-4Z" />
    </svg>
  );
}

function DonutChart({ data, total }) {
  if (!total) return <div className="m-empty">No incidents in this period</div>;
  const radius = 52;
  const stroke = 16.8;
  const gap = 3.2;
  const circ = 2 * Math.PI * radius;
  const outer = radius + stroke / 2;
  const labelR = outer + 12;
  const viewExtent = labelR + 16;
  const viewSize = viewExtent * 2;
  const labels = data.map((d, i) => {
    const frac = d.value / total;
    const cumulative = data.slice(0, i).reduce((sum, item) => sum + item.value / total, 0);
    const midFrac = cumulative + frac / 2;
    const angle = midFrac * 2 * Math.PI - Math.PI / 2;
    return {
      color: d.color,
      pct: ((d.value / total) * 100).toFixed(1),
      x: Math.cos(angle) * labelR,
      y: Math.sin(angle) * labelR,
    };
  });
  return (
    <svg
      viewBox={`${-viewExtent} ${-viewExtent} ${viewSize} ${viewSize}`}
      className="m-donut"
    >
      <g transform="rotate(-90)">
        {data.map((d, i) => {
          const slice = (d.value / total) * circ;
          const offset = data.slice(0, i).reduce((sum, item) => sum + item.value / total * circ, 0);
          const len = Math.max(slice - gap, 0);
          const seg = (
            <circle
              key={i}
              r={radius}
              cx="0"
              cy="0"
              fill="none"
              stroke={d.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${circ - len}`}
              strokeDashoffset={-offset}
            />
          );
          return seg;
        })}
      </g>
      {labels.map((l, i) => (
        <text
          key={i}
          x={l.x}
          y={l.y}
          textAnchor="middle"
          dominantBaseline="middle"
          className="m-donut-pct"
          fill={l.color}
        >
          {l.pct}%
        </text>
      ))}
    </svg>
  );
}

function LineChart({ points, labels, labelTicks, height = 180, width = 560 }) {
  if (!points.length) return <div className="m-empty">No monthly data</div>;
  const padL = 24,
    padR = 12,
    padT = 12,
    padB = 26;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const max = Math.max(...points, 1);
  const min = 0;
  const sx = (i) => padL + (i * w) / Math.max(points.length - 1, 1);
  const sy = (v) => padT + h - ((v - min) / (max - min || 1)) * h;

  // Smooth Catmull-Rom → cubic Bezier path
  const n = points.length;
  let path = `M${sx(0)},${sy(points[0])}`;
  for (let i = 0; i < n - 1; i++) {
    const i0 = Math.max(i - 1, 0);
    const i3 = Math.min(i + 2, n - 1);
    const x0 = sx(i0),
      y0 = sy(points[i0]);
    const x1 = sx(i),
      y1 = sy(points[i]);
    const x2 = sx(i + 1),
      y2 = sy(points[i + 1]);
    const x3 = sx(i3),
      y3 = sy(points[i3]);
    const cp1x = x1 + (x2 - x0) / 6;
    const cp1y = y1 + (y2 - y0) / 6;
    const cp2x = x2 - (x3 - x1) / 6;
    const cp2y = y2 - (y3 - y1) / 6;
    path += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${x2},${y2}`;
  }
  const area = `${path} L${sx(n - 1)},${padT + h} L${sx(0)},${padT + h} Z`;
  const gridY = [0, 0.25, 0.5, 0.75, 1].map((p) => padT + h * (1 - p));
  const gridX = points.map((_, i) => sx(i));
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="m-line"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="lineFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-fire)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent-fire)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="gridFade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#000" stopOpacity="0" />
          <stop offset="55%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="1" />
        </linearGradient>
        <mask id="gridMask" maskUnits="userSpaceOnUse">
          <rect x={padL} y={padT} width={w} height={h} fill="url(#gridFade)" />
        </mask>
      </defs>
      <g mask="url(#gridMask)">
        <rect
          x={padL}
          y={padT}
          width={w}
          height={h}
          className="m-line-grid-bg"
        />
        {gridY.map((y, i) => (
          <line
            key={`gy-${i}`}
            x1={padL}
            x2={width - padR}
            y1={y}
            y2={y}
            className="m-line-grid"
          />
        ))}
        {gridX.map((x, i) => (
          <line
            key={`gx-${i}`}
            x1={x}
            x2={x}
            y1={padT}
            y2={padT + h}
            className="m-line-grid"
          />
        ))}
      </g>
      {[0.25, 0.5, 0.75, 1].map((p, i) => (
        <text
          key={i}
          x={padL - 11}
          y={padT + h * (1 - p) + 3}
          textAnchor="end"
          className="m-line-ytick"
        >
          {Math.round(max * p)}
        </text>
      ))}
      <path d={area} fill="url(#lineFill)" />
      <path
        d={path}
        fill="none"
        stroke="var(--accent-fire)"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {(labelTicks
        ? labelTicks
        : labels.map((text, i) => ({ text, index: i }))
      ).map((t, i) => (
        <text
          key={i}
          x={sx(t.index)}
          y={height - 8}
          textAnchor="middle"
          className="m-line-xtick"
        >
          {t.text}
        </text>
      ))}
    </svg>
  );
}

function BarangayBar({ name, value, max, color }) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div className="m-bar-row">
      <div className="m-bar-name" title={name}>{name}</div>
      <div className="m-bar-track">
        <div
          className="m-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <div className="m-bar-value">{value}</div>
    </div>
  );
}

export default function MetricsPage() {
  const [period, setPeriod] = useState("all");
  const [result, setResult] = useState(null);
  const summary = result?.period === period ? result.data : null;
  const error = result?.period === period ? result.error : null;
  const loading = !summary && !error;
  const [barangays, setBarangays] = useState(null);
  // Re-resolved whenever the theme flips — a [] dep here would freeze the
  // choropleth on whichever palette happened to be active at mount.
  const theme = useTheme();
  const bucketColors = BUCKET_COLOR_VARS.map((b) => readCssVar(b.varName, b.fallback));

  const barangayBounds = useMemo(() => {
    if (!barangays?.features?.length) return null;
    const layer = L.geoJSON(barangays);
    const b = layer.getBounds();
    return b.isValid() ? b : null;
  }, [barangays]);


  // Real per-barangay incident counts (keyed by brgy_name) from the summary.
  const byBarangay = useMemo(() => summary?.by_barangay ?? {}, [summary]);

  useEffect(() => {
    let alive = true;
    fetchMetricsSummary(period)
      .then((data) => {
        if (!alive) return;
        setResult({ period, data });
      })
      .catch((err) => { if (alive) setResult({ period, error: err.message }); });
    return () => { alive = false; };
  }, [period]);

  useEffect(() => {
    fetchBarangays()
      .then(setBarangays)
      .catch(() => setBarangays(null));
  }, []);

  const severity = summary?.severity ?? { Critical: 0, Moderate: 0, Minor: 0 };
  const total = summary?.total ?? 0;
  const contained = summary?.contained ?? 0;
  const deltas = summary?.deltas ?? {};
  const avgResponse = summary?.avg_response_minutes;

  const donutData = Object.entries(summary?.alarm_levels || {}).map(([label, value], index) => ({
    label, value, color: ALARM_COLORS[index % ALARM_COLORS.length],
  }));
  const donutTotal = donutData.reduce((a, b) => a + b.value, 0);
  const causes = summary?.top_causes || [];
  const maxCause = Math.max(1, ...causes.map(c => c.count));

  // Incidents-per-month over the last 12 months (real).
  const monthNames = (summary?.monthly ?? []).map((p) => p.month);
  const linePoints = (summary?.monthly ?? []).map((p) => p.count);

  const buckets = useMemo(
    () => buildBuckets(Math.max(0, ...Object.values(byBarangay))),
    [byBarangay]
  );

  const topBarangays = Object.entries(byBarangay)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, value]) => ({
        name,
        value,
        color: bucketColors[bucketIndexFor(value, buckets)],
      }));
  const maxBar = Math.max(...topBarangays.map((b) => b.value), 1);

  return (
    <div className="m-page">
      <div className="m-header">
        <div className="m-title-row">
          <div>
            <div className="m-title">Metrics</div>
            <UnfoldIcon />
            {/* <div className="m-subtitle">Operational performance overview</div> */}
          </div>
          {/* <div className="m-period-group">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                className={`m-period-btn${period === p.key ? " active" : ""}`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div> */}
        </div>
      </div>

      <div className="m-body">
        <div className="m-section-row">
          <div className="m-section-label">Overall Stats</div>
          <div className="m-period-group">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                className={`m-period-btn${period === p.key ? " active" : ""}`}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="kpi-row m-kpi-row">
          <KpiCard
            icon={<PhoneIcon />}
            label="Calls Responded"
            value={total.toLocaleString()}
            loading={loading}
            trend={trendOf(deltas.total)}
            accent="fire"
          />
          <KpiCard
            icon={<ClockIcon />}
            label="Average Response Time"
            value={avgResponse != null ? avgResponse : KPI_EMPTY}
            loading={loading}
            sub={avgResponse != null ? "min, call to arrival" : "no arrivals recorded"}
            trend={trendOf(deltas.response)}
            accent="fire"
          />
          <KpiCard
            icon={<AlertIcon />}
            label="Critical Incidents"
            value={total > 0 && summary?.unknown_severity_count === total ? KPI_EMPTY : (severity.Critical ?? 0).toLocaleString()}
            sub={summary?.unknown_severity_count > 0 ? `${summary.unknown_severity_count} records have no reported severity` : undefined}
            loading={loading}
            trend={trendOf(deltas.critical)}
            accent="fire"
          />
          <KpiCard
            icon={<MapIcon />}
            label="Contained / Closed"
            value={contained.toLocaleString()}
            loading={loading}
            trend={trendOf(deltas.contained)}
            accent="fire"
          />
        </div>

        <div className="m-grid">
          <div className="m-card m-card-donut">
            <div className="m-card-head">
              <div className="m-card-title">Fire Incidents by Alarm Level</div>
              <div className="m-card-sub">
                {PERIODS.find((p) => p.key === period)?.label}
              </div>
            </div>
            <div className="m-donut-wrap">
              <DonutChart data={donutData} total={donutTotal} />
              <div className="m-legend-table">
                <div className="m-legend-thead">
                  <span>Alarm level</span>
                  <span>Percentage</span>
                  <span>Cases</span>
                </div>
                {donutData.map((d) => {
                  const pct = donutTotal
                    ? ((d.value / donutTotal) * 100).toFixed(1)
                    : "0.0";
                  return (
                    <div key={d.label} className="m-legend-row">
                      <span className="m-legend-name">
                        <span
                          className="m-legend-dot"
                          style={{ background: d.color }}
                        />
                        {d.label}
                      </span>
                      <span className="m-legend-pct">{pct}%</span>
                      <span className="m-legend-val">{d.value}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="m-card m-card-line">
            <div className="m-card-head">
              <div className="m-card-title">Incidents per Month</div>
              <div className="m-card-sub">{period === "all" ? "All recorded dates" : "Last 12 months"}</div>
            </div>
            <LineChart points={linePoints} labels={monthNames} labelTicks={monthNames.map((text, index) => ({ text, index })).filter((_, i) => i % Math.max(1, Math.ceil(monthNames.length / 12)) === 0)} />
          </div>

          <div className="m-bottom-grid">
          <div className="m-card m-card-bars">
            <div className="m-card-head">
              <div className="m-card-title">Fire Occurrences by Barangay</div>
              <div className="m-card-sub">Top 8</div>
            </div>
            {summary?.unresolved_barangay_count > 0 && <p className="m-card-sub">{summary.unresolved_barangay_count} incident has an unresolved barangay and is excluded from this map.</p>}
            <div className="m-brgy-split">
              <div className="m-brgy-map-col">
                <div className="m-brgy-map-wrap">
                  <MapContainer
                    center={MAP_CENTER}
                    zoom={11.5}
                    zoomSnap={0.1}
                    className="m-brgy-map"
                    attributionControl
                    dragging={false}
                    scrollWheelZoom={false}
                    doubleClickZoom={false}
                    touchZoom={false}
                    boxZoom={false}
                    keyboard={false}
                    zoomControl={false}
                  >
                    <FitBarangays bounds={barangayBounds} />
                    {tileLayersFor(theme === "light" ? "street" : "dark").map(
                      (layer, i) => (
                        <TileLayer key={`${theme}-${i}`} {...layer} />
                      ),
                    )}
                    {barangays && (
                      <GeoJSON
                        key={`${period}-${theme}-${JSON.stringify(byBarangay)}`}
                        data={barangays}
                        style={(feature) => {
                          const name = feature.properties?.brgy_name ?? "";
                          const count = byBarangay[name] ?? 0;
                          const color =
                            bucketColors[bucketIndexFor(count, buckets)];
                          return {
                            color,
                            weight: 1,
                            fillColor: color,
                            fillOpacity: 0.55,
                            interactive: false,
                          };
                        }}
                      />
                    )}
                  </MapContainer>
                </div>
                <div className="m-brgy-legend">
                  {buckets.map((b, i) => (
                    <div key={b.label} className="m-brgy-legend-item">
                      <span
                        className="m-brgy-legend-swatch"
                        style={{ background: bucketColors[i] }}
                      />
                      <span className="m-brgy-legend-label">{b.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="m-brgy-bars">
                {topBarangays.length === 0 ? (
                  <div className="m-empty">No data available</div>
                ) : (
                  <div className="m-bar-list">
                    {topBarangays.map((b) => (
                      <BarangayBar
                        key={b.name}
                        name={b.name}
                        value={b.value}
                        max={maxBar}
                        color={b.color}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <section className="m-card m-card-causes" aria-label="Top 10 reported fire causes">
            <div className="m-card-head"><div className="m-card-title">Top 10 Reported Fire Causes</div><div className="m-card-sub">Incidents</div></div>
            <p className="m-card-sub">Source cause labels, one count per incident</p>
            <div className="m-bar-list">{causes.map(c => <BarangayBar key={c.cause} name={c.cause} value={c.count} max={maxCause} color="var(--accent-fire)" />)}</div>
            {!causes.length && <div className="m-empty">No cause data in this period</div>}
          </section>
          </div>
        </div>
      </div>
    </div>
  );
}
