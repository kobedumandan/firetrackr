import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import AppModal from './AppModal'
import ModelSettingsIcon from './ModelSettingsIcon'
import SettingsLoading from './SettingsLoading'
import {
  fetchModelSummary, fetchModelVersions, fetchModelReport,
  initializeModels, retrainModel, cancelModelRetrain, rejectModel, promoteModel, notifyModelUpdate,
} from '../api'
import '../styles/ModelSettings.css'

const ModelPreview = lazy(() => import('./ModelPreview'))
const labels = { training: 'Training', failed: 'Failed', candidate: 'Ready for review', champion: 'Active', archived: 'Archived', rejected: 'Rejected', scheduled: 'Scheduled', cancelled: 'Cancelled' }
const verdicts = { recommend: 'Recommended', no_clear_difference: 'No clear difference', do_not_recommend: 'Not recommended' }
const metricLabels = { precision: 'Precision', recall: 'Recall', f1: 'F1 score', balanced_accuracy: 'Balanced accuracy', pr_auc: 'PR-AUC' }
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
const points = value => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}` : '—'
const date = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded'

function Badge({ status }) {
  return <span className={`model-badge model-badge-${status}`}>{labels[status] || verdicts[status] || status}</span>
}

function Audit({ report }) {
  const oldMetrics = report.champion?.metrics || {}
  const newMetrics = report.challenger?.metrics || {}
  const interval = report.bootstrap?.f1_difference_ci95
  const explanation = report.recommendation === 'recommend'
    ? 'The audit supports this candidate while keeping recall within the allowed drop. Review the changed roads before promoting.'
    : report.recommendation === 'no_clear_difference'
      ? 'The comparison does not establish a clear improvement. Review the uncertainty and changed roads before deciding.'
      : 'The audit does not recommend this candidate. Review recall and F1 carefully before making it active.'
  const verified = (report.churn || []).filter(row => ['manual_verified', 'user_drawn'].includes(row.annotation_source)).length
  return <>
    <div className="model-report-heading"><Badge status={report.recommendation} />{report.low_confidence && <span className="model-warning">Low confidence</span>}</div>
    <p>{explanation}</p>
    <div className="model-table-scroll"><table className="model-table">
      <caption>Test-set comparison against {report.champion_version || 'the previous model'}</caption>
      <thead><tr><th>Metric</th><th>Previous model</th><th>Candidate</th></tr></thead>
      <tbody>{Object.entries(metricLabels).map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{percent(oldMetrics[key])}</td><td>{percent(newMetrics[key])}</td></tr>)}</tbody>
    </table></div>
    <dl className="model-facts">
      <div><dt>F1 difference</dt><dd>{points(report.f1_difference)} points</dd></div>
      <div><dt>95% confidence interval</dt><dd>{interval ? `${points(interval[0])} to ${points(interval[1])} points` : 'Not recorded'}</dd></div>
      <div><dt>Bootstrap chance of better F1</dt><dd>{percent(report.bootstrap?.probability_better)}</dd></div>
      <div><dt>Changed predicted classes</dt><dd>{report.churn?.length ?? 0} roads · {verified} manually annotated</dd></div>
    </dl>
    <p className="model-muted">The preview shows classification changes. Manually annotated road types continue to determine their routing costs.</p>
    {(report.warnings || []).map((warning, index) => <p className="model-warning" key={index}>{warning}</p>)}
  </>
}

export default function ModelSettings({ theme = 'dark' }) {
  const [summary, setSummary] = useState(null)
  const [versions, setVersions] = useState([])
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState('')
  const [report, setReport] = useState(null)
  const [reportError, setReportError] = useState(null)
  const [error, setError] = useState('')
  const [operationError, setOperationError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [action, setAction] = useState(null)
  const [actionError, setActionError] = useState('')
  const [preview, setPreview] = useState(false)
  const working = useRef(false)
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    const update = () => setRevision(value => value + 1)
    window.addEventListener('firetrackr:model-update', update)
    return () => { mounted.current = false; window.removeEventListener('firetrackr:model-update', update) }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    let timer
    async function refresh() {
      try {
        const [nextSummary, nextVersions] = await Promise.all([
          fetchModelSummary(controller.signal), fetchModelVersions(page * 20, controller.signal),
        ])
        if (controller.signal.aborted) return
        setSummary(nextSummary)
        setVersions(nextVersions)
        setError('')
        setSelected(value => value || nextVersions.find(row => row.status === 'candidate')?.version || nextSummary.champion?.version || nextVersions[0]?.version || '')
      } catch (err) {
        if (!controller.signal.aborted) setError(err.message)
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 10000)
      }
    }
    refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [page, revision])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    fetchModelReport(selected, controller.signal).then(value => {
      if (!controller.signal.aborted) { setReport(value); setReportError(null) }
    }).catch(err => {
      if (!controller.signal.aborted) setReportError({ version: selected, message: err.message })
    })
    return () => controller.abort()
  }, [selected, versions, revision])

  async function run(kind, target = null) {
    if (working.current) return
    working.current = true
    setBusy(true)
    setActionError('')
    setOperationError('')
    setNotice('')
    try {
      const value = kind === 'initialize' ? await initializeModels()
        : kind === 'retrain' ? await retrainModel()
          : kind === 'cancel' ? await cancelModelRetrain(target.version)
          : kind === 'reject' ? await rejectModel(target.version)
            : await promoteModel(target.version, target.expected)
      if (!mounted.current) return
      if (kind === 'retrain') setSummary(previous => ({ ...previous, training: value, can_retrain: false }))
      if (kind === 'cancel') setSummary(previous => ({ ...previous, training: value.status === 'training' ? value : null }))
      setSelected(value.version)
      setNotice(kind === 'retrain' ? `Training started for ${value.version}. You can leave this page.`
        : kind === 'cancel' ? value.job_status === 'cancelled' ? `${value.version} retraining was cancelled.` : `Cancellation requested for ${value.version}. The worker will confirm when it has stopped.`
        : kind === 'initialize' ? 'The current model is registered.'
          : kind === 'reject' ? `${value.version} was rejected.` : `${value.version} is now active.`)
      setAction(null)
      setPreview(false)
      notifyModelUpdate()
    } catch (err) {
      if (mounted.current) {
        if (target) setActionError(err.message)
        else setOperationError(err.message)
      }
    } finally {
      working.current = false
      if (mounted.current) { setBusy(false); setRevision(value => value + 1) }
    }
  }

  const champion = summary?.champion
  const envelope = report?.version === selected ? report : null
  const failedReport = reportError?.version === selected ? reportError.message : ''
  const audit = envelope?.report
  const stale = !!error
  const partialRoads = summary?.snapshot?.partial_edge_rows_not_used_as_training_labels || 0
  const choose = version => { setSelected(version); setPreview(false); setActionError('') }
  const confirm = kind => {
    setActionError('')
    setAction({ kind, version: kind === 'cancel' ? summary.training.version : selected, expected: envelope?.expected_champion, rollback: envelope?.status === 'archived' })
  }
  const actionUnavailable = stale || (action?.kind === 'retrain' && !summary?.can_retrain)
    || (action?.kind === 'cancel' && (summary?.training?.version !== action.version || summary.training.cancel_requested))
    || (action?.kind === 'promote' && (!envelope?.promotion_eligible || failedReport || envelope.expected_champion !== action.expected))
  const actionDetails = action?.kind === 'retrain' ? [['Active model', champion?.version]]
    : action?.kind === 'promote' ? [['Active model', action.expected], [action.rollback ? 'Restore model' : 'New model', action.version]]
      : [['Model', action?.version]]

  return <section className="model-settings" aria-labelledby="model-settings-title">
    <div className="model-page-heading"><div><h2 className="settings-section-title" id="model-settings-title">Model</h2><p className="section-desc">Review road-constraint predictions and manage model versions.</p></div>
      <button type="button" className="model-btn model-refresh-btn" aria-label="Refresh" title="Refresh model status" disabled={busy} onClick={() => setRevision(value => value + 1)}><ModelSettingsIcon name="refresh" />Refresh status</button></div>
    {error && <p className="model-error" role="alert">{error}</p>}
    {operationError && <p className="model-error" role="alert">{operationError}</p>}
    {notice && <p className="model-success" role="status">{notice}</p>}
    {!summary && !error && <SettingsLoading message="Loading model settings…" description="Getting the latest model status and version history." />}
    {summary && <>
      <article className="settings-block model-card model-current-card">
        <div className="model-card-heading"><div className="model-card-title"><span className="model-card-icon"><ModelSettingsIcon name="model" /></span><div><h3>Current model</h3><p className="model-card-description">The model used for road-constraint predictions.</p></div></div>{champion && <Badge status="champion" />}</div>
        {champion ? <>
          <div className="model-version"><span className="model-version-id">{champion.version}</span><span className="model-version-label">Road constraints</span></div>
          <dl className="model-facts">
            <div><dt>Registered</dt><dd>{date(champion.created_at)}</dd></div>
            <div><dt>Labelled segments</dt><dd>{champion.label_count?.toLocaleString() ?? 'Not recorded'}</dd></div>
            <div><dt>Classification threshold</dt><dd>{champion.threshold ?? '—'}</dd></div>
            <div className="model-fact-score"><dt>Test F1</dt><dd>{percent(champion.metrics?.f1)}</dd></div>
          </dl>
          <div className="model-training-row"><div><span className="model-training-label">{summary.training ? 'Training in progress' : summary.can_retrain ? 'Ready to retrain' : 'Training status'}</span>
            {summary.training ? <p id="model-retrain-status" role="status"><span className="model-pulse" />{summary.training.cancel_requested ? `Cancelling ${summary.training.version}… Waiting for the worker to stop.` : `Training ${summary.training.version}… Current routing remains available.`}</p>
              : <p id="model-retrain-status">{summary.labels_changed ? 'New effective labels are ready for training.' : 'No new labels since the current model. Retrain becomes available when verified road conditions change.'}</p>}
            {summary.snapshot && <p className="model-muted">{summary.snapshot.active_drawn_rows} saved constraint{summary.snapshot.active_drawn_rows === 1 ? '' : 's'} · {summary.snapshot.drawn_segments} model roads covered for training.</p>}
            {partialRoads > 0 && <p id="model-partial-roads" className="model-muted">{partialRoads} partial-road selection{partialRoads === 1 ? ' affects' : 's affect'} routes but {partialRoads === 1 ? 'does' : 'do'} not label a whole model road for training. To make a training correction, use Edit constraints to select an existing model road and update its verified condition or severity.</p>}
          </div><div className="model-training-buttons">{summary.training && <button type="button" className="model-btn" disabled={busy || stale || summary.training.cancel_requested} onClick={() => confirm('cancel')}><ModelSettingsIcon name="reject" />{summary.training.cancel_requested ? 'Cancelling…' : 'Cancel retrain'}</button>}<button type="button" className="model-btn model-btn-primary" disabled={busy || stale || !summary.can_retrain} aria-describedby={`model-retrain-status${partialRoads > 0 ? ' model-partial-roads' : ''}`} onClick={() => confirm('retrain')}><ModelSettingsIcon name="train" />Retrain</button></div></div>
        </> : <div className="model-empty-state"><span className="model-empty-icon"><ModelSettingsIcon name="register" /></span><h4>No model registered</h4><p className="model-muted">Register the current model to start tracking versions and reviewing future changes.</p>{summary.can_initialize ? <button type="button" className="model-btn model-btn-primary" disabled={busy || stale} onClick={() => run('initialize')}><ModelSettingsIcon name="register" />Register current model</button> : <p className="model-warning">The model history needs administrator attention before training can start.</p>}</div>}
      </article>

      {selected && <article className="settings-block model-card" aria-busy={!envelope && !failedReport}>
        <div className="model-card-heading"><div className="model-card-title"><span className="model-card-icon"><ModelSettingsIcon name="review" /></span><div><h3>Review {selected}</h3><p className="model-card-description">Compare results before making a model active.</p></div></div>{envelope && <Badge status={audit?.job_status === 'cancelled' ? 'cancelled' : envelope.status} />}</div>
        {failedReport ? <p className="model-error" role="alert">{failedReport}</p> : !envelope ? <SettingsLoading message="Loading report…" compact /> : <>
          {envelope.status === 'training' ? <p>Training is in progress. The audit will appear here when it finishes.</p>
            : audit?.challenger ? <Audit report={audit} />
              : <p className="model-muted">{audit?.job_status === 'cancelled' ? 'This retrain was cancelled. The current model remains active.' : envelope.status === 'failed' ? 'Training did not complete. The current model remains active.' : 'This is the reconstructed original model. A comparison report will be available after retraining.'}</p>}
          {envelope.error && <p className="model-error" role="alert">{envelope.error}</p>}
          {(envelope.promotion_blockers || []).filter(() => ['candidate', 'archived'].includes(envelope.status)).map(message => <p className="model-warning" key={message}>{message}</p>)}
          <div className="model-actions">
            {audit?.challenger && <button type="button" className="model-btn" onClick={() => setPreview(true)} aria-haspopup="dialog"><ModelSettingsIcon name="map" />Preview on map</button>}
            {['candidate', 'archived'].includes(envelope.status) && <button type="button" className="model-btn model-btn-primary" disabled={busy || stale || !!failedReport || !envelope.promotion_eligible} onClick={() => confirm('promote')}><ModelSettingsIcon name={envelope.status === 'archived' ? 'restore' : 'promote'} />{envelope.status === 'archived' ? 'Roll back' : 'Promote now'}</button>}
            {envelope.status === 'candidate' && <button type="button" className="model-btn" disabled={busy || stale} onClick={() => confirm('reject')}><ModelSettingsIcon name="reject" />Reject</button>}
          </div>
        </>}
      </article>}

      <article className="settings-block model-card model-history-card"><div className="model-card-heading"><div className="model-card-title"><span className="model-card-icon"><ModelSettingsIcon name="history" /></span><div><h3>Version history</h3><p className="model-card-description">Browse previous models and select a version to review.</p></div></div><span className="model-count">{versions.length} on this page</span></div>
        {versions.length ? <div className="model-table-scroll"><table className="model-table"><thead><tr><th>Version</th><th>Status</th><th>Registered</th><th>Test F1</th><th><span className="model-sr-only">Review</span></th></tr></thead>
          <tbody>{versions.map(row => <tr key={row.version} className={row.version === selected ? 'model-selected-row' : ''}><th scope="row">{row.version}</th><td><Badge status={row.job_status === 'cancelled' ? 'cancelled' : row.status} /></td><td>{date(row.created_at)}</td><td>{percent(row.metrics?.f1)}</td><td><button type="button" className="model-btn model-icon-btn" onClick={() => choose(row.version)} aria-label={`Review ${row.version}`} title={`Review ${row.version}`} aria-pressed={row.version === selected}><ModelSettingsIcon name="review" /></button></td></tr>)}</tbody></table></div> : <p className="model-muted">No versions on this page.</p>}
        <div className="model-pagination"><span>Page {page + 1}</span><div className="model-pagination-buttons"><button type="button" className="model-btn model-icon-btn" aria-label="Previous" title="Previous page" disabled={!page || busy} onClick={() => setPage(value => value - 1)}><ModelSettingsIcon name="previous" /></button><button type="button" className="model-btn model-icon-btn" aria-label="Next" title="Next page" disabled={versions.length < 20 || busy} onClick={() => setPage(value => value + 1)}><ModelSettingsIcon name="next" /></button></div></div>
      </article>
    </>}
    {preview && <AppModal title={`Model comparison · ${selected}`} subtitle="Before and after · changed road predictions" onClose={() => setPreview(false)} width={1180} className="model-preview-dialog" variant="confirmation" icon={<ModelSettingsIcon name="map" />} manageFocus>
      <div className="model-preview-body"><Suspense fallback={<SettingsLoading message="Loading maps…" compact />}><ModelPreview key={selected} version={selected} theme={theme} /></Suspense></div>
      <div className="cfm-actions"><button type="button" className="apm-btn-cancel" onClick={() => setPreview(false)}>Close comparison</button></div>
    </AppModal>}
    {action && <AppModal title={action.kind === 'retrain' ? 'Retrain the model?' : action.kind === 'cancel' ? `Cancel retraining ${action.version}?` : action.kind === 'reject' ? `Reject ${action.version}?` : action.rollback ? `Restore ${action.version}?` : `Promote ${action.version}?`} dismissible={!busy} onClose={() => setAction(null)} width={420} className="model-confirm-dialog" variant="confirmation" icon={<ModelSettingsIcon name={action.kind === 'retrain' ? 'train' : action.kind === 'promote' ? action.rollback ? 'restore' : 'promote' : 'reject'} />} manageFocus>
      <div className="cfm-body">
        <dl className="cfm-details">{actionDetails.map(([label, value]) => <div className="cfm-detail" key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
        <p className="cfm-message">{action.kind === 'retrain' ? 'Train a new candidate using the latest verified road labels. The current model stays active until you review and promote the candidate.' : action.kind === 'cancel' ? 'Stop this training job and discard its candidate results. The active model and routing will stay unchanged.' : action.kind === 'reject' ? 'This candidate will remain in history and will not become active.' : `${action.version} will replace ${action.expected} immediately and update road predictions and routing costs.`}</p>
        {action.kind === 'promote' && !action.rollback && audit?.recommendation !== 'recommend' && <p className="model-warning">The audit does not establish a recommended improvement. Review the comparison before continuing.</p>}
        {actionUnavailable && <p className="model-muted" role="status">Model status changed. Close this dialog and review the latest status before continuing.</p>}
        {actionError && <div className="apm-error cfm-error" role="alert">{actionError}</div>}</div>
      <div className="cfm-actions"><button type="button" className="apm-btn-cancel" autoFocus disabled={busy} onClick={() => setAction(null)}>{action.kind === 'cancel' ? 'Keep training' : 'Cancel'}</button><button type="button" className="cfm-btn-danger" disabled={busy || actionUnavailable} onClick={() => run(action.kind, action)}>{busy ? <><span className="apm-spinner" aria-hidden="true" /><span className="model-sr-only">Applying…</span></> : action.kind === 'retrain' ? 'Confirm retrain' : action.kind === 'cancel' ? 'Confirm cancellation' : action.kind === 'reject' ? 'Reject candidate' : action.rollback ? 'Confirm rollback' : 'Confirm promotion'}</button></div>
    </AppModal>}
  </section>
}
