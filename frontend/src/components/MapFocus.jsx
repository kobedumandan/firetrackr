import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

export default function MapFocus({ mapFocus }) {
  const map = useMap()
  const { lat, lng, zoom = 17, bounds, nonce } = mapFocus || {}
  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
    // Apply navigation before asynchronous renderer startup can sync its camera.
    if (bounds?.length) {
      map.fitBounds(bounds, { paddingTopLeft: [340, 80], paddingBottomRight: [50, 70], maxZoom: 18, animate: false })
      return
    }
    map.setView([lat, lng], zoom, { animate: false })
    // A new nonce repeats the request even when the destination is unchanged.
  }, [map, lat, lng, zoom, bounds, nonce])
  return null
}
