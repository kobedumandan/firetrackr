import { useRef, useState } from 'react';
import { needsNeighboringSupport } from '../utils/alarmLevels';
import { supportsFireAlarm, ICON_WARN } from './incidentFormOptions';
import { Icon } from './incidentForm';
import '../styles/CommandIncidentWarnings.css';

function AlarmWarning({ incident, compact, expanded, onToggle }) {
  const summaryRef = useRef(null);
  const name = incident.loc || 'Unnamed incident';
  const id = incident.id || `INC-${incident.fire_id}`;
  const body = <>
    <div className="detail-header">
      <div className="detail-tag">
        <span className="ci-incident-id">{id}</span>
        {compact && <button type="button" className="ci-neighbor-warning-collapse" aria-label={`Collapse warning for ${id}`} title="Collapse warning" onClick={() => {
          onToggle();
          requestAnimationFrame(() => summaryRef.current?.focus());
        }}>
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="m4 10 4-4 4 4" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>}
      </div>
      <div className="ci-neighbor-warning-title-row">
        <h3 className="detail-title" title={name}>{name}</h3>
        <span className="detail-chip ci-alarm-chip">{incident.alarm}</span>
      </div>
      <p className="ci-address" title={incident.addr}>{incident.addr || 'Address not recorded'}</p>
    </div>
    <div className="ci-neighbor-warning-message-panel">
      <p className="ci-neighbor-warning-message">
        <span>Request Assistance From Neighboring Cities' Fire Stations.</span>
      </p>
    </div>
  </>;

  return (
    <div className={`ci-neighbor-warning${compact ? ' ci-neighbor-warning--compact' : ''}`} role="alert">
      {compact ? (
        <details open={expanded}>
          <summary ref={summaryRef} className="ci-neighbor-warning-summary" onClick={event => {
            event.preventDefault();
            onToggle();
          }}>
            <Icon d={ICON_WARN} />
            <span className="ci-neighbor-warning-summary-name" title={`${name} · ${id}`}>
              <strong>{name}</strong><span>{id}</span>
            </span>
            <span className="detail-chip ci-alarm-chip">{incident.alarm}</span>
            <svg className="ci-neighbor-warning-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </summary>
          <div className="ci-neighbor-warning-expanded">
            {body}
          </div>
        </details>
      ) : <>
        <h2 className="sidebar-section-header"><Icon d={ICON_WARN} />Alarm Warning</h2>
        {body}
      </>}
    </div>
  );
}

function WarningList({ incidents, compact }) {
  const [expandedId, setExpandedId] = useState(null);
  return (
    <div className="command-incident-warnings" aria-label="Incidents requiring neighboring-city support">
      {incidents.map(incident => {
        const id = incident.fire_id || incident.id;
        return <AlarmWarning key={id} incident={incident} compact={compact}
          expanded={expandedId === id} onToggle={() => setExpandedId(current => current === id ? null : id)} />;
      })}
    </div>
  );
}

export default function CommandIncidentWarnings({ incidents = [] }) {
  const urgentIncidents = incidents.filter(incident =>
    supportsFireAlarm(incident.dispatch_type) && needsNeighboringSupport(incident.alarm)
    && !incident.operation_completed_at
    && !['closed', 'cancelled', 'canceled', 'recalled', 'operation_complete'].includes(incident.lifecycle_stage || incident.status)
  );

  if (!urgentIncidents.length) return null;
  const compact = urgentIncidents.length >= 2;

  return <WarningList key={String(compact)} incidents={urgentIncidents} compact={compact} />;
}
