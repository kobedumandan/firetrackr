// Right-rail sections shared by Add Station and Edit Station.
import { STATION_TYPES, STATION_STATUSES, statusMeta } from './resourceFormOptions'
import { Field, SectionHead, Segmented, FieldError } from './incidentForm'

/**
 * form        – station_* fields (strings)
 * set         – (field, value) setter
 * isChanged   – optional (field) => bool for the edited-field dots
 * mainStations – [{ id: 'STA-001', name }] candidates for the parent station
 * contactError – validation message for the contact number
 * editing     – omit ending periods from help text in the edit modal
 */
export function StationDetailsSections({ form, set, isChanged = () => false, mainStations, contactError, autoFocus, editing = false, detecting = false, barangayHint }) {
  const isSub = form.station_type === 'sub'
  const helpText = text => editing ? text.replace(/\.$/, '') : text

  function setType(value) {
    set('station_type', value)
    if (value === 'main') set('parent_station_id', '')
  }

  return (
    <>
      <section className="eim-section">
        <SectionHead title="Station" desc={helpText('Its name and where it sits in the command chain.')} />
        <Field label="Station name" required changed={isChanged('station_name')}>
          <input
            placeholder="e.g. Station 4 · Gredu"
            value={form.station_name}
            onChange={e => set('station_name', e.target.value)}
            autoFocus={autoFocus}
          />
        </Field>
        <div className="eim-row">
          <Field label="Type" required changed={isChanged('station_type')}>
            <Segmented label="Station type" options={STATION_TYPES} value={form.station_type} onChange={setType} />
          </Field>
          {isSub && (
            <Field label="Reports to" required changed={isChanged('parent_station_id')}>
              <select
                value={form.parent_station_id}
                onChange={e => set('parent_station_id', e.target.value)}
                aria-invalid={!form.parent_station_id || undefined}
              >
                <option value="">Choose a main station</option>
                {mainStations.map(s => (
                  <option key={s.id} value={s.id.replace('STA-', '').replace(/^0+/, '')}>{s.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </section>

      <section className="eim-section">
        <SectionHead title="Address" desc={helpText('Shown to dispatchers and on reports.')} />
        <div className="eim-row">
          <Field label="Street address" required changed={isChanged('station_address')}>
            <input
              placeholder="e.g. Quezon St., Panabo City"
              value={form.station_address}
              onChange={e => set('station_address', e.target.value)}
            />
          </Field>
          <Field label="Barangay" required changed={isChanged('station_barangay')}>
            <div className="barangay-input-wrap">
            <input
              placeholder="Filled automatically from the map pin"
              aria-label="Barangay"
              aria-describedby="station-barangay-hint"
              aria-busy={detecting}
              value={form.station_barangay}
              onChange={e => set('station_barangay', e.target.value)}
            />
            {detecting && <span className="apm-spinner barangay-input-spinner" aria-hidden="true" />}
            </div>
            <span id="station-barangay-hint" className="frm-hint" aria-live="polite">{barangayHint}</span>
          </Field>
        </div>
      </section>

      <section className="eim-section">
        <SectionHead title="Contact & status" desc={helpText("How to reach it, and whether it's in service.")} />
        <Field label="Contact number" required className="frm-half" changed={isChanged('station_contact')}>
          <input
            type="tel"
            inputMode="tel"
            placeholder="e.g. (084) 628 1234"
            value={form.station_contact}
            onChange={e => set('station_contact', e.target.value)}
            aria-invalid={!!contactError || undefined}
          />
          <FieldError>{contactError}</FieldError>
        </Field>
        <Field label="Status" changed={isChanged('station_status')}>
          <Segmented label="Status" options={STATION_STATUSES} value={form.station_status} onChange={v => set('station_status', v)} />
        </Field>
        <div className="frm-hint">{helpText(statusMeta(STATION_STATUSES, form.station_status).hint)}</div>
      </section>
    </>
  )
}
