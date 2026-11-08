import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  fetchDispatchRecommendations,
  fetchTeams,
  createDispatch,
  updateIncident,
} from "../api";
import "../styles/AppModal.css";
import "../styles/ConfirmModal.css";
import "../styles/DispatchModal.css";
import "../styles/EscalateAlarmModal.css";
import { ICON_CLOSE, ICON_CHECK, ICON_WARN } from "./incidentFormOptions";
import { Icon, SectionHead, Callout, LockedNote } from "./incidentForm";

// Alarm levels the dashboard exposes (mirrors Log/Edit incident modals). The
// backend also knows "General Alarm", but the rest of the UI caps at 3rd, so
// escalation does too — a dispatcher never escalates past what they can log.
const ALARM_LEVELS = ["1st Alarm", "2nd Alarm", "3rd Alarm"];

// Human copy for the diagnostic `reason` codes when nothing eligible remains.
const REASON_COPY = {
  incident_missing_coordinates:
    "The incident has no map coordinates, so routes can't be computed.",
  no_teams_configured: "No response teams are configured in the system.",
  no_operational_station: "Every station with teams is marked inactive.",
  all_teams_active: "Every other team is already active on an incident.",
  no_team_on_shift: "No additional team is assigned to the current shift.",
  no_available_truck: "No remaining eligible team has an available truck.",
  no_team_on_standby: "No additional team is fully on standby.",
};

function formatEta(minutes) {
  if (minutes == null) return "—";
  if (minutes < 1) return "< 1 min";
  return `${Math.round(minutes)} min`;
}

/* 1st → 2nd → 3rd, read-only: where the incident is, and where it's going. */
function AlarmTrack({ currentIdx, targetIdx }) {
  return (
    <ol className="eam-track" aria-label="Alarm level">
      {ALARM_LEVELS.map((lvl, i) => {
        const state = i === targetIdx ? "target" : i === currentIdx ? "current" : i < currentIdx ? "past" : "todo";
        return (
          <li key={lvl} className={`eam-level ${state}`}>
            <span className="eam-level-node">{i + 1}</span>
            <span className="eam-level-label">
              {lvl}
              {state === "current" && <em>Now</em>}
              {state === "target" && <em>Next</em>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Propose-and-confirm alarm escalation.
 *
 * Raises the incident's alarm level and lets the dispatcher review a ranked
 * shortlist of additional units before committing. Nothing is dispatched until
 * the dispatcher confirms — the system recommends, the human authorizes.
 *
 * Props:
 *   incident      – selected incident (needs fire_id, alarm, id, loc, sev)
 *   onClose       – dismiss the modal
 *   onDispatched  – called once per team actually dispatched, with
 *                   { team, dispatchId, routes } (same shape DispatchModal uses)
 */
export default function EscalateAlarmModal({ incident, onClose, onDispatched }) {
  const currentLevel = incident?.alarm || "1st Alarm";
  const currentIdx = Math.max(0, ALARM_LEVELS.indexOf(currentLevel));
  const nextLevel = ALARM_LEVELS[currentIdx + 1] || null;
  const atMax = !nextLevel;

  // Only fetch (and thus start in a loading state) when there's a level to
  // escalate to and a real incident to fetch for.
  const willFetch = !atMax && !!incident?.fire_id;
  const [loading, setLoading] = useState(willFetch);
  const [loadError, setLoadError] = useState(null);
  const [recs, setRecs] = useState([]);
  const [teams, setTeams] = useState([]);
  const [alreadyActive, setAlreadyActive] = useState(0);
  const [targetUnits, setTargetUnits] = useState(null);
  const [reason, setReason] = useState(null);
  const [selected, setSelected] = useState(() => new Set());

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!willFetch) return;
    let cancelled = false;
    Promise.all([
      fetchDispatchRecommendations(incident.fire_id, {
        limit: 8,
        targetLevel: nextLevel,
      }),
      fetchTeams().catch(() => []),
    ])
      .then(([data, teamList]) => {
        if (cancelled) return;
        const recommended = data.recommended || [];
        const active = data.already_active || 0;
        const target = data.target_units ?? currentIdx + 2;
        setRecs(recommended);
        setTeams(teamList || []);
        setAlreadyActive(active);
        setTargetUnits(target);
        setReason(data.reason || null);
        // Pre-select the top (target − already responding) recommended units.
        const additional = Math.max(target - active, 0);
        setSelected(
          new Set(recommended.slice(0, additional).map((r) => r.team_id))
        );
      })
      .catch((ex) => {
        if (!cancelled) setLoadError(ex.message || "Failed to load recommendations.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [willFetch, incident?.fire_id, nextLevel, currentIdx]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const recommendedCount = useMemo(
    () => Math.max((targetUnits ?? 0) - alreadyActive, 0),
    [targetUnits, alreadyActive]
  );
  const shortfall = Math.max(recommendedCount - recs.length, 0);
  const maxEta = Math.max(1, ...recs.map((r) => r.eta_minutes || 0));

  function toggle(teamId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  }

  async function handleConfirm() {
    if (!incident?.fire_id || !nextLevel) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // 1. Raise the alarm level (broadcasts incident_updated → sidebar refreshes).
      await updateIncident(incident.fire_id, { fire_alarm_level: nextLevel });

      // 2. Dispatch each chosen team in ranked order. Reuses the same dispatch
      //    endpoint as manual dispatch, so routes/websocket behave identically.
      const chosen = recs.filter((r) => selected.has(r.team_id));
      for (const rec of chosen) {
        const result = await createDispatch({
          fire_id: incident.fire_id,
          team_id: rec.team_id,
        });
        const full = teams.find((t) => t.team_id === rec.team_id);
        onDispatched?.({
          team: full || {
            team_id: rec.team_id,
            team_name: rec.team_name,
            station_name: rec.station_name,
            members: [],
          },
          dispatchId: result.dispatch_id,
          routes: result.routes ?? [],
        });
      }
      onClose();
    } catch (ex) {
      setSubmitError(ex.message || "Escalation failed.");
      setSubmitting(false);
    }
  }

  const selectedCount = selected.size;
  const ready = !atMax && !loading && !loadError;

  return createPortal(
    <div className="apm-overlay adm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <div className="apm-panel eim-panel adm-panel eam-panel" role="dialog" aria-modal="true" aria-labelledby="eam-title">
        <div className="cfm-head dpm-header">
          <span className="cfm-badge">
            <Icon d={ICON_WARN} className="cfm-badge-icon" />
          </span>
          <div className="cfm-head-text">
            <div className="apm-eyebrow">ESCALATE ALARM</div>
            <div id="eam-title" className="cfm-title">
              {atMax ? "Already at the highest alarm" : `Escalate to ${nextLevel}`}
            </div>
          </div>
          <button className="eim-close" onClick={onClose} aria-label="Close" disabled={submitting}>
            <Icon d={ICON_CLOSE} />
          </button>
          <div className="eim-subtitle">
            <span className="eim-chip eim-chip-code">{incident?.id}</span>
            {incident?.loc && <span className="eim-chip">{incident.loc}</span>}
            {incident?.sev && <span className="eim-chip">{incident.sev}</span>}
          </div>
        </div>

        <div className="eim-body">
          <AlarmTrack currentIdx={currentIdx} targetIdx={atMax ? -1 : currentIdx + 1} />

          {atMax ? (
            <div className="adm-result warn" role="status">
              <span className="adm-result-icon"><Icon d={ICON_WARN} /></span>
              <span className="adm-result-text">
                <span className="adm-result-title">No higher level to escalate to</span>
                <span className="adm-result-desc">
                  This incident is at {currentLevel}. Send more units with Dispatch instead.
                </span>
              </span>
            </div>
          ) : loadError ? (
            <div className="apm-error">{loadError}</div>
          ) : (
            <>
              {/* ── Units at a glance ── */}
              <div className="eam-stats">
                <div className="eam-stat">
                  <span className="eam-stat-val">{loading ? "–" : targetUnits}</span>
                  <span className="eam-stat-lbl">{nextLevel} calls for</span>
                </div>
                <div className="eam-stat">
                  <span className="eam-stat-val">{loading ? "–" : alreadyActive}</span>
                  <span className="eam-stat-lbl">Already responding</span>
                </div>
                <div className="eam-stat add">
                  <span className="eam-stat-val">{loading ? "–" : `+${selectedCount}`}</span>
                  <span className="eam-stat-lbl">Adding now</span>
                </div>
              </div>

              <section className="eim-section">
                <SectionHead
                  title="Additional units"
                  desc={loading ? "Finding the nearest teams…" : recs.length ? "Ranked by drive time. Tap to include or skip." : null}
                />

                {loading ? (
                  <div className="adm-cands" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="dpm-team dpm-skeleton">
                        <span className="eam-check" />
                        <span className="dpm-sk-lines"><span /><span /></span>
                      </div>
                    ))}
                  </div>
                ) : recs.length === 0 ? (
                  <LockedNote>
                    {REASON_COPY[reason] || "No additional units are available right now."}{" "}
                    The alarm level will still be raised.
                  </LockedNote>
                ) : (
                  <>
                    {shortfall > 0 && (
                      <Callout>
                        Only {recs.length} of the {recommendedCount} units this level calls for are available.
                      </Callout>
                    )}
                    <ul className="adm-cands">
                      {recs.map((c, i) => {
                        const isSel = selected.has(c.team_id);
                        return (
                          <li key={c.team_id}>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={isSel}
                              className={`adm-cand eam-cand ${isSel ? "selected" : ""}`}
                              onClick={() => toggle(c.team_id)}
                            >
                              <span className="eam-check">{isSel && <Icon d={ICON_CHECK} />}</span>
                              <span className="adm-cand-info">
                                <span className="adm-cand-name">
                                  {c.team_name}
                                  {i < recommendedCount && <span className="eam-rec-tag">Recommended</span>}
                                </span>
                                <span className="adm-cand-meta">
                                  {c.station_name ? `${c.station_name} · ` : ""}
                                  {(c.haversine_m / 1000).toFixed(1)} km
                                  {c.eta_source === "haversine_fallback" && (
                                    <span className="adm-cand-flag"> · estimate, routing offline</span>
                                  )}
                                </span>
                              </span>
                              <span className="adm-cand-bar" aria-hidden="true">
                                <span style={{ width: `${((c.eta_minutes || 0) / maxEta) * 100}%` }} />
                              </span>
                              <span className="adm-cand-eta">{formatEta(c.eta_minutes)}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>

              {submitError && <div className="apm-error">{submitError}</div>}
            </>
          )}
        </div>

        <div className="eim-footer">
          <span className="eim-changes">
            {ready && recs.length > 0
              ? `${selectedCount} of ${recs.length} units selected`
              : ready ? "Raises the alarm level only." : ""}
          </span>
          <div className="eim-footer-actions">
            {atMax ? (
              <button className="apm-btn-submit" onClick={onClose} autoFocus>Close</button>
            ) : (
              <>
                <button className="apm-btn-cancel" onClick={onClose} disabled={submitting}>Cancel</button>
                <button className="apm-btn-submit" onClick={handleConfirm} disabled={!ready || submitting}>
                  {submitting ? (
                    <span className="apm-spinner" />
                  ) : selectedCount > 0 ? (
                    `Escalate & dispatch ${selectedCount}`
                  ) : (
                    "Escalate alarm"
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
