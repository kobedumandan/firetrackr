import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { hasTrackerLocation } from '../utils/trackerStatus'

export default function PersonnelMapFocus({ focusedPersonnel, livePersonnelLocations }) {
  const map = useMap()
  useEffect(() => {
    if (focusedPersonnel?.per_id == null) return
    const current = livePersonnelLocations.find(row => row.per_id === focusedPersonnel.per_id && hasTrackerLocation(row))
    const location = current || focusedPersonnel.lastLocation
    if (!hasTrackerLocation(location)) return
    const animate = document.documentElement.dataset.motion !== 'off'
    const zoom = focusedPersonnel.lastLocation ? 18 : 16
    map.flyTo([location.latitude, location.longitude], Math.max(map.getZoom(), zoom), {
      animate, duration: animate ? 0.9 : 0,
    })
    // A request moves the camera once; later polls can move the pin independently.
  }, [map, focusedPersonnel?.nonce]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}
