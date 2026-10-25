import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import AppModal from './AppModal'
import ModelSettingsIcon from './ModelSettingsIcon'
import {
  fetchModelSummary, fetchModelVersions, fetchModelReport,
  initializeModels, retrainModel, rejectModel, promoteModel, notifyModelUpdate,
} from '../api'
import '../styles/ModelSettings.css'

const ModelPreview = lazy(() => import('./ModelPreview'))
const labels = { training: 'Training', failed: 'Failed', candidate: 'Ready for review', champion: 'Active', archived: 'Archived', rejected: 'Rejected', scheduled: 'Scheduled' }
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

export default function ModelSettings() {
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
          : kind === 'reject' ? await rejectModel(target.version)
            : await promoteModel(target.version, target.expected)
      if (!mounted.current) return
      if (kind === 'retrain') setSummary(previous => ({ ...previous, training: value, can_retrain: false }))
      setSelected(value.version)
      setNotice(kind === 'retrain' ? `Training started for ${value.version}. You can leave this page.`
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
    setAction({ kind, version: selected, expected: envelope.expected_champion, rollback: envelope.status === 'archived' })
  }

  return <section className="model-settings" aria-labelledby="model-settings-title">
    <div className="model-page-heading"><div><h2 className="settings-section-title" id="model-settings-title">Model</h2><p className="section-desc">Review road-constraint predictions and manage model versions.</p></div>
      <button type="button" className="model-btn model-icon-btn" aria-label="Refresh" title="Refresh model status" disabled={busy} onClick={() => setRevision(value => value + 1)}><ModelSettingsIcon name="refresh" /></button></div>
    {error && <p className="model-error" role="alert">{error}</p>}
    {operationError && <p className="model-error" role="alert">{operationError}</p>}
    {notice && <p className="model-success" role="status">{notice}</p>}
    {!summary && !error && <p role="status">Loading model status…</p>}
    {summary && <>
      <article className="settings-block model-card model-current-card">
        <div className="model-card-heading"><h3><ModelSettingsIcon name="model" />Current model</h3>{champion && <Badge status="champion" />}</div>
        {champion ? <>
          <div className="model-version"><span className="model-version-id">{champion.version}</span><span className="model-version-label">Road constraints</span></div>
          <dl className="model-facts">
            <div><dt>Registered</dt><dd>{date(champion.created_at)}</dd></div>
            <div><dt>Labelled segments</dt><dd>{champion.label_count?.toLocaleString() ?? 'Not recorded'}</dd></div>
            <div><dt>Classification threshold</dt><dd>{champion.threshold ?? '—'}</dd></div>
            <div><dt>Test F1</dt><dd>{percent(champion.metrics?.f1)}</dd></div>
          </dl>
          <div className="model-training-row"><div>
            {summary.training ? <p id="model-retrain-status" role="status"><span className="model-pulse" />Training {summary.training.version}… Current routing remains available.</p>
              : <p id="model-retrain-status">{summary.labels_changed ? 'New effective labels are ready for training.' : 'No new labels since the current model. Retrain becomes available when verified road conditions change.'}</p>}
            {summary.snapshot && <p className="model-muted">{summary.snapshot.active_drawn_rows} saved constraint{summary.snapshot.active_drawn_rows === 1 ? '' : 's'} · {summary.snapshot.drawn_segments} model roads covered for training.</p>}
            {partialRoads > 0 && <p id="model-partial-roads" className="model-muted">{partialRoads} partial-road selection{partialRoads === 1 ? ' affects' : 's affect'} routes but {partialRoads === 1 ? 'does' : 'do'} not label a whole model road for training. To make a training correction, use Edit constraints to select an existing model road and update its verified condition or severity.</p>}
          </div><button type="button" className="model-btn model-btn-primary" disabled={busy || stale || !summary.can_retrain} aria-describedby={`model-retrain-status${partialRoads > 0 ? ' model-partial-roads' : ''}`} onClick={() => run('retrain')}><ModelSettingsIcon name="train" />{busy && !action ? 'Working…' : 'Retrain'}</button></div>
        </> : <><p>No model is registered yet.</p>{summary.can_initialize ? <button type="button" className="model-btn model-btn-primary" disabled={busy || stale} onClick={() => run('initialize')}><ModelSettingsIcon name="register" />Register current model</button> : <p className="model-warning">The model history needs administrator attention before training can start.</p>}</>}
      </article>

      {selected && <article className="settings-block model-card" aria-busy={!envelope && !failedReport}>
        <div className="model-card-heading"><h3><ModelSettingsIcon name="review" />Review {selected}</h3>{envelope && <Badge status={envelope.status} />}</div>
        {failedReport ? <p className="model-error" role="alert">{failedReport}</p> : !envelope ? <p role="status">Loading report…</p> : <>
          {envelope.status === 'training' ? <p>Training is in progress. The audit will appear here when it finishes.</p>
            : audit?.challenger ? <Audit report={audit} />
              : <p className="model-muted">{envelope.status === 'failed' ? 'Training did not complete. The current model remains active.' : 'This is the reconstructed original model. A comparison report will be available after retraining.'}</p>}
          {envelope.error && <p className="model-error" role="alert">{envelope.error}</p>}
          {(envelope.promotion_blockers || []).filter(() => ['candidate', 'archived'].includes(envelope.status)).map(message => <p className="model-warning" key={message}>{message}</p>)}
          <div className="model-actions">
            {audit?.challenger && <button type="button" className="model-btn" onClick={() => setPreview(value => !value)} aria-expanded={preview}><ModelSettingsIcon name="map" />{preview ? 'Hide preview' : 'Preview on map'}</button>}
            {['candidate', 'archived'].includes(envelope.status) && <button type="button" className="model-btn model-btn-primary" disabled={busy || stale || !!failedReport || !envelope.promotion_eligible} onClick={() => confirm('promote')}><ModelSettingsIcon name={envelope.status === 'archived' ? 'restore' : 'promote'} />{envelope.status === 'archived' ? 'Roll back' : 'Promote now'}</button>}
            {envelope.status === 'candidate' && <button type="button" className="model-btn" disabled={busy || stale} onClick={() => confirm('reject')}><ModelSettingsIcon name="reject" />Reject</button>}
          </div>
          {preview && <Suspense fallback={<p role="status">Loading map…</p>}><ModelPreview key={selected} version={selected} /></Suspense>}
        </>}
      </article>}

      <article className="settings-block model-card model-history-card"><div className="model-card-heading"><h3><ModelSettingsIcon name="history" />Version history</h3><span className="model-muted">{versions.length} on this page</span></div>
        {versions.length ? <div className="model-table-scroll"><table className="model-table"><thead><tr><th>Version</th><th>Status</th><th>Registered</th><th>Test F1</th><th><span className="model-sr-only">Review</span></th></tr></thead>
          <tbody>{versions.map(row => <tr key={row.version} className={row.version === selected ? 'model-selected-row' : ''}><th scope="row">{row.version}</th><td><Badge status={row.status} /></td><td>{date(row.created_at)}</td><td>{percent(row.metrics?.f1)}</td><td><button type="button" className="model-btn model-icon-btn" onClick={() => choose(row.version)} aria-label={`Review ${row.version}`} title={`Review ${row.version}`} aria-pressed={row.version === selected}><ModelSettingsIcon name="review" /></button></td></tr>)}</tbody></table></div> : <p className="model-muted">No versions on this page.</p>}
        <div className="model-pagination"><button type="button" className="model-btn model-icon-btn" aria-label="Previous" title="Previous page" disabled={!page || busy} onClick={() => setPage(value => value - 1)}><ModelSettingsIcon name="previous" /></button><span>Page {page + 1}</span><button type="button" className="model-btn model-icon-btn" aria-label="Next" title="Next page" disabled={versions.length < 20 || busy} onClick={() => setPage(value => value + 1)}><ModelSettingsIcon name="next" /></button></div>
      </article>
    </>}
    {action && <AppModal title={action.kind === 'reject' ? `Reject ${action.version}?` : action.rollback ? `Restore ${action.version}?` : `Promote ${action.version}?`} eyebrow="MODEL REVIEW" dismissible={!busy} onClose={() => setAction(null)} width={480} manageFocus>
      <div className="model-dialog-body"><p>{action.kind === 'reject' ? 'This candidate will remain in history and will not become active.' : `${action.version} will replace ${action.expected} immediately and update road predictions and routing costs.`}</p>
        {action.kind === 'promote' && !action.rollback && audit?.recommendation !== 'recommend' && <p className="model-warning">The audit does not establish a recommended improvement. Review the comparison before continuing.</p>}
        {actionError && <p className="model-error" role="alert">{actionError}</p>}</div>
      <div className="model-dialog-actions"><button type="button" className="model-btn" autoFocus disabled={busy} onClick={() => setAction(null)}>Cancel</button><button type="button" className="model-btn model-btn-primary" disabled={busy} onClick={() => run(action.kind, action)}>{busy ? 'Applying…' : action.kind === 'reject' ? 'Reject candidate' : action.rollback ? 'Confirm rollback' : 'Confirm promotion'}</button></div>
    </AppModal>}
  </section>
}
