import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { playChime } from '../utils/chime'

/** Per-browser preference blob, stored under this key. */
export const NOTIF_STORAGE_KEY = 'fireops-notif-prefs'

/* `resolution` starts off because a close is the one event that isn't urgent,
   and it preserves what the Settings row defaulted to before it was wired up.
   `sound` starts off because it is intrusive on a shared console — and it is
   inert anyway until the dispatcher has clicked somewhere on the page. */
export const NOTIF_DEFAULTS = {
  newIncident:        true,
  escalation:         true,
  resolution:         false,
  contained:          true,
  reportFiled:        true,
  onScene:            true,
  deviceOffline:      true,
  autoDispatchFailed: true,
  modelUpdates:       true,
  connectionRecovery: true,
  sound:              false,
}

export function readNotifPrefs() {
  try {
    return { ...NOTIF_DEFAULTS, ...JSON.parse(localStorage.getItem(NOTIF_STORAGE_KEY) || '{}') }
  } catch {
    return NOTIF_DEFAULTS
  }
}

/** History cap. Older entries fall off the end rather than growing unbounded
    across a 12-hour shift. */
const MAX_ITEMS = 50
/** How long a non-critical toast stays up. Critical ones never auto-dismiss. */
export const TOAST_MS = 7_000

/**
 * The notification store behind both surfaces (toasts + the bell panel).
 *
 * Preferences arrive as an argument rather than being read from localStorage
 * here, so flipping a toggle in Settings takes effect on the next event
 * instead of on the next reload. They are mirrored into a ref so `push` keeps
 * a stable identity: the WebSocket effect in App.jsx mounts once per session
 * and closes over it, and a changing `push` would mean tearing the socket down
 * every time a toggle moved.
 */
export function useNotifications(prefs) {
  const prefsRef = useRef(prefs)
  useEffect(() => { prefsRef.current = prefs }, [prefs])

  const [items, setItems]       = useState([])
  const [toastIds, setToastIds] = useState([])
  const seqRef    = useRef(0)
  const timersRef = useRef(new Map())

  // Any toast still counting down when the dashboard unmounts (logout) would
  // otherwise fire setState on a dead component.
  useEffect(() => {
    const timers = timersRef.current
    return () => { timers.forEach(clearTimeout); timers.clear() }
  }, [])

  const hideToast = useCallback((id) => {
    const t = timersRef.current.get(id)
    if (t) { clearTimeout(t); timersRef.current.delete(id) }
    setToastIds(prev => prev.filter(x => x !== id))
  }, [])

  /**
   * push('newIncident', { title, body, fireId, severity })
   *
   * Returns early when the matching toggle is off, so every call site can stay
   * dumb: the gating lives here and nowhere else.
   */
  const push = useCallback((kind, { title, body = '', fireId = null, severity = 'info' } = {}) => {
    if (!prefsRef.current?.[kind]) return
    const id = `n${++seqRef.current}-${Date.now()}`
    const item = { id, kind, title, body, at: new Date().toISOString(), fireId, severity, read: false }

    setItems(prev => [item, ...prev].slice(0, MAX_ITEMS))
    setToastIds(prev => [id, ...prev])

    if (severity !== 'critical') {
      timersRef.current.set(id, setTimeout(() => {
        timersRef.current.delete(id)
        setToastIds(prev => prev.filter(x => x !== id))
      }, TOAST_MS))
    }

    if (prefsRef.current.sound && severity === 'critical') playChime()
  }, [])

  /** Drop an entry from the history (and its toast, if still up). */
  const dismiss = useCallback((id) => {
    hideToast(id)
    setItems(prev => prev.filter(i => i.id !== id))
  }, [hideToast])

  const markAllRead = useCallback(() => {
    setItems(prev => prev.some(i => !i.read) ? prev.map(i => ({ ...i, read: true })) : prev)
  }, [])

  const clear = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current.clear()
    setToastIds([])
    setItems([])
  }, [])

  const toasts = useMemo(
    () => toastIds.map(id => items.find(i => i.id === id)).filter(Boolean),
    [toastIds, items],
  )
  const unreadCount = useMemo(() => items.filter(i => !i.read).length, [items])

  return { items, toasts, unreadCount, push, dismiss, hideToast, markAllRead, clear }
}
