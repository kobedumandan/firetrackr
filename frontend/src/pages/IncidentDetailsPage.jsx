import { useState, useEffect, useRef } from "react";
import PhotoViewer from "../components/PhotoViewer";
import "../styles/IncidentDetailsPage.css";
import DetailsLayout, {
  DetailsSection,
  DetailsGrid,
  DetailsField,
} from "../layout/DetailsLayout";
import {
  SeverityBadge,
  EditIcon,
  RemoveIcon,
  FireGeneralIcon,
  formatReported,
} from "../components/incidentUi";
import { fetchIncidentReport, fetchDispatches } from "../api";
import AfterActionReport, { ReportTime } from "../components/AfterActionReport";
import AfterActionReportModal from "../components/AfterActionReportModal";
import IncidentExportModal from "../components/IncidentExportModal";
import IncidentWorkflowPanel from '../components/IncidentWorkflowPanel';
import IncidentTeamResponseActions from '../components/IncidentTeamResponseActions';
import { Icon } from '../components/incidentForm';
import { ICON_CHECK, supportsFireAlarm } from '../components/incidentFormOptions';
import useIncidentWorkflow from '../hooks/useIncidentWorkflow';
import { incidentControl, incidentStage } from '../utils/incidentOperations';
import { isDateOnly } from '../utils/incidentDate';

const STEPS = [
  { key: "pending", label: "Reported" },
  { key: "responding", label: "Responding" },
  { key: "under_control", label: "Under Control" },
  { key: "operation_complete", label: "Operation Complete" },
  { key: "closed", label: "Closed" },
];
const STEP_INDEX = { pending: 0, responding: 1, under_control: 2, operation_complete: 3, closed: 4 };

const DISPATCH_STATUS = {
  dispatched: { label: "Dispatched", tone: "amber" },
  en_route: { label: "En Route", tone: "amber" },
  on_scene: { label: "On Scene", tone: "amber" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

function clock(iso) {
  if (isDateOnly(iso)) return 'Time not recorded';
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-PH", { timeZone: 'Asia/Manila', hour: "2-digit", minute: "2-digit" });
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

/* Report closure comes from the recorded status event, independently of a
   report added later by an administrator. */
function Progress({ incident, reportedAt, dispatchedAt, closedAt }) {
  const current = STEP_INDEX[incidentStage(incident)] ?? 0;
  const timelineRef = useRef(null);
  const times = [reportedAt, dispatchedAt, null, incident.operation_completed_at, closedAt];
  useEffect(() => {
    const timeline = timelineRef.current;
    const step = timeline?.children[current];
    if (step) timeline.scrollLeft = Math.max(0, step.offsetLeft - (timeline.clientWidth - step.clientWidth) / 2);
  }, [current]);
  return (
    <div className={`idp-steps eim-steps${incident.status === 'closed' ? ' complete' : ''}`} ref={timelineRef} tabIndex={0} role="list" aria-label="Incident progress">
      {STEPS.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "todo";
        return (
          <div key={s.key} className={`idp-step eim-step ${state} is-${state}`} role="listitem" aria-current={state === 'current' ? 'step' : undefined}>
            <span className="eim-step-node" aria-hidden="true">
              {state === "done" ? <Icon d={ICON_CHECK} className="eim-step-icon" /> : i + 1}
            </span>
            <div className="idp-step-label eim-step-label">{s.key === 'under_control' ? incidentControl(incident).label : s.label}</div>
            <div className="idp-step-time">
              {state !== "todo" ? clock(times[i]) ?? "—" : "Pending"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function UnitCard({ d, now, workflow }) {
  const assignment = workflow.data?.dispatches.find(dispatch => dispatch.dispatch_id === d.dispatch_id);
  const dispatchStatus = assignment?.dispatch_status || d.dispatch_status;
  const st = (assignment?.cleared_at || d.cleared_at) ? { label: "Cleared", tone: "green" }
    : DISPATCH_STATUS[dispatchStatus] ?? { label: dispatchStatus, tone: "muted" };
  const live = !d.arrived_at && ["dispatched", "en_route"].includes(dispatchStatus);
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
            {d.station_name || "—"}
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
              ? clock(d.arrived_at) ?? "—"
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
      <IncidentTeamResponseActions dispatch={assignment} workflow={workflow} />
    </div>
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
 * @param onViewAnalysis open response analysis for this incident
 */
export default function IncidentDetailsPage({
  incident,
  onBack,
  onEdit,
  onDelete,
  onViewOnMap,
  onViewAnalysis,
  onUpdated,
  section = null,
  sectionFocusNonce = 0,
}) {
  const [reportState, setReportState] = useState(null);
  const [reportRevision, setReportRevision] = useState(0);
  const [reportEditor, setReportEditor] = useState(null);
  const [exportOpen, setExportOpen] = useState(false);
  const fireId = incident?.fire_id;
  const workflow = useIncidentWorkflow(fireId, reportRevision, updated => {
    setReportRevision(value => value + 1);
    onUpdated?.(updated);
  });
  const incStatus = incident?.status;
  const canFileReport = !!incident && !['cancelled', 'canceled', 'recalled'].includes(incStatus);
  const reportReady = reportState?.fireId === fireId && reportState?.status === incStatus && reportState?.revision === reportRevision;
  const report = reportReady ? reportState.report : null;
  const reportError = reportReady ? reportState.error : null;
  const reportLoading = canFileReport && !reportReady;
  // Keyed by fire_id so rows from a previous incident never show on this one;
  // `dispatches` is null until this incident's fetch lands.
  const [dispatchState, setDispatchState] = useState({ fireId: null, rows: null });
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Index of the scene photo shown in the in-app viewer; null = viewer closed.
  const [photoIndex, setPhotoIndex] = useState(null);
  const workflowSectionRef = useRef(null);

  useEffect(() => {
    if (fireId == null || section !== 'response-reporting') return;
    const target = workflowSectionRef.current;
    target?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
    target?.focus({ preventScroll: true });
  }, [fireId, section, sectionFocusNonce]);

  // Keeps "time on incident" and "en route for" honest while the page is open.
  useEffect(() => {
    if (incident?.status === "closed") return;
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, [incident?.status]);

  // Contained incidents may need an administrator to file the closing report.
  // Key the result by incident/status/revision so another report never flashes here.
  useEffect(() => {
    if (!canFileReport || fireId == null) return;
    let cancelled = false;
    fetchIncidentReport(fireId)
      .then((r) => {
        if (!cancelled) setReportState({ fireId, status: incStatus, revision: reportRevision, report: r, error: null });
      })
      .catch((e) => {
        if (!cancelled) setReportState({ fireId, status: incStatus, revision: reportRevision, report: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [fireId, incStatus, canFileReport, reportRevision]);

  useEffect(() => {
    const refresh = event => {
      if (event.detail?.fireId === fireId) setReportRevision(value => value + 1);
    };
    window.addEventListener('incident-report-updated', refresh);
    const refreshWorkflow = () => setReportRevision(value => value + 1);
    window.addEventListener('operational-times-updated', refreshWorkflow);
    return () => { window.removeEventListener('incident-report-updated', refresh); window.removeEventListener('operational-times-updated', refreshWorkflow); };
  }, [fireId]);

  // Units sent to this incident, for the Responding Units column and the
  // "Dispatched" step's timestamp. Refetched when the status moves.
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
  }, [fireId, incStatus, reportRevision]);
  const dispatches = dispatchState.fireId === fireId ? dispatchState.rows : null;

  const photos = report?.photos ?? [];

  if (!incident) return null;

  const closed = incident.status === "closed";
  const alarm = supportsFireAlarm(incident.dispatch_type) && incident.alarm
    && !['n/a', 'not applicable', '-', '—'].includes(incident.alarm.trim().toLowerCase())
    ? incident.alarm : null;
  const hasCoords = incident.latitude != null && incident.longitude != null;
  const hasMapPin = hasCoords && !incident.operation_completed_at
    && ['pending', 'responding', 'under_control'].includes(incidentStage(incident));
  const coords = hasCoords
    ? `${incident.latitude.toFixed(5)}, ${incident.longitude.toFixed(5)}`
    : "—";
  const hasCasualties =
    !!incident.casualties && incident.casualties !== "None" && incident.casualties !== "—";

  const firstDispatchAt = dispatches?.length
    ? dispatches.map((d) => d.dispatch_at).filter(Boolean).sort()[0]
    : null;
  const closedAt = report && Object.hasOwn(report, "closed_at") ? report.closed_at : report?.submitted_at ?? null;
  const endMs = closed && closedAt ? new Date(closedAt).getTime() : now;
  const duration = closed && !closedAt ? null : span(incident.reported_at, endMs);

  function copyCoords() {
    if (!hasCoords || !navigator.clipboard) return;
    navigator.clipboard.writeText(coords).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleReportSaved(result) {
    setReportState({ fireId, status: result.incident.status, revision: reportRevision, report: result.report, error: null });
    setReportEditor(null);
    setPhotoIndex(null);
    onUpdated?.(result.incident);
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
              <UnitCard key={d.dispatch_id} d={d} now={now} workflow={workflow} />
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
        {hasMapPin && (
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
              onClick={() => setExportOpen(true)}
              disabled={fireId == null}
              title="Export incident report"
              aria-label="Export incident report"
            >
              <span className="material-symbols-outlined" aria-hidden="true">download</span>
            </button>
            <button
              type="button"
              className="act-icon-btn"
              onClick={() => onEdit?.(incident)}
              disabled={!!incident.archived_at}
              title="Edit incident"
              aria-label="Edit incident"
            >
              <EditIcon />
            </button>
            <button
              type="button"
              className="act-icon-btn danger"
              onClick={() => onDelete?.(incident)}
              disabled={!!incident.archived_at}
              title="Archive incident"
              aria-label="Archive incident"
            >
              <RemoveIcon />
            </button>
          </div>
        </div>

        <div className="idp-stats">
          <StatTile label="Alarm Level" value={alarm || "-"} sub={incident.alarm_basis === 'user_annotation' ? 'ANNOTATED' : 'CURRENT'} tone={alarm ? undefined : "muted"} />
          <StatTile
            label="Units"
            value={incident.data_source && incident.units == null && !dispatches?.length ? 'Not recorded' : dispatches ? dispatches.length : incident.units ?? 0}
            sub={`TEAM${(dispatches?.length ?? incident.units) === 1 ? "" : "S"} DISPATCHED`}
          />
          <StatTile
            label={closed ? "Duration" : "Time Elapsed"}
            value={duration ?? "—"}
            sub={closed ? "REPORTED → CLOSED" : "SINCE REPORT"}
          />
          <StatTile
            label="Casualties"
            value={incident.casualties || "Unconfirmed"}
            sub={incident.casualties_reviewed_at ? "DISPATCHER REVIEWED" : "PENDING REVIEW"}
            tone={hasCasualties ? "amber" : undefined}
          />
        </div>
        <Progress
          incident={incident}
          reportedAt={incident.reported_at}
          dispatchedAt={firstDispatchAt}
          closedAt={closedAt}
        />
      </div>

      {/* ── Info ─────────────────────────────────────────────────────── */}
      <DetailsSection title="Incident Information">
        <DetailsGrid min={170}>
          <DetailsField label="Dispatch type" value={incident.dispatch_type || "Unspecified"} />
          <DetailsField label="Structure type" value={incident.structure || "—"} />
          <DetailsField label="Reported via" value={(incident.reporter_name ?? incident.reporter) || "—"} />
          <DetailsField label="Reporter contact number" value={incident.reporter_contact || "—"} />
          <DetailsField label={incident.occurrence_precision === 'date_only' ? 'Incident date' : 'Reported at'} value={<ReportTime value={incident.reported_at} stacked />} />
          {incident.data_source && <DetailsField label="Data source" value={`${incident.data_source} · ${incident.source_record_id}`} />}
          <DetailsField label="Severity" value={incident.sev || "—"} />
          <DetailsField label="Address" value={incident.addr || "—"} />
          <DetailsField label="Casualties" value={incident.casualties || "—"} highlight={hasCasualties} />
        </DetailsGrid>
      </DetailsSection>

      {(fireId != null || canFileReport) && (
        <div id="response-reporting" className="idp-linked-section" ref={workflowSectionRef} tabIndex={-1} role="region" aria-label="Response & Reporting">
          <DetailsSection title="Response & Reporting">
            {fireId != null && <IncidentWorkflowPanel
              key={fireId}
              fireId={fireId}
              workflow={workflow}
              onPrepare={sourceReport => setReportEditor({ incident, report: null, sourceReport })}
            />}
            {canFileReport && <section className="idp-report-section" aria-label="Incident report">
              <header className="idp-report-heading">
                <h3>Incident Report</h3>
                {report && !reportLoading && !reportError && <button type="button" className="act-icon-btn aar-edit" onClick={() => setReportEditor({ incident, report })} aria-label="Edit incident report" title="Edit incident report"><EditIcon /></button>}
                {!report && <span className="aar-section-actions">
                  {reportError && <button type="button" className="eim-link-btn" onClick={() => setReportRevision(value => value + 1)}>Retry</button>}
                  {closed && <button
                    type="button"
                    className="act-btn"
                    aria-label="Add incident report"
                    disabled={reportLoading || !!reportError}
                    onClick={() => setReportEditor({ incident, report })}
                  >
                    <EditIcon /> Add report
                  </button>}
                </span>}
              </header>
              <AfterActionReport
                report={report}
                incident={incident}
                loading={reportLoading}
                error={reportError}
                onPhotoSelect={setPhotoIndex}
              />
            </section>}
          </DetailsSection>
        </div>
      )}

      {fireId != null && onViewAnalysis && (
        <div className="act-group">
          <button type="button" className="act-btn" onClick={() => onViewAnalysis(incident)}>
            <span className="material-symbols-outlined" aria-hidden="true">analytics</span>
            View response analysis
          </button>
        </div>
      )}

      {exportOpen && <IncidentExportModal key={fireId} incident={incident} onClose={() => setExportOpen(false)} />}

      {reportEditor && <AfterActionReportModal
        incident={reportEditor.incident}
        report={reportEditor.report}
        sourceReport={reportEditor.sourceReport}
        fieldReports={workflow.data?.field_reports || []}
        onClose={() => setReportEditor(null)}
        onSaved={handleReportSaved}
      />}

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
