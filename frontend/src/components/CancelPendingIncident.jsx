import { useState } from 'react';
import ConfirmModal from './ConfirmModal';
import { Field } from './incidentForm';
import { RemoveIcon, formatReported } from './incidentUi';
import { cancelIncident } from '../api';

export default function CancelPendingIncident({ incident, dispatches, onUpdated }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saved, setSaved] = useState(false);
  const eligible = !saved && incident.status === 'pending' && !incident.archived_at
    && !incident.operation_completed_at && dispatches?.length === 0;

  async function save() {
    if (!eligible || !reason.trim()) throw new Error('Only pending incidents without dispatches can be cancelled. Record a cancellation reason.');
    const updated = await cancelIncident(incident.fire_id, reason.trim());
    setSaved(true); onUpdated?.(updated);
  }

  if ((saved || incident.status !== 'pending') && !open) return null;
  return <>
    <button type="button" className="act-icon-btn danger" title="Cancel incident" aria-label="Cancel incident" disabled={!eligible} onClick={() => setOpen(true)}><RemoveIcon /></button>
    {open && <ConfirmModal
      className="cancel-incident-modal"
      eyebrow="CANCEL INCIDENT"
      title="Cancel this incident?"
      details={[
        { label: 'Incident', value: incident.id },
        { label: 'Location', value: incident.loc },
        { label: 'Status', value: 'Pending' },
        { label: 'Reported', value: formatReported(incident.reported_at) },
      ]}
      message="Its record and cancellation reason will remain in history. It will be removed from active incidents."
      confirmLabel="Cancel incident"
      cancelLabel="Keep incident"
      confirmDisabled={!eligible || !reason.trim()}
      onConfirm={save}
      onClose={() => setOpen(false)}
    >
          <Field label="Reason for cancellation">
            <textarea aria-label="Reason for cancellation" required maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder="e.g. Due to False Alarms/Prank Call" />
          </Field>
          {!eligible && <p role="alert">This incident is no longer eligible for cancellation. Refresh its details.</p>}
    </ConfirmModal>}
  </>;
}
