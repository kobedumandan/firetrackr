import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import { hasTrackerLocation } from '../utils/trackerStatus'

export default function PersonnelMapFocus({ focusedPersonnel, livePersonnelLocations }) {
  const map = useMap()
  const applied = useRef(null)
  useEffect(() => {
    if (focusedPersonnel?.per_id == null) {
      applied.current = null
      return
    }
    const { per_id, nonce } = focusedPersonnel
    if (applied.current?.map === map && applied.current.per_id === per_id && applied.current.nonce === nonce) return
    const current = livePersonnelLocations.find(row => row.per_id === focusedPersonnel.per_id && hasTrackerLocation(row))
    const location = current || focusedPersonnel.lastLocation
    if (!hasTrackerLocation(location)) return
    const zoom = focusedPersonnel.lastLocation ? 18 : 16
    // Commit the destination before the asynchronous raster/3D renderer starts.
    // Its initial camera synchronization can interrupt an in-flight Leaflet flyTo.
    map.setView([location.latitude, location.longitude], Math.max(map.getZoom(), zoom), { animate: false })
    applied.current = { map, per_id, nonce }
    // Wait for valid GPS, then move once; later polls move the pin independently.
  }, [map, focusedPersonnel, livePersonnelLocations])
  return null
}
