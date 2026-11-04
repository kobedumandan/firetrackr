import { useEffect, useRef, useState } from 'react'
import { fetchBarangays } from '../api'
import { barangayNameForPoint } from '../utils/barangayLocation'

export function useIncidentBarangay(lat, lng, setForm, nameField) {
  const [lookup, setLookup] = useState(null)
  const edits = useRef(0)
  const hasPin = lat !== '' && lat != null && lng !== '' && lng != null
  const pinKey = hasPin ? `${lat},${lng}` : null

  useEffect(() => {
    if (!hasPin) return
    let active = true
    const revision = edits.current
    async function detect() {
      try {
        const boundaries = await fetchBarangays()
        if (!active) return
        const name = barangayNameForPoint(boundaries, lat, lng)
        // Keep a name typed while the boundary request was in flight.
        if (edits.current === revision) {
          setForm(previous => ({ ...previous, [nameField]: name }))
        }
        setLookup({ pinKey, status: name ? 'found' : 'missing', name })
      } catch {
        if (active) setLookup({ pinKey, status: 'error' })
      }
    }
    detect()
    return () => { active = false }
  }, [hasPin, lat, lng, pinKey, setForm, nameField])

  const detecting = hasPin && lookup?.pinKey !== pinKey
  const hint = !hasPin ? 'Pick a location to fill in the barangay automatically.'
    : detecting ? 'Detecting barangay…'
      : lookup.status === 'found' ? 'Barangay detected from the pin. You can edit the name.'
        : lookup.status === 'missing' ? 'No barangay boundary matches this pin. Enter the area name.'
          : 'Barangay data is unavailable. Enter the area name manually.'

  return {
    detecting, hint,
    detectedName: lookup?.pinKey === pinKey ? lookup?.name : '',
    markEdited: () => { edits.current += 1 },
  }
}
