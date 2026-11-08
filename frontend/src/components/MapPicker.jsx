// Click-to-pin map used by the split-layout modals (Log Incident, Add/Edit
// Station). Styles: lim-map* and asm-tile-* in AppModal.css.
import { useState, useMemo, useEffect } from 'react'
import { MapContainer, TileLayer, Marker, GeoJSON, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { MAP_CENTER, MAP_ZOOM, TILE_OPTIONS, withinRegion, maskStyle, REGION_BOUNDARY, REGION_LABEL } from '../data/mapConfig'
import { useTheme } from '../hooks/useTheme'
import { Icon } from './incidentForm'
import { ICON_PIN } from './incidentFormOptions'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Leaflet measures its container once at mount; the split layout settles its
// size afterwards, which leaves grey/misplaced tiles. Re-measure on any resize.
function SizeWatcher() {
  const map = useMap()
  useEffect(() => {
    const el = map.getContainer()
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
    return () => ro.disconnect()
  }, [map])
  return null
}

function ClickHandler({ onChange, onBoundsError }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng
      if (!withinRegion(lat, lng)) {
        onBoundsError(`That point is outside ${REGION_LABEL}. Pick a spot inside the boundary.`)
        return
      }
      onBoundsError(null)
      onChange(lat, lng)
    },
  })
  return null
}

const hasValue = v => v !== '' && v != null

/**
 * lat/lng     – current pin ('' or null when none)
 * onChange    – (lat, lng) when a valid point is clicked
 * prompt      – overlay text shown until a pin exists
 * ghost       – optional [lat, lng] of the previous position, shown faded when
 *               the pin has been moved (edit forms)
 * icon        – optional Leaflet icon for the current and previous pins
 */
export function MapPicker({ lat, lng, onChange, onBoundsError, prompt = 'Click the map to drop a pin', ghost, icon }) {
  const [tileId, setTileId] = useState('satellite')
  const theme = useTheme()
  const tile = TILE_OPTIONS.find(t => t.id === tileId)
  const pinned = hasValue(lat) && hasValue(lng)

  const maskFeature = useMemo(() => ({
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [[-180, -90], [-180, 90], [180, 90], [180, -90], [-180, -90]],
        REGION_BOUNDARY,
      ],
    },
  }), [])

  const boundaryFeature = useMemo(() => ({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [REGION_BOUNDARY] },
  }), [])

  return (
    <div className="lim-map">
      <MapContainer
        center={pinned ? [lat, lng] : MAP_CENTER}
        zoom={pinned ? MAP_ZOOM + 3 : MAP_ZOOM + 1}
        className="lim-map-canvas"
        scrollWheelZoom
        zoomControl
        attributionControl={false}
      >
        <SizeWatcher />
        {tile.layers.map((l, i) => <TileLayer key={`${tileId}-${i}`} {...l} />)}
        <GeoJSON key={`mask-${theme}`} data={maskFeature} style={() => maskStyle(theme)} />
        <GeoJSON key="boundary" data={boundaryFeature} style={() => ({ fill: false, stroke: true, color: '#1e90ff', weight: 2, opacity: 0.85 })} />
        <ClickHandler onChange={onChange} onBoundsError={onBoundsError} />
        {ghost && <Marker position={ghost} {...(icon ? { icon } : {})} opacity={0.4} interactive={false} />}
        {pinned && <Marker position={[lat, lng]} {...(icon ? { icon } : {})} />}
      </MapContainer>
      {!pinned && <div className="lim-map-prompt">{prompt}</div>}
      <div className="asm-tile-switcher lim-tile-switcher">
        {TILE_OPTIONS.map(opt => (
          <button key={opt.id} type="button" className={`asm-tile-btn${tileId === opt.id ? ' active' : ''}`} onClick={() => setTileId(opt.id)}>
            <img src={opt.thumb} alt={opt.label} draggable={false} />
          </button>
        ))}
      </div>
    </div>
  )
}

/* Pin readout (or bounds error) under the map. */
export function PinStatus({ lat, lng, error, emptyText, children }) {
  if (error) return <div className="apm-error lim-map-status">{error}</div>
  const pinned = hasValue(lat) && hasValue(lng)
  return (
    <div className={`eim-coords lim-map-status ${pinned ? 'pinned' : ''}`}>
      <Icon d={ICON_PIN} />
      {pinned ? (
        <span className="eim-coords-val">{Number(lat).toFixed(6)}, {Number(lng).toFixed(6)}</span>
      ) : (
        <span>{emptyText}</span>
      )}
      {children}
    </div>
  )
}
