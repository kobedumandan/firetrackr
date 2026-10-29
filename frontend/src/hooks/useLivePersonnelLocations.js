import { useState, useSyncExternalStore } from 'react'

const EMPTY_LOCATIONS = []
const getEmptySnapshot = () => EMPTY_LOCATIONS
const subscribeToNothing = () => () => {}

// Keep receiving GPS while another page is open, but only render location
// changes on the Command and Personnel pages that display them.
export default function useLivePersonnelLocations(enabled) {
  const [store] = useState(() => {
    let locations = EMPTY_LOCATIONS
    const listeners = new Set()
    return {
      getSnapshot: () => locations,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      update(value) {
        const next = typeof value === 'function' ? value(locations) : value
        if (Object.is(next, locations)) return
        locations = next
        listeners.forEach(listener => listener())
      },
    }
  })
  const locations = useSyncExternalStore(
    enabled ? store.subscribe : subscribeToNothing,
    enabled ? store.getSnapshot : getEmptySnapshot,
  )
  return [locations, store.update]
}
