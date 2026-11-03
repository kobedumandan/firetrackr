import { DetailsField, DetailsGrid, DetailsProse } from "../layout/DetailsLayout";
import KpiCard from "./KpiCard";
import { EditIcon } from "./incidentUi";
import { duration } from "../utils/operationalTimes";
import "../styles/IncidentDetailsPage.css";
import "../styles/ResponderRouteHistory.css";
import "../styles/AfterActionReport.css";

const hasValue = value => value != null && (typeof value !== "string" || value.trim() !== "");
const valueOrMissing = value => hasValue(value) ? value : "Not recorded";
const reportDate = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric" });
const reportClock = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit", second: "2-digit" });

function ReportTime({ value, stacked = false }) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return stacked ? <span className="aar-missing">-</span> : <>Not recorded</>;
  return (
    <time className={`aar-datetime${stacked ? " is-stacked" : ""}`} dateTime={value}>
      <span className="aar-date">{reportDate.format(date)}</span>
      {!stacked && <span className="aar-time-separator" aria-hidden="true">|</span>}
      <span className="aar-time">{reportClock.format(date)}</span>
    </time>
  );
}

export default function AfterActionReport({ report, loading, error, onPhotoSelect, onEdit }) {
  if (loading) return <div className="idp-aside-state" role="status">Loading after-action report…</div>;
  if (error) return (
    <div role="alert">
      <DetailsProse tone="danger">Failed to load report: {error}</DetailsProse>
    </div>
  );
  if (!report) return (
    <div className="idp-aside-empty" role="status">
      <div className="idp-aside-empty-icon" aria-hidden="true">
        <span className="material-symbols-outlined">description</span>
      </div>
      <div className="idp-aside-state">No report filed for this incident</div>
    </div>
  );

  const photos = report.photos ?? [];
  const timing = report.operational_timing;
  const author = hasValue(report.author) ? report.author : "Unknown author";
  const initials = String(report.author || "").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "?";
  const facts = [
    { label: "Reported cause", value: report.cause, icon: "find_in_page" },
    { label: "Casualties", value: report.casualties, icon: "personal_injury" },
    { label: "Damage estimate", value: report.damage_estimate, icon: "payments" },
  ];

  return (
    <article className="aar-report" aria-label="Filed after-action report">
      <header className="idp-unit">
        <div className="idp-unit-top">
          <span className="idp-unit-icon aar-initials" aria-hidden="true">{initials}</span>
          <div className="idp-unit-info">
            <div className="dl-label">Filed by</div>
            <div className="dl-value">{author}</div>
            {hasValue(report.author_rank) && <div className="aar-rank">{report.author_rank}</div>}
          </div>
          <span className="idp-pill idp-tone-green">Filed</span>
        </div>
        <div className="idp-unit-rows">
          <div className="dl-meta-row aar-filed-at">
            <span className="aar-filed-timestamp">
              <span className="material-symbols-outlined" aria-hidden="true">schedule</span>
              <ReportTime value={report.submitted_at} />
            </span>
            {onEdit && <button type="button" className="act-icon-btn aar-edit" onClick={onEdit} aria-label="Edit after-action report" title="Edit after-action report">
              <EditIcon />
            </button>}
          </div>
        </div>
      </header>

      <div className="rt-personal-metrics aar-metrics">
        {facts.map(({ label, value, icon }) => (
          <KpiCard
            key={label}
            label={label}
            value={valueOrMissing(value)}
            icon={<span className="material-symbols-outlined" aria-hidden="true">{icon}</span>}
            accent="muted"
          />
        ))}
      </div>

      {timing?.response_kind === "fire" && (
        <section className="idp-unit aar-operations" aria-label="Fire operations">
          <div className="dl-meta-row aar-operations-heading">
            <span className="dl-label">Fire-operation times</span>
          </div>
          <DetailsGrid min={150}>
            <DetailsField label="Suppression started" value={<ReportTime value={timing.suppression_started_at} stacked />} />
            <DetailsField label="Fire contained" value={<ReportTime value={timing.controlled_at} stacked />} />
            <DetailsField label="Fire out" value={<ReportTime value={timing.fire_out_at} stacked />} />
            <DetailsField label="Suppression duration" value={<span className={!Number.isFinite(timing.suppression_seconds) ? "aar-missing" : undefined}>{duration(timing.suppression_seconds, "-")}</span>} />
          </DetailsGrid>
        </section>
      )}

      <DetailsField label="Narrative">
        <DetailsProse tone={!hasValue(report.narrative) ? "muted" : undefined}>
          {hasValue(report.narrative) ? report.narrative : "No narrative was included in this report"}
        </DetailsProse>
      </DetailsField>

      {hasValue(report.recommendations) && (
        <DetailsField label="Recommendations">
          <DetailsProse>{report.recommendations}</DetailsProse>
        </DetailsField>
      )}

      {photos.length > 0 && (
        <DetailsField label={`Scene photos (${photos.length})`}>
          <div className="aar-photo-grid">
            {photos.map((url, index) => (
              <button key={`${url}-${index}`} type="button" className="aar-photo" onClick={() => onPhotoSelect?.(index)} aria-label={`View scene photo ${index + 1}`}>
                <img src={url} alt={`Scene photo ${index + 1}`} loading="lazy" />
                <span className="aar-photo-zoom" aria-hidden="true">
                  <span className="material-symbols-outlined">zoom_in</span>
                </span>
              </button>
            ))}
          </div>
        </DetailsField>
      )}
    </article>
  );
}
