// Shared incident presentation helpers — used by both the incidents list and
// the incident details page so the two never drift apart.
import "../styles/IncidentsPage.css";
import { incidentStatusBadgeLabel, incidentStage } from '../utils/incidentOperations';

export function FireGeneralIcon({ className }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className={className}
      fill="currentColor"
    >
      <path d="M240-400q0 52 21 98.5t60 81.5q-1-5-1-9v-9q0-32 12-60t35-51l113-111 113 111q23 23 35 51t12 60v9q0 4-1 9 39-35 60-81.5t21-98.5q0-50-18.5-94.5T648-574q-20 13-42 19.5t-45 6.5q-62 0-107.5-41T401-690q-39 33-69 68.5t-50.5 72Q261-513 250.5-475T240-400Zm240 52-57 56q-11 11-17 25t-6 29q0 32 23.5 55t56.5 23q33 0 56.5-23t23.5-55q0-16-6-29.5T537-292l-57-56Zm0-492v132q0 34 23.5 57t57.5 23q18 0 33.5-7.5T622-658l18-22q74 42 117 117t43 163q0 134-93 227T480-80q-134 0-227-93t-93-227q0-129 86.5-245T480-840Z" />
    </svg>
  );
}

export function RemoveIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="action_icons"
      fill="currentColor"
    >
      <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z" />
    </svg>
  );
}

export function EditIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 -960 960 960"
      className="action_icons"
      fill="currentColor"
    >
      <path d="M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z" />
    </svg>
  );
}

export function SeverityBadge({ sev }) {
  const cls =
    sev === "Critical"
      ? "badge-critical"
      : sev === "Moderate"
      ? "badge-moderate"
      : "inc-badge-minor";
  return (
    <span className={`inc-badge ${cls}`}>
      <FireGeneralIcon className={"sev-icon"} />
      {sev}
    </span>
  );
}

export function StatusPill({ status, incident }) {
  const map = {
    pending: ["sp-pending", "Pending"],
    dispatched: ["sp-dispatched", "Dispatched"],
    contained: ["sp-contained", incidentStatusBadgeLabel(status, incident)],
    closed: ["sp-closed", "Closed"],
  };
  const stage = incidentStage(incident || { status });
  const tone = { responding: 'dispatched', under_control: 'contained', operation_complete: 'closed' }[stage] || stage;
  const [cls] = map[tone] || ["sp-closed"];
  return <span className={`status-pill ${cls}`}>{incidentStatusBadgeLabel(status, incident)}</span>;
}

export function formatReported(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const day = value => value.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const isToday = day(d) === day(now);
  const time = d.toLocaleTimeString("en-PH", {
    timeZone: 'Asia/Manila',
    hour: "2-digit",
    minute: "2-digit",
  });
  if (isToday) return `Today ${time}`;
  return (
    d.toLocaleDateString("en-PH", { timeZone: 'Asia/Manila', month: "short", day: "numeric" }) +
    " " +
    time
  );
}
