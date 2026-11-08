import { useEffect, useState } from 'react'

let pdfjsPromise
function loadPdfjs() {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    .then(([lib, worker]) => { lib.GlobalWorkerOptions.workerSrc = worker.default; return lib })
  return pdfjsPromise
}

export default function IncidentReportPreview({ document: report, paper, orientation, format }) {
  const [preview, setPreview] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!report) return
    let cancelled = false, task, pdfDocument
    const urls = []
    ;(async () => {
      try {
        const [pdfjs, { incidentReportToPdf }] = await Promise.all([loadPdfjs(), import('../utils/incidentReportPdf')])
        if (cancelled) return
        task = pdfjs.getDocument({ data: new Uint8Array(incidentReportToPdf(report, { paper, orientation }).output('arraybuffer')) })
        pdfDocument = await task.promise
        const count = pdfDocument.numPages, pages = []
        for (let number = 1; number <= Math.min(count, 20); number++) {
          if (cancelled) return
          const page = await pdfDocument.getPage(number), viewport = page.getViewport({ scale: 1.5 })
          const canvas = document.createElement('canvas')
          canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
          await page.render({ canvas, viewport }).promise
          if (cancelled) return
          const blob = await new Promise(resolve => canvas.toBlob(resolve))
          if (!blob) throw new Error('Could not render the preview page.')
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          urls.push(url); pages.push({ url, ratio: viewport.height / viewport.width })
          setPreview({ report, paper, orientation, pages: [...pages], count, complete: number === Math.min(count, 20) })
        }
      } catch (error) {
        if (!cancelled) setPreview({ report, paper, orientation, error: error.message })
      } finally {
        await task?.destroy()
      }
    })()
    return () => { cancelled = true; task?.destroy()?.catch(() => {}); urls.forEach(url => URL.revokeObjectURL(url)) }
  }, [report, paper, orientation, retry])
  const current = preview?.report === report && preview?.paper === paper && preview?.orientation === orientation ? preview : null
  return <section className="xpm-preview" aria-label="Report preview">
    <div className="xpm-toolbar">
      <div className="xpm-toolbar-title">Preview {report && !current?.complete && !current?.error && <span className="apm-spinner xpm-spin" aria-label="Updating preview" />}</div>
      <div className="xpm-toolbar-meta">
        <div className="xpm-zoom" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom(value => value - 0.25)}>−</button>
          <button type="button" className="xpm-zoom-val" title="Fit to pane" onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button type="button" aria-label="Zoom in" disabled={zoom >= 2} onClick={() => setZoom(value => value + 0.25)}>+</button>
        </div>
      </div>
    </div>
    {format === 'docx' && <p className="irp-preview-note">Word preview uses the same report content and styling. Pagination and spacing may differ in Word.</p>}
    <div className="xpm-pages" style={{ '--xpm-zoom': zoom, '--xpm-fit': orientation === 'landscape' ? '900px' : '660px' }}>
      {current?.error ? <div className="xpm-state" role="alert"><strong>Preview unavailable</strong><span>{current.error}</span><button type="button" className="apm-btn-cancel" onClick={() => setRetry(value => value + 1)}>Retry preview</button></div>
        : current?.pages?.length ? <>
          {current.pages.map((page, index) => <figure className="xpm-page" key={page.url}>
            <img src={page.url} alt={`Report page ${index + 1} of ${current.count}`} style={{ aspectRatio: `1 / ${page.ratio}` }} />
            <figcaption>{index + 1} / {current.count}</figcaption>
          </figure>)}
          {current.count > 20 && <p className="xpm-more">Showing the first 20 of {current.count} pages. The download includes every page.</p>}
        </> : <div className="xpm-state" role="status"><span className="apm-spinner" /><strong>{report ? 'Preparing report preview…' : 'Gathering incident records…'}</strong></div>}
    </div>
  </section>
}
