import AnalysisIcon from './AnalysisIcon'
import AnalysisValue from './AnalysisValue'
import { duration } from '../utils/operationalTimes'

const MEASURES = [
  ['response', 'Dispatch-to-Arrival', 'From team dispatch to arrival at the incident'],
  ['handling', 'Report Processing', 'From receiving the report to dispatching the team'],
  ['acknowledgement', 'Acknowledgment', 'From team dispatch to the team confirming it'],
  ['turnout', 'Preparation', 'From team dispatch to departure'],
  ['travel', 'Travel', 'From departure to arrival at the incident'],
]
const humanize = value => value ? String(value).replaceAll('_', ' ').replace(/^./, first => first.toUpperCase()) : null

export default function DispatchEvidenceContent({ data, unit, children }) {
  const context = data.context || {}
  const snapshot = context.provenance === 'assignment'
  return <div className="rar-evidence-content-layout">
    <div className="rar-evidence-columns">
      <section className="rar-evidence-block rar-measurements" aria-label="Dispatch interval quality">
        <header className="rar-evidence-block-heading"><div><h4>Dispatch Intervals</h4><p>Recorded durations and measurement quality.</p></div></header>
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

      <aside className="rar-evidence-sidebar" aria-label="Assignment resources">
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
      {children}
      {unit.arrival_source === 'legacy_single_truck_dispatch' && <p className="rar-note">Arrival source: existing dispatch arrival record, with exactly one truck assigned.</p>}
    </section>}
  </div>
}
