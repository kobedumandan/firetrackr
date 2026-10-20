import { useEffect, useMemo, useRef, useState } from 'react'
import AppModal from './AppModal'
import CsvSheet from './CsvSheet'
import { Icon, Field, SectionHead, Segmented, FieldError } from './incidentForm'
import { ICON_CHECK, ICON_MINUS, ICON_PLUS, ICON_WARN } from './incidentFormOptions'
import {
  COLUMNS, DEFAULT_COLUMNS, MAX_ROWS, buildRegister, defaultOptions, describeQuery,
  downloadBlob, fetchAllIncidents, registerToCsv, safeFileName,
} from '../utils/incidentRegister'
import '../styles/ExportModal.css'

const ICON_DOC = 'M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z'
const ICON_DOWNLOAD = 'M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z'
const ICON_PRINT = 'M640-640v-120H320v120h-80v-200h480v200h-80Zm-480 80h640-640Zm560 100q17 0 28.5-11.5T760-500q0-17-11.5-28.5T720-540q-17 0-28.5 11.5T680-500q0 17 11.5 28.5T720-460Zm-80 260v-160H320v160h320Zm80 80H240v-160H80v-240q0-51 35-85.5t85-34.5h560q51 0 85.5 34.5T880-520v240H720v160Zm80-240v-160q0-17-11.5-28.5T760-560H200q-17 0-28.5 11.5T160-520v160h80v-80h480v80h80Z'
const ICON_SUMMARY = 'M280-280h80v-200h-80v200Zm320 0h80v-400h-80v400Zm-160 0h80v-120h-80v120Zm0-200h80v-80h-80v80ZM200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z'
const ICON_SIGN = 'M160-80v-80h640v80H160Zm80-160v-170l362-362q11-11 25.5-17t30.5-6q16 0 30.5 6t25.5 17l54 56q11 11 17 25.5t6 30.5q0 15-6 30t-17 26L386-240H240Zm80-80h32l280-280-16-16-16-16-280 280v32Zm296-296-32-32 32 32 32 32-32-32Z'

const FORMATS = [
  { value: 'pdf',  badge: 'PDF',  name: 'PDF',  desc: 'Print-ready document' },
  { value: 'docx', badge: 'DOCX', name: 'Word', desc: 'Editable before filing' },
  { value: 'csv',  badge: 'CSV',  name: 'CSV',  desc: 'Rows for spreadsheets' },
]
const PAPERS = [
  { value: 'a4', label: 'A4' },
  { value: 'letter', label: 'Letter' },
  { value: 'legal', label: 'Legal' },
]
const ORIENTATIONS = [
  { value: 'landscape', label: 'Landscape' },
  { value: 'portrait', label: 'Portrait' },
]
// Portrait aspect (h / w) per paper, for skeleton pages before the render lands.
const PAPER_RATIO = { a4: 297 / 210, letter: 11 / 8.5, legal: 14 / 8.5 }
const PREVIEW_PAGES = 20
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2]

let pdfjsPromise = null
function loadPdfjs() {
  // pdf.js and its worker are only fetched the first time a preview renders.
  pdfjsPromise ??= Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default
    return lib
  })
  return pdfjsPromise
}

function readUser() {
  try { return JSON.parse(localStorage.getItem('bfp_user') || 'null') } catch { return null }
}

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

function printPdf(blob) {
  const url = URL.createObjectURL(blob)
  const frame = document.createElement('iframe')
  frame.className = 'xpm-print-frame'
  frame.src = url
  frame.onload = () => {
    try {
      frame.contentWindow.focus()
      frame.contentWindow.print()
    } catch {
      window.open(url, '_blank', 'noopener')
    }
    setTimeout(() => { frame.remove(); URL.revokeObjectURL(url) }, 60_000)
  }
  document.body.appendChild(frame)
}

/**
 * Incident register export: live preview on the left, settings on the right.
 *   query – the Incidents page's current filters + sort (the export's scope)
 */
export default function ExportRegisterModal({ query, onClose }) {
  const [options, setOptions] = useState(() => defaultOptions(readUser()))
  const [data, setData] = useState({ status: 'loading' })
  const [preview, setPreview] = useState({ status: 'idle', pages: [], pageCount: 0 })
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(null) // 'download' | 'print'
  const [actionError, setActionError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const set = (key, value) => setOptions(o => ({ ...o, [key]: value }))
  const isDoc = options.format !== 'csv'
  const noColumns = options.columns.length === 0
  const { parts: scopeParts, sort: scopeSort } = describeQuery(query)

  // ── Scope: every matching incident, fetched once ──
  useEffect(() => {
    const ctrl = new AbortController()
    fetchAllIncidents(query, { signal: ctrl.signal })
      .then(value => setData({ status: 'ready', value }))
      .catch(e => { if (e.name !== 'AbortError') setData({ status: 'error', error: e.message }) })
    return () => ctrl.abort()
  }, [query, reloadKey])

  // Typing in a text field shouldn't re-render the PDF on every keystroke.
  const settled = useDebounced(options, 350)
  const doc = useMemo(
    () => (data.status === 'ready' && settled.columns.length
      ? buildRegister(data.value, query, settled) : null),
    [data, query, settled],
  )
  const docIsPaged = settled.format !== 'csv'

  // Page images on screen right now. Each is an object URL, freed only once a
  // newer render has replaced it — never while it is still displayed.
  const shownUrls = useRef(new Set())
  function showPreview(next) {
    const keep = new Set(next.pages.map(p => p.url))
    shownUrls.current.forEach(u => { if (!keep.has(u)) URL.revokeObjectURL(u) })
    shownUrls.current = keep
    setPreview(next)
  }
  useEffect(() => () => shownUrls.current.forEach(u => URL.revokeObjectURL(u)), [])

  // ── Preview: render the real PDF with pdf.js, page by page ──
  useEffect(() => {
    if (!doc || !docIsPaged) return
    let cancelled = false
    const stale = () => cancelled
    const urls = []
    let pdfDoc = null
    // First render streams pages in as they land; later ones swap the whole
    // set at the end, so an edit doesn't make the pages below flicker out.
    const progressive = shownUrls.current.size === 0

    ;(async () => {
      try {
        const [{ registerToPdf }, pdfjs] = await Promise.all([import('../utils/exportPdf'), loadPdfjs()])
        if (stale()) return
        const bytes = registerToPdf(doc, settled).output('arraybuffer')
        pdfDoc = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise
        const pageCount = pdfDoc.numPages
        const last = Math.min(pageCount, PREVIEW_PAGES)
        const pages = []
        for (let i = 1; i <= last; i++) {
          if (stale()) return
          const page = await pdfDoc.getPage(i)
          const viewport = page.getViewport({ scale: 2 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width)
          canvas.height = Math.ceil(viewport.height)
          await page.render({ canvas, viewport }).promise
          const blob = await new Promise(r => canvas.toBlob(r))
          const url = URL.createObjectURL(blob)
          urls.push(url)
          pages.push({ url, ratio: viewport.height / viewport.width })
          if (stale()) return
          if (progressive || i === last) {
            showPreview({ doc, status: i === last ? 'ready' : 'rendering', pages: [...pages], pageCount })
          }
        }
      } catch (e) {
        if (!stale()) showPreview({ doc, status: 'error', pages: [], pageCount: 0, error: e.message })
      } finally {
        pdfDoc?.destroy()
        // A render cut short by a newer one never reached the screen.
        urls.forEach(u => { if (!shownUrls.current.has(u)) URL.revokeObjectURL(u) })
      }
    })()

    return () => { cancelled = true }
  }, [doc, docIsPaged, settled])
  // Stale until the pages on screen were rendered from the current document.
  const previewBusy = docIsPaged && !!doc && (preview.doc !== doc || preview.status === 'rendering')

  async function buildFile(format) {
    // Build from the live options, not the debounced ones, so the file always
    // matches the rail even if the preview is a keystroke behind.
    const d = buildRegister(data.value, query, options)
    if (format === 'csv') return registerToCsv(d)
    if (format === 'docx') {
      const { registerToDocx } = await import('../utils/exportDocx')
      return registerToDocx(d, options)
    }
    const { registerToPdf } = await import('../utils/exportPdf')
    return registerToPdf(d, options).output('blob')
  }

  async function handleDownload() {
    setBusy('download')
    setActionError(null)
    try {
      const blob = await buildFile(options.format)
      downloadBlob(blob, safeFileName(options.fileName, options.format))
    } catch (e) {
      setActionError(`Couldn't create the ${options.format.toUpperCase()} file: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }

  async function handlePrint() {
    setBusy('print')
    setActionError(null)
    try {
      printPdf(await buildFile('pdf'))
    } catch (e) {
      setActionError(`Couldn't prepare the document for printing: ${e.message}`)
    } finally {
      setBusy(null)
    }
  }

  function toggleColumn(key) {
    set('columns', options.columns.includes(key)
      ? options.columns.filter(k => k !== key)
      : COLUMNS.map(c => c.key).filter(k => k === key || options.columns.includes(k)))
  }

  const rows = data.value?.items.length ?? 0
  const ready = data.status === 'ready'
  const fit = options.orientation === 'landscape' ? 900 : 660
  const ratio = options.orientation === 'landscape'
    ? 1 / PAPER_RATIO[options.paper] : PAPER_RATIO[options.paper]

  let footerNote = 'Gathering incidents…'
  if (data.status === 'error') footerNote = 'Couldn’t load incidents'
  else if (ready && !isDoc) footerNote = `${rows} ${rows === 1 ? 'row' : 'rows'} · ${options.columns.length} columns`
  else if (ready) {
    const pages = preview.pageCount
      ? `${preview.pageCount} ${preview.pageCount === 1 ? 'page' : 'pages'}` : 'Paginating…'
    footerNote = `${rows} ${rows === 1 ? 'incident' : 'incidents'} · ${pages}${options.format === 'docx' && preview.pageCount ? ' (approx.)' : ''}`
  }

  return (
    <AppModal
      eyebrow="EXPORT"
      title="Incident register"
      subtitle="Preview the report, adjust it on the right, then download or print."
      onClose={onClose}
      width={1280}
      className="eim-panel xpm-panel"
      dismissible={!busy}
    >
      <div className="xpm-layout">
        {/* ── Preview ── */}
        <section className="xpm-preview" aria-label="Preview">
          <div className="xpm-toolbar">
            <div className="xpm-toolbar-title">
              Preview
              {isDoc && previewBusy && <span className="apm-spinner xpm-spin" aria-label="Updating preview" />}
            </div>
            <div className="xpm-toolbar-meta">
              {options.format === 'docx' && <span className="eim-chip">Word layout may differ slightly</span>}
              {isDoc && (
                <div className="xpm-zoom" role="group" aria-label="Zoom">
                  <button type="button" onClick={() => setZoom(z => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])} disabled={zoom === ZOOMS[0]} aria-label="Zoom out">
                    <Icon d={ICON_MINUS} />
                  </button>
                  <button type="button" className="xpm-zoom-val" onClick={() => setZoom(1)} title="Fit to pane">
                    {Math.round(zoom * 100)}%
                  </button>
                  <button type="button" onClick={() => setZoom(z => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])} disabled={zoom === ZOOMS.at(-1)} aria-label="Zoom in">
                    <Icon d={ICON_PLUS} />
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="xpm-pages" style={{ '--xpm-zoom': zoom, '--xpm-fit': `${fit}px` }}>
            {data.status === 'error' ? (
              <div className="xpm-state">
                <Icon d={ICON_WARN} className="xpm-state-icon" />
                <strong>Couldn&rsquo;t load the incidents</strong>
                <span>{data.error}</span>
                <button type="button" className="apm-btn-cancel" onClick={() => { setData({ status: 'loading' }); setReloadKey(k => k + 1) }}>Try again</button>
              </div>
            ) : noColumns ? (
              <div className="xpm-state">
                <strong>No columns selected</strong>
                <span>Pick at least one column on the right to build the report.</span>
              </div>
            ) : !isDoc ? (
              ready ? <CsvSheet doc={doc} /> : <div className="xpm-sheet-skeleton" />
            ) : preview.status === 'error' ? (
              <div className="xpm-state">
                <Icon d={ICON_WARN} className="xpm-state-icon" />
                <strong>Preview failed</strong>
                <span>{preview.error}</span>
              </div>
            ) : preview.pages.length ? (
              <>
                {preview.pages.map((p, i) => (
                  <figure key={p.url} className="xpm-page">
                    <img src={p.url} alt={`Page ${i + 1} of ${preview.pageCount}`} style={{ aspectRatio: `1 / ${p.ratio}` }} />
                    <figcaption>{i + 1} / {preview.pageCount}</figcaption>
                  </figure>
                ))}
                {preview.pageCount > PREVIEW_PAGES && (
                  <div className="xpm-more">
                    Preview shows the first {PREVIEW_PAGES} of {preview.pageCount} pages. The file includes all of them.
                  </div>
                )}
              </>
            ) : (
              <figure className="xpm-page">
                <div className="xpm-page-skeleton" style={{ aspectRatio: `1 / ${ratio}` }} />
              </figure>
            )}
          </div>
        </section>

        {/* ── Settings rail ── */}
        <div className="eim-body xpm-rail">
          <section className="eim-section">
            <SectionHead title="Format" />
            <div className="xpm-formats" role="radiogroup" aria-label="Export format">
              {FORMATS.map(f => (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={options.format === f.value}
                  className={`xpm-format ${options.format === f.value ? 'active' : ''}`}
                  onClick={() => set('format', f.value)}
                >
                  <span className="xpm-format-icon">
                    <Icon d={ICON_DOC} />
                    <span className={`xpm-badge xpm-badge-${f.value}`}>{f.badge}</span>
                  </span>
                  <span className="xpm-format-name">{f.name}</span>
                  <span className="xpm-format-desc">{f.desc}</span>
                  {options.format === f.value && <Icon d={ICON_CHECK} className="eim-icon xpm-format-check" />}
                </button>
              ))}
            </div>
          </section>

          <section className="eim-section">
            <SectionHead title="Scope" desc="Set on the Incidents page" />
            <div className="xpm-scope">
              <div className="xpm-scope-count">
                {ready ? <><strong>{rows}</strong> {rows === 1 ? 'incident' : 'incidents'}</> : 'Counting…'}
                {ready && data.value.total > rows && <span className="xpm-scope-cap"> (capped at {MAX_ROWS})</span>}
              </div>
              <div className="eim-subtitle">
                {scopeParts.map(([k, v]) => <span key={k} className="eim-chip">{k}: {v}</span>)}
              </div>
              <div className="xpm-scope-sort">Sorted by {scopeSort}</div>
            </div>
          </section>

          {isDoc && (
            <section className="eim-section">
              <SectionHead title="Document" />
              <Field label="Title">
                <input value={options.title} onChange={e => set('title', e.target.value)} placeholder="Fire Incident Register" />
              </Field>
              <Field label="Office">
                <input value={options.office} onChange={e => set('office', e.target.value)} placeholder="e.g. Panabo City Fire Station" />
              </Field>
              <div className="eim-row">
                <Field label="Paper">
                  <Segmented options={PAPERS} value={options.paper} onChange={v => set('paper', v)} label="Paper size" />
                </Field>
                <Field label="Orientation">
                  <Segmented options={ORIENTATIONS} value={options.orientation} onChange={v => set('orientation', v)} label="Orientation" />
                </Field>
              </div>
            </section>
          )}

          {isDoc && (
            <section className="eim-section">
              <SectionHead title="Contents" />
              <Toggle
                icon={ICON_SUMMARY}
                title="Summary counts"
                desc="Totals by status above the table."
                checked={options.showSummary}
                onChange={v => set('showSummary', v)}
              />
              <Toggle
                icon={ICON_SIGN}
                title="Signature block"
                desc="Prepared by / Noted by lines for filing."
                checked={options.showSignatures}
                onChange={v => set('showSignatures', v)}
              />
              {options.showSignatures && (
                <div className="eim-row xpm-sign-fields">
                  <Field label="Prepared by">
                    <input value={options.preparedBy} onChange={e => set('preparedBy', e.target.value)} placeholder="Name" />
                  </Field>
                  <Field label="Noted by">
                    <input value={options.notedBy} onChange={e => set('notedBy', e.target.value)} placeholder="Leave blank to sign by hand" />
                  </Field>
                </div>
              )}
            </section>
          )}

          <section className="eim-section">
            <div className="eim-section-head">
              <h3>Columns</h3>
              <p>{options.columns.length} of {COLUMNS.length}</p>
              <button type="button" className="eim-link-btn" onClick={() => set('columns', DEFAULT_COLUMNS)}>Reset</button>
            </div>
            <div className="eim-chips">
              {COLUMNS.map(c => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={options.columns.includes(c.key)}
                  className={`eim-pick ${options.columns.includes(c.key) ? 'active' : ''}`}
                  onClick={() => toggleColumn(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            {noColumns && <FieldError>Select at least one column.</FieldError>}
            {options.columns.includes('reporter') && (
              <p className="frm-hint">Reporter names and numbers are personal data. Share this file only within BFP.</p>
            )}
          </section>

          <section className="eim-section">
            <SectionHead title="File" />
            <Field label="File name">
              <div className="xpm-file">
                <input value={options.fileName} onChange={e => set('fileName', e.target.value)} spellCheck={false} />
                <span className="xpm-file-ext">.{options.format}</span>
              </div>
            </Field>
          </section>

          {actionError && <div className="apm-error">{actionError}</div>}
        </div>
      </div>

      <div className="eim-footer">
        <div className="eim-changes">{footerNote}</div>
        <div className="eim-footer-actions">
          <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={!!busy}>Close</button>
          {isDoc && (
            <button type="button" className="apm-btn-cancel xpm-btn-icon" onClick={handlePrint} disabled={!ready || noColumns || !!busy}>
              {busy === 'print' ? <span className="apm-spinner xpm-spin" /> : <Icon d={ICON_PRINT} />}
              Print
            </button>
          )}
          <button type="button" className="apm-btn-submit xpm-btn-icon" onClick={handleDownload} disabled={!ready || noColumns || !!busy}>
            {busy === 'download' ? <span className="apm-spinner" /> : <Icon d={ICON_DOWNLOAD} />}
            Download {FORMATS.find(f => f.value === options.format).badge}
          </button>
        </div>
      </div>
    </AppModal>
  )
}

function Toggle({ icon, title, desc, checked, onChange }) {
  return (
    <label className={`nim-toggle ${checked ? 'on' : ''}`}>
      <span className="nim-toggle-icon"><Icon d={icon} /></span>
      <span className="nim-toggle-text">
        <span className="nim-toggle-title">{title}</span>
        <span className="nim-toggle-desc">{desc}</span>
      </span>
      <input type="checkbox" role="switch" className="nim-switch" checked={checked} onChange={e => onChange(e.target.checked)} />
    </label>
  )
}
