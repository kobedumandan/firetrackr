import { useState, useEffect, useRef, useCallback } from 'react'
import TopBar from './components/TopBar'
import LeftSidebar from './components/LeftSidebar'
import MapArea from './components/MapArea'
import MapActions from './components/MapActions'
import RightSidebar from './components/RightSidebar'
import StatusBar from './components/StatusBar'
import IncidentsPage from './pages/IncidentsPage'
import PersonnelPage from './pages/PersonnelPage'
import NewIncidentModal from './components/NewIncidentModal'
import AutoDispatchModal from './components/AutoDispatchModal'
import LocationRequestModal from './components/LocationRequestModal'
import StationsPage from './pages/StationsPage'
import TeamsPage from './pages/TeamsPage'
import TrucksPage from './pages/TrucksPage'
import MetricsPage from './pages/MetricsPage'
import PlanningPage from './pages/PlanningPage'
import SettingsPage from './pages/SettingsPage'
import LoginPage from './pages/LoginPage'
import ToastStack from './components/ToastStack'
import NotificationPanel from './components/NotificationPanel'
import { useNotifications, readNotifPrefs, NOTIF_STORAGE_KEY } from './hooks/useNotifications'
import { fetchActiveIncidents, fetchPersonnel, fetchStations, fetchDispatches, selectRoute, fetchPersonnelLocations, fullReroute, createIncident, fetchReporterSessions, invalidateModelRouting, notifyModelUpdate, WS_URL } from './api'
import { readMapLayerPrefs, MAP_LAYER_STORAGE_KEY } from './utils/mapLayers'
import useCommandShortcut from './hooks/useCommandShortcut'
import './App.css'

const ACTIVE_STATUSES = new Set(['pending', 'active', 'dispatched', 'contained'])
// Dispatch statuses whose routes are still relevant on the map. A closed
// incident's dispatch is "completed", so its routes are excluded on (re)load.
const ACTIVE_DISPATCH_STATUSES = new Set(['dispatched', 'en_route', 'on_scene'])

// Alarm levels are stored as free text, so "did this escalate?" is an ordering
// question, not a string comparison. Mirrors ALARM_UNIT_TARGETS in
// backend/auto_dispatch.py; an unrecognised level ranks 0 and never trips an
// escalation alert on its own.
const ALARM_ORDER = { '1st Alarm': 1, '2nd Alarm': 2, '3rd Alarm': 3, 'General Alarm': 4 }
function _alarmRank(level) { return ALARM_ORDER[level] ?? 0 }

function _parseWkt(wkt) {
  if (!wkt) return null
  const match = wkt.match(/LINESTRING\s*\(([^)]+)\)/)
  if (!match) return null
  // Split on any run of whitespace: some rows come back "lon lat", others with
  // padding, and a single-space split silently yields NaN on the padded ones.
  return match[1].split(',').map(pair => {
    const [lon, lat] = pair.trim().split(/\s+/).map(Number)
    return [lat, lon]
  })
}

/**
 * Map /api/dispatch rows onto the flat route shape the map renders.
 *
 * This existed twice — once for the initial load and once for the refetch after
 * a successful auto-dispatch — and the copies drifted: the auto-dispatch one
 * never set `isGnn`, so MapArea read it as falsy and drew a real GNN route with
 * the dashed "straight-line fallback" style. One builder, one shape.
 */
function _routesFromDispatchRows(rows) {
  return rows.flatMap(r => {
    // Skip completed/cancelled dispatches (e.g. closed incidents) so their
    // routes don't reappear on the map after a page reload.
    if (!ACTIVE_DISPATCH_STATUSES.has(r.dispatch_status)) return []

    if (r.routes && r.routes.length > 0) {
      return r.routes.flatMap(rt => {
        const positions = _parseWkt(rt.route_wkt)
        if (!positions) return []
        return [{
          id: `${r.dispatch_id}_${rt.route_id}`,
          route_id: rt.route_id,
          dispatch_id: r.dispatch_id,
          fire_id: r.fire_id,
          positions,
          teamName: r.team_name ?? '',
          isGnn: true,
          isSelected: rt.is_selected,
          rank: rt.rank,
          routeType: rt.route_type,
          etaMinutes: rt.eta_minutes,
          distanceKm: rt.distance_meters != null ? rt.distance_meters / 1000 : null,
        }]
      })
    }

    // No routed path came back — fall back to a station→incident straight line,
    // which is what the dashed style actually means.
    if (r.station_latitude && r.station_longitude && r.incident_latitude && r.incident_longitude) {
      return [{
        id: `${r.dispatch_id}_fallback`,
        route_id: null,
        dispatch_id: r.dispatch_id,
        fire_id: r.fire_id,
        positions: [
          [r.station_latitude, r.station_longitude],
          [r.incident_latitude, r.incident_longitude],
        ],
        teamName: r.team_name ?? '',
        isGnn: false,
        isSelected: true,
        rank: 1,
        routeType: 'fallback',
        etaMinutes: null,
      }]
    }
    return []
  })
}

function getInitialRoute() {
  const token = localStorage.getItem('bfp_token')
  const user  = localStorage.getItem('bfp_user')
  if (token && user) {
    return { view: 'dashboard', user: JSON.parse(user) }
  }
  return { view: 'login' }
}

export default function App() {
  const [route, setRoute] = useState(getInitialRoute)

  // ── Dashboard-only state ───────────────────────────────────────────────────
  const [activeNav, setActiveNav]                 = useState('Command')
  const [reviewStationId, setReviewStationId] = useState(null)
  const [showSettings, setShowSettings]           = useState(false)
  const [selectedIncident, setSelectedIncident]   = useState(null)
  // Persisted: without this the dashboard snapped back to dark on every
  // reload, so picking Light in Settings never survived a refresh.
  const [theme, setTheme]                         = useState(
    () => localStorage.getItem('fireops-theme') || 'dark'
  )
  // Appearance preferences, persisted the same way as theme. Both are applied
  // purely through an attribute on <html> that CSS keys off, so no component
  // needs the value threaded down to it.
  const [compactNav, setCompactNav]               = useState(
    () => localStorage.getItem('fireops-compact-nav') === '1'
  )
  const [animations, setAnimations]               = useState(
    () => localStorage.getItem('fireops-animations') !== '0'   // default on
  )
  // Alert preferences. One blob rather than seven useStates — they are always
  // read together, and they persist per-browser exactly like compact-nav and
  // animations do, so there is no account-level store to migrate.
  const [notifPrefs, setNotifPrefs]               = useState(readNotifPrefs)
  const [showAlerts, setShowAlerts]               = useState(false)
  const [mapLayerPrefs, setMapLayerPrefs]         = useState(() => readMapLayerPrefs())
  // Bumped when a dispatch completes, so the Teams and Trucks pages refetch
  // their rosters. App owns the only WebSocket in the app, so a counter passed
  // down as a prop is how a page hears about a server event without opening a
  // second socket of its own.
  const [rosterNonce, setRosterNonce]             = useState(0)
  const [leftCollapsed, setLeftCollapsed]         = useState(false)
  // Start collapsed; the Incident View only auto-opens once there's an active
  // incident to show (see the effect below).
  const [rightCollapsed, setRightCollapsed]       = useState(true)
  const [mapControlsHost, setMapControlsHost]     = useState(null)
  const [mapLayerToolsHost, setMapLayerToolsHost] = useState(null)
  const [viewMode, setViewMode]                   = useState("normal")
  const [constraintEditing, setConstraintEditing] = useState(false)
  const [heatmapRevision, setHeatmapRevision] = useState(0)
  const [pickingMode, setPickingMode]             = useState(false)
  const [pickedLocation, setPickedLocation]       = useState(null)
  const [incidentDefaults, setIncidentDefaults]   = useState(null) // prefill for NewIncidentModal
  const [autoDispatchResult, setAutoDispatchResult] = useState(null) // incident dict for AutoDispatchModal
  const [loggedIncidents, setLoggedIncidents]     = useState([])
  const [ripplingId, setRipplingId]               = useState(null)
  const [incidentFocusNonce, setIncidentFocusNonce] = useState(0)
  const [focusedPersonnel, setFocusedPersonnel]   = useState(null) // { per_id, nonce }
  const [mapFocus, setMapFocus]                   = useState(null) // { lat, lng, nonce }
  const [showLocationRequest, setShowLocationRequest] = useState(false)
  const [reporterLocations, setReporterLocations] = useState([])
  const [activeIncidents, setActiveIncidents]     = useState([])
  const [loadingIncidents, setLoadingIncidents]   = useState(true)
  const [loadingPersonnel, setLoadingPersonnel]   = useState(true)
  const [personnel, setPersonnel]               = useState([])
  const [stations, setStations]                 = useState([])
  const [dispatchRoutes, setDispatchRoutes]           = useState([])
  const [dispatches, setDispatches]                   = useState([])
  const [livePersonnelLocations, setLivePersonnelLocations] = useState([])
  const [pendingReporterToken, setPendingReporterToken] = useState(null)
  const [reporterReceivedData, setReporterReceivedData] = useState(null)
  const pendingReporterTokenRef = useRef(null)

  // ── Alert plumbing ───────────────────────────────────────────────────────
  // `push` gates itself on notifPrefs, so every call site below can stay dumb.
  const { items: notifItems, toasts, unreadCount, push: pushNotif,
          dismiss: dismissNotif, hideToast, markAllRead, clear: clearNotifs }
    = useNotifications(notifPrefs)

  // Last-seen { alarm, status, loc } per fire_id.
  //
  // The diffing has to happen in the message handler BEFORE setState, not
  // inside a setActiveIncidents(prev => …) updater: an updater that pushes a
  // notification is a side effect in a reducer, and StrictMode double-invokes
  // those — which would double every escalation alert in development.
  const incidentSnapRef = useRef(new Map())
  // per_ids already known to be offline, so a tracker that has been stale for
  // hours doesn't re-alert on every 10s poll.
  const staleSeenRef    = useRef(null)

  function setNotifPref(key, value) {
    setNotifPrefs(prev => ({ ...prev, [key]: value }))
  }

  function setMapLayerPref(key, value) {
    setMapLayerPrefs(prev => ({ ...prev, [key]: value }))
  }

  // Read is marked on CLOSE, not on open: marking on open would wipe the unread
  // strips in the same frame the dispatcher started reading them. Doing it here
  // rather than inside a setShowAlerts updater keeps the side effect out of a
  // reducer, which StrictMode double-invokes.
  function closeAlerts() {
    markAllRead()
    setShowAlerts(false)
  }

  function toggleAlerts() {
    if (showAlerts) closeAlerts()
    else setShowAlerts(true)
  }

  // An alert row for an incident still on the board jumps to it: back to the
  // map, incident selected and centred — the same path Incidents' "show on
  // map" takes.
  // Which alerts can still be jumped to — shared by the panel and the toasts.
  const activeFireIds = new Set(activeIncidents.map(i => i.fire_id))

  function openAlertIncident(fireId) {
    const inc = activeIncidents.find(i => i.fire_id === fireId)
    if (!inc) return
    closeAlerts()
    setConstraintEditing(false)
    setShowSettings(false)
    setActiveNav('Command')
    handleSelectIncident(inc.id)
    if (inc.latitude != null && inc.longitude != null) {
      setMapFocus({ lat: inc.latitude, lng: inc.longitude, nonce: Date.now() })
    }
  }

  // Keep ref in sync so the WS onmessage handler never reads a stale value
  useEffect(() => { pendingReporterTokenRef.current = pendingReporterToken }, [pendingReporterToken])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('fireops-theme', theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.nav = compactNav ? 'compact' : 'full'
    localStorage.setItem('fireops-compact-nav', compactNav ? '1' : '0')
  }, [compactNav])

  useEffect(() => {
    // "off" is what index.css and MapArea look for; the OS reduced-motion
    // setting suppresses motion independently, so this can only ever turn
    // animation off, never force it back on against an accessibility choice.
    document.documentElement.dataset.motion = animations ? 'on' : 'off'
    localStorage.setItem('fireops-animations', animations ? '1' : '0')
  }, [animations])

  useEffect(() => {
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifPrefs))
  }, [notifPrefs])

  useEffect(() => {
    localStorage.setItem(MAP_LAYER_STORAGE_KEY, JSON.stringify(mapLayerPrefs))
  }, [mapLayerPrefs])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') cancelPicking() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigateToPage = useCallback(nav => {
    if (constraintEditing && nav === 'Incidents') return
    setConstraintEditing(false)
    setActiveNav(nav)
    setShowSettings(false)
    setFocusedPersonnel(null)
    setMapFocus(null)
  }, [constraintEditing])
  useCommandShortcut(navigateToPage, route.view === 'dashboard')

  // Auto-select the first incident when the list loads or changes
  useEffect(() => {
    const all = [...activeIncidents, ...loggedIncidents]
    if (all.length === 0) return
    setSelectedIncident(prev => {
      const stillExists = all.some(i => i.id === prev || i.fire_id === prev)
      return stillExists ? prev : (all[0].id || all[0].fire_id)
    })
  }, [activeIncidents, loggedIncidents])

  // Auto-open the Incident View when active incidents exist, and auto-collapse
  // it when there are none — but only on that transition, so a manual collapse/
  // expand during the same has/has-not state is preserved.
  const hadActiveIncidentsRef = useRef(null)
  useEffect(() => {
    const hasActive = activeIncidents.length > 0
    if (hadActiveIncidentsRef.current === hasActive) return
    hadActiveIncidentsRef.current = hasActive
    setRightCollapsed(!hasActive)
  }, [activeIncidents])

  // ── Initial dashboard data load (runs once on login) ─────────────────────
  useEffect(() => {
    if (route.view !== 'dashboard') return

    setLoadingIncidents(true)
    setLoadingPersonnel(true)

    fetchActiveIncidents()
      .then(data => {
        const active = data.filter(i => ACTIVE_STATUSES.has(i.status))
        // Seed the diff baseline, silently — everything already open at login
        // is history, not news.
        const snap = new Map()
        data.forEach(i => snap.set(i.fire_id, { alarm: i.alarm, status: i.status, loc: i.loc }))
        incidentSnapRef.current = snap
        setActiveIncidents(active)
        setLoadingIncidents(false)
      })
      .catch(() => { setLoadingIncidents(false) })

    fetchPersonnel()
      .then(data => { setPersonnel(data); setLoadingPersonnel(false) })
      .catch(() => { setLoadingPersonnel(false) })
    fetchStations().then(setStations).catch(() => {})

    // Rehydrate reporter pins (WS only pushes new events, so a reload would
    // otherwise lose already-received locations).
    fetchReporterSessions()
      .then(sessions => setReporterLocations(
        sessions.map(s => ({ token: s.token, coords: s.coords, mobile: s.phone || '' }))
      ))
      .catch(() => {})

    fetchDispatches().then(rows => {
      setDispatches(rows)
      setDispatchRoutes(_routesFromDispatchRows(rows))
    }).catch(() => {})
  }, [route.view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persistent WebSocket — connects on login, closes only on logout ───────
  useEffect(() => {
    if (route.view !== 'dashboard') return

    const token = localStorage.getItem('bfp_token')

    // These are per-run locals, NOT refs, and that distinction is the whole
    // point. StrictMode mounts this effect twice in dev: run 1 connects, its
    // cleanup sets the destroy flag and closes the socket, then run 2 connects
    // again — and, with a shared ref, run 2 reset the flag that run 1's cleanup
    // had just set. Socket 1's close event then arrived to find the flag false
    // and scheduled a reconnect nobody owned, leaving two live sockets and
    // every broadcast delivered twice. Harmless while every handler was an
    // idempotent merge; not harmless once a handler fires a notification.
    let destroyed = false
    let socket    = null
    let pingId    = null
    let retryId   = null

    function connect() {
      if (destroyed) return
      const ws = new WebSocket(`${WS_URL}?token=${token}`)
      socket = ws

      ws.onopen = () => {
        setHeatmapRevision(value => value + 1)
        pingId = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, 30_000)
      }

      ws.onmessage = e => {
        if (e.data === 'pong') return
        try {
          const msg = JSON.parse(e.data)
          if (['model_candidate_ready', 'model_training_failed', 'model_promoted'].includes(msg.type)) {
            if (msg.type === 'model_promoted') invalidateModelRouting()
            notifyModelUpdate()
            if (route.user?.role === 'admin') {
              pushNotif('modelUpdates', {
                title: msg.type === 'model_candidate_ready' ? `${msg.data.version} is ready for review`
                  : msg.type === 'model_promoted' ? `${msg.data.version} is now active` : `${msg.data.version} training failed`,
                body: 'Open Settings → Model to review the current status.',
              })
            }
          }
          if (['incident_created', 'incident_updated', 'incident_deleted'].includes(msg.type)) {
            setHeatmapRevision(value => value + 1)
          }
          if (msg.type === 'incident_created') {
            const inc = msg.data
            incidentSnapRef.current.set(inc.fire_id, {
              alarm: inc.alarm, status: inc.status, loc: inc.loc,
            })
            pushNotif('newIncident', {
              title: inc.loc,
              body: `${inc.sev} · ${inc.alarm}`,
              fireId: inc.fire_id,
              severity: 'critical',
            })
            if (ACTIVE_STATUSES.has(inc.status)) {
              setActiveIncidents(prev => [inc, ...prev])
            }
          } else if (msg.type === 'incident_updated') {
            const inc = msg.data
            const prevSnap = incidentSnapRef.current.get(inc.fire_id)
            incidentSnapRef.current.set(inc.fire_id, {
              alarm: inc.alarm, status: inc.status, loc: inc.loc,
            })
            if (prevSnap) {
              if (_alarmRank(inc.alarm) > _alarmRank(prevSnap.alarm)) {
                pushNotif('escalation', {
                  title: inc.loc,
                  body: `Escalated ${prevSnap.alarm} → ${inc.alarm}`,
                  fireId: inc.fire_id,
                  severity: 'critical',
                })
              }
              // 'contained' is still an active status, so it needs its own edge
              // check — the resolution one below only sees the later close.
              if (inc.status === 'contained' && prevSnap.status !== 'contained') {
                pushNotif('contained', {
                  title: inc.loc,
                  body: 'Fire marked contained. Crew remains on scene for overhaul.',
                  fireId: inc.fire_id,
                })
              }
              if (ACTIVE_STATUSES.has(prevSnap.status) && !ACTIVE_STATUSES.has(inc.status)) {
                pushNotif('resolution', {
                  title: inc.loc,
                  body: `Incident ${inc.status}`,
                  fireId: inc.fire_id,
                })
              }
            }
            setActiveIncidents(prev => {
              const rest = prev.filter(i => i.fire_id !== inc.fire_id)
              return ACTIVE_STATUSES.has(inc.status) ? [inc, ...rest] : rest
            })
            // Once an incident leaves the active set (e.g. closed), drop its
            // dispatch routes too — otherwise the route lines linger on the map
            // after the incident pin is gone.
            if (!ACTIVE_STATUSES.has(inc.status)) {
              setDispatchRoutes(prev => prev.filter(r => r.fire_id !== inc.fire_id))
            }
          } else if (msg.type === 'auto_dispatch_failed') {
            // Payload carries only { fire_id, reason }; incident_created always
            // precedes it, so the snapshot has the location by now. Name the
            // place — "no unit for fire 41" is not actionable at 3am.
            const { fire_id, reason } = msg.data
            const loc = incidentSnapRef.current.get(fire_id)?.loc
            pushNotif('autoDispatchFailed', {
              title: loc ? `No unit available for ${loc}` : 'No unit available',
              body: reason || 'Auto-dispatch found no available team.',
              fireId: fire_id,
              severity: 'critical',
            })
          } else if (msg.type === 'dispatch_arrived') {
            const { fire_id, team_name } = msg.data
            const loc = incidentSnapRef.current.get(fire_id)?.loc
            pushNotif('onScene', {
              title: `${team_name} on scene`,
              body: loc ? `Arrived at ${loc}` : 'Unit marked arrival.',
              fireId: fire_id,
            })
            setDispatches(prev => prev.map(d =>
              d.dispatch_id === msg.data.dispatch_id
                ? { ...d, dispatch_status: 'on_scene' }
                : d
            ))
          } else if (msg.type === 'report_submitted') {
            // Sent just before the incident_updated that closes the fire, so the
            // snapshot still has the place name.
            const { fire_id, team_name, filed_by, photo_count } = msg.data
            const loc = incidentSnapRef.current.get(fire_id)?.loc
            const who = [filed_by, team_name && `(${team_name})`].filter(Boolean).join(' ')
            const photos = photo_count ? ` · ${photo_count} photo${photo_count === 1 ? '' : 's'}` : ''
            pushNotif('reportFiled', {
              title: loc ? `Report filed for ${loc}` : 'Incident report filed',
              body: `${who ? `Filed by ${who}` : 'After-action report submitted'}${photos}. Incident closed.`,
              fireId: fire_id,
            })
          } else if (msg.type === 'dispatch_completed') {
            // The crew and truck are back on standby server-side. Drop the
            // finished dispatches from local state and nudge the roster pages
            // to refetch — otherwise both keep showing the unit as committed
            // until a reload, which reads as the close having failed.
            const ids = new Set(msg.data.dispatch_ids || [])
            setDispatches(prev => prev.filter(d => !ids.has(d.dispatch_id)))
            setDispatchRoutes(prev => prev.filter(r => !ids.has(r.dispatch_id)))
            setRosterNonce(n => n + 1)
          } else if (msg.type === 'reporter_location') {
            const { token: t, lat, lng, phone } = msg.data
            handleReporterLocationReceived({ token: t, coords: [lat, lng], mobile: phone || '' })
            if (t === pendingReporterTokenRef.current) {
              setReporterReceivedData(msg.data)
            }
          } else if (msg.type === 'reporter_cleared') {
            const { token: t } = msg.data
            setReporterLocations(prev => prev.filter(r => r.token !== t))
          } else if (msg.type === 'personnel_location') {
            const row = msg.data
            setLivePersonnelLocations(prev => {
              const idx = prev.findIndex(p => p.per_id === row.per_id)
              if (idx === -1) return [...prev, row]
              const next = prev.slice()
              next[idx] = row
              return next
            })
          } else if (msg.type === 'dispatch_rerouted') {
            const { dispatch_id, fire_id, routes = [] } = msg.data
            setDispatchRoutes(prev => {
              const kept = prev.filter(r => r.dispatch_id !== dispatch_id)
              const teamName = prev.find(p => p.dispatch_id === dispatch_id)?.teamName ?? ''
              const replacements = routes.flatMap(r => {
                const positions = _parseWkt(r.route_wkt)
                if (!positions) return []
                return [{
                  id: `${dispatch_id}_${r.route_id}`,
                  route_id: r.route_id,
                  dispatch_id,
                  fire_id,
                  positions,
                  teamName,
                  isGnn: true,
                  isSelected: r.is_selected,
                  rank: r.rank,
                  routeType: r.route_type,
                  etaMinutes: r.eta_minutes,
                  distanceKm: r.distance_meters != null ? r.distance_meters / 1000 : null,
                }]
              })
              return [...kept, ...replacements]
            })
          }
        } catch {}
      }

      ws.onclose = () => {
        clearInterval(pingId)
        if (!destroyed) retryId = setTimeout(connect, 3_000)
      }

      ws.onerror = () => ws.close()
    }

    connect()

    // In production this runs only when route.view leaves 'dashboard' (i.e.
    // logout) — navigating between inner pages (activeNav) never triggers it.
    // In dev StrictMode also runs it once immediately after the first mount,
    // which is what the per-run locals above are there to survive.
    return () => {
      destroyed = true
      clearInterval(pingId)
      // Without this a reconnect already in flight would outlive the cleanup.
      clearTimeout(retryId)
      socket?.close()
    }
  }, [route.view]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 10-second live-location poll (TODO: replace with WebSocket push when scaling requires it) ──
  useEffect(() => {
    if (route.view !== 'dashboard') return
    let cancelled = false

    async function poll() {
      try {
        const rows = await fetchPersonnelLocations()
        if (cancelled) return
        detectNewlyOffline(rows)
        setLivePersonnelLocations(rows)
      } catch { /* non-fatal */ }
    }

    poll()
    const id = setInterval(poll, 10_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [route.view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Alert only on the false → true edge of is_stale. The first poll after login
  // just seeds the set: a tracker that went offline before the shift started is
  // not news, and without this every login would open with a burst of alerts.
  function detectNewlyOffline(rows) {
    const nowStale = new Set(rows.filter(r => r.is_stale).map(r => r.per_id))
    const seen = staleSeenRef.current
    if (seen === null) { staleSeenRef.current = nowStale; return }
    rows.forEach(r => {
      if (r.is_stale && !seen.has(r.per_id)) {
        pushNotif('deviceOffline', {
          title: `${r.name || `Personnel ${r.per_id}`} tracker offline`,
          body: `No location for ${Math.round(r.age_minutes)} min`,
        })
      }
    })
    staleSeenRef.current = nowStale
  }

  function handleDispatched({ team, dispatchId, routes }) {
    const fireId = selectedInc?.fire_id ?? null
    const teamName = team.team_name
    setDispatches(prev => [...prev, {
      dispatch_id:     dispatchId,
      fire_id:         fireId,
      team_id:         team.team_id,
      team_name:       teamName,
      team_code:       team.team_code,
      dispatch_status: 'dispatched',
      dispatch_at:     new Date().toISOString(),
      station_name:    team.station_name,
      members:         team.members || [],
    }])

    if (routes && routes.length > 0) {
      // GNN routes — add all variants
      const newRoutes = routes.flatMap(r => {
        const positions = _parseWkt(r.route_wkt)
        if (!positions) return []
        return [{
          id: `${dispatchId}_${r.route_id}`,
          route_id: r.route_id,
          dispatch_id: dispatchId,
          fire_id: fireId,
          positions,
          teamName,
          isGnn: true,
          isSelected: r.is_selected,
          rank: r.rank,
          routeType: r.route_type,
          etaMinutes: r.eta_minutes,
          distanceKm: r.distance_meters != null ? r.distance_meters / 1000 : null,
        }]
      })
      setDispatchRoutes(prev => [...prev, ...newRoutes])
    } else if (team.station_latitude && team.station_longitude && selectedInc) {
      // Fallback straight-line
      setDispatchRoutes(prev => [...prev, {
        id: `${dispatchId}_fallback`,
        route_id: null,
        dispatch_id: dispatchId,
        fire_id: fireId,
        positions: [
          [team.station_latitude, team.station_longitude],
          [selectedInc.latitude, selectedInc.longitude],
        ],
        teamName,
        isGnn: false,
        isSelected: true,
        rank: 1,
        routeType: 'fallback',
        etaMinutes: null,
      }])
    }
  }

  function handleSelectRoute(dispatchId, routeId) {
    selectRoute(dispatchId, routeId).then(() => {
      setDispatchRoutes(prev => prev.map(r => {
        if (r.dispatch_id !== dispatchId) return r
        return { ...r, isSelected: r.route_id === routeId }
      }))
    }).catch(console.error)
  }

  // fireId is passed explicitly: a dispatch whose routing failed has only the
  // straight-line fallback entry (or nothing at all), so deriving the incident
  // from the existing routes is not reliable. Returns the promise so the caller
  // can keep its button in a pending state until the reroute lands.
  function handleFullReroute(dispatchId, fireId = null) {
    return fullReroute(dispatchId).then(result => {
      // Replace all routes for this dispatch with the newly computed ones
      setDispatchRoutes(prev => {
        const kept = prev.filter(r => r.dispatch_id !== dispatchId)
        const existing = prev.find(p => p.dispatch_id === dispatchId)
        const resolvedFireId = fireId
          ?? existing?.fire_id
          ?? dispatches.find(d => d.dispatch_id === dispatchId)?.fire_id
          ?? null
        const teamName = existing?.teamName
          ?? dispatches.find(d => d.dispatch_id === dispatchId)?.team_name
          ?? ''
        const newRoutes = (result.routes ?? []).flatMap(r => {
          const positions = _parseWkt(r.route_wkt)
          if (!positions) return []
          return [{
            id: `${dispatchId}_${r.route_id}`,
            route_id: r.route_id,
            dispatch_id: dispatchId,
            fire_id: resolvedFireId,
            positions,
            teamName,
            isGnn: true,
            isSelected: r.is_selected,
            rank: r.rank,
            routeType: r.route_type,
            etaMinutes: r.eta_minutes,
            distanceKm: r.distance_meters != null ? r.distance_meters / 1000 : null,
          }]
        })
        // Nothing parseable came back — keep what was on screen rather than
        // clearing the map and leaving the dispatcher with no line at all.
        if (newRoutes.length === 0) return prev
        return [...kept, ...newRoutes]
      })
    }).catch(err => { console.error(err); throw err })
  }

  function handleSelectIncident(id) {
    setSelectedIncident(id)
    setRightCollapsed(false)
    setIncidentFocusNonce(n => n + 1)
    const inc = activeIncidents.find(i => i.id === id)
    if (inc) {
      setRipplingId(inc.fire_id)
      setTimeout(() => setRipplingId(null), 950)
    }
  }

  function toggleTheme() { setTheme(t => t === 'dark' ? 'light' : 'dark') }

  function startPicking() { setPickingMode(true); setPickedLocation(null); setIncidentDefaults(null) }
  function cancelPicking() { setPickingMode(false); setPickedLocation(null); setIncidentDefaults(null) }

  function handleLocationPicked(coords) { setPickedLocation(coords) }

  // "Move pin" in the Log Incident form: stay in picking mode and keep what was
  // typed, so the form reopens filled in at the next click. A hand-moved pin is
  // no longer the reporter's raw GPS fix.
  function repickLocation(draft) {
    setIncidentDefaults({ ...draft, locationSource: 'manual' })
    setPickedLocation(null)
  }

  // Open the Log Incident modal pre-filled at a reporter's shared location.
  function logIncidentAtReporter(coords, mobile, token) {
    setIncidentDefaults({
      reporter: 'SMS Report',
      locationSource: 'report',
      ...(mobile ? { mobile } : {}),
      ...(token ? { reporterToken: token } : {}),
    })
    setPickingMode(true)
    setPickedLocation(coords)
  }

  async function handleIncidentSubmit(formData) {
    const result = await createIncident({
      fire_location_name:    formData.locationName,
      fire_address:          formData.address,
      fire_latitude:         formData.coords[0],
      fire_longitude:        formData.coords[1],
      fire_severity:         formData.severity,
      fire_status:           'pending',
      fire_alarm_level:      formData.alarm,
      fire_structure_type:   formData.structure,
      fire_dispatch_type:    formData.dispatchType,
      fire_casualties:       'None',
      fire_units_assigned:   0,
      fire_reporter_name:    formData.reporter,
      fire_reporter_contact: formData.mobile || '',
      fire_location_source:  formData.locationSource || 'manual',
      fire_remarks:          '',
      auto_dispatch:         !!formData.autoDispatch,
      reporter_token:        formData.reporterToken || null,
    })
    cancelPicking()
    fetchActiveIncidents()
      .then(data => setActiveIncidents(data.filter(i => ACTIVE_STATUSES.has(i.status))))
      .catch(() => {})

    const ad = result?.auto_dispatch
    if (ad?.status === 'dispatched') {
      fetchDispatches().then(rows => {
        setDispatches(rows)
        // Same builder as the initial load — this used to be a hand-copied
        // duplicate that forgot isGnn, which is why auto-dispatched routes
        // rendered with the dashed fallback style.
        setDispatchRoutes(_routesFromDispatchRows(rows))
      }).catch(() => {})
      setAutoDispatchResult(result)
    } else if (ad?.status === 'no_team_available') {
      setAutoDispatchResult(result)
    }
  }

  function handleReporterLocationReceived(data) {
    // data: { token, coords: [lat, lng], receivedAt }
    setReporterLocations(prev => {
      const exists = prev.find(r => r.token === data.token)
      if (exists) return prev.map(r => r.token === data.token ? { ...r, ...data } : r)
      return [...prev, data]
    })
  }

  function handleLogin(user) {
    setConstraintEditing(false)
    setRoute({ view: 'dashboard', user })
  }

  // A credential change re-mints the token server-side (email is a JWT claim,
  // and a password change revokes the old jti), so the new one has to land in
  // localStorage before the next request or apiFetch's 401 handler signs the
  // user out mid-edit. access_token is null when the save was a no-op.
  function handleAccountUpdate({ user, access_token }) {
    if (access_token) localStorage.setItem('bfp_token', access_token)
    if (user) {
      localStorage.setItem('bfp_user', JSON.stringify(user))
      setRoute(r => ({ ...r, user }))
    }
  }

  function handleLogout() {
    setConstraintEditing(false)
    // Both are diff baselines, not data: a new session has to reseed them or it
    // would alert on everything that changed while nobody was signed in.
    incidentSnapRef.current = new Map()
    staleSeenRef.current    = null
    clearNotifs()
    setShowAlerts(false)
    localStorage.removeItem('bfp_token')
    localStorage.removeItem('bfp_user')
    setRoute({ view: 'login' })
  }

  // ── Login page ────────────────────────────────────────────────────────────
  if (route.view === 'login') {
    return <LoginPage onLogin={handleLogin} />
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────
  const selectedInc = activeIncidents.find(i => i.id === selectedIncident) || null

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <TopBar
        activeNav={activeNav}
        onNavChange={navigateToPage}
        theme={theme}
        onThemeToggle={toggleTheme}
        onOpenSettings={() => { setConstraintEditing(false); setShowSettings(s => !s) }}
        constraintEditing={constraintEditing && activeNav === 'Command' && !showSettings}
        showingSettings={showSettings}
        user={route.user}
        onLogout={handleLogout}
        unreadCount={unreadCount}
        alertsOpen={showAlerts}
        onToggleAlerts={toggleAlerts}
      />
      <main className="app-content" id="main-content">
      {showSettings ? (
        <SettingsPage
          user={route.user}
          theme={theme}
          onThemeToggle={toggleTheme}
          compactNav={compactNav}
          onCompactNavChange={setCompactNav}
          animations={animations}
          onAnimationsChange={setAnimations}
          notifPrefs={notifPrefs}
          onNotifPrefChange={setNotifPref}
          mapLayerPrefs={mapLayerPrefs}
          onMapLayerPrefChange={setMapLayerPref}
          onLogout={handleLogout}
          onAccountUpdate={handleAccountUpdate}
        />
      ) : activeNav === 'Metrics' ? (
        <MetricsPage />
      ) : activeNav === 'Planning' ? (
        <PlanningPage />
      ) : activeNav === 'Incidents' ? (
        <IncidentsPage
          onShowOnMap={(inc) => {
            setActiveNav('Command')
            handleSelectIncident(inc.id)
            setMapFocus({ lat: inc.latitude, lng: inc.longitude, nonce: Date.now() })
          }}
        />
      ) : activeNav === 'Personnel' ? (
        <PersonnelPage
          livePersonnelLocations={livePersonnelLocations}
          onShowOnMap={(perId) => {
            setActiveNav('Command')
            setFocusedPersonnel({ per_id: perId, nonce: Date.now() })
          }}
        />
      ) : activeNav === 'Teams' ? (
        <TeamsPage
          refreshKey={rosterNonce}
          onShowOnMap={(t) => {
            setActiveNav('Command')
            setMapFocus({ lat: t.station_latitude, lng: t.station_longitude, nonce: Date.now() })
          }}
        />
      ) : activeNav === 'Stations' ? (
        <StationsPage
          initialStationId={reviewStationId}
          onShowOnMap={(s) => {
            setActiveNav('Command')
            setMapFocus({ lat: s.latitude, lng: s.longitude, nonce: Date.now() })
          }}
        />
      ) : activeNav === 'Trucks' ? (
        <TrucksPage
          refreshKey={rosterNonce}
          onShowOnMap={(t) => {
            setActiveNav('Command')
            setMapFocus({ lat: t.truck_latitude, lng: t.truck_longitude, nonce: Date.now() })
          }}
        />
      ) : (
        <div className="main">
          <MapArea
            heatmapRevision={heatmapRevision}
            cameraControlsHost={mapControlsHost}
            layerToolsHost={mapLayerToolsHost}
            pickingMode={pickingMode}
            onLocationPicked={handleLocationPicked}
            pickedLocation={pickedLocation}
            onLogIncidentHere={logIncidentAtReporter}
            activeIncidents={activeIncidents}
            newIncidents={loggedIncidents}
            reporterLocations={reporterLocations}
            stations={stations}
            onViewStation={stationId => { setReviewStationId(stationId); navigateToPage('Stations') }}
            personnel={personnel}
            livePersonnelLocations={livePersonnelLocations}
            dispatchRoutes={dispatchRoutes}
            dispatches={dispatches}
            focusedIncidentId={selectedInc?.fire_id ?? null}
            ripplingIncidentId={ripplingId}
            onIncidentClick={handleSelectIncident}
            leftCollapsed={leftCollapsed}
            viewMode={viewMode}
            constraintEditing={constraintEditing && viewMode === 'gnn'}
            onConstraintEditingChange={editing => { if (editing) cancelPicking(); setConstraintEditing(editing) }}
            layerPrefs={mapLayerPrefs}
            focusedPersonnel={focusedPersonnel}
            mapFocus={mapFocus}
          />
          {!constraintEditing && <MapActions
            pickingMode={pickingMode}
            onStartPicking={startPicking}
            onOpenLocationRequest={() => setShowLocationRequest(true)}
            reporterCount={reporterLocations.length}
          />}
          <div ref={setMapControlsHost} className="command-map-camera-slot" />
          <RightSidebar
            onLayerToolsHostChange={setMapLayerToolsHost}
            viewMode={viewMode}
            onViewModeChange={mode => { setConstraintEditing(false); setViewMode(mode) }}
            constraintEditing={constraintEditing && viewMode === 'gnn'}
            incident={selectedInc}
            incidentRoutes={dispatchRoutes.filter(r => r.fire_id === (selectedInc?.fire_id ?? null))}
            incidentDispatches={dispatches.filter(d => d.fire_id === (selectedInc?.fire_id ?? null))}
            livePersonnelLocations={livePersonnelLocations}
            onSelectRoute={handleSelectRoute}
            onFullReroute={handleFullReroute}
            loading={loadingIncidents}
            collapsed={rightCollapsed}
            onToggleCollapse={() => setRightCollapsed(c => !c)}
            focusNonce={incidentFocusNonce}
            onDispatched={handleDispatched}
          />
        </div>
      )}
      </main>

      {showAlerts && (
        <NotificationPanel
          items={notifItems}
          onClose={closeAlerts}
          onDismiss={dismissNotif}
          onClear={clearNotifs}
          activeFireIds={activeFireIds}
          onOpenIncident={openAlertIncident}
        />
      )}

      {/* Rendered here rather than inside TopBar: the rail opens its own
          stacking context, which would cap these below the map's layers. */}
      <ToastStack
        toasts={toasts}
        onDismiss={hideToast}
        onOpenPanel={() => setShowAlerts(true)}
        activeFireIds={activeFireIds}
        onOpenIncident={openAlertIncident}
      />

      {pickedLocation && (
        <NewIncidentModal
          location={pickedLocation}
          initial={incidentDefaults}
          onSubmit={handleIncidentSubmit}
          onCancel={cancelPicking}
          onRepick={repickLocation}
        />
      )}

      {showLocationRequest && (
        <LocationRequestModal
          onClose={() => { setShowLocationRequest(false); setPendingReporterToken(null); setReporterReceivedData(null) }}
          onLocationReceived={handleReporterLocationReceived}
          onTokenGenerated={setPendingReporterToken}
          onLogIncident={(coords, mobile, token) => {
            setShowLocationRequest(false); setPendingReporterToken(null); setReporterReceivedData(null)
            logIncidentAtReporter(coords, mobile, token)
          }}
          receivedData={reporterReceivedData}
        />
      )}

      {autoDispatchResult && (
        <AutoDispatchModal
          incident={autoDispatchResult}
          onClose={() => setAutoDispatchResult(null)}
          onViewDispatch={() => {
            handleSelectIncident(autoDispatchResult.id)
            setAutoDispatchResult(null)
          }}
        />
      )}
    </>
  )
}
