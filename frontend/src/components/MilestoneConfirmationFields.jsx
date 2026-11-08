import { useId } from 'react'
import AnalysisDateTime from './AnalysisDateTime'
import AnalysisIcon from './AnalysisIcon'

const HINTS = {
  receipt: 'When the incident report was received.',
  departure: 'When the selected truck left for the incident.',
  arrival: 'When the selected truck reached the incident.',
  suppression_start: 'Beginning of suppression operations for this incident.',
  fire_out: 'When the fire was declared extinguished.',
  classification: 'Record the incident’s verified response type.',
  clearance: 'When the selected dispatch completed its assignment.',
  operation_complete: 'Confirm after every responding dispatch has cleared.',
}
const titleCase = value => value ? value.replace(/^./, first => first.toUpperCase()) : 'Unknown'

function SelectControl({ children, ...props }) {
  return <div className="rar-confirm-select"><select {...props}>{children}</select><AnalysisIcon name="chevron" /></div>
}

export default function MilestoneConfirmationFields({ data, unit, milestones, kind, at, recordedAt, changed, responseKind, dispatchId, busy, error, saved, onKindChange, onTimeChange, onClassificationChange, onDispatchChange, onNow, onKeepRecorded }) {
  const id = useId()
  const vehicleMilestone = ['departure', 'arrival'].includes(kind)
  const dispatch = data.dispatches?.find(item => String(item.dispatch_id) === dispatchId)
  const scope = vehicleMilestone ? 'Truck' : kind === 'clearance' ? 'Dispatch' : 'Incident'
  const target = vehicleMilestone ? unit?.truck || 'No truck selected' : kind === 'clearance' ? dispatch ? `DISP-${dispatch.dispatch_id}` : 'Select a dispatch' : `INC-${data.fire_id}`
  const targetContext = vehicleMilestone ? unit?.team : kind === 'clearance' ? dispatch?.team : data.barangay || data.address
  const occurrence = at ? new Date(`${at}+08:00`) : null
  const previewTime = occurrence && !Number.isNaN(occurrence.getTime()) ? occurrence.toISOString() : null
  const needsClassification = kind === 'classification' && !responseKind
  const needsDispatch = kind === 'clearance' && !dispatchId
  const unchanged = Boolean(recordedAt) && !changed
  const submitHint = unchanged ? 'Recorded time is unchanged. Edit it only if a correction is needed.' : needsClassification ? 'Choose a response classification to continue.' : needsDispatch ? 'Select a responding dispatch to continue.' : recordedAt ? 'Save the new time as a correction to the recorded milestone.' : at ? 'Review the details before confirming.' : 'Add a verified occurrence time to continue.'

  return <>
    <div className="rar-confirm-layout">
      <fieldset className="rar-evidence-block rar-confirm-fields" disabled={busy} aria-label="Milestone details">
        <header className="rar-evidence-block-heading"><div><h4>Milestone Details</h4><p>Review a recorded time or confirm a missing milestone.</p></div></header>
        <div className="rar-confirm-field-grid">
          <div className="rar-confirm-field">
            <label htmlFor={`${id}-kind`}>Milestone</label>
            <SelectControl id={`${id}-kind`} value={kind} onChange={event => onKindChange(event.target.value)} aria-describedby={`${id}-kind-hint`}>
              {Object.entries(milestones).map(([key, label]) => <option key={key} value={key} disabled={['departure', 'arrival'].includes(key) && !unit}>{label}</option>)}
            </SelectControl>
            <p className="rar-confirm-hint" id={`${id}-kind-hint`}>{HINTS[kind]}</p>
          </div>
          <div className="rar-confirm-field">
            <label htmlFor={`${id}-classification`}>Response classification{data.response_kind ? <span className="rar-confirm-recorded">Recorded</span> : kind === 'classification' && <span className="rar-confirm-required">Required</span>}</label>
            <SelectControl id={`${id}-classification`} required={kind === 'classification'} value={responseKind} onChange={event => onClassificationChange(event.target.value)} disabled={Boolean(data.response_kind)} aria-describedby={`${id}-classification-hint`}>
              <option value="">Unknown</option>{['fire', 'medical', 'rescue', 'other'].map(value => <option key={value} value={value}>{titleCase(value)}</option>)}
            </SelectControl>
            <p className="rar-confirm-hint" id={`${id}-classification-hint`}>{data.response_kind ? 'Already recorded for this incident.' : kind === 'classification' ? 'Select the response type being confirmed.' : 'Select the response type, if known.'}</p>
          </div>
        </div>
        {kind === 'clearance' && <div className="rar-confirm-field ram-confirm-dispatch">
          <label htmlFor={`${id}-dispatch`}>Responding dispatch<span className="rar-confirm-required">Required</span></label>
          <SelectControl id={`${id}-dispatch`} required value={dispatchId} onChange={event => onDispatchChange(event.target.value)}>
            <option value="">Select a dispatch</option>{(data.dispatches || []).map(item => <option key={item.dispatch_id} value={item.dispatch_id}>{item.team || `Dispatch ${item.dispatch_id}`} | {item.cleared_at ? 'Clearance recorded' : item.status}</option>)}
          </SelectControl>
        </div>}
        <div className="rar-confirm-field ram-confirm-time">
          <div className="rar-confirm-time-heading"><label htmlFor={`${id}-time`}>Verified occurrence{recordedAt ? <span className="rar-confirm-recorded">Recorded</span> : <span className="rar-confirm-required">Required</span>}</label><button className="rar-confirm-now" type="button" onClick={onNow}><AnalysisIcon name="response" />Happened now</button></div>
          <input id={`${id}-time`} type="datetime-local" step="1" required value={at} onChange={event => onTimeChange(event.target.value)} aria-describedby={`${id}-time-hint`} />
          <p className="rar-confirm-hint" id={`${id}-time-hint`}><span className="rar-confirm-timezone">Philippine time · UTC+8</span>Use the time the event occurred, even if recorded later.</p>
          {recordedAt && changed && <button type="button" className="rar-confirm-keep" onClick={onKeepRecorded}><AnalysisIcon name="refresh" />Keep recorded time</button>}
        </div>
      </fieldset>

      <aside className="rar-confirm-preview" aria-label="Milestone confirmation preview">
        <header className="rar-evidence-block-heading"><div className="rar-confirm-preview-heading"><span className="rar-action-icon"><AnalysisIcon name="handling" /></span><div><h4>Confirmation Preview</h4><p>Check the details before confirming.</p></div></div></header>
        <dl className="rar-confirm-preview-fields">
          <div><dt>Milestone</dt><dd>{milestones[kind]}</dd></div>
          <div><dt>Applies to<span>{scope}</span></dt><dd>{target}{targetContext && <small>{targetContext}</small>}</dd></div>
          {recordedAt && changed && <div><dt>Recorded occurrence<span>Before this correction</span></dt><dd><AnalysisDateTime value={recordedAt} /></dd></div>}
          <div><dt>{recordedAt && changed ? 'New occurrence' : 'Verified occurrence'}<span>Philippine time</span></dt><dd>{previewTime ? <AnalysisDateTime value={previewTime} /> : <span className="rar-confirm-pending">Enter an occurrence time</span>}</dd></div>
          <div><dt>Classification</dt><dd data-known={Boolean(responseKind)}>{titleCase(responseKind)}</dd></div>
        </dl>
        <div className="rar-confirm-guidance"><AnalysisIcon name="info" /><p>Corrections preserve audit history. New clearance starts truck return; operation completion advances the incident stage.</p></div>
      </aside>
    </div>

    {error && <div className="rar-confirm-feedback" data-state="error" role="alert"><AnalysisIcon name="info" /><div><strong>{recordedAt ? 'Timestamp could not be saved' : 'Milestone could not be confirmed'}</strong><p>{error}</p></div></div>}
    {saved && !error && <div className="rar-confirm-feedback" data-state="success" role="status"><AnalysisIcon name="acknowledgement" /><span>{saved}</span></div>}
    <footer className="ram-confirm-actions"><p>{submitHint}</p><button className="rar-confirm-submit" type="submit" disabled={busy || !at || needsClassification || needsDispatch || unchanged} aria-busy={busy}><AnalysisIcon name={busy ? 'refresh' : 'acknowledgement'} />{busy ? 'Saving…' : recordedAt ? 'Save timestamp' : 'Confirm milestone'}</button></footer>
  </>
}
