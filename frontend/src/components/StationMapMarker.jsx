import { Marker, Popup, Tooltip } from 'react-leaflet'

export default function StationMapMarker({ station, icon, onViewStation }) {
  return <Marker position={[station.station_latitude, station.station_longitude]} icon={icon}
    title={station.station_name} eventHandlers={{ click: event => event.target.closeTooltip() }}>
    <Tooltip direction="top" className="leaflet-dark-tooltip">
      {station.station_name}{station.station_barangay ? ` · ${station.station_barangay}` : ''}
    </Tooltip>
    <Popup className="station-popup" minWidth={230}>
      <div className="station-popup-inner">
        <strong className="station-popup-name">{station.station_name}</strong>
        <div className="station-popup-meta">{station.station_type === 'sub' ? 'Sub-station' : 'Main station'} · {station.station_status || 'Operational'}</div>
        {station.station_barangay && <div>{station.station_barangay}</div>}
        {station.station_address && <div>{station.station_address}</div>}
        {station.station_contact && <div>Contact: {station.station_contact}</div>}
        <button type="button" className="station-popup-view" onClick={() => onViewStation(station.station_id)}>View station</button>
      </div>
    </Popup>
  </Marker>
}
