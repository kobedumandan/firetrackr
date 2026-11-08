import { useState } from 'react'
import AppModal from './AppModal'
import { Field } from './incidentForm'
import { performWorkflowAction } from '../api'
import { dateTime } from '../utils/operationalTimes'

export default function TruckReturnReadiness({ truck, onRecorded }) {
  const [confirmation, setConfirmation] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unit = truck.pending_return
  if (!unit) return null
  const confirming = confirmation?.unitId === unit.dispatch_truck_id
  const station = unit.station_name || truck.station_name || 'Home station'

  function open(ready) {
    setReason(''); setError('')
    setConfirmation({ unitId: unit.dispatch_truck_id, ready })
  }
  async function save(event) {
    event.preventDefault()
    if (busy || !confirming) return
    const source = reason.trim()
    if (!source) { setError('Record the radio source and readiness reason.'); return }
    setBusy(true); setError('')
    try {
      const result = await performWorkflowAction(`/api/workflow/returns/${unit.dispatch_truck_id}/readiness`, { ready: confirmation.ready, reason: source })
      setConfirmation(null)
      onRecorded(result, source)
    } catch (failure) { setError(failure.message || 'Could not record truck readiness.') }
    finally { setBusy(false) }
  }

  return <div className="trk-detail-hero trk-return-readiness" aria-label="Truck return and readiness">
    <div className="trk-info-title">Return &amp; Readiness</div>
    <div className="trk-info-grid">
      <div className="trk-info-row"><span className="trk-info-label">Readiness</span><span className="trk-info-value">{truck.truck_status === 'available' ? 'Ready' : 'Not Ready'}</span></div>
      <div className="trk-info-row"><span className="trk-info-label">Back At Station</span><span className="trk-info-value">{unit.returned_at ? dateTime(unit.returned_at) : 'Not yet returned'}</span></div>
      <div className="trk-info-row"><span className="trk-info-label">Last Updated</span><span className="trk-info-value">{dateTime(truck.truck_last_updated)}</span></div>
      <div className="trk-info-row trk-return-reason"><span className="trk-info-label">Reason</span><span className="trk-info-value">{unit.reason || 'None recorded'}</span></div>
    </div>
    <div className="trk-return-actions">
      <button type="button" className="act-btn" onClick={() => open(true)} disabled={busy}>Confirm Ready</button>
      <button type="button" className="act-btn" onClick={() => open(false)} disabled={busy}>Not Ready</button>
    </div>
    {confirming && <AppModal
      eyebrow="TRUCK READINESS"
      title={confirmation.ready ? (unit.returned_at ? 'Confirm truck readiness?' : 'Record return & ready?') : 'Record return & not ready?'}
      variant="confirmation"
      icon={<span className="material-symbols-outlined" aria-hidden="true">fire_truck</span>}
      className="eim-panel trk-readiness-modal"
      width={480}
      manageFocus
      dismissible={!busy}
      onClose={() => setConfirmation(null)}
    >
      <form onSubmit={save} aria-busy={busy}>
        <div className="cfm-body">
          <dl className="cfm-details">
            <div className="cfm-detail"><dt>Truck</dt><dd>{truck.truck_platenum}</dd></div>
            <div className="cfm-detail"><dt>Home Station</dt><dd>{station}</dd></div>
            <div className="cfm-detail"><dt>Response Team</dt><dd>{unit.team || 'Not recorded'}</dd></div>
          </dl>
          <p className="cfm-message">{confirmation.ready ? 'Confirm this truck is physically back at its home station and ready for another response.' : 'Confirm this truck is physically back at its home station. It will remain unavailable until readiness is confirmed.'}</p>
          <div className="trk-readiness-source"><Field label="Radio Source / Readiness Reason">
            <textarea required disabled={busy} maxLength={255} rows={3} value={reason} onChange={event => setReason(event.target.value)} aria-label="Radio source / readiness reason" data-autofocus placeholder={confirmation.ready ? 'Who confirmed the truck is back and ready?' : 'Who confirmed its return, and why is it not ready?'} />
          </Field></div>
          {error && <div className="apm-error cfm-error" role="alert">{error}</div>}
        </div>
        <div className="cfm-actions">
          <button type="button" className="apm-btn-cancel" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button>
          <button type="submit" className="cfm-btn-danger" disabled={busy}>{busy ? 'Saving…' : confirmation.ready ? 'Confirm Ready' : 'Confirm Not Ready'}</button>
        </div>
      </form>
    </AppModal>}
  </div>
}
