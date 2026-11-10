import AnalysisDateTime from './AnalysisDateTime'
import AnalysisIcon from './AnalysisIcon'
import AnalysisValue from './AnalysisValue'
import { duration } from '../utils/operationalTimes'

const MEASURES = [
  ['response', 'Response', 'Dispatch to arrival'],
  ['handling', 'Handling', 'Report received to dispatch'],
  ['acknowledgement', 'Acknowledgement', 'Dispatch to acknowledgement'],
  ['turnout', 'Turnout', 'Dispatch to departure'],
  ['travel', 'Travel', 'Departure to arrival'],
]
const humanize = value => value ? String(value).replaceAll('_', ' ').replace(/^./, first => first.toUpperCase()) : null

function RecordedAction({ label, icon, actor, at }) {
  return <div className="rar-recorded-action">
    <span className="rar-action-icon"><AnalysisIcon name={icon} /></span>
    <div className="rar-action-person"><h5>{label}</h5><strong data-known={Boolean(actor)}>{actor || 'Unknown'}</strong></div>
    <AnalysisDateTime value={at} />
  </div>
}

export default function DispatchEvidenceContent({ data, unit, children }) {
  const context = data.context || {}
  const validCount = MEASURES.filter(([key]) => data.metrics?.[key]?.quality === 'valid').length
  const allValid = validCount === MEASURES.length
  const snapshot = context.provenance === 'assignment'
  return <div className="rar-evidence-content-layout">
    <div className="rar-evidence-columns">
      <section className="rar-evidence-block rar-measurements" aria-label="Dispatch interval quality">
        <header className="rar-evidence-block-heading"><div><h4>Dispatch Intervals</h4><p>Recorded durations and measurement quality.</p></div><span className="rar-quality-summary" data-complete={allValid} aria-label={`${validCount} of ${MEASURES.length} dispatch intervals have valid timing`}><AnalysisIcon name={allValid ? 'acknowledgement' : 'info'} />{validCount}/{MEASURES.length} Valid</span></header>
        <div className="rar-quality-table"><table>
          <caption>Dispatch response intervals</caption>
          <thead><tr><th scope="col">Interval</th><th scope="col" className="rar-duration-column">Duration</th><th scope="col">Quality</th></tr></thead>
          <tbody>{MEASURES.map(([key, label, interval]) => {
            const metric = data.metrics?.[key]
            const quality = metric?.quality || 'unknown'
            return <tr key={key} data-measure={key}>
              <th scope="row"><strong>{label}</strong><span className="rar-interval-description">{interval}</span></th>
              <td className="rar-evidence-duration"><AnalysisValue value={duration(metric?.seconds)} /></td>
              <td><span className="rar-quality" data-quality={quality}><AnalysisIcon name={quality === 'valid' ? 'acknowledgement' : 'info'} />{humanize(quality)}</span>{metric?.reason && <small className="rar-quality-reason">{humanize(metric.reason)}</small>}</td>
            </tr>
          })}</tbody>
        </table></div>
      </section>

      <aside className="rar-evidence-sidebar" aria-label="Dispatch attribution and resources">
        <section className="rar-evidence-block" aria-label="Recorded actors">
          <header className="rar-evidence-block-heading"><div><h4>Recorded Actions</h4><p>Actor attribution stored with the dispatch.</p></div></header>
          <div className="rar-recorded-actions">
            <RecordedAction label="Acknowledgement" icon="acknowledgement" actor={data.acknowledged_by} at={data.acknowledged_at} />
            <RecordedAction label="Departure" icon="turnout" actor={data.departed_by} at={data.departed_at} />
          </div>
        </section>
        <section className="rar-evidence-block" aria-label="Assignment context">
          <header className="rar-evidence-block-heading"><div><h4>Assignment Context</h4></div><span className="rar-context-source">{snapshot ? 'Saved snapshot' : context.provenance === 'legacy_frozen_metadata' ? 'Preserved legacy metadata' : 'Unknown context'}</span></header>
          <dl className="rar-resource-fields">{[
            ['Assigned truck', context.truck], ['Record kind', humanize(data.record_kind)],
            ['Station', context.station_name], ['Shift', context.shift_name],
          ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd><AnalysisValue value={value} /></dd></div>)}</dl>
          <p className="rar-provenance-note"><AnalysisIcon name="info" /><span>{snapshot ? 'Context preserved at assignment.' : context.provenance === 'legacy_frozen_metadata' ? 'Legacy metadata preserved at upgrade; original assignment unknown.' : 'Historical assignment context unknown.'}{snapshot && context.metadata_provenance === 'migration_current_metadata' ? ' Missing display details were preserved at upgrade.' : ''}</span></p>
        </section>
      </aside>
    </div>

    {unit && <section className="rar-unit-evidence" aria-label="Selected truck evidence">
      <header className="rar-evidence-block-heading"><div className="rar-unit-evidence-heading"><span className="rar-action-icon"><AnalysisIcon name="travel" /></span><div><h4>Truck Timing</h4><p>Recorded intervals for the selected vehicle.</p></div></div><span className="rar-truck-reference">{unit.truck || 'Truck unknown'}</span></header>
      <dl className="rar-unit-measures">{[
        ['processing', 'Report Processing'], ['preparation', 'Preparation'], ['cta', 'Report to Arrival'],
      ].map(([key, label]) => <div key={key}><dt>{label}</dt><dd><AnalysisValue value={duration(unit.durations?.[key])} /></dd>{unit.metrics?.[key]?.reason && <small>{humanize(unit.metrics[key].reason)}</small>}</div>)}</dl>
      {unit.arrival_source === 'legacy_single_truck_dispatch' && <p className="rar-note">Arrival source: existing dispatch arrival record, with exactly one truck assigned.</p>}
      {children}
    </section>}
  </div>
}
