import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { playChime } from '../utils/chime'

/** Per-browser preference blob, stored under this key. */
export const NOTIF_STORAGE_KEY = 'fireops-notif-prefs'
export const NOTIF_HISTORY_STORAGE_KEY = 'fireops-notif-history-v1'

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
  workflow:           true,
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
export const TOAST_MS = 20_000

function readHistory(storageKey) {
  if (!storageKey) return []
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]')
    if (!Array.isArray(saved)) return []
    return saved.filter(item => item && typeof item.id === 'string'
      && typeof item.kind === 'string' && typeof item.title === 'string'
      && typeof item.body === 'string' && typeof item.read === 'boolean'
      && typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)))
      .slice(0, MAX_ITEMS)
  } catch {
    return []
  }
}

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
export function useNotifications(prefs, userId = null) {
  const prefsRef = useRef(prefs)
  useEffect(() => { prefsRef.current = prefs }, [prefs])

  const storageKey = userId == null ? null : `${NOTIF_HISTORY_STORAGE_KEY}:${userId}`
  const [historyKey, setHistoryKey] = useState(storageKey)
  const [items, setItems]       = useState(() => readHistory(storageKey))
  const [toastIds, setToastIds] = useState([])
  const seqRef    = useRef(0)
  const timersRef = useRef(new Map())

  // App stays mounted through login/logout. Switch history before rendering
  // another account, and restore only the list, never old toast popups.
  if (historyKey !== storageKey) {
    setHistoryKey(storageKey)
    setItems(readHistory(storageKey))
    setToastIds([])
  }

  useEffect(() => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify(items))
    } catch { /* Alerts still work in memory if browser storage is unavailable. */ }
  }, [items, storageKey])

  // Cancel outstanding toast timers when the account changes or App unmounts.
  useEffect(() => {
    const timers = timersRef.current
    return () => { timers.forEach(clearTimeout); timers.clear() }
  }, [storageKey])

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
  const push = useCallback((kind, { title, body = '', fireId = null, severity = 'info', incident = null, tracker = null } = {}) => {
    if (!prefsRef.current?.[kind]) return
    const id = `n${++seqRef.current}-${Date.now()}`
    const item = { id, kind, title, body, at: new Date().toISOString(), fireId, severity, incident, tracker, read: false }

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
    // Logout also changes the account in this render, so remove its saved
    // history here rather than relying on the persistence effect to run.
    if (storageKey) {
      try { localStorage.removeItem(storageKey) } catch { /* Storage may be blocked. */ }
    }
    timersRef.current.forEach(clearTimeout)
    timersRef.current.clear()
    setToastIds([])
    setItems([])
  }, [storageKey])

  const toasts = useMemo(
    () => toastIds.map(id => items.find(i => i.id === id)).filter(Boolean),
    [toastIds, items],
  )
  const unreadCount = useMemo(() => items.filter(i => !i.read).length, [items])

  return { items, toasts, unreadCount, push, dismiss, hideToast, markAllRead, clear }
}
