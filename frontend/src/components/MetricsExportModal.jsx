import { useEffect, useState } from 'react'
import AppModal from './AppModal'
import { Icon, Field, SectionHead } from './incidentForm'
import { ICON_CHECK, ICON_MINUS, ICON_PLUS, ICON_WARN, ICON_PIN } from './incidentFormOptions'
import { ICON_DOC, ICON_DOWNLOAD, ICON_PRINT, ICON_SUMMARY } from '../utils/exportIcons'
import { downloadBlob } from '../utils/incidentRegister'
import { DEFAULT_METRICS_OPTIONS } from '../utils/metricsExportOptions'
import '../styles/ExportModal.css'
import '../styles/MetricsExportModal.css'

const ZOOMS = [.5, .75, 1, 1.25, 1.5, 2]

function FormatIcon({ format }) {
  return <span className="xpm-format-icon" aria-hidden="true">
    <Icon d={ICON_DOC} />
    <span className={`xpm-badge xpm-badge-${format}`}>{format.toUpperCase()}</span>
  </span>
}

export default function MetricsExportModal({ snapshot, onClose }) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState(null)
  const [options, setOptions] = useState(() => ({ ...DEFAULT_METRICS_OPTIONS, barangayMap: !!snapshot.barangays?.features?.length }))
  const [zoom, setZoom] = useState(1)
  const selected = ['overview', 'alarms', 'monthly', 'barangays', 'causes'].some(key => options[key])
  const current = result?.attempt === attempt && result.options === options ? result : null
  const update = (key, value) => setOptions(previous => ({ ...previous, [key]: value }))
  useEffect(() => {
    let alive = true, document, renderTask
    async function prepare() {
      if (!selected) return
      try {
        const [{ buildMetricsPresentation }, pdfjs, worker] = await Promise.all([
          import('../utils/metricsPresentation'), import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
        ])
        if (!alive) return
        const pdf = buildMetricsPresentation(snapshot, options)
        const bytes = pdf.output('arraybuffer')
        const blob = new Blob([bytes], { type: 'application/pdf' })
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default
        const task = pdfjs.getDocument({ data: new Uint8Array(bytes) })
        document = task
        const doc = await task.promise
        const pages = []
        for (let n = 1; alive && n <= doc.numPages; n++) {
          const page = await doc.getPage(n)
          const viewport = page.getViewport({ scale: 2 })
          const canvas = window.document.createElement('canvas')
          canvas.width = viewport.width; canvas.height = viewport.height
          renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport })
          await renderTask.promise
          pages.push(canvas.toDataURL('image/png'))
          canvas.width = 0; canvas.height = 0
        }
        let output = blob
        if (alive && options.format === 'pptx') {
          const { buildMetricsPptx } = await import('../utils/metricsPptx')
          if (!alive) return
          output = await buildMetricsPptx(pages, options)
        }
        if (alive) setResult({ attempt, options, blob: output, pdfBlob: blob, pages })
      } catch (error) {
        if (alive) setResult({ attempt, options, error: error.message || 'Could not prepare the presentation.' })
      }
    }
    const timer = setTimeout(prepare, 250)
    return () => { alive = false; clearTimeout(timer); renderTask?.cancel(); document?.destroy() }
  }, [snapshot, attempt, options, selected])

  function check(key, label, disabled = false, desc) {
    return <label className={`nim-toggle mex-check${options[key] ? ' on' : ''}`}>
      <span className="nim-toggle-icon"><Icon d={key.toLowerCase().includes('barangay') ? ICON_PIN : ICON_SUMMARY} /></span>
      <span className="nim-toggle-text"><span className="nim-toggle-title">{label}</span>{desc && <span className="nim-toggle-desc">{desc}</span>}</span>
      <input type="checkbox" role="switch" className="nim-switch" checked={options[key]} disabled={disabled} onChange={event => update(key, event.target.checked)} />
    </label>
  }
  function download() {
    const name = options.fileName.trim().replace(/\.(pdf|pptx)$/i, '').replace(/[\\/:*?"<>|]+/g, '-') || 'FireTrackr-metrics'
    downloadBlob(current.blob, `${name}-${snapshot.period.key}-${snapshot.generatedAt.slice(0, 10)}.${options.format}`)
  }
  function print() {
    const url = URL.createObjectURL(current.pdfBlob)
    const frame = document.createElement('iframe')
    frame.className = 'xpm-print-frame'
    frame.src = url
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print() }
      catch { window.open(url, '_blank', 'noopener') }
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60_000)
    }
    document.body.appendChild(frame)
  }

  return <AppModal title="Metrics export preview" eyebrow="EXPORT" subtitle="Preview the report, adjust it on the right, then download or print." onClose={onClose} width={1280} className="eim-panel xpm-panel mex-modal" manageFocus>
    <div className="xpm-layout">
      <section className="xpm-preview" aria-label="Preview">
        <div className="xpm-toolbar">
          <div className="xpm-toolbar-title">Preview{selected && !current && <span className="apm-spinner xpm-spin" aria-label="Updating preview" />}</div>
          <div className="xpm-toolbar-meta"><div className="xpm-zoom" role="group" aria-label="Zoom">
            <button type="button" onClick={() => setZoom(value => ZOOMS[Math.max(0, ZOOMS.indexOf(value) - 1)])} disabled={zoom === ZOOMS[0]} aria-label="Zoom out"><Icon d={ICON_MINUS} /></button>
            <button type="button" className="xpm-zoom-val" onClick={() => setZoom(1)} title="Fit to pane">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => setZoom(value => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(value) + 1)])} disabled={zoom === ZOOMS.at(-1)} aria-label="Zoom in"><Icon d={ICON_PLUS} /></button>
          </div></div>
        </div>
        <div className="xpm-pages mex-preview" style={{ '--xpm-zoom': zoom, '--xpm-fit': '900px' }} aria-label="Presentation preview" aria-busy={selected && !current}>
          {!selected ? <div className="xpm-state" role="status"><strong>No sections selected</strong><span>Select at least one presentation section.</span></div> : current?.error ? <div className="xpm-state" role="alert"><Icon d={ICON_WARN} className="xpm-state-icon" /><strong>Preview failed</strong><span>{current.error}</span><button type="button" className="apm-btn-cancel" onClick={() => setAttempt(value => value + 1)}>Retry preview</button></div> : current?.pages ? current.pages.map((src, index) => <figure className="xpm-page" key={index}><img src={src} alt={`Metrics presentation slide ${index + 1}`} style={{ aspectRatio: '16 / 9' }} /><figcaption>{index + 1} / {current.pages.length}</figcaption></figure>) : <figure className="xpm-page"><div className="xpm-page-skeleton" style={{ aspectRatio: '16 / 9' }} role="status" aria-label="Preparing slides" /></figure>}
        </div>
      </section>
      <aside className="eim-body xpm-rail mex-settings" aria-label="Export settings">
        <section className="eim-section"><SectionHead title="Format" />
          <div className="xpm-formats mex-formats" role="group" aria-label="Export format">{['pdf', 'pptx'].map(format => <button type="button" key={format} value={format} className={`xpm-format${options.format === format ? ' active' : ''}`} aria-pressed={options.format === format} onClick={() => update('format', format)}>
            <FormatIcon format={format} /><span className="xpm-format-name">{format === 'pdf' ? 'PDF' : 'PowerPoint'}</span><span className="xpm-format-desc">{format === 'pdf' ? 'Print-ready document' : 'PPTX · image slides'}</span>{options.format === format && <Icon d={ICON_CHECK} className="eim-icon xpm-format-check" />}
          </button>)}</div>
        </section>
        <section className="eim-section"><SectionHead title="Scope" desc="Set on the Metrics page" /><div className="xpm-scope"><div className="xpm-scope-count"><strong>{(snapshot.summary.total ?? 0).toLocaleString()}</strong> incidents</div><div className="eim-subtitle"><span className="eim-chip">Period: {snapshot.period.description}</span>{snapshot.breakdownPeriod && <span className="eim-chip">Breakdowns: {snapshot.breakdownPeriod}</span>}<span className="eim-chip">Widescreen 16:9</span></div><div className="xpm-scope-sort">Snapshot at export opening · occurrence-date metrics</div></div></section>
        <section className="eim-section"><SectionHead title="Document" />
          <Field label="Title"><input aria-label="Presentation title" value={options.title} maxLength={60} onChange={event => update('title', event.target.value)} /></Field>
          <Field label="Prepared by"><input aria-label="Prepared by" value={options.preparedBy} maxLength={60} placeholder="Name" onChange={event => update('preparedBy', event.target.value)} /></Field>
          <Field label="Accent color"><select aria-label="Accent color" value={options.accent} onChange={event => update('accent', event.target.value)}><option value="#d84927">Fire orange</option><option value="#2563eb">Blue</option><option value="#334155">Slate</option></select></Field>
        </section>
        <section className="eim-section"><SectionHead title="Include sections" />{check('overview', 'Overview & key metrics')}{check('alarms', 'Alarm levels')}{check('monthly', 'Monthly incident activity')}{check('barangays', 'Incidents by barangay')}{check('causes', 'Top 10 reported causes')}</section>
        <section className="eim-section"><SectionHead title="Charts & map" />{check('lineChart', 'Monthly line chart', !options.monthly)}{check('alarmDonut', 'Alarm-level donut', !options.alarms)}{check('barangayMap', 'Barangay choropleth map', !options.barangays || !snapshot.barangays?.features?.length)}{!snapshot.barangays?.features?.length && <p className="frm-hint">Boundaries unavailable in this snapshot. Barangay rankings will be included instead. Close and refresh Metrics to retry the map.</p>}{check('causeChart', 'Top causes bar chart', !options.causes)}{check('values', 'Show chart values & percentages')}{check('dataTables', 'Supporting data tables', false, 'Add full data tables after chart slides.')}<p className="frm-hint">Sections without a selected visual use data tables. Monthly charts show up to twelve months per slide. The map uses recorded boundaries and counts.</p></section>
        <section className="eim-section"><SectionHead title="File" /><Field label="File name"><div className="xpm-file"><input aria-label="File name" value={options.fileName} maxLength={100} spellCheck={false} onChange={event => update('fileName', event.target.value)} /><span className="xpm-file-ext">.{options.format}</span></div></Field></section>
      </aside>
    </div>
    <div className="eim-footer"><div className="eim-changes">{!selected ? 'No sections selected' : current?.pages ? `${current.pages.length} slides · ${options.format.toUpperCase()}` : 'Preparing presentation…'}{options.format === 'pptx' && ' · Image slides'}</div><div className="eim-footer-actions">
      <button type="button" className="apm-btn-cancel" onClick={onClose}>Close</button>
      <button type="button" className="apm-btn-cancel xpm-btn-icon" disabled={!current?.pdfBlob || !selected} onClick={print}><Icon d={ICON_PRINT} />Print</button>
      <button type="button" className="apm-btn-submit xpm-btn-icon mex-download" disabled={!current?.blob || !selected} onClick={download}><Icon d={ICON_DOWNLOAD} />Download {options.format.toUpperCase()}</button>
    </div></div>
  </AppModal>
}
