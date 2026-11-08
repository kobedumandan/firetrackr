import { Popup } from 'react-leaflet'
import AnalysisIcon from './AnalysisIcon'

export default function RoutePopup({ type, name, distanceKm, etaMinutes, segment = false }) {
  return <Popup className="route-popup" minWidth={300} maxWidth={420}>
    <div className="route-popup-header"><AnalysisIcon name="route" /><strong>Generated Route</strong><span className="route-popup-pipe" aria-hidden="true">|</span><span className="route-popup-type">{type}</span></div>
    {name && <div className="route-popup-name">{name}</div>}
    <dl className="route-popup-metrics">
      <div><dt>{segment ? 'Segment distance' : 'Distance'}</dt><dd>{Number.isFinite(distanceKm) ? `${distanceKm.toFixed(2)} km` : 'Unavailable'}</dd></div>
      <div><dt>ETA</dt><dd>{Number.isFinite(etaMinutes) ? `~${etaMinutes} min` : 'Unavailable'}</dd></div>
    </dl>
  </Popup>
}
