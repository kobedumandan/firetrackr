import { useState } from 'react'
import AnalysisIcon from './AnalysisIcon'
import ConfirmModal from './ConfirmModal'
import { Field } from './incidentForm'

const releaseDate = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric' })
const releaseTime = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit', second: '2-digit' })

function ReleaseTimestamp({ value }) {
  const instant = new Date(value)
  return <span>
    <span>{releaseDate.format(instant)}</span>{' '}
    <span className="idp-unit-release-separator" aria-hidden="true">|</span>{' '}
    <span className="idp-unit-release-clock">{releaseTime.format(instant)}</span>
  </span>
}

export default function IncidentTeamResponseActions({ dispatch, workflow }) {
  const [confirmingRelease, setConfirmingRelease] = useState(false)
  const [clearance, setClearance] = useState(null)
  const [clearanceReason, setClearanceReason] = useState('')
  if (!dispatch) return null
  const { data, busy, submit, clear } = workflow
  const canManageRelease = !dispatch.cleared_at && dispatch.dispatch_status === 'on_scene'
    && !data.incident.operation_completed_at && data.incident.status !== 'closed'
  const needsAuthorization = !dispatch.release_authorized_at || (dispatch.release?.is_last_on_scene && !dispatch.release?.work_finished_confirmed)
  const releaseBlocker = dispatch.release?.authorization_blocker || (dispatch.release_authorized_at && dispatch.release?.clearance_blocker)
  const blockerNote = releaseBlocker?.includes('Fire Out') ? 'Fire Out needed before release' : releaseBlocker
  const clearanceCurrent = clearance?.fireId === data.incident.fire_id
    && clearance?.dispatchId === dispatch.dispatch_id && canManageRelease
    && !needsAuthorization && !!dispatch.release?.can_clear

  async function confirmClearance() {
    if (!clearanceCurrent) throw new Error('The team clearance status changed. Cancel and reopen clearance to review the latest status.')
    await clear(dispatch, clearanceReason)
  }

  return <>
    {dispatch.release_authorized_at && <div className="idp-unit-row idp-unit-release-time"><span>Release authorized</span><ReleaseTimestamp value={dispatch.release_authorized_at} /></div>}
    {dispatch.cleared_at && <div className="idp-unit-row idp-unit-release-time"><span>Cleared scene</span><ReleaseTimestamp value={dispatch.cleared_at} /></div>}
    {canManageRelease && <div className="idp-unit-actions" aria-busy={busy}>
      {dispatch.release_authorized_at && <p className="idp-unit-note">Release authorized. Awaiting the leader’s actual scene clearance.</p>}
      {blockerNote && <p className="idp-unit-note idp-unit-blocker"><AnalysisIcon name="info" /><span>{blockerNote}</span></p>}
      {needsAuthorization
        ? <button type="button" className="act-btn block" disabled={busy || !dispatch.release?.can_authorize} onClick={() => setConfirmingRelease(true)}>{dispatch.release_authorized_at ? 'Confirm Work & Renew Release' : 'Authorize Team Release'}</button>
        : <button type="button" className="act-btn block" disabled={busy || !dispatch.release?.can_clear} onClick={() => { setClearanceReason(''); setClearance({ fireId: data.incident.fire_id, dispatchId: dispatch.dispatch_id }) }}>Record Radio-confirmed Clearance</button>}
    </div>}
    {clearance && <ConfirmModal
      eyebrow="RADIO-CONFIRMED CLEARANCE"
      icon="release"
      title="Record team clearance?"
      details={[{ label: 'Team', value: dispatch.team }, { label: 'Dispatch', value: `DISP-${clearance.dispatchId}` }]}
      message={clearanceCurrent
        ? 'Confirm the team is physically clear of the scene based on radio communication. This records clearance now and starts truck return tracking.'
        : 'The team clearance status changed. Cancel and reopen clearance to review the latest status.'}
      confirmLabel="Record Clearance"
      confirmDisabled={busy || !clearanceCurrent || !clearanceReason.trim()}
      onConfirm={confirmClearance}
      onClose={() => setClearance(null)}
    >
      <Field label="Radio Source / Clearance Reason">
        <textarea aria-label="Radio source / clearance reason" required maxLength={255} rows={3} disabled={busy} value={clearanceReason} onChange={event => setClearanceReason(event.target.value)} placeholder="Who confirmed the team is physically clear?" />
      </Field>
    </ConfirmModal>}
    {confirmingRelease && canManageRelease && needsAuthorization && <ConfirmModal
      eyebrow="TEAM RELEASE"
      icon="release"
      title={dispatch.release_authorized_at ? 'Renew team release?' : 'Authorize team release?'}
      details={[{ label: 'Team', value: dispatch.team }, { label: 'Dispatch', value: `DISP-${dispatch.dispatch_id}` }]}
      message={`Confirm ${dispatch.team}'s assigned work is finished and record field command's release instruction.${dispatch.release?.is_last_on_scene ? ' This is the last on-scene team; confirm all remaining scene work is finished.' : ' Another team remains on scene.'} Its leader must still confirm actual clearance.`}
      confirmLabel={dispatch.release_authorized_at ? 'Confirm work & renew release' : 'Authorize release'}
      confirmDisabled={busy || !dispatch.release?.can_authorize}
      onConfirm={() => submit(`/api/workflow/dispatch/${dispatch.dispatch_id}/release`, { work_finished: true })}
      onClose={() => setConfirmingRelease(false)}
    />}
  </>
}
