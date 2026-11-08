import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { fetchTeams, createDispatch } from "../api";
import { getCurrentShift } from "../utils/shift";
import "../styles/AppModal.css";
import "../styles/ConfirmModal.css";
import "../styles/DispatchModal.css";
import { ICON_CLOSE, ICON_TRUCK, ICON_CHEVRON, ICON_ROUTE } from "./incidentFormOptions";
import { Icon, SectionHead, Callout } from "./incidentForm";

const isLeader = (m) => m.member_role === "Team Leader";
const stationOf = (t) => (t.station_name && t.station_name !== "—" ? t.station_name : null);
const separator = <span className="dpm-separator" aria-hidden="true"> | </span>;
const readinessBlocker = (team) => team.dispatch_blocker
  || (team.truck_id && team.truck_status && team.truck_status !== 'available' ? 'Assigned truck is unavailable.' : '')
  || (team.members || []).find(member => member.return_assignment_locked)?.return_assignment_reason
  || '';

export default function DispatchModal({ incident, onClose, onDispatched }) {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null); // full team object
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchTeams()
      .then(setTeams)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || saving) return;
      // Esc steps back from the review before closing the whole dialog.
      if (selected) { setSelected(null); setError(null); } else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving, selected]);

  async function handleDispatch() {
    if (!selected || readinessBlocker(selected)) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createDispatch({
        fire_id: incident.fire_id,
        team_id: selected.team_id,
      });
      onDispatched({
        team: selected,
        dispatchId: result.dispatch_id,
        routes: result.routes ?? [],
      });
    } catch (ex) {
      setError(ex.message);
      setSaving(false);
    }
  }

  function back() {
    setSelected(null);
    setError(null);
  }

  // Only teams on the currently active A/B shift are dispatchable.
  const shiftLetter = getCurrentShift().letter;
  const availableTeams = teams.filter(
    (t) => t.team_status === "standby" && t.shift_name === `Shift ${shiftLetter}`
  ).sort((a, b) => Number(!readinessBlocker(b)) - Number(!readinessBlocker(a)));
  const crew = selected
    ? [...(selected.members || [])].sort((a, b) => isLeader(b) - isLeader(a))
    : [];
  const hasGps = !!(selected?.station_latitude && selected?.station_longitude);

  return createPortal(
    <div className="apm-overlay adm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <div className="apm-panel eim-panel adm-panel dpm-panel" role="dialog" aria-modal="true" aria-labelledby="dpm-title">
        <div className="cfm-head dpm-header">
          <span className="cfm-badge">
            <Icon d={ICON_TRUCK} className="cfm-badge-icon" />
          </span>
          <div className="cfm-head-text">
            <div className="apm-eyebrow">DISPATCH</div>
            <div id="dpm-title" className="cfm-title">
              {selected ? "Confirm dispatch" : "Send a team"}
            </div>
          </div>
          <button className="eim-close" onClick={onClose} aria-label="Close" disabled={saving}>
            <Icon d={ICON_CLOSE} />
          </button>
          <div className="eim-subtitle">
            <span className="eim-chip eim-chip-code">{incident.id}</span>
            {incident.loc && <span className="eim-chip">{incident.loc}</span>}
            {incident.sev && <span className="eim-chip">{incident.sev}</span>}
          </div>
        </div>

        <div className="eim-body">
          {!selected ? (
            <section className="eim-section">
              <SectionHead
                title="Standby Teams"
                desc={loading ? "Loading…" : <>{availableTeams.length} on standby{separator}Shift {shiftLetter}</>}
              />
              {loading ? (
                <div className="adm-cands" aria-busy="true">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="dpm-team dpm-skeleton">
                      <span className="dpm-team-av" />
                      <span className="dpm-sk-lines"><span /><span /></span>
                    </div>
                  ))}
                </div>
              ) : availableTeams.length === 0 ? (
                <div className="dpm-empty">
                  <strong>No team on standby for Shift {shiftLetter}.</strong>
                  <span>Teams already on an incident or on the other shift can&apos;t be dispatched.</span>
                </div>
              ) : (
                <ul className="adm-cands">
                  {availableTeams.map((team) => {
                    const leader = (team.members || []).find(isLeader);
                    const station = stationOf(team);
                    const blocker = readinessBlocker(team);
                    const truckReadiness = blocker.match(/^Truck not ready:\s*(.*?)\.\s*([\s\S]*)$/i);
                    const truckNotReady = /^Truck not ready:/i.test(blocker) || (team.truck_status && team.truck_status !== "available");
                    const truckPlate = team.truck_platenum || truckReadiness?.[1];
                    return (
                      <li key={team.team_id}>
                        <button type="button" className={`dpm-team${!blocker ? " dpm-team-eligible" : ""}`} disabled={!!blocker} title={blocker || undefined} onClick={() => setSelected(team)}>
                          <span className="dpm-team-av"><Icon d={ICON_TRUCK} /></span>
                          <span className="dpm-team-info">
                            <span className="dpm-team-name">
                              {team.team_name}
                            </span>
                            <span className="dpm-team-meta">
                              {leader?.name && <>{leader.name}{separator}</>}
                              {station || "No station assigned"}
                              {!team.station_latitude && <>{separator}<span className="dpm-flag">no station GPS</span></>}
                              {team.station_status === "inactive" && <>{separator}<span className="dpm-flag">station inactive</span></>}
                            </span>
                            {blocker && (
                              <span className="dpm-readiness dpm-flag">
                                <span className="dpm-readiness-title">
                                  {truckNotReady ? "Truck not Ready" : "Team not ready"}
                                  {truckNotReady && truckPlate && <>{separator}{truckPlate}</>}
                                </span>
                                <span className="dpm-readiness-reason">{truckReadiness ? truckReadiness[2] : blocker}</span>
                              </span>
                            )}
                          </span>
                          <span className="dpm-team-count">{team.member_count} crew</span>
                          <Icon d={ICON_CHEVRON} className="eim-icon dpm-team-chev" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : (
            <>
              <div className="adm-result dpm-selected">
                <span className="adm-result-icon"><Icon d={ICON_TRUCK} /></span>
                <span className="adm-result-text">
                  <span className="adm-result-title">
                    {selected.team_name}
                  </span>
                  <span className="adm-result-desc">{stationOf(selected) || "No station assigned"}</span>
                </span>
                <button type="button" className="eim-link-btn" onClick={back} disabled={saving}>
                  Change
                </button>
              </div>

              <section className="eim-section">
                <SectionHead title="Crew" desc={`${crew.length} ${crew.length === 1 ? "Person" : "People"} will be Notified`} />
                {crew.length === 0 ? (
                  <div className="dpm-empty">
                    <strong>No personnel assigned to this team.</strong>
                    <span>The route will still be drawn, but nobody gets the dispatch on their phone.</span>
                  </div>
                ) : (
                  <ul className="adm-cands">
                    {crew.map((p) => (
                      <li key={p.per_id} className="dpm-member">
                        <span className="dpm-member-av">{p.initials}</span>
                        <span className="dpm-team-info">
                          <span className="dpm-team-name">{p.name}</span>
                          <span className="dpm-team-meta">{p.rank}</span>
                        </span>
                        {p.member_role && (
                          <span className={`dpm-role ${isLeader(p) ? "lead" : ""}`}>{p.member_role}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {hasGps ? (
                <div className="dpm-route">
                  <Icon d={ICON_ROUTE} />
                  <span>A route will be drawn from <strong>{selected.station_name}</strong> to the incident.</span>
                </div>
              ) : (
                <Callout>This team&apos;s station has no GPS coordinates, so no route will be drawn on the map.</Callout>
              )}

              {error && <div className="apm-error">{error}</div>}
            </>
          )}
        </div>

        <div className="eim-footer">
          <span className="eim-changes">Step {selected ? 2 : 1} of 2{separator}{selected ? "Review" : "Choose a Team"}</span>
          <div className="eim-footer-actions">
            {!selected ? (
              <button className="apm-btn-cancel" onClick={onClose}>Cancel</button>
            ) : (
              <>
                <button className="apm-btn-cancel" onClick={back} disabled={saving}>Back</button>
                <button className="apm-btn-submit" onClick={handleDispatch} disabled={saving} autoFocus>
                  {saving ? <span className="apm-spinner" /> : "Dispatch team"}
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
