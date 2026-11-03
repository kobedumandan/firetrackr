import { useEffect, useRef, useState } from 'react'
import AppModal from './AppModal'
import { saveIncidentReport } from '../api'
import { Field, SectionHead, FormStatus, LockedNote, ReviewChanges } from './incidentForm'
import '../styles/EditFormModal.css'
import '../styles/AfterActionReport.css'

const FIELDS = [
  ['cause', 'Reported cause'],
  ['casualties', 'Casualties'],
  ['damage_estimate', 'Damage estimate'],
  ['remarks', 'Incident remarks', true],
  ['narrative', 'Narrative', true],
  ['recommendations', 'Recommendations', true],
]
const text = value => value == null || value === '—' ? '' : String(value)
const MAX_PHOTOS = 8
const MAX_PHOTO_BYTES = 10 * 1024 * 1024
const PHOTO_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])

export default function AfterActionReportModal({ incident, report, onClose, onSaved }) {
  const [initial] = useState(() => ({
    cause: text(report?.cause),
    casualties: text(report?.casualties ?? incident.casualties),
    damage_estimate: text(report?.damage_estimate),
    remarks: text(incident.remarks),
    narrative: text(report?.narrative ?? incident.remarks),
    recommendations: text(report?.recommendations),
  }))
  const [form, setForm] = useState(initial)
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [photos, setPhotos] = useState([])
  const [dragging, setDragging] = useState(false)
  const photoInput = useRef(null)
  const dragDepth = useRef(0)
  const previewUrls = useRef(new Set())
  const nextPhotoId = useRef(0)
  const existingPhotos = report?.photos ?? []
  const photoCount = existingPhotos.length + photos.length
  useEffect(() => {
    const urls = previewUrls.current
    return () => {
      for (const url of urls) URL.revokeObjectURL(url)
    }
  }, [])
  const creating = !report
  const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]))
  const changes = FIELDS.filter(([key]) => values[key] !== initial[key].trim())
  const blocked = !values.narrative || (!creating && changes.length === 0 && photos.length === 0)
  const rows = (creating ? FIELDS.filter(([key]) => values[key] !== '') : changes).map(([key, label, long]) => ({
    key, label, long, before: creating ? '' : initial[key], after: values[key],
  }))
  const closing = incident.status === 'contained'
  if (photos.length) rows.push({
    key: 'photos', label: 'Scene photos', long: true,
    before: `${existingPhotos.length} attached`,
    after: `${photos.length} added: ${photos.map(photo => photo.file.name).join(', ')}`,
  })

  function set(key, value) {
    setForm(previous => ({ ...previous, [key]: value }))
    setError('')
  }
  function addPhotos(event) {
    const selected = Array.from(event.target.files || [])
    event.target.value = ''
    selectPhotos(selected)
  }
  function selectPhotos(selected) {
    if (!selected.length) return
    if (photoCount + selected.length > MAX_PHOTOS) {
      setError(`A report can have up to ${MAX_PHOTOS} photos, including those already attached.`)
      return
    }
    if (selected.some(file => !PHOTO_TYPES.has(file.type.toLowerCase()))) {
      setError('Choose JPG, PNG or WebP photos.')
      return
    }
    if (selected.some(file => file.size === 0 || file.size > MAX_PHOTO_BYTES)) {
      setError('Each photo must be nonempty and no larger than 10 MB.')
      return
    }
    const added = selected.map(file => {
      const preview = URL.createObjectURL(file)
      previewUrls.current.add(preview)
      return { id: nextPhotoId.current++, file, preview }
    })
    setPhotos(previous => [...previous, ...added])
    setError('')
  }
  function dragEnter(event) {
    if (saving || !Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }
  function dragOver(event) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = saving || photoCount >= MAX_PHOTOS ? 'none' : 'copy'
  }
  function dragLeave(event) {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  function dropPhotos(event) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    if (!saving) selectPhotos(Array.from(event.dataTransfer.files || []))
  }
  function removePhoto(photo) {
    URL.revokeObjectURL(photo.preview)
    previewUrls.current.delete(photo.preview)
    setPhotos(previous => previous.filter(item => item.id !== photo.id))
    setError('')
  }
  function handleSubmit(event) {
    event.preventDefault()
    if (blocked) return
    setError('')
    setReviewing(true)
  }
  async function confirmSave() {
    setSaving(true)
    setError('')
    try {
      const body = {
        report_id: report?.report_id ?? null,
        ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null])),
      }
      const result = photos.length
        ? await saveIncidentReport(incident.fire_id, body, photos.map(photo => photo.file))
        : await saveIncidentReport(incident.fire_id, body)
      onSaved(result)
    } catch (failure) {
      setError(failure.message)
      setSaving(false)
    }
  }

  return <>
    <AppModal
      eyebrow={creating ? 'ADD AFTER-ACTION REPORT' : 'EDIT AFTER-ACTION REPORT'}
      title={incident.loc || incident.id || 'Incident report'}
      subtitle={incident.id}
      width={620}
      className="eim-panel edit-form-modal"
      onClose={onClose}
      dismissible={!saving && !reviewing}
      manageFocus
    >
      <form onSubmit={handleSubmit} inert={reviewing || undefined}>
        <div className="eim-body">
          <fieldset className="aar-editor-fields" disabled={saving}>
            <section className="eim-section">
              <SectionHead title="Outcome" desc="Cause, casualties and estimated damage" />
              <Field label="Reported cause" changed={changes.some(([key]) => key === 'cause')}>
                <input aria-label="Reported cause" data-autofocus value={form.cause} onChange={event => set('cause', event.target.value)} placeholder="e.g. Electrical fault" maxLength={255} />
              </Field>
              <div className="eim-row">
                <Field label="Casualties" changed={changes.some(([key]) => key === 'casualties')}>
                  <input aria-label="Casualties" value={form.casualties} onChange={event => set('casualties', event.target.value)} placeholder="e.g. No injuries reported" maxLength={255} />
                </Field>
                <Field label="Damage estimate" changed={changes.some(([key]) => key === 'damage_estimate')}>
                  <input aria-label="Damage estimate" value={form.damage_estimate} onChange={event => set('damage_estimate', event.target.value)} placeholder="e.g. PHP 150,000" maxLength={100} />
                </Field>
              </div>
              <Field label="Incident remarks" changed={changes.some(([key]) => key === 'remarks')}>
                <textarea aria-label="Incident remarks" value={form.remarks} onChange={event => set('remarks', event.target.value)} placeholder="Additional incident notes" rows={2} />
              </Field>
            </section>
            <section className="eim-section">
              <SectionHead title="Report" desc="Account of the response and follow-up actions" />
              <Field label="Narrative" required changed={changes.some(([key]) => key === 'narrative')}>
                <textarea aria-label="Narrative" value={form.narrative} onChange={event => set('narrative', event.target.value)} placeholder="Describe the response, actions taken and outcome" rows={5} required />
              </Field>
              <Field label="Recommendations" changed={changes.some(([key]) => key === 'recommendations')}>
                <textarea aria-label="Recommendations" value={form.recommendations} onChange={event => set('recommendations', event.target.value)} placeholder="Recommended follow-up or prevention measures" rows={3} />
              </Field>
              {report && <LockedNote>
                {report.author ? <>Originally filed by <strong>{report.author}</strong>. </> : null}
                Corrections are recorded under your administrator account
              </LockedNote>}
            </section>
            <section className="eim-section" aria-label="Report photos">
              <SectionHead title="Scene photos" desc="Complete the incident record" />
              <div className={`aar-photo-dropzone${dragging && photoCount < MAX_PHOTOS ? ' is-dragging' : ''}${photoCount >= MAX_PHOTOS ? ' is-full' : ''}`}
                onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={dropPhotos}>
                <input ref={photoInput} type="file" multiple hidden aria-label="Choose report photos"
                  accept="image/jpeg,image/jpg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                  onChange={addPhotos} disabled={saving || photoCount >= MAX_PHOTOS} />
                <button type="button" className="aar-photo-drop-target" onClick={() => photoInput.current?.click()} disabled={photoCount >= MAX_PHOTOS}
                  aria-label="Browse report photos" aria-describedby="aar-photo-formats">
                  <span className="aar-photo-drop-icon" aria-hidden="true">
                    <span className="material-symbols-outlined">{dragging ? 'upload' : 'add_photo_alternate'}</span>
                  </span>
                  <span className="aar-photo-drop-copy">
                    <strong>{photoCount >= MAX_PHOTOS ? 'Photo limit reached' : dragging ? 'Drop to attach your photos' : 'Drag and drop scene photos'}</strong>
                    <span>{photoCount >= MAX_PHOTOS ? 'This report has all 8 photo slots filled' : 'or choose images from your device'}</span>
                  </span>
                  <span className="aar-photo-browse" aria-hidden="true">Browse files<span className="material-symbols-outlined">arrow_upward</span></span>
                </button>
                <div className="aar-photo-drop-footer">
                  <span className="aar-photo-help" id="aar-photo-formats">JPG, PNG or WebP<span aria-hidden="true"> · </span>10 MB each</span>
                  <span className="aar-photo-count" aria-live="polite">{photoCount} / {MAX_PHOTOS} photos</span>
                </div>
              </div>
              {photoCount > 0 && <div className="aar-attachment-summary">
                <span>{existingPhotos.length ? `${existingPhotos.length} already attached` : 'Selected photos'}</span>
                {photos.length > 0 && <span className="aar-attachment-pending">{photos.length} ready to add</span>}
              </div>}
              {photoCount > 0 && <div className="aar-attachment-grid">
                {existingPhotos.map((url, index) => <figure className="aar-attachment" key={`${url}-${index}`}>
                  <img src={url} alt={`Attached scene photo ${index + 1}`} loading="lazy" />
                  <figcaption>Already attached</figcaption>
                </figure>)}
                {photos.map(photo => <figure className="aar-attachment is-new" key={photo.id}>
                  <img src={photo.preview} alt={`Selected photo: ${photo.file.name}`} />
                  <figcaption title={photo.file.name}>{photo.file.name}</figcaption>
                  <span className="aar-attachment-badge">New</span>
                  <button type="button" className="aar-attachment-remove" onClick={() => removePhoto(photo)} aria-label={`Remove ${photo.file.name}`} title="Remove selected photo">
                    <span className="material-symbols-outlined" aria-hidden="true">close</span>
                  </button>
                </figure>)}
              </div>}
            </section>
          </fieldset>
          {error && !reviewing && <div className="apm-error" role="alert">{error}</div>}
        </div>
        <div className="eim-footer">
          {creating ? <FormStatus missing={values.narrative ? [] : ['narrative']} /> : <FormStatus changeCount={changes.length + (photos.length ? 1 : 0)} />}
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="apm-btn-submit" disabled={blocked || saving}>Review &amp; save</button>
          </div>
        </div>
      </form>
    </AppModal>
    {reviewing && <ReviewChanges
      code={incident.id}
      rows={rows}
      note={closing ? 'Filing this report closes the incident and releases all responding teams and trucks.' : null}
      saving={saving}
      error={error}
      onBack={() => { setError(''); setReviewing(false) }}
      onConfirm={confirmSave}
    />}
  </>
}
