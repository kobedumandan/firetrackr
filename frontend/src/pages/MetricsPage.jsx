import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, GeoJSON, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "../styles/MetricsPage.css";
import "../styles/MetricsOverview.css";
import "../styles/MethodNote.css";
import { fetchMetricsSummary, fetchBarangays, invalidateOperationalTimes } from "../api";
import AnalysisIcon from "../components/AnalysisIcon";
import KpiCard, { KPI_EMPTY } from "../components/KpiCard";
import IncidentTrendChart from "../components/IncidentTrendChart";
import MetricsExportModal from "../components/MetricsExportModal";
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
  { key: "1d", label: "Day", description: "Past day" },
  { key: "1w", label: "Week", description: "Past week" },
  { key: "1m", label: "Month", description: "Past month" },
  { key: "1y", label: "Year", description: "Past year" },
  { key: "all", label: "All dates", description: "All recorded dates" },
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
  const [activeIndex, setActiveIndex] = useState(null);
  if (!total) return <div className="m-empty">No incidents in this period</div>;
  const radius = 52;
  const stroke = 10;
  const gap = 3.2;
  const circ = 2 * Math.PI * radius;
  const outer = radius + stroke / 2;
  const viewExtent = outer + 8;
  const viewSize = viewExtent * 2;
  const active = data[activeIndex];
  const activeAngle = active
    ? ((data.slice(0, activeIndex).reduce((sum, item) => sum + item.value, 0) + active.value / 2) / total) * 2 * Math.PI - Math.PI / 2
    : 0;
  return (
    <div className="m-donut-chart">
    <svg
      viewBox={`${-viewExtent} ${-viewExtent} ${viewSize} ${viewSize}`}
      className="m-donut"
      role="group"
      aria-label={`Alarm levels for ${total.toLocaleString()} incidents`}
    >
      <g transform="rotate(-90)">
        {data.map((d, i) => {
          if (!d.value) return null;
          const slice = (d.value / total) * circ;
          const offset = data.slice(0, i).reduce((sum, item) => sum + item.value / total * circ, 0);
          const len = Math.max(slice - gap, 0);
          const seg = (
            <circle
              key={i}
              className={`m-donut-segment${activeIndex === i ? " is-active" : ""}${active && activeIndex !== i ? " is-muted" : ""}`}
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${d.value.toLocaleString()} incident${d.value === 1 ? "" : "s"}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(null)}
              onFocus={() => setActiveIndex(i)}
              onBlur={() => setActiveIndex(null)}
              onKeyDown={(event) => { if (event.key === "Escape") setActiveIndex(null); }}
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
      <text x="0" y="-2" textAnchor="middle" dominantBaseline="middle" className="m-donut-total">{total.toLocaleString()}</text>
      <text x="0" y="17" textAnchor="middle" className="m-donut-cap">Incidents</text>
    </svg>
    {active && <div
      className="m-donut-tooltip"
      role="tooltip"
      style={{
        left: `${50 + Math.cos(activeAngle) * radius / viewSize * 100}%`,
        top: `${50 + Math.sin(activeAngle) * radius / viewSize * 100}%`,
      }}
    >
      <strong>{active.label}</strong>
      <span>{active.value.toLocaleString()} incident{active.value === 1 ? "" : "s"}</span>
    </div>}
    </div>
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

export default function MetricsPage({ onOpenAnalysis }) {
  const [period, setPeriod] = useState("all");
  const [rangeDraft, setRangeDraft] = useState({ from: '', to: '' });
  const [dateRange, setDateRange] = useState(null);
  const [rangeError, setRangeError] = useState('');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [exportSnapshot, setExportSnapshot] = useState(null);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState("");
  const [monthResult, setMonthResult] = useState(null);
  const resultKey = `${period}:${dateRange?.from || ''}:${dateRange?.to || ''}:${revision}`;
  const summary = result?.key === resultKey ? result.data : null;
  const error = result?.key === resultKey ? result.error : null;
  const loading = !summary && !error;
  const monthResultKey = `${resultKey}:${selectedMonth}`;
  const monthReady = monthResult?.key === monthResultKey;
  const breakdown = selectedMonth ? (monthReady ? monthResult.data : null) : summary;
  const breakdownLoading = selectedMonth ? !monthReady : loading;
  const breakdownError = selectedMonth && monthReady ? monthResult.error : null;
  const [barangays, setBarangays] = useState(null);
  const [boundaryError, setBoundaryError] = useState(null);
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
  const byBarangay = useMemo(() => breakdown?.by_barangay ?? {}, [breakdown]);

  useEffect(() => {
    let alive = true;
    const request = dateRange ? fetchMetricsSummary(period, '', dateRange) : fetchMetricsSummary(period);
    request
      .then((data) => {
        if (!alive) return;
        setResult({ key: resultKey, data });
      })
      .catch((err) => { if (alive) setResult({ key: resultKey, error: err.message }); });
    return () => { alive = false; };
  }, [period, dateRange, revision, resultKey]);

  useEffect(() => {
    if (!selectedMonth) return;
    let alive = true;
    const request = dateRange ? fetchMetricsSummary(period, selectedMonth, dateRange) : fetchMetricsSummary(period, selectedMonth);
    request
      .then(data => { if (alive) setMonthResult({ key: monthResultKey, data }); })
      .catch(failure => { if (alive) setMonthResult({ key: monthResultKey, error: failure.message }); });
    return () => { alive = false; };
  }, [period, dateRange, selectedMonth, revision, monthResultKey]);

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1);
    window.addEventListener('operational-times-updated', refresh);
    return () => window.removeEventListener('operational-times-updated', refresh);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchBarangays()
      .then((data) => { if (alive) { setBarangays(data); setBoundaryError(null); } })
      .catch(() => { if (alive) { setBarangays(null); setBoundaryError("Barangay boundaries unavailable"); } });
    return () => { alive = false; };
  }, [revision]);

  const severity = summary?.severity ?? { Critical: 0, Moderate: 0, Minor: 0 };
  const total = summary?.total ?? 0;
  const contained = summary?.contained ?? 0;
  const deltas = summary?.deltas ?? {};
  const avgResponse = summary?.recorded_response_minutes;

  const donutData = Object.entries(breakdown?.alarm_levels || {}).map(([label, value], index) => ({
    label, value, color: label === "Not recorded" ? ALARM_COLORS.at(-1) : ALARM_COLORS[index % ALARM_COLORS.length],
  }));
  const donutTotal = donutData.reduce((a, b) => a + b.value, 0);
  const causes = (breakdown?.top_causes || []).slice(0, 10);
  const maxCause = Math.max(1, ...causes.map(c => c.count));

  // The API supplies monthly context independently of shorter period filters.
  const monthNames = (summary?.monthly ?? []).map((p) => p.month);
  const monthLabels = (summary?.monthly ?? []).map(month => month.month_key
    ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'long', year: 'numeric' }).format(new Date(`${month.month_key}-01T00:00:00+08:00`))
    : month.month);
  const causesByMonth = (summary?.monthly ?? []).map(month => month.top_causes ?? []);
  const linePoints = (summary?.monthly ?? []).map((p) => p.count);
  const chartTotal = linePoints.reduce((sum, count) => sum + count, 0);
  const formatDate = value => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T00:00:00+08:00`));
  const activePeriod = dateRange
    ? { key: 'custom', label: 'Date range', description: `${formatDate(dateRange.from)} – ${formatDate(dateRange.to)}` }
    : PERIODS.find((p) => p.key === period);
  const chartScope = dateRange ? activePeriod.description : period === "all" ? "All recorded months" : "Last 12 months";
  const selectedMonthIndex = (summary?.monthly ?? []).findIndex(month => month.month_key === selectedMonth);
  const selectedMonthLabel = selectedMonth
    ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'long', year: 'numeric' }).format(new Date(`${selectedMonth}-01T00:00:00+08:00`))
    : '';
  const breakdownScope = selectedMonthLabel || activePeriod.description;
  const breakdownMessage = breakdownLoading ? 'Loading selected month…' : breakdownError ? `Could not load selected month: ${breakdownError}` : null;

  function selectMonth(index) {
    const month = summary?.monthly?.[index]?.month_key;
    if (month) setSelectedMonth(month);
  }

  function applyRange(event) {
    event.preventDefault();
    if (!rangeDraft.from || !rangeDraft.to) { setRangeError('Choose both a start and end date.'); return; }
    if (rangeDraft.from > rangeDraft.to) { setRangeError('The start date must be on or before the end date.'); return; }
    if (rangeDraft.to > today) { setRangeError('Reporting dates cannot be in the future.'); return; }
    setRangeError(''); setDateRange({ ...rangeDraft }); setPeriod('custom'); setSelectedMonth('');
  }

  function openExport() {
    setExportSnapshot({
      summary: selectedMonth ? {
        ...summary,
        alarm_levels: breakdown.alarm_levels,
        by_barangay: breakdown.by_barangay,
        top_causes: breakdown.top_causes,
        breakdown_unresolved_barangay_count: breakdown.unresolved_barangay_count ?? 0,
      } : summary,
      barangays,
      period: activePeriod,
      breakdownPeriod: selectedMonthLabel || undefined,
      generatedAt: new Date().toISOString(),
    });
  }

  const buckets = useMemo(
    () => buildBuckets(Math.max(0, ...Object.values(byBarangay))),
    [byBarangay]
  );

  const topBarangays = Object.entries(byBarangay)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, value]) => ({
        name,
        value,
        color: bucketColors[bucketIndexFor(value, buckets)],
      }));
  const maxBar = Math.max(...topBarangays.map((b) => b.value), 1);

  return (
    <main className="m-page" aria-busy={loading}>
      <header className="m-header"><div className="m-title-row"><div><span className="m-title">Metrics</span><UnfoldIcon /></div></div></header>
      <div className="m-body">
        <div className="m-workspace">
        <header className="mo-view-heading"><div><span className="mo-eyebrow">Incident activity</span><h1>Overview</h1><p>Incident activity, response times and reported fire patterns.</p></div><div className="mo-heading-actions"><div><button className="mo-button" disabled={loading} onClick={invalidateOperationalTimes}><AnalysisIcon name="refresh" />{loading ? "Updating…" : "Refresh"}</button><button className="mo-button" disabled={loading || !!error || breakdownLoading || !!breakdownError} onClick={openExport}><AnalysisIcon name="download" />Export</button>{onOpenAnalysis && <button className="m-analysis-link mo-button is-primary" onClick={onOpenAnalysis}>Open Analysis<AnalysisIcon name="chevron" /></button>}</div></div></header>
        <section className="mo-period-panel" aria-label="Metrics reporting period">
        <div className="m-section-row">
          <div className="mo-period-copy"><span className="mo-control-icon"><AnalysisIcon name="chart" /></span><div><h2>Reporting period</h2><p>Review recorded activity across a selected window.</p></div></div>
          <div className="mo-period-controls">
          <div className="m-period-group" role="group" aria-label="Reporting period">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                className={`m-period-btn${period === p.key ? " active" : ""}`}
                onClick={() => { setPeriod(p.key); setDateRange(null); setRangeDraft({ from: '', to: '' }); setRangeError(''); setSelectedMonth(''); }}
                aria-pressed={period === p.key}
                aria-label={p.description}
              >
                {p.label}
              </button>
            ))}
          </div>
          <form className={`mo-date-range${dateRange ? ' is-active' : ''}`} onSubmit={applyRange} aria-label="Custom reporting date range">
            <label>From<input type="date" aria-label="Start date" className={!rangeDraft.from ? 'is-empty' : undefined} value={rangeDraft.from} max={rangeDraft.to || today} onChange={event => { setRangeDraft(value => ({ ...value, from: event.target.value })); setRangeError(''); }} /></label>
            <label>To<input type="date" aria-label="End date" className={!rangeDraft.to ? 'is-empty' : undefined} value={rangeDraft.to} min={rangeDraft.from || undefined} max={today} onChange={event => { setRangeDraft(value => ({ ...value, to: event.target.value })); setRangeError(''); }} /></label>
            <button className="mo-button" type="submit">Apply</button>
          </form>
          </div>
        </div>
        {rangeError && <p className="mo-range-error" role="alert">{rangeError}</p>}
        </section>
        {error && <div className="mo-error" role="alert"><AnalysisIcon name="info" /><div><strong>Could not load metrics</strong><p>{error}</p></div><button className="mo-button" onClick={invalidateOperationalTimes}>Retry</button></div>}
        {!error && <>
        <div className="kpi-row m-kpi-row">
          <KpiCard
            icon={<PhoneIcon />}
            label="Recorded fire incidents"
            value={total.toLocaleString()}
            sub="Fire incidents in the selected reporting period"
            loading={loading}
            trend={trendOf(deltas.total)}
            accent="fire"
          />
          <div className="mo-response-kpi"><KpiCard
            icon={<ClockIcon />}
            label="Average fire response time"
            onClick={onOpenAnalysis}
            actionLabel="Average Response Time: open Analysis, Response & Operations"
            value={avgResponse != null ? `${avgResponse.toFixed(1)} min` : KPI_EMPTY}
            loading={loading}
            sub={avgResponse != null ? <>Report receipt → first arrival{summary?.recorded_response_quality?.valid != null && <><span className="mo-pipe" aria-hidden="true"> | </span>{summary.recorded_response_quality.valid.toLocaleString()} Dispatches</>}</> : "No eligible arrivals recorded"}
            trend={trendOf(summary?.recorded_response_change)}
            accent="blue"
          /></div>
          <KpiCard
            icon={<AlertIcon />}
            label="Critical fire incidents"
            value={total > 0 && summary?.unknown_severity_count === total ? KPI_EMPTY : (severity.Critical ?? 0).toLocaleString()}
            sub={summary?.unknown_severity_count > 0 ? `${summary.unknown_severity_count} records have no reported severity` : "Incidents with critical severity"}
            loading={loading}
            trend={trendOf(deltas.critical)}
            accent="amber"
          />
          <KpiCard
            icon={<MapIcon />}
            label="Contained / closed"
            value={contained.toLocaleString()}
            sub="Incidents marked contained or closed"
            loading={loading}
            trend={trendOf(deltas.contained)}
            accent="green"
          />
        </div>

        {loading ? <div className="mo-chart-skeletons" aria-label="Loading metric charts">{[0, 1, 2, 3].map(n => <div className="m-card" key={n}><span className="kpi-sk mo-skeleton-title" /><span className="kpi-sk mo-skeleton-chart" /></div>)}</div> : <>
        <div className="m-grid">
          <div className="m-card m-card-donut" aria-busy={breakdownLoading}>
            <div className="m-card-head">
              <h2 className="m-card-title">Alarm levels</h2>
              <div className="m-card-sub">
                {breakdownScope}
              </div>
            </div>
            {breakdownMessage ? <div className="m-empty" role={breakdownError ? 'alert' : 'status'}>{breakdownMessage}</div> : <div className="m-donut-wrap">
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
            </div>}
          </div>

          <div className="m-card m-card-line">
            <div className="m-line-head">
              <div>
                <h2 className="m-card-title">Monthly incident activity</h2>
                <div className="m-card-sub">{chartScope}<span className="mo-pipe" aria-hidden="true"> | </span>Incidents by occurrence date</div>
              </div>
              <div className="m-line-total">
                <strong>{chartTotal.toLocaleString()}</strong>
                <span>Incidents Plotted</span>
              </div>
            </div>
            <div className="mo-line-chart" role="region" tabIndex="0" aria-label="Monthly incident chart"><IncidentTrendChart points={linePoints} labels={monthNames} monthLabels={monthLabels} causesByMonth={causesByMonth} selectedIndex={selectedMonthIndex} onSelect={selectMonth} onClose={() => setSelectedMonth('')} labelTicks={monthNames.map((text, index) => ({ text, index })).filter((_, i) => i % Math.max(1, Math.ceil(monthNames.length / 12)) === 0)} /></div>
            {selectedMonth && <div className="mo-month-filter"><span>Breakdowns for <strong>{selectedMonthLabel}</strong></span><button type="button" className="mo-button" aria-label="Clear selected month" onClick={() => setSelectedMonth('')}>Clear month</button></div>}
          </div>

          <div className="m-bottom-grid">
          <div className="m-card m-card-bars" aria-busy={breakdownLoading}>
            <div className="m-card-head">
              <h2 className="m-card-title">Incidents by barangay</h2>
              <div className="m-card-sub">{breakdownScope}<span className="mo-pipe" aria-hidden="true"> | </span>Top 10</div>
            </div>
            {breakdown?.unresolved_barangay_count > 0 && <p className="mo-location-note">{breakdown.unresolved_barangay_count} incident{breakdown.unresolved_barangay_count === 1 ? ' has' : 's have'} an unresolved barangay and {breakdown.unresolved_barangay_count === 1 ? 'is' : 'are'} excluded from this map.</p>}
            {breakdownMessage ? <div className="m-empty" role={breakdownError ? 'alert' : 'status'}>{breakdownMessage}</div> : <div className="m-brgy-split">
              <div className="m-brgy-map-col">
                <div className="m-brgy-map-wrap">
                  {boundaryError ? <div className="mo-map-placeholder"><AnalysisIcon name="coverage" /><strong>{boundaryError}</strong><p>Refresh to try loading the map again.</p></div> : <MapContainer
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
                  </MapContainer>}
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
            </div>}
          </div>
          <section className="m-card m-card-causes" aria-label="Top 10 reported fire causes" aria-busy={breakdownLoading}>
            <div className="m-card-head"><h2 className="m-card-title">Top reported fire causes</h2><div className="m-card-sub">{breakdownScope}<span className="mo-pipe" aria-hidden="true"> | </span>Top 10</div></div>
            {breakdownMessage ? <div className="m-empty" role={breakdownError ? 'alert' : 'status'}>{breakdownMessage}</div> : <>
              <div className="m-bar-list">{causes.map(c => <BarangayBar key={c.cause} name={c.cause} value={c.count} max={maxCause} color="var(--accent-fire)" />)}</div>
              {!causes.length && <div className="m-empty">No cause data in this period</div>}
            </>}
            <p className="mo-data-note">Source cause labels, one count per incident</p>
          </section>
          </div>
        </div>
        <details className="mo-method"><summary><AnalysisIcon name="info" />How to read this overview<AnalysisIcon name="chevron" /></summary><div className="mo-method-content">
          <section><div className="mo-method-heading"><span><AnalysisIcon name="chart" /></span><h3>Incident activity & rankings</h3></div><p>Incident totals use the selected occurrence-date window. Select a chart month to filter alarm levels, barangays and causes to that calendar month. Each incident contributes once to a cause or barangay count. Rankings show up to ten entries.</p><div className="mo-method-assumptions"><h4>Monthly chart scope</h4><p>All dates shows all recorded months. A custom range includes both calendar dates in Philippine time and limits the chart to that window. Other periods show the last twelve months. Clear the month to restore reporting-period breakdowns.</p></div></section>
          <section><div className="mo-method-heading"><span><AnalysisIcon name="response" /></span><h3>Response time & record quality</h3></div><p>Response time measures verified report receipt to the first eligible arrival, using its own receipt-date cohort and available measurements.</p><div className="mo-method-assumptions"><h4>Missing & historical records</h4><p>Unknown severity, missing arrivals and unresolved barangays stay explicit. Historical imports may include assumed alarm levels and estimated locations. Open Analysis to review response quality and individual incidents.</p></div></section>
        </div></details>
        </>}
        </>}
        </div>
      </div>
      {exportSnapshot && <MetricsExportModal snapshot={exportSnapshot} onClose={() => setExportSnapshot(null)} />}
    </main>
  );
}
