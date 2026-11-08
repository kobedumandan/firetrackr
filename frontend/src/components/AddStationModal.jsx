import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import '../styles/AppModal.css'
import '../styles/ConfirmModal.css'
import '../styles/DispatchModal.css'
import '../styles/PersonnelFormModal.css'
import { phoneError } from './resourceFormOptions'
import { ICON_CLOSE, ICON_PLUS } from './incidentFormOptions'
import { Icon, FormStatus } from './incidentForm'
import { MapPicker, PinStatus } from './MapPicker'
import { StationDetailsSections } from './stationForm'
import { stationIcon } from '../utils/stationIcon'
import { useIncidentBarangay } from '../hooks/useIncidentBarangay'

const STATION_ICON = stationIcon()

const EMPTY_FORM = {
  station_name: '',
  station_type: 'main',
  parent_station_id: '',
  station_address: '',
  station_barangay: '',
  station_latitude: '',
  station_longitude: '',
  station_contact: '',
  station_status: 'operational',
}

export default function AddStationModal({ onClose, onAdd, stations }) {
  const [form, setForm]         = useState(EMPTY_FORM)
  const [error, setError]       = useState(null)
  const [mapError, setMapError] = useState(null)
  const [saving, setSaving]     = useState(false)
  const { detecting, hint: barangayHint, markEdited } = useIncidentBarangay(
    form.station_latitude, form.station_longitude, setForm, 'station_barangay',
  )

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, saving])

  function set(field, value) {
    setError(null)
    if (field === 'station_barangay') markEdited()
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const hasPin = form.station_latitude !== '' && form.station_longitude !== ''
  const contactError = phoneError(form.station_contact)
  const missing = [
    !form.station_name.trim() && 'name',
    form.station_type === 'sub' && !form.parent_station_id && 'parent station',
    !form.station_address.trim() && 'address',
    !form.station_barangay.trim() && 'barangay',
    !form.station_contact.trim() && 'contact number',
    !hasPin && 'map pin',
  ].filter(Boolean)
  const blocked = detecting || missing.length > 0 || !!contactError

  async function handleSubmit(e) {
    e.preventDefault()
    if (blocked) return
    setSaving(true)
    try {
      await onAdd({
        station_name:      form.station_name.trim(),
        station_type:      form.station_type,
        station_address:   form.station_address.trim(),
        station_barangay:  form.station_barangay.trim(),
        station_contact:   form.station_contact.trim(),
        station_status:    form.station_status,
        station_latitude:  parseFloat(form.station_latitude),
        station_longitude: parseFloat(form.station_longitude),
        parent_station_id: form.station_type === 'sub' && form.parent_station_id
          ? parseInt(form.parent_station_id, 10)
          : null,
      })
      onClose()
    } catch (ex) {
      setError(ex.message)
      setSaving(false)
    }
  }

  const mainStations = stations.filter(s => s.type === 'main')

  return createPortal(
    <div className="apm-overlay" onMouseDown={e => e.target === e.currentTarget && !saving && onClose()}>
      <div className="apm-panel eim-panel lim-panel-split stn-panel resource-form-modal" role="dialog" aria-modal="true" aria-labelledby="asm-title">
        <div className="cfm-head dpm-header">
          <span className="cfm-badge"><Icon d={ICON_PLUS} className="cfm-badge-icon" /></span>
          <div className="cfm-head-text">
            <div className="apm-eyebrow">NEW STATION</div>
            <div id="asm-title" className="cfm-title">{form.station_name.trim() || 'Add a station'}</div>
          </div>
          <button className="eim-close" onClick={onClose} aria-label="Close" disabled={saving}>
            <Icon d={ICON_CLOSE} />
          </button>
        </div>

        <div className="lim-layout">
          <aside className="lim-rail-map" aria-label="Station location">
            <MapPicker
              icon={STATION_ICON}
              lat={form.station_latitude}
              lng={form.station_longitude}
              onChange={(lat, lng) => setForm(prev => ({
                ...prev, station_latitude: lat, station_longitude: lng,
                station_barangay: prev.station_latitude === lat && prev.station_longitude === lng ? prev.station_barangay : '',
              }))}
              onBoundsError={setMapError}
              prompt="Click the map where the station is"
            />
            <PinStatus
              lat={form.station_latitude}
              lng={form.station_longitude}
              error={mapError}
              emptyText="No pin yet. Routes and coverage start from this point."
            />
          </aside>

          <form id="asm-form" className="eim-body lim-rail-form" onSubmit={handleSubmit}>
            <StationDetailsSections
              form={form}
              set={set}
              mainStations={mainStations}
              contactError={contactError}
              detecting={detecting}
              barangayHint={barangayHint}
              autoFocus
            />
            {error && <div className="apm-error">{error}</div>}
          </form>
        </div>

        <div className="eim-footer">
          <FormStatus missing={missing} />
          <div className="eim-footer-actions">
            <button type="button" className="apm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" form="asm-form" className="apm-btn-submit" disabled={saving || blocked}>
              {saving ? <span className="apm-spinner" /> : 'Add station'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
