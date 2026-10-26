import { useEffect, useState } from "react";
import { fetchDispatches, fetchIncidentEvents } from "../api";

function clock(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "2-digit", minute: "2-digit", hour12: true });
}

// "12m" / "1h 4m" between two instants.
function span(fromIso, toMs) {
  if (!fromIso) return null;
  const mins = Math.max(0, Math.floor((toMs - new Date(fromIso).getTime()) / 60000));
  if (!Number.isFinite(mins)) return null;
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const STATUS_LABEL = {
  pending: "Awaiting a crew",
  active: "Crew responding",
  dispatched: "Crew responding",
  contained: "Fire contained",
  closed: "Incident closed",
};

const ALARM_RANK = { "1st Alarm": 1, "2nd Alarm": 2, "3rd Alarm": 3, "General Alarm": 4 };
const SEV_RANK = { Minor: 1, Moderate: 2, Critical: 3 };

const by = (actor) => (actor ? `by ${actor}` : null);

/* One logged status / alarm / severity change → a timeline row, or null when
   another row already tells the story (dispatch rows cover "dispatched"). */
function changeRow(ev, hasDispatches) {
  const base = { key: `ev-${ev.event_id}`, at: ev.at };
  if (ev.type === "status") {
    if (ev.to === "dispatched" && hasDispatches) return null;
    const rows = {
      contained:  { tone: "green", title: "Fire contained" },
      closed:     { tone: "green", title: "Incident closed" },
      dispatched: { tone: "amber", title: "Marked dispatched" },
      pending:    { tone: "amber", title: "Set back to Pending" },
    };
    const row = rows[ev.to] || { tone: "muted", title: `Status: ${ev.to}` };
    return { ...base, ...row, desc: by(ev.actor) };
  }
  if (ev.type === "alarm") {
    const up = (ALARM_RANK[ev.to] || 0) > (ALARM_RANK[ev.from] || 0);
    return {
      ...base,
      tone: up ? "fire" : "muted",
      title: up ? `Escalated to ${ev.to}` : `Alarm lowered to ${ev.to}`,
      desc: [ev.from && `from ${ev.from}`, by(ev.actor)].filter(Boolean).join(" · "),
    };
  }
  if (ev.type === "severity") {
    const up = (SEV_RANK[ev.to] || 0) > (SEV_RANK[ev.from] || 0);
    return {
      ...base,
      tone: up ? "amber" : "muted",
      title: `Severity ${up ? "raised" : "lowered"} to ${ev.to}`,
      desc: [ev.from && `was ${ev.from}`, by(ev.actor)].filter(Boolean).join(" · "),
    };
  }
  return null;
}

/* Everything the system records for an incident, oldest first: the report,
   each logged status / alarm / severity change, and each unit's dispatch,
   arrival and release. Live states (en route, just arrived) have no stored
   time yet and sit after the latest timed row. */
function buildEvents(incident, dispatches, changes, now) {
  const events = [];
  // The level it was reported at: the first escalation's "from", else current.
  const initialAlarm = changes.find((c) => c.type === "alarm")?.from ?? incident.alarm;
  if (incident.reported_at) {
    events.push({
      key: "reported",
      at: incident.reported_at,
      tone: "fire",
      title: "Incident reported",
      desc: [incident.reporter && `via ${incident.reporter}`, initialAlarm].filter(Boolean).join(" · "),
    });
  }
  for (const ev of changes) {
    const row = changeRow(ev, dispatches.length > 0);
    if (row) events.push(row);
  }
  for (const d of dispatches) {
    const team = d.team_name || "Team";
    const trucks = d.truck_platenums?.length ? d.truck_platenums.join(", ") : null;
    if (d.dispatch_at) {
      events.push({
        key: `${d.dispatch_id}-sent`,
        at: d.dispatch_at,
        tone: "amber",
        title: `${team} dispatched`,
        desc: [d.station_name, trucks].filter(Boolean).join(" · "),
      });
    }
    if (d.arrived_at) {
      const response = span(d.dispatch_at, new Date(d.arrived_at).getTime());
      events.push({
        key: `${d.dispatch_id}-arrived`,
        at: d.arrived_at,
        tone: "green",
        title: `${team} on scene`,
        desc: response ? `Response time ${response}` : null,
      });
    } else if (d.dispatch_status === "on_scene") {
      // Arrival came in over the socket; the exact time lands on the next fetch.
      events.push({
        key: `${d.dispatch_id}-arrived`,
        at: null,
        tone: "green",
        title: `${team} on scene`,
        desc: "Just arrived",
      });
    } else if (["dispatched", "en_route"].includes(d.dispatch_status)) {
      events.push({
        key: `${d.dispatch_id}-enroute`,
        at: null,
        tone: "amber",
        live: true,
        title: `${team} en route`,
        desc: `${span(d.dispatch_at, now) ?? "0m"} since dispatch`,
      });
    }
    if (d.completed_at) {
      events.push({
        key: `${d.dispatch_id}-done`,
        at: d.completed_at,
        tone: "muted",
        title: `${team} released`,
        desc: "Back on standby",
      });
    }
  }
  return events.sort((a, b) => {
    if (!a.at) return 1;
    if (!b.at) return -1;
    return new Date(a.at) - new Date(b.at);
  });
}

export default function IncidentTimeline({ incident, liveDispatches = [] }) {
  const fireId = incident?.fire_id;
  const [state, setState] = useState({ fireId: null, rows: null, changes: [] });
  const [now, setNow] = useState(() => Date.now());

  // App state drops a dispatch once it completes, so fetch this incident's full
  // history, and refetch whenever its units, status, alarm or severity move.
  const liveKey = liveDispatches.map((d) => `${d.dispatch_id}:${d.dispatch_status}`).join("|");
  const incKey = `${incident?.status}|${incident?.alarm}|${incident?.sev}`;
  useEffect(() => {
    if (fireId == null) return;
    let cancelled = false;
    Promise.all([
      fetchDispatches(fireId).catch(() => []),
      fetchIncidentEvents(fireId).catch(() => []),
    ]).then(([rows, changes]) => {
      if (!cancelled) setState({ fireId, rows, changes });
    });
    return () => { cancelled = true; };
  }, [fireId, liveKey, incKey]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  if (!incident) return null;
  const loaded = state.fireId === fireId;
  const fetched = loaded ? state.rows : null;
  const changes = loaded ? state.changes : [];

  // Merge: fetched rows are authoritative; a just-created dispatch that the
  // fetch hasn't seen yet still shows from live state.
  const byId = new Map((fetched || []).map((d) => [d.dispatch_id, d]));
  for (const d of liveDispatches) {
    const known = byId.get(d.dispatch_id);
    byId.set(d.dispatch_id, known ? { ...known, dispatch_status: d.dispatch_status } : d);
  }
  const events = buildEvents(incident, [...byId.values()], changes, now);
  const elapsed = span(incident.reported_at, now);

  return (
    <div className="detail-body">
      <div className="detail-section-title">Timeline</div>
      <p className="ci-timeline-zone">Times shown in Philippine time (PHT)</p>
      {!loaded && liveDispatches.length === 0 ? (
        <div className="itl-state">Loading timeline…</div>
      ) : (
        <ol className="itl">
          {events.map((e) => (
            <li key={e.key} className={`itl-item itl-tone-${e.tone}${e.live ? " live" : ""}`}>
              <span className="itl-dot" />
              <div className="itl-main">
                <div className="itl-head">
                  <span className="itl-title">{e.title}</span>
                  <span className="itl-time">{clock(e.at) ?? (e.live ? "Live" : "—")}</span>
                </div>
                {e.desc && <div className="itl-desc">{e.desc}</div>}
              </div>
            </li>
          ))}
          <li className="itl-item itl-now">
            <span className="itl-dot" />
            <div className="itl-main">
              <div className="itl-head">
                <span className="itl-title">{STATUS_LABEL[incident.status] || "Now"}</span>
                <span className="itl-time">Now</span>
              </div>
              {elapsed && <div className="itl-desc">{elapsed} since report</div>}
            </div>
          </li>
        </ol>
      )}
      {loaded && byId.size === 0 && (
        <div className="itl-state">No units dispatched yet. Dispatch events will appear here.</div>
      )}
    </div>
  );
}
