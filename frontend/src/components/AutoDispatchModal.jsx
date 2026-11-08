import { useEffect } from "react";
import { createPortal } from "react-dom";
import "../styles/AppModal.css";
import "../styles/ConfirmModal.css";
import "../styles/DispatchModal.css";
import "../styles/AutoDispatchModal.css";
import { ICON_CLOSE, ICON_TRUCK, ICON_WARN } from "./incidentFormOptions";
import { Icon, SectionHead } from "./incidentForm";

const separator = <span className="dpm-separator" aria-hidden="true"> | </span>;

// Human-friendly copy for each backend `reason` code returned when no team
// could be auto-dispatched (see auto_dispatch.select_best_team).
const REASON_COPY = {
  incident_missing_coordinates:
    "The incident has no map coordinates, so a route could not be computed.",
  no_teams_configured: "No response teams are configured in the system.",
  no_operational_station: "Every station with teams is marked inactive.",
  all_teams_active: "Every team is currently active on another incident.",
  no_team_on_shift: "No team is assigned to the currently active shift.",
  no_available_truck:
    "No station with an eligible team has an available truck.",
  no_team_on_standby:
    "No eligible team is fully on standby (all members available).",
};

const STAGE_LABELS = {
  total: "Teams configured",
  station_operational: "Station in service",
  not_active: "Not already active",
  on_shift: "On current shift",
  has_truck: "Station has a truck",
  members_standby: "All members on standby",
};

function formatEta(minutes) {
  if (minutes == null) return "—";
  if (minutes < 1) return "< 1 min";
  return `${Math.round(minutes)} min`;
}

/**
 * Shows the outcome of an auto-dispatch attempt after an incident is logged.
 *
 * Props:
 *   incident – the incident dict returned by createIncident (has id/loc/sev
 *              plus the nested `auto_dispatch` payload)
 *   onClose  – dismiss the modal
 *   onViewDispatch – optional; jumps to the incident on the map/sidebar. On
 *              success it shows the route; on failure it's where the
 *              dispatcher sends a team by hand.
 */
export default function AutoDispatchModal({ incident, onClose, onViewDispatch }) {
  const ad = incident?.auto_dispatch || {};
  const dispatched = ad.status === "dispatched";
  const candidates = ad.breakdown?.candidates || [];
  const winner = candidates[0] || null;
  const maxEta = Math.max(1, ...candidates.map((c) => c.eta_seconds || 0));

  const counts = ad.breakdown?.stage_counts || {};
  const hasFunnel = Object.keys(counts).length > 0;
  const total = Math.max(1, counts.total || 0);
  // The first check that no team passed is where auto-dispatch stopped.
  const stopKey = Object.keys(STAGE_LABELS).find((k) => (counts[k] ?? 0) === 0);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div className="apm-overlay adm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="apm-panel eim-panel adm-panel auto-dispatch-modal" role="dialog" aria-modal="true" aria-labelledby="adm-title">
        <div className="cfm-head dpm-header">
          <span className="cfm-badge">
            <Icon d={ICON_TRUCK} className="cfm-badge-icon" />
          </span>
          <div className="cfm-head-text">
            <div className="apm-eyebrow">AUTO-DISPATCH</div>
            <div id="adm-title" className="cfm-title">
              {dispatched ? "Team dispatched" : "No team available"}
            </div>
          </div>
          <button className="eim-close" onClick={onClose} aria-label="Close">
            <Icon d={ICON_CLOSE} />
          </button>
          <div className="eim-subtitle">
            <span className="eim-chip eim-chip-code">{incident?.id}</span>
            {incident?.loc && <span className="eim-chip">{incident.loc}</span>}
            {incident?.sev && <span className="eim-chip">{incident.sev}</span>}
          </div>
        </div>

        <div className="eim-body">
          {dispatched ? (
            <>
              <div className="adm-result ok" role="status">
                <span className="adm-result-icon"><Icon d={ICON_TRUCK} /></span>
                <span className="adm-result-text">
                  <span className="adm-result-title">
                    {winner?.team_name || `Team #${ad.team_id}`}
                  </span>
                  <span className="adm-result-desc">
                    {winner?.station_name || `Station #${ad.station_id}`}{separator}Nearest Available Crew
                  </span>
                </span>
                <span className="adm-eta">
                  <span className="adm-eta-val">{formatEta(ad.eta_minutes)}</span>
                  <span className="adm-eta-lbl">ETA</span>
                </span>
              </div>

              {candidates.length > 1 && (
                <section className="eim-section">
                  <SectionHead
                    title="Teams compared"
                    desc={`${candidates.length} eligible, ranked by drive time.`}
                  />
                  <ol className="adm-cands">
                    {candidates.map((c, i) => (
                      <li key={c.team_id} className={`adm-cand ${i === 0 ? "winner" : ""}`}>
                        <span className="adm-cand-rank">{i + 1}</span>
                        <span className="adm-cand-info">
                          <span className="adm-cand-name">
                            {c.team_name}
                            {i === 0 && <span className="adm-cand-tag">Sent</span>}
                          </span>
                          <span className="adm-cand-meta">
                            {c.station_name && <>{c.station_name}{separator}</>}
                            {(c.haversine_m / 1000).toFixed(1)} km
                            {c.eta_source === "haversine_fallback" && (
                              <>{separator}<span className="adm-cand-flag">estimate, routing offline</span></>
                            )}
                          </span>
                        </span>
                        <span className="adm-cand-bar" aria-hidden="true">
                          <span style={{ width: `${((c.eta_seconds || 0) / maxEta) * 100}%` }} />
                        </span>
                        <span className="adm-cand-eta">
                          {c.eta_seconds == null ? "—" : formatEta(c.eta_seconds / 60)}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          ) : (
            <>
              <div className="adm-result warn" role="alert">
                <span className="adm-result-icon"><Icon d={ICON_WARN} /></span>
                <span className="adm-result-text">
                  <span className="adm-result-title">Logged, but no crew was sent</span>
                  <span className="adm-result-desc">
                    {REASON_COPY[ad.reason] ||
                      `Auto-dispatch was not possible (${ad.reason || "unknown"}).`}
                  </span>
                </span>
              </div>

              {hasFunnel && (
                <section className="eim-section">
                  <SectionHead title="Why no team qualified" desc="Teams left after each check." />
                  <ol className="adm-funnel">
                    {Object.entries(STAGE_LABELS).map(([key, label]) => {
                      const n = counts[key] ?? 0;
                      return (
                        <li key={key} className={`adm-stage ${key === stopKey ? "stop" : ""}`}>
                          <span className="adm-stage-lbl">{label}</span>
                          <span className="adm-stage-bar" aria-hidden="true">
                            <span style={{ width: `${(n / total) * 100}%` }} />
                          </span>
                          <span className="adm-stage-val">{n}</span>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
            </>
          )}
        </div>

        <div className="eim-footer">
          <span className="eim-changes">
            {dispatched ? "Route is live on the map." : "You can still send a team by hand."}
          </span>
          <div className="eim-footer-actions">
            {onViewDispatch ? (
              <>
                <button className="apm-btn-cancel" onClick={onClose}>Close</button>
                <button className="apm-btn-submit" onClick={() => onViewDispatch(ad.dispatch_id)} autoFocus>
                  {dispatched ? "View on map" : "Dispatch manually"}
                </button>
              </>
            ) : (
              <button className="apm-btn-submit" onClick={onClose} autoFocus>Got it</button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
