import { createPortal } from 'react-dom'
import MapControlIcon from './MapControlIcon'
import '../styles/MapCameraControls.css'

export default function MapCameraControls({ host, camera, onAction, disabled = false, maxTilt = 80, title = 'Map view', detail }) {
  if (!host) return null
  const button = (action, label, icon, limit = false) => (
    <button type="button" title={label} aria-label={label} disabled={disabled || limit} onClick={() => onAction(action)}><MapControlIcon name={icon} /></button>
  )
  return createPortal(
    <div className="map-camera" role="group" aria-label="Map camera controls">
      <div className="map-camera-heading"><span><MapControlIcon name="camera" />{title}{detail && <><span className="map-camera-separator" aria-hidden="true">|</span>{detail}</>}</span><span className="map-camera-badge">CAMERA</span></div>
      <div className="map-camera-row"><span>Tilt <output aria-label="Tilt angle">{Math.round(camera.tilt)}°</output></span><div className="map-camera-buttons">{button('tilt-down', 'Decrease tilt', 'down', camera.tilt <= 0)}{button('tilt-up', 'Increase tilt', 'up', camera.tilt >= maxTilt)}</div></div>
      <div className="map-camera-row"><span>Rotation <output aria-label="Heading angle">{Math.round(camera.heading)}°</output></span><div className="map-camera-buttons">{button('rotate-left', 'Rotate left', 'left')}{button('rotate-right', 'Rotate right', 'right')}</div></div>
      <div className="map-camera-row"><span>Zoom</span><div className="map-camera-buttons">{button('zoom-out', 'Zoom out', 'minus')}{button('zoom-in', 'Zoom in', 'plus')}</div></div>
      <button className="map-camera-reset" type="button" onClick={() => onAction('reset')} disabled={disabled}><MapControlIcon name="north" />North / top view</button>
    </div>, host,
  )
}
