import { useEffect, useMemo, useState } from 'react'
import AppModal from './AppModal'
import IncidentReportPreview from './IncidentReportPreview'
import { Field, SectionHead, Segmented, Icon } from './incidentForm'
import { ICON_DOC, ICON_DOWNLOAD, ICON_SUMMARY } from '../utils/exportIcons'
import { fetchIncidentWorkflow, fetchDispatches, fetchIncidentReport, fetchOperationalDetail } from '../api'
import { buildIncidentReport } from '../utils/incidentReportExport'
import { downloadBlob, safeFileName } from '../utils/incidentRegister'
import '../styles/DispatchModal.css'
import '../styles/ExportModal.css'
import '../styles/IncidentReportExport.css'

const CONTENTS = [
  ['summary', 'Incident summary', 'Location, classification, status and key incident details.', ICON_DOC],
  ['units', 'Responding units', 'Assignments, trucks, crew and response milestones.', ICON_SUMMARY],
  ['unitReports', 'Unit field reports', 'Each unit’s attributed findings and recommendations.', ICON_DOC],
  ['overallReport', 'Overall incident report', 'The consolidated narrative, findings and review status.', ICON_DOC],
  ['analysis', 'Include response analysis', 'Response durations, planned travel comparisons and milestone history.', ICON_SUMMARY],
  ['signatures', 'Signature block', 'Prepared by and noted by lines for filing.', 'M160-80v-80h640v80H160Zm80-160v-170l362-362 112 112-362 362H240Z'],
]
const PAPERS = [{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'legal', label: 'Legal' }]
const ORIENTATIONS = [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]

export default function IncidentExportModal({ incident, onClose }) {
  const [options, setOptions] = useState({ format: 'pdf', title: '', paper: 'a4', orientation: 'portrait', summary: true, units: true, unitReports: true, overallReport: true, analysis: false, signatures: false, preparedBy: '', notedBy: '', fileName: '' })
  const [settled, setSettled] = useState(options)
  const [data, setData] = useState(null)
  const [analysisState, setAnalysisState] = useState(null)
  const [reload, setReload] = useState(0)
  const [analysisReload, setAnalysisReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => {
    if (key === 'analysis' && value) setAnalysisReload(current => current + 1)
    setOptions(current => ({ ...current, [key]: value }))
  }
  useEffect(() => { const timer = setTimeout(() => setSettled(options), 300); return () => clearTimeout(timer) }, [options])
  useEffect(() => {
    let alive = true
    Promise.all([fetchIncidentWorkflow(incident.fire_id), fetchDispatches(incident.fire_id), fetchIncidentReport(incident.fire_id)])
      .then(([workflow, dispatches, report]) => {
        if (alive) setData({ fireId: incident.fire_id, reload, value: {
          incident: { ...incident, ...workflow.incident }, dispatches, fieldReports: workflow.field_reports,
          report: report || workflow.report, generatedAt: new Date(),
        } })
      }).catch(failure => { if (alive) setData({ fireId: incident.fire_id, reload, error: failure.message }) })
    return () => { alive = false }
  }, [incident, reload])
  useEffect(() => {
    if (!options.analysis) return
    let alive = true
    fetchOperationalDetail(incident.fire_id)
      .then(value => { if (alive) setAnalysisState({ fireId: incident.fire_id, reload: analysisReload, value }) })
      .catch(failure => { if (alive) setAnalysisState({ fireId: incident.fire_id, reload: analysisReload, error: failure.message }) })
    return () => { alive = false }
  }, [incident.fire_id, options.analysis, analysisReload])
  const source = data?.fireId === incident.fire_id && data.reload === reload ? data : null
  const analysis = analysisState?.fireId === incident.fire_id && analysisState.reload === analysisReload ? analysisState : null
  const ready = !!source?.value && (!options.analysis || !!analysis?.value)
  const noContents = !['summary', 'units', 'unitReports', 'overallReport', 'analysis'].some(key => options[key])
  const reportOptions = useMemo(() => ({ ...settled, analysis: options.analysis }), [settled, options.analysis])
  const document = useMemo(() => source?.value && (!options.analysis || analysis?.value) && !noContents
    ? buildIncidentReport({ ...source.value, analysis: options.analysis ? analysis.value : null }, reportOptions) : null,
  [source, analysis, options.analysis, reportOptions, noContents])
  const classification = source?.value?.incident.status === 'closed' || (!source && incident.status === 'closed') ? 'Final Incident Report' : 'Interim Incident Report'
  const defaultName = `${incident.id || `INC-${incident.fire_id}`}-${classification}`

  async function download() {
    if (busy || !ready || noContents) return
    setBusy(true); setError('')
    try {
      const report = buildIncidentReport({ ...source.value, analysis: options.analysis ? analysis.value : null }, options)
      const blob = options.format === 'docx'
        ? await (await import('../utils/incidentReportDocx')).incidentReportToDocx(report, options)
        : (await import('../utils/incidentReportPdf')).incidentReportToPdf(report, options).output('blob')
      downloadBlob(blob, safeFileName(options.fileName || defaultName, options.format))
    } catch (failure) { setError(failure.message || 'Could not create the report. Please try again.') }
    finally { setBusy(false) }
  }

  return <AppModal title="Incident report preview" eyebrow="EXPORT" variant="badged"
    icon={<Icon d={ICON_DOWNLOAD} className="cfm-badge-icon" />}
    subtitle="Preview the report, adjust the document, then download your file."
    onClose={onClose} dismissible={!busy} manageFocus className="eim-panel xpm-panel irp-panel" width={1280}>
    <div className="xpm-layout">
      {source?.error ? <section className="xpm-preview"><div className="xpm-state" role="alert"><strong>Could not load incident records</strong><span>{source.error}</span><button type="button" className="apm-btn-cancel" onClick={() => setReload(value => value + 1)}>Try again</button></div></section>
        : noContents ? <section className="xpm-preview"><div className="xpm-state"><strong>No report contents selected</strong><span>Choose at least one report section.</span></div></section>
          : <IncidentReportPreview document={document} paper={settled.paper} orientation={settled.orientation} format={options.format} />}
      <div className="eim-body xpm-rail">
        <fieldset disabled={busy}>
          <section className="eim-section">
            <SectionHead title="Format" />
            <div className="xpm-formats" role="radiogroup" aria-label="Export format">
              {[['pdf', 'PDF', 'Print-ready report'], ['docx', 'DOCX', 'Editable in Word']].map(([value, label, description]) => <button key={value} type="button" role="radio" aria-checked={options.format === value} className={`xpm-format ${options.format === value ? 'active' : ''}`} onClick={() => set('format', value)}>
                <span className="xpm-format-icon"><Icon d={ICON_DOC} /><span className={`xpm-badge xpm-badge-${value}`}>{label}</span></span>
                <span className="xpm-format-name">{label}</span><span className="xpm-format-desc">{description}</span>
              </button>)}
            </div>
          </section>
          <section className="eim-section">
            <SectionHead title="Document" />
            <div className="irp-notice"><strong>{incident.id}<span className="irp-notice-separator" aria-hidden="true">|</span>{classification}</strong>{classification.startsWith('Interim') ? 'Available data as of export. Response analysis is preliminary.' : 'Closed incident record.'} Missing submissions and pending reviews remain labeled.</div>
            <Field label="Title"><input aria-label="Report title" maxLength={160} value={options.title} placeholder={classification} onChange={event => set('title', event.target.value)} /></Field>
            <Field label="Orientation"><Segmented options={ORIENTATIONS} value={options.orientation} onChange={value => set('orientation', value)} label="Orientation" /></Field>
            <Field label="Paper"><Segmented options={PAPERS} value={options.paper} onChange={value => set('paper', value)} label="Paper size" /></Field>
          </section>
          <section className="eim-section">
            <SectionHead title="Contents" />
            {CONTENTS.map(([key, title, description, icon]) => <label key={key} className={`nim-toggle ${options[key] ? 'on' : ''}`}>
              <span className="nim-toggle-icon"><Icon d={icon} /></span>
              <span className="nim-toggle-text"><span className="nim-toggle-title">{title}</span><span className="nim-toggle-desc">{description}</span></span>
              <input type="checkbox" role="switch" aria-label={title} className="nim-switch" checked={options[key]} onChange={event => set(key, event.target.checked)} />
            </label>)}
            {noContents && <p className="apm-error" role="alert">Select at least one report section.</p>}
            {options.analysis && analysis?.error && <div className="apm-error" role="alert">{analysis.error} <button type="button" className="eim-link-btn" onClick={() => setAnalysisReload(value => value + 1)}>Retry analysis</button></div>}
            {options.signatures && <><Field label="Prepared by"><input aria-label="Prepared by" maxLength={100} value={options.preparedBy} onChange={event => set('preparedBy', event.target.value)} /></Field><Field label="Noted by"><input aria-label="Noted by" maxLength={100} value={options.notedBy} onChange={event => set('notedBy', event.target.value)} /></Field></>}
            <p className="frm-hint">Photo counts are included with reports. Scene photos remain available on the incident page.</p>
          </section>
          <section className="eim-section">
            <SectionHead title="File" />
            <Field label="File name"><div className="xpm-file"><input aria-label="File name" maxLength={160} value={options.fileName} placeholder={defaultName} onChange={event => set('fileName', event.target.value)} /><span className="xpm-file-ext">.{options.format}</span></div></Field>
          </section>
        </fieldset>
        {error && <div className="apm-error" role="alert">{error}</div>}
      </div>
    </div>
    <div className="eim-footer">
      <div className="eim-changes" role="status">{busy ? 'Preparing download…' : ready ? `${classification} · Philippine time` : 'Loading report data…'}</div>
      <div className="eim-footer-actions"><button type="button" className="apm-btn-cancel" onClick={onClose} disabled={busy}>Close</button><button type="button" className="apm-btn-submit" onClick={download} disabled={busy || !ready || noContents}>{busy ? 'Exporting…' : `Download ${options.format.toUpperCase()}`}</button></div>
    </div>
  </AppModal>
}
