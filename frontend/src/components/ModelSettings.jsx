import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import AppModal from './AppModal'
import ModelSettingsIcon from './ModelSettingsIcon'
import SettingsLoading from './SettingsLoading'
import {
  fetchModelSummary, fetchModelVersions, fetchModelReport,
  initializeModels, retrainModel, cancelModelRetrain, rejectModel, promoteModel, notifyModelUpdate, renameModel,
} from '../api'
import '../styles/ModelSettings.css'

const ModelPreview = lazy(() => import('./ModelPreview'))
const HISTORY_PAGE_SIZE = 6
const labels = { training: 'Training', failed: 'Failed', candidate: 'Ready for review', champion: 'Active', archived: 'Archived', rejected: 'Rejected', scheduled: 'Scheduled', cancelled: 'Cancelled' }
const verdicts = { recommend: 'Recommended', no_clear_difference: 'No clear difference', do_not_recommend: 'Not recommended' }
const metricLabels = { precision: 'Precision', recall: 'Recall', f1: 'F1 score', balanced_accuracy: 'Balanced accuracy', pr_auc: 'PR-AUC' }
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
const points = value => Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}` : '—'
const date = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : 'Not recorded'
const versionStatus = row => row.job_status === 'cancelled' ? 'cancelled' : row.status

async function fetchHistory(signal) {
  const rows = []
  while (!signal.aborted) {
    const batch = await fetchModelVersions(rows.length, signal)
    rows.push(...batch)
    if (batch.length < 20) break
  }
  return rows
}

function Badge({ status }) {
  return <span className={`model-badge model-badge-${status}`}>{labels[status] || verdicts[status] || status}</span>
}

function RegisteredDate({ value }) {
  if (!value) return <span className="model-muted">Not recorded</span>
  const registered = new Date(value)
  return <time className="model-registered" dateTime={value}>
    <span>{registered.toLocaleDateString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium' })}</span>
    <span className="model-registered-time">{registered.toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', timeStyle: 'short' })}</span>
  </time>
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
    <div className="model-report-heading"><span className="model-verdict">Verdict <span className="model-verdict-pipe">|</span> <Badge status={report.recommendation} /></span>{report.low_confidence && <span className="model-warning">Low confidence</span>}</div>
    <p className="model-report-explanation">{explanation}</p>
    <div className="model-table-scroll"><table className="model-table">
      <caption>Test-set comparison against {report.champion_version || 'the previous model'}</caption>
      <thead><tr><th>Metric</th><th>Previous model</th><th>Candidate</th></tr></thead>
      <tbody>{Object.entries(metricLabels).map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{percent(oldMetrics[key])}</td><td>{percent(newMetrics[key])}</td></tr>)}</tbody>
    </table></div>
    <dl className="model-facts">
      <div><dt>F1 difference</dt><dd>{points(report.f1_difference)} points</dd></div>
      <div><dt>95% confidence interval</dt><dd>{interval ? `${points(interval[0])} to ${points(interval[1])} points` : 'Not recorded'}</dd></div>
      <div><dt>Bootstrap chance of better F1</dt><dd>{percent(report.bootstrap?.probability_better)}</dd></div>
      <div><dt>Changed predicted classes</dt><dd>{report.churn?.length ?? 0} roads <span className="model-separator">|</span> {verified} manually annotated</dd></div>
    </dl>
    <p className="model-muted">The preview shows classification changes. Manually annotated road types continue to determine their routing costs.</p>
    {(report.warnings || []).map((warning, index) => <p className="model-warning" key={index}>{warning}</p>)}
  </>
}

export default function ModelSettings({ theme = 'dark' }) {
  const [summary, setSummary] = useState(null)
  const [versions, setVersions] = useState([])
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sort, setSort] = useState({ key: 'created_at', direction: 'desc' })
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
  const [editing, setEditing] = useState(null)
  const [modelName, setModelName] = useState('')
  const [retrainName, setRetrainName] = useState('')
  const [nameError, setNameError] = useState('')
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
          fetchModelSummary(controller.signal), fetchHistory(controller.signal),
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
  }, [revision])

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
        : kind === 'retrain' ? await retrainModel(retrainName.trim() || undefined)
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
  const filteredVersions = versions.filter(row => {
    const status = versionStatus(row)
    return (!statusFilter || status === statusFilter)
      && `${row.version} ${row.name || ''} ${labels[status] || status}`.toLowerCase().includes(search.trim().toLowerCase())
  }).sort((a, b) => {
    const left = sort.key === 'f1' ? a.metrics?.f1 : a.created_at ? Date.parse(a.created_at) : null
    const right = sort.key === 'f1' ? b.metrics?.f1 : b.created_at ? Date.parse(b.created_at) : null
    if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0
    if (!Number.isFinite(right)) return -1
    return (left - right) * (sort.direction === 'asc' ? 1 : -1)
  })
  const historyPage = Math.min(page, Math.max(0, Math.ceil(filteredVersions.length / HISTORY_PAGE_SIZE) - 1))
  const visibleVersions = filteredVersions.slice(historyPage * HISTORY_PAGE_SIZE, (historyPage + 1) * HISTORY_PAGE_SIZE)
  const sortHistory = key => {
    setSort(previous => ({ key, direction: previous.key === key && previous.direction === 'desc' ? 'asc' : 'desc' }))
    setPage(0)
  }
  const envelope = report?.version === selected ? report : null
  const failedReport = reportError?.version === selected ? reportError.message : ''
  const audit = envelope?.report
  const stale = !!error
  const partialRoads = summary?.snapshot?.partial_edge_rows_not_used_as_training_labels || 0
  const choose = version => { setSelected(version); setPreview(false); setActionError('') }
  const selectedName = versions.find(row => row.version === selected)?.name
  async function saveName(event) {
    event.preventDefault()
    if (working.current || !modelName.trim()) return
    working.current = true
    setBusy(true)
    setNameError('')
    try {
      const updated = await renameModel(editing.version, modelName.trim())
      if (!mounted.current) return
      setVersions(previous => previous.map(row => row.version === updated.version ? updated : row))
      setSummary(previous => previous?.champion?.version === updated.version ? { ...previous, champion: { ...previous.champion, name: updated.name } } : previous)
      setEditing(null)
      notifyModelUpdate()
    } catch (err) {
      if (mounted.current) setNameError(err.message)
    } finally {
      working.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const confirm = kind => {
    setActionError('')
    if (kind === 'retrain') setRetrainName('')
    setAction({ kind, version: kind === 'cancel' ? summary.training.version : selected, expected: kind === 'retrain' ? champion?.version : envelope?.expected_champion, rollback: envelope?.status === 'archived' })
  }
  const actionUnavailable = stale || (action?.kind === 'retrain' && (!summary?.can_retrain || champion?.version !== action.expected))
    || (action?.kind === 'cancel' && (summary?.training?.version !== action.version || summary.training.cancel_requested))
    || (action?.kind === 'promote' && (!envelope?.promotion_eligible || failedReport || envelope.expected_champion !== action.expected))
  const actionDetails = action?.kind === 'retrain' ? [['Active model', champion?.version]]
    : action?.kind === 'promote' ? [['Active model', action.expected], [action.rollback ? 'Restore model' : 'New model', action.version]]
      : [['Model', action?.version]]

  return <section className="model-settings" aria-labelledby="model-settings-title">
    <div className="model-page-heading"><div><h2 className="settings-section-title" id="model-settings-title">Model</h2><p className="section-desc">Review road-constraint predictions and manage model versions.</p></div>
      <button type="button" className="model-btn model-refresh-btn" aria-label="Refresh" title="Refresh model status" disabled={busy} onClick={() => setRevision(value => value + 1)}><ModelSettingsIcon name="refresh" />Refresh</button></div>
    {error && <p className="model-error" role="alert">{error}</p>}
    {operationError && <p className="model-error" role="alert">{operationError}</p>}
    {notice && <p className="model-success" role="status">{notice}</p>}
    {!summary && !error && <SettingsLoading message="Loading model settings…" description="Getting the latest model status and version history." />}
    {summary && <>
      <article className="settings-block model-card model-current-card">
        <div className="model-card-heading"><div className="model-card-title"><span className="model-card-icon"><ModelSettingsIcon name="model" /></span><div><h3>Current Model</h3><p className="model-card-description">The model used for road-constraint predictions.</p></div></div>{champion && <Badge status="champion" />}</div>
        {champion ? <>
          <div className="model-version"><span className="model-version-id">{champion.name || champion.version}</span><span className="model-version-label">{champion.name ? `${champion.version} / Road constraints` : 'Road constraints'}</span></div>
          <dl className="model-facts">
            <div><dt>Registered</dt><dd>{date(champion.created_at)}</dd></div>
            <div><dt>Labelled segments</dt><dd>{champion.label_count?.toLocaleString() ?? 'Not recorded'}</dd></div>
            <div><dt>Classification threshold</dt><dd>{champion.threshold ?? '—'}</dd></div>
            <div className="model-fact-score"><dt>Test F1</dt><dd>{percent(champion.metrics?.f1)}</dd></div>
          </dl>
          <div className="model-training-row">
            <div className="model-training-header">
              <div className="model-training-copy">
                <span className="model-training-label">{summary.training ? 'Training In Progress' : summary.can_retrain ? 'Ready To Retrain' : 'Training Status'}</span>
                {summary.training ? <p id="model-retrain-status" role="status"><span className="model-pulse" />{summary.training.cancel_requested ? `Cancelling ${summary.training.version}... Waiting for the worker to stop.` : `Training ${summary.training.version}... Current routing remains available.`}</p>
                  : <p id="model-retrain-status">{summary.labels_changed ? 'New effective labels are ready for training.' : 'No new labels since the current model. Retrain becomes available when verified road conditions change.'}</p>}
              </div>
              <div className="model-training-buttons">
                {summary.training && <button type="button" className="model-btn" disabled={busy || stale || summary.training.cancel_requested} onClick={() => confirm('cancel')}><ModelSettingsIcon name="reject" />{summary.training.cancel_requested ? 'Cancelling...' : 'Cancel retrain'}</button>}
                <button type="button" className="model-btn model-refresh-btn model-retrain-btn" disabled={busy || stale || !summary.can_retrain} aria-describedby={`model-retrain-status${partialRoads > 0 ? ' model-partial-roads' : ''}`} onClick={() => confirm('retrain')}><ModelSettingsIcon name="train" />Retrain</button>
              </div>
            </div>
            {summary.snapshot && <div className="model-training-stats">
              <div className="model-training-stat">
                <span className="model-card-icon"><ModelSettingsIcon name="register" /></span>
                <div><span className="model-training-stat-label">New Saved Constraints</span><strong>{summary.snapshot.active_drawn_rows?.toLocaleString() ?? 'Not recorded'}</strong><p className="model-muted">Active saved constraints</p></div>
              </div>
              <div className="model-training-stat">
                <span className="model-card-icon"><ModelSettingsIcon name="map" /></span>
                <div><span className="model-training-stat-label">Model Roads</span><strong>{summary.snapshot.drawn_segments?.toLocaleString() ?? 'Not recorded'}</strong><p className="model-muted">Covered by training labels</p></div>
              </div>
              <div id="model-partial-roads" className="model-training-stat model-partial-roads" title="To make a training correction, use Edit constraints to select an existing model road and update its verified condition or severity.">
                <span className="model-card-icon"><ModelSettingsIcon name="map" /></span>
                <div><span className="model-training-stat-label">Partial Road Selections</span><strong>{partialRoads.toLocaleString()}</strong><p className="model-muted">Affect routing; excluded from training</p></div>
              </div>
            </div>}
          </div>
        </> : <div className="model-empty-state"><span className="model-empty-icon"><ModelSettingsIcon name="register" /></span><h4>No Model Registered</h4><p className="model-muted">Register the current model to start tracking versions and reviewing future changes.</p>{summary.can_initialize ? <button type="button" className="model-btn model-btn-primary" disabled={busy || stale} onClick={() => run('initialize')}><ModelSettingsIcon name="register" />Register current model</button> : <p className="model-warning">The model history needs administrator attention before training can start.</p>}</div>}
      </article>

      <article className="settings-block model-card model-history-card"><div className="model-card-heading"><div className="model-card-title"><span className="model-card-icon"><ModelSettingsIcon name="history" /></span><div><h3>Version History</h3><p className="model-card-description">Browse previous models and select a version to review.</p></div></div><span className="model-count">{filteredVersions.length} versions</span></div>
        <div className="model-history-toolbar">
          <div className="model-history-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search model versions" placeholder="Search name, version, status..." value={search} onChange={event => { setSearch(event.target.value); setPage(0) }} /></div>
          <select className="model-history-filter" aria-label="Filter model status" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(0) }}>
            <option value="">All statuses</option>
            {Object.entries(labels).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
          </select>
        </div>
        <div className="model-table-scroll"><table className="model-table model-history-table"><thead><tr><th scope="col">Version</th><th scope="col">Status</th>{[['created_at', 'Registered'], ['f1', 'F1 score']].map(([key, label]) => <th key={key} scope="col" className={sort.key === key ? 'sort-active' : ''} aria-sort={sort.key === key ? sort.direction === 'asc' ? 'ascending' : 'descending' : 'none'}><button type="button" className="model-sort-btn" onClick={() => sortHistory(key)}>{label}<span className="model-sort-arrow" aria-hidden="true">{sort.key === key ? sort.direction === 'asc' ? '↑' : '↓' : '↕'}</span></button></th>)}<th scope="col"><span className="model-sr-only">Actions</span></th></tr></thead>
          <tbody>{visibleVersions.length ? visibleVersions.map(row => <tr key={row.version} className={row.version === selected ? 'model-selected-row' : ''}><th scope="row">{row.name ? <span className="model-history-name">{row.name}<small>{row.version}</small></span> : row.version}</th><td><Badge status={versionStatus(row)} /></td><td><RegisteredDate value={row.created_at} /></td><td>{percent(row.metrics?.f1)}</td><td><div className="model-row-actions"><button type="button" className="model-btn model-icon-btn" onClick={() => choose(row.version)} aria-label={`Review ${row.version}`} title={`Review ${row.version}`} aria-pressed={row.version === selected}><ModelSettingsIcon name="review" /></button><button type="button" className="model-btn model-icon-btn" aria-label={`Edit ${row.version} name`} title="Edit model name" aria-haspopup="dialog" disabled={busy} onClick={() => { setEditing(row); setModelName(row.name || row.version); setNameError('') }}><ModelSettingsIcon name="edit" /></button></div></td></tr>) : <tr><td colSpan={5} className="model-muted">{versions.length ? 'No versions match your search or status filter.' : 'No model versions registered yet.'}</td></tr>}</tbody></table></div>
        <div className="model-pagination"><span>Page {historyPage + 1}</span><div className="model-pagination-buttons"><button type="button" className="model-btn model-icon-btn" aria-label="Previous" title="Previous page" disabled={!historyPage || busy} onClick={() => setPage(historyPage - 1)}><ModelSettingsIcon name="previous" /></button><button type="button" className="model-btn model-icon-btn" aria-label="Next" title="Next page" disabled={(historyPage + 1) * HISTORY_PAGE_SIZE >= filteredVersions.length || busy} onClick={() => setPage(historyPage + 1)}><ModelSettingsIcon name="next" /></button></div></div>
      </article>

      {selected && <article className="settings-block model-card model-review-card" aria-busy={!envelope && !failedReport}>
        <div className="model-card-heading"><div className="model-card-title"><span className="model-card-icon"><ModelSettingsIcon name="review" /></span><div><h3>Review {selectedName || selected}</h3><p className="model-card-description">Compare results before making a model active.</p></div></div>{envelope && <Badge status={audit?.job_status === 'cancelled' ? 'cancelled' : envelope.status} />}</div>
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

    </>}
    {editing && <AppModal title="Edit model name" subtitle={editing.version} onClose={() => setEditing(null)} dismissible={!busy} width={420} className="model-confirm-dialog" variant="confirmation" icon={<ModelSettingsIcon name="edit" />} manageFocus>
      <form onSubmit={saveName}>
        <div className="cfm-body model-name-form">
          <label htmlFor="model-name">Model name</label>
          <input id="model-name" type="text" value={modelName} maxLength={120} required autoFocus disabled={busy} aria-describedby={nameError ? 'model-name-error' : undefined} onChange={event => { setModelName(event.target.value); setNameError('') }} />
          {nameError && <p id="model-name-error" className="apm-error cfm-error" role="alert">{nameError}</p>}
        </div>
        <div className="cfm-actions"><button type="button" className="apm-btn-cancel" disabled={busy} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="model-btn model-btn-primary model-save-name" disabled={busy || !modelName.trim() || modelName.trim() === (editing.name || editing.version)}>{busy ? 'Saving...' : 'Save name'}</button></div>
      </form>
    </AppModal>}
    {preview && <AppModal title="Model Comparison" subtitle={`Original audit baseline / ${selectedName || selected} (${selected})`} eyebrow="Road Predictions" onClose={() => setPreview(false)} width={1180} className="model-preview-dialog" manageFocus>
      <div className="model-preview-body"><Suspense fallback={<SettingsLoading message="Loading maps…" compact />}><ModelPreview key={selected} version={selected} theme={theme} /></Suspense></div>
      <div className="cfm-actions"><button type="button" className="apm-btn-cancel" onClick={() => setPreview(false)}>Close comparison</button></div>
    </AppModal>}
    {action && <AppModal title={action.kind === 'retrain' ? 'Retrain the model?' : action.kind === 'cancel' ? `Cancel retraining ${action.version}?` : action.kind === 'reject' ? `Reject ${action.version}?` : action.rollback ? `Restore ${action.version}?` : `Promote ${action.version}?`} dismissible={!busy} onClose={() => setAction(null)} width={420} className="model-confirm-dialog" variant="confirmation" icon={<ModelSettingsIcon name={action.kind === 'retrain' ? 'train' : action.kind === 'promote' ? action.rollback ? 'restore' : 'promote' : 'reject'} />} manageFocus>
      <div className="cfm-body">
        <dl className="cfm-details">{actionDetails.map(([label, value]) => <div className="cfm-detail" key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}</dl>
        <p className="cfm-message" role={actionUnavailable ? 'status' : undefined}>{actionUnavailable ? 'Model status changed. Close this dialog and review the latest status before continuing.' : action.kind === 'retrain' ? 'Train a new candidate using the latest verified road labels. The current model stays active until you review and promote the candidate.' : action.kind === 'cancel' ? 'Stop this training job and discard its candidate results. The active model and routing will stay unchanged.' : action.kind === 'reject' ? 'This candidate will remain in history and will not become active.' : `${action.version} will replace ${action.expected} immediately and update road predictions and routing costs.`}</p>
        {action.kind === 'retrain' && !actionUnavailable && <div className="model-name-form">
          <label htmlFor="model-retrain-name">Model name</label>
          <input id="model-retrain-name" type="text" maxLength={120} value={retrainName} placeholder="Optional model name" disabled={busy} onChange={event => setRetrainName(event.target.value)} />
        </div>}
        {action.kind === 'promote' && !action.rollback && audit?.recommendation !== 'recommend' && <p className="model-warning">The audit does not establish a recommended improvement. Review the comparison before continuing.</p>}
        {actionError && <div className="apm-error cfm-error" role="alert">{actionError}</div>}</div>
      <div className="cfm-actions"><button type="button" className="apm-btn-cancel" autoFocus disabled={busy} onClick={() => setAction(null)}>{action.kind === 'cancel' ? 'Keep training' : 'Cancel'}</button><button type="button" className="cfm-btn-danger" disabled={busy || actionUnavailable} onClick={() => run(action.kind, action)}>{busy ? <><span className="apm-spinner" aria-hidden="true" /><span className="model-sr-only">Applying…</span></> : action.kind === 'retrain' ? 'Confirm retrain' : action.kind === 'cancel' ? 'Confirm cancellation' : action.kind === 'reject' ? 'Reject candidate' : action.rollback ? 'Confirm rollback' : 'Confirm promotion'}</button></div>
    </AppModal>}
  </section>
}
