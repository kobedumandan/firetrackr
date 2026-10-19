import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import "../styles/IncidentDetailsPage.css";
import DetailsLayout, {
  DetailsSection,
  DetailsGrid,
  DetailsField,
  DetailsProse,
} from "../layout/DetailsLayout";
import {
  SeverityBadge,
  EditIcon,
  RemoveIcon,
  FireGeneralIcon,
  formatReported,
} from "../components/incidentUi";
import { fetchIncidentReport, fetchDispatches } from "../api";

const STEPS = [
  { key: "pending", label: "Reported" },
  { key: "dispatched", label: "Dispatched" },
  { key: "contained", label: "Contained" },
  { key: "closed", label: "Closed" },
];
const STEP_INDEX = { pending: 0, active: 1, dispatched: 1, contained: 2, closed: 3 };

const DISPATCH_STATUS = {
  dispatched: { label: "Dispatched", tone: "amber" },
  en_route: { label: "En Route", tone: "amber" },
  on_scene: { label: "On Scene", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

function clock(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit" });
}

// "1h 12m" between two instants — used for time-on-incident and response time.
function span(fromIso, toMs) {
  if (!fromIso) return null;
  const mins = Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 60000));
  if (!Number.isFinite(mins)) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function initials(name) {
  const parts = (name || "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Tone({ tone = "muted", children, dot }) {
  return (
    <span className={`idp-pill idp-tone-${tone}`}>
      {dot && <span className="idp-pill-dot" />}
      {children}
    </span>
  );
}

function StatTile({ label, value, sub, tone }) {
  return (
    <div className="idp-stat">
      <div className="idp-stat-label">{label}</div>
      <div className={`idp-stat-value${tone ? ` idp-text-${tone}` : ""}`}>{value}</div>
      {sub && <div className="idp-stat-sub">{sub}</div>}
    </div>
  );
}

/* Where the incident is in its lifecycle. Only the reported and first-dispatch
   times are recorded; contained has no timestamp, and closed borrows the
   report's submission time when there is one. */
function Progress({ status, reportedAt, dispatchedAt, closedAt }) {
  const current = STEP_INDEX[status] ?? 0;
  const times = [reportedAt, dispatchedAt, null, closedAt];
  return (
    <div className="idp-steps">
      {STEPS.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <div key={s.key} className={`idp-step is-${state}`}>
            <div className="idp-step-track">
              <span className="idp-step-dot">
                {state === "done" && (
                  <span className="material-symbols-outlined">check</span>
                )}
              </span>
              {i < STEPS.length - 1 && <span className="idp-step-line" />}
            </div>
            <div className="idp-step-label">{s.label}</div>
            <div className="idp-step-time">
              {state !== "todo" ? clock(times[i]) ?? "—" : "Pending"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UnitCard({ d, now }) {
  const st = DISPATCH_STATUS[d.dispatch_status] ?? { label: d.dispatch_status, tone: "muted" };
  const response = d.arrived_at ? span(d.dispatch_at, new Date(d.arrived_at).getTime()) : null;
  const live = !d.arrived_at && ["dispatched", "en_route"].includes(d.dispatch_status);
  const members = d.members ?? [];
  return (
    <div className="idp-unit">
      <div className="idp-unit-top">
        <div className="idp-unit-icon">
          <span className="material-symbols-outlined">fire_truck</span>
        </div>
        <div className="idp-unit-info">
          <div className="idp-unit-name">{d.team_name}</div>
          <div className="idp-unit-sub">
            {[d.team_code, d.station_name].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
        <Tone tone={st.tone} dot={live}>
          {st.label}
        </Tone>
      </div>

      <div className="idp-unit-rows">
        <div className="idp-unit-row">
          <span>Dispatched</span>
          <span>{clock(d.dispatch_at) ?? "—"}</span>
        </div>
        <div className="idp-unit-row">
          <span>{d.arrived_at ? "Arrived" : "En route for"}</span>
          <span>
            {d.arrived_at
              ? `${clock(d.arrived_at)}${response ? ` · ${response}` : ""}`
              : live
              ? span(d.dispatch_at, now) ?? "—"
              : "—"}
          </span>
        </div>
        {d.truck_platenums?.length > 0 && (
          <div className="idp-unit-row">
            <span>Truck{d.truck_platenums.length > 1 ? "s" : ""}</span>
            <span className="is-mono">{d.truck_platenums.join(", ")}</span>
          </div>
        )}
      </div>

      {members.length > 0 && (
        <div className="idp-unit-crew">
          <div className="idp-avatars">
            {members.slice(0, 5).map((m) => (
              <span key={m.per_id} className="idp-avatar" title={`${m.rank} ${m.name}`}>
                {m.initials}
              </span>
            ))}
            {members.length > 5 && (
              <span className="idp-avatar is-more">+{members.length - 5}</span>
            )}
          </div>
          <span className="idp-unit-crew-count">
            {members.length} crew
          </span>
        </div>
      )}
    </div>
  );
}

/* Full-screen scene-photo lightbox: counter + caption up top, prev/next,
   a thumbnail strip to jump around, Esc / ← / → from the keyboard. */
function PhotoViewer({ photos, index, onIndexChange, onClose, caption }) {
  const count = photos.length;
  const go = (delta) => onIndexChange((index + delta + count) % count);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && count > 1) onIndexChange((index - 1 + count) % count);
      else if (e.key === "ArrowRight" && count > 1) onIndexChange((index + 1) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, count, onClose, onIndexChange]);

  return createPortal(
    <div
      className="idp-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Scene photo ${index + 1} of ${count}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="idp-viewer-bar">
        <div className="idp-viewer-meta">
          <span className="idp-viewer-count">
            Photo {index + 1} <span>of {count}</span>
          </span>
          {caption && <span className="idp-viewer-caption">{caption}</span>}
        </div>
        <div className="idp-viewer-tools">
          <a
            className="idp-viewer-btn"
            href={photos[index]}
            target="_blank"
            rel="noreferrer"
            title="Open full size in a new tab"
            aria-label="Open full size in a new tab"
          >
            <span className="material-symbols-outlined">open_in_new</span>
          </a>
          <button type="button" className="idp-viewer-btn" onClick={onClose} aria-label="Close viewer" autoFocus>
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>

      <div className="idp-viewer-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {count > 1 && (
          <button type="button" className="idp-viewer-btn idp-viewer-nav prev" onClick={() => go(-1)} aria-label="Previous photo">
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
        )}
        <img key={photos[index]} className="idp-viewer-img" src={photos[index]} alt={`Scene photo ${index + 1}`} />
        {count > 1 && (
          <button type="button" className="idp-viewer-btn idp-viewer-nav next" onClick={() => go(1)} aria-label="Next photo">
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
        )}
      </div>

      {count > 1 && (
        <div className="idp-viewer-strip" role="tablist" aria-label="All photos">
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Photo ${i + 1}`}
              className={`idp-viewer-thumb${i === index ? " active" : ""}`}
              onClick={() => onIndexChange(i)}
            >
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body
  );
}

/**
 * Full-page view of a single incident, built on the shared DetailsLayout.
 *
 * @param incident    the incident row to display
 * @param onBack      return to the list
 * @param onEdit      open the edit modal for this incident
 * @param onDelete    open the delete confirmation for this incident
 * @param onViewOnMap jump to the Command map focused on this incident
 */
export default function IncidentDetailsPage({
  incident,
  onBack,
  onEdit,
  onDelete,
  onViewOnMap,
}) {
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState(null);
  // Keyed by fire_id so rows from a previous incident never show on this one;
  // `dispatches` is null until this incident's fetch lands.
  const [dispatchState, setDispatchState] = useState({ fireId: null, rows: null });
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Index of the scene photo shown in the in-app viewer; null = viewer closed.
  const [photoIndex, setPhotoIndex] = useState(null);

  // Keeps "time on incident" and "en route for" honest while the page is open.
  useEffect(() => {
    if (incident?.status === "closed") return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [incident?.status]);

  // Load the after-action report (narrative + photos) for a closed incident.
  // Other statuses don't have a report, so we skip the fetch.
  useEffect(() => {
    if (!incident || incident.status !== "closed") {
      setReport(null);
      setReportError(null);
      setReportLoading(false);
      return;
    }
    let cancelled = false;
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    fetchIncidentReport(incident.fire_id)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => {
        if (!cancelled) setReportError(e.message);
      })
      .finally(() => {
        if (!cancelled) setReportLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incident?.fire_id, incident?.status]);

  // Units sent to this incident, for the Responding Units column and the
  // "Dispatched" step's timestamp. Refetched when the status moves.
  const fireId = incident?.fire_id;
  const incStatus = incident?.status;
  useEffect(() => {
    if (fireId == null) return;
    let cancelled = false;
    fetchDispatches(fireId)
      .then((rows) => {
        if (!cancelled) setDispatchState({ fireId, rows });
      })
      .catch(() => {
        if (!cancelled) setDispatchState({ fireId, rows: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [fireId, incStatus]);
  const dispatches = dispatchState.fireId === fireId ? dispatchState.rows : null;

  const photos = report?.photos ?? [];

  if (!incident) return null;

  const closed = incident.status === "closed";
  const hasCoords = incident.latitude != null && incident.longitude != null;
  const coords = hasCoords
    ? `${incident.latitude.toFixed(5)}, ${incident.longitude.toFixed(5)}`
    : "—";
  const hasCasualties =
    !!incident.casualties && incident.casualties !== "None" && incident.casualties !== "—";

  const firstDispatchAt = dispatches?.length
    ? dispatches.map((d) => d.dispatch_at).filter(Boolean).sort()[0]
    : null;
  const closedAt = report?.submitted_at ?? null;
  const endMs = closed && closedAt ? new Date(closedAt).getTime() : now;
  const duration = span(incident.reported_at, endMs);

  function copyCoords() {
    if (!hasCoords || !navigator.clipboard) return;
    navigator.clipboard.writeText(coords).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const aside = (
    <div className="idp-aside">
      <DetailsSection title="Responding Units">
        {dispatches === null ? (
          <div className="idp-aside-state">Loading units…</div>
        ) : dispatches.length === 0 ? (
          <div className="idp-aside-empty">
            <div className="idp-aside-empty-icon">
              <span className="material-symbols-outlined">fire_truck</span>
            </div>
            <div className="idp-aside-state">No units dispatched</div>
          </div>
        ) : (
          <div className="idp-units">
            {dispatches.map((d) => (
              <UnitCard key={d.dispatch_id} d={d} now={now} />
            ))}
          </div>
        )}
      </DetailsSection>

      <DetailsSection title="Location">
        <div className="idp-loc">
          <div className="idp-loc-icon">
            <span className="material-symbols-outlined">location_on</span>
          </div>
          <div className="idp-loc-info">
            <div className="idp-loc-name">{incident.loc}</div>
            {incident.addr && <div className="idp-loc-addr">{incident.addr}</div>}
          </div>
        </div>
        <div className="idp-coords">
          <span className="idp-coords-val">{coords}</span>
          {hasCoords && (
            <button type="button" className="idp-icon-btn" onClick={copyCoords} title="Copy coordinates">
              <span className="material-symbols-outlined">
                {copied ? "check" : "content_copy"}
              </span>
            </button>
          )}
        </div>
        {!closed && (
          <button
            type="button"
            className="act-btn block"
            onClick={() => onViewOnMap?.(incident)}
            disabled={!hasCoords}
            title={hasCoords ? "Show on the Command map" : "No location on record"}
          >
            <span className="material-symbols-outlined">map</span>
            View on map
          </button>
        )}
      </DetailsSection>
    </div>
  );

  return (
    <DetailsLayout onBack={onBack} backLabel="Incidents" aside={aside}>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="idp-hero idp-hero-fire">
        <div className="idp-hero-top">
          <div className="idp-hero-left">
            <div className="idp-hero-icon idp-tile-fire">
              <FireGeneralIcon className="idp-hero-svg" />
            </div>
            <div className="idp-hero-text">
              <div className="idp-eyebrow">
                {incident.id}
              </div>
              <div className="idp-title">{incident.loc}</div>
              {incident.addr && <div className="idp-addr">{incident.addr}</div>}
              <div className="idp-chips">
                <SeverityBadge sev={incident.sev} />
              </div>
            </div>
          </div>
          <div className="idp-actions">
            <button
              type="button"
              className="act-icon-btn"
              onClick={() => onEdit?.(incident)}
              title="Edit incident"
              aria-label="Edit incident"
            >
              <EditIcon />
            </button>
            <button
              type="button"
              className="act-icon-btn danger"
              onClick={() => onDelete?.(incident)}
              title="Delete incident"
              aria-label="Delete incident"
            >
              <RemoveIcon />
            </button>
          </div>
        </div>

        <div className="idp-stats">
          <StatTile label="Alarm Level" value={incident.alarm || "—"} sub="CURRENT" />
          <StatTile
            label="Units"
            value={dispatches ? dispatches.length : incident.units ?? 0}
            sub={`TEAM${(dispatches?.length ?? incident.units) === 1 ? "" : "S"} DISPATCHED`}
          />
          <StatTile
            label={closed ? "Duration" : "Time Elapsed"}
            value={duration ?? "—"}
            sub={closed ? "REPORTED → CLOSED" : "SINCE REPORT"}
          />
          <StatTile
            label="Casualties"
            value={incident.casualties || "None"}
            sub={hasCasualties ? "REPORTED" : "NONE REPORTED"}
            tone={hasCasualties ? "amber" : undefined}
          />
        </div>
      </div>

      {/* ── Progress ─────────────────────────────────────────────────── */}
      <DetailsSection title="Progress">
        <Progress
          status={incident.status}
          reportedAt={incident.reported_at}
          dispatchedAt={firstDispatchAt}
          closedAt={closedAt}
        />
      </DetailsSection>

      {/* ── Info ─────────────────────────────────────────────────────── */}
      <DetailsSection title="Incident Information">
        <DetailsGrid min={170}>
          <DetailsField label="Dispatch type" value={incident.dispatch_type || "Unspecified"} />
          <DetailsField label="Structure type" value={incident.structure || "—"} />
          <DetailsField label="Reported via" value={incident.reporter || "—"} />
          <DetailsField label="Reported at" value={formatReported(incident.reported_at)} />
          <DetailsField label="Severity" value={incident.sev || "—"} />
          <DetailsField label="Address" value={incident.addr || "—"} />
          <DetailsField label="Casualties" value={incident.casualties || "—"} highlight={hasCasualties} />
        </DetailsGrid>
      </DetailsSection>

      {/* ── Report ───────────────────────────────────────────────────── */}
      {closed && (
        <DetailsSection title="After-Action Report">
          {reportLoading ? (
            <div className="idp-report-state">Loading report…</div>
          ) : reportError ? (
            <DetailsProse tone="danger">
              Failed to load report: {reportError}
            </DetailsProse>
          ) : !report ? (
            <div className="idp-report-empty">
              <div className="idp-aside-empty-icon">
                <span className="material-symbols-outlined">description</span>
              </div>
              <div className="idp-aside-state">No report filed for this incident</div>
            </div>
          ) : (
            <>
              {(report.author || report.submitted_at) && (
                <div className="idp-author">
                  <span className="idp-author-av">{initials(report.author)}</span>
                  <div className="idp-author-info">
                    <div className="idp-author-name">
                      {report.author_rank ? `${report.author_rank} ` : ""}
                      {report.author || "Unknown"}
                    </div>
                    <div className="idp-author-sub">
                      Filed {report.submitted_at ? formatReported(report.submitted_at) : "—"}
                    </div>
                  </div>
                  <Tone tone="green">Filed</Tone>
                </div>
              )}

              <div className="idp-report-stats">
                <StatTile label="Cause" value={report.cause || "—"} />
                <StatTile label="Casualties" value={report.casualties || "—"} />
                <StatTile label="Damage Estimate" value={report.damage_estimate || "—"} />
              </div>

              <DetailsField label="Narrative">
                <DetailsProse>{report.narrative}</DetailsProse>
              </DetailsField>

              {report.recommendations && (
                <DetailsField label="Recommendations">
                  <DetailsProse>{report.recommendations}</DetailsProse>
                </DetailsField>
              )}

              {photos.length > 0 && (
                <DetailsField label={`Scene photos (${photos.length})`}>
                  <div className="idp-photo-grid">
                    {photos.map((url, i) => (
                      <button
                        key={url}
                        type="button"
                        className="idp-photo"
                        onClick={() => setPhotoIndex(i)}
                      >
                        <img
                          src={url}
                          alt={`Scene photo ${i + 1}`}
                          loading="lazy"
                        />
                        <span className="idp-photo-zoom">
                          <span className="material-symbols-outlined">zoom_in</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </DetailsField>
              )}
            </>
          )}
        </DetailsSection>
      )}

      {photoIndex !== null && photos[photoIndex] && (
        <PhotoViewer
          photos={photos}
          index={photoIndex}
          onIndexChange={setPhotoIndex}
          onClose={() => setPhotoIndex(null)}
          caption={[
            report.author && `Filed by ${report.author_rank ? `${report.author_rank} ` : ""}${report.author}`,
            report.submitted_at && formatReported(report.submitted_at),
          ].filter(Boolean).join(" · ")}
        />
      )}
    </DetailsLayout>
  );
}
