import { createPortal } from 'react-dom'

export default function MapCameraControls({ host, camera, onAction, disabled = false, maxTilt = 80, title = 'Map view' }) {
  if (!host) return null
  const button = (action, label, symbol, limit = false) => (
    <button type="button" title={label} aria-label={label} disabled={disabled || limit} onClick={() => onAction(action)}>{symbol}</button>
  )
  return createPortal(
    <div className="map-camera" role="group" aria-label="Map camera controls">
      <div className="map-camera-heading"><span>{title}</span><output aria-label="Camera angle">{Math.round(camera.tilt)}° tilt · {Math.round(camera.heading)}° heading</output></div>
      <div className="map-camera-row">{button('tilt-down', 'Decrease tilt', '↥', camera.tilt <= 0)}<span>Tilt</span>{button('tilt-up', 'Increase tilt', '↧', camera.tilt >= maxTilt)}</div>
      <div className="map-camera-row">{button('rotate-left', 'Rotate left', '↶')}<span>Rotate</span>{button('rotate-right', 'Rotate right', '↷')}</div>
      <div className="map-camera-row">{button('zoom-out', 'Zoom out', '−')}<span>Zoom</span>{button('zoom-in', 'Zoom in', '+')}</div>
      <button className="map-camera-reset" type="button" onClick={() => onAction('reset')} disabled={disabled}>↑ North / top view</button>
    </div>, host,
  )
}
