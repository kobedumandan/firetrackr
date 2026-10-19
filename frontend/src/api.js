import { createAsyncCache } from './utils/asyncCache'

// In development, requests use the page's own origin and Vite proxies them to
// FastAPI. That keeps login working whether the dashboard was opened through
// localhost, 127.0.0.1, or another development hostname. Deployments that host
// the API elsewhere can still provide VITE_API_BASE_URL.
const BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')
const constraintCache = createAsyncCache({ ttl: 5 * 60 * 1000 })
const operationalCache = createAsyncCache({ ttl: 30000 })
export function invalidateOperationalTimes() {
  operationalCache.clear()
  window.dispatchEvent(new Event('operational-times-updated'))
}
async function operationalRequest(path, options) {
  const res = await apiFetch(`/api/operational-times${path}`, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Operational analysis unavailable (${res.status})`)
  return data
}
export function fetchOperationalTimes(period, page = 1) {
  return operationalCache.get(`${localStorage.getItem('bfp_token')}:${period}:${page}`, () => operationalRequest(`?period=${period}&page=${page}`))
}
export function fetchOperationalDetail(fireId) { return operationalRequest(`/${fireId}`) }
export async function confirmOperationalMilestone(fireId, body) {
  const data = await operationalRequest(`/${fireId}/milestones`, { method: 'POST', body: JSON.stringify(body) })
  invalidateOperationalTimes()
  return data
}
function cachedConstraints(path) {
  const key = `${BASE_URL}:${localStorage.getItem('bfp_token') || ''}:${path}`
  return constraintCache.get(key, async () => {
    const res = await apiFetch(path)
    if (!res.ok) throw new Error(`Failed to fetch constraints (${res.status})`)
    return res.json()
  })
}
// Same host as the REST API (http→ws, https→wss). With no explicit API URL,
// use the current page host so Vite can proxy the development WebSocket too.
const pageOrigin = globalThis.location?.origin || 'http://localhost:5173'
export const WS_URL = `${(BASE_URL || pageOrigin).replace(/^http/, 'ws')}/ws`

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('bfp_token')

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': '1',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401 && path !== '/api/auth/login') {
    localStorage.removeItem('bfp_token')
    localStorage.removeItem('bfp_user')
    window.location.reload()
  }

  if (res.ok && options.method && !['GET', 'HEAD'].includes(options.method.toUpperCase()) && /^\/api\/(incidents|dispatch)(\/|$)/.test(path)) {
    invalidateOperationalTimes()
  }

  return res
}

// ── Simple in-memory cache ────────────────────────────────────────────────────
const _cache = {}
const CACHE_TTL_MS = 2 * 60 * 1000  // 2 minutes

function _cacheGet(key) {
  const entry = _cache[key]
  if (!entry) return null
  if (Date.now() - entry.ts > CACHE_TTL_MS) { delete _cache[key]; return null }
  return entry.data
}

function _cacheSet(key, data) {
  _cache[key] = { data, ts: Date.now() }
}

// ── Personnel ─────────────────────────────────────────────────────────────────
export async function fetchHeatmap() {
  const cached = _cacheGet('heatmap')
  if (cached) return cached

  const res = await apiFetch('/api/heatmap')
  if (!res.ok) throw new Error(`Failed to fetch heatmap data (${res.status})`)
  const data = await res.json()
  _cacheSet('heatmap', data)
  return data
}

export async function fetchPersonnel() {
  const cached = _cacheGet('personnel')
  if (cached) return cached

  const res = await apiFetch('/api/personnel')
  if (!res.ok) throw new Error(`Failed to fetch personnel (${res.status})`)
  const data = await res.json()
  _cacheSet('personnel', data)
  return data
}

// ── Barangay boundaries (Panabo) ─────────────────────────────────────────────
export async function fetchBarangays() {
  const cached = _cacheGet('barangays')
  if (cached) return cached

  const res = await apiFetch('/api/barangays')
  if (!res.ok) throw new Error(`Failed to fetch barangays (${res.status})`)
  const data = await res.json()
  _cacheSet('barangays', data)
  return data
}

// ── Stations ──────────────────────────────────────────────────────────────────
export async function fetchStations() {
  const cached = _cacheGet('stations')
  if (cached) return cached

  const res = await apiFetch('/api/stations')
  if (!res.ok) throw new Error(`Failed to fetch stations (${res.status})`)
  const data = await res.json()
  _cacheSet('stations', data)
  return data
}

export async function createPersonnel(body) {
  const res = await apiFetch('/api/personnel', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to create personnel (${res.status})`)
  }
  delete _cache['personnel']
  return res.json()
}

export async function updatePersonnel(perId, body) {
  const res = await apiFetch(`/api/personnel/${perId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to update personnel (${res.status})`)
  }
  delete _cache['personnel']
  return res.json()
}

export async function deletePersonnel(perId) {
  const res = await apiFetch(`/api/personnel/${perId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to delete personnel (${res.status})`)
  }
  delete _cache['personnel']
}

export async function updateStation(stationId, body) {
  const res = await apiFetch(`/api/stations/${stationId}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to update station (${res.status})`)
  }
  delete _cache['stations']
  clearCoverageCache()   // coverage depends on station positions + status
  return res.json()
}

// ── Shifts ────────────────────────────────────────────────────────────────────
export async function fetchShifts() {
  const cached = _cacheGet('shifts')
  if (cached) return cached

  const res = await apiFetch('/api/shifts')
  if (!res.ok) throw new Error(`Failed to fetch shifts (${res.status})`)
  const data = await res.json()
  _cacheSet('shifts', data)
  return data
}

// ── Teams ─────────────────────────────────────────────────────────────────────
export async function fetchTeams() {
  const cached = _cacheGet('teams')
  if (cached) return cached

  const res = await apiFetch('/api/teams')
  if (!res.ok) throw new Error(`Failed to fetch teams (${res.status})`)
  const data = await res.json()
  _cacheSet('teams', data)
  return data
}

export async function createTeam(body) {
  const res = await apiFetch('/api/teams', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to create team (${res.status})`)
  }
  delete _cache['teams']
  return res.json()
}

export async function updateTeam(teamId, body) {
  const res = await apiFetch(`/api/teams/${teamId}`, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to update team (${res.status})`)
  }
  delete _cache['teams']
  return res.json()
}

export async function deleteTeam(teamId) {
  const res = await apiFetch(`/api/teams/${teamId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to delete team (${res.status})`)
  }
  delete _cache['teams']
}

export async function addTeamMember(teamId, body) {
  const res = await apiFetch(`/api/teams/${teamId}/members`, { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to add member (${res.status})`)
  }
  delete _cache['teams']
  delete _cache['personnel']
  return res.json()
}

export async function updateTeamMember(teamId, perId, body) {
  const res = await apiFetch(`/api/teams/${teamId}/members/${perId}`, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to update member (${res.status})`)
  }
  delete _cache['teams']
  return res.json()
}

export async function removeTeamMember(teamId, perId) {
  const res = await apiFetch(`/api/teams/${teamId}/members/${perId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to remove member (${res.status})`)
  }
  delete _cache['teams']
  delete _cache['personnel']
}

// ── Incidents ─────────────────────────────────────────────────────────────────
export async function fetchActiveIncidents() {
  const res = await apiFetch('/api/incidents/active')
  if (!res.ok) throw new Error(`Failed to fetch active incidents (${res.status})`)
  return res.json()
}

export async function fetchIncidents({ page = 1, pageSize = 15, period, status, search, sev, alarm, sortCol, sortDir } = {}) {
  const params = new URLSearchParams()
  if (page)     params.set('page',      page)
  if (pageSize) params.set('page_size', pageSize)
  if (period && period !== 'all') params.set('period', period)
  if (status && status !== 'all') params.set('status', status)
  if (search)   params.set('search',   search)
  if (sev)      params.set('sev',      sev)
  if (alarm)    params.set('alarm',    alarm)
  if (sortCol)  params.set('sort_col', sortCol)
  if (sortDir)  params.set('sort_dir', sortDir === -1 ? 'desc' : 'asc')

  const res = await apiFetch(`/api/incidents?${params}`)
  if (!res.ok) throw new Error(`Failed to fetch incidents (${res.status})`)
  return res.json()
}

export async function createIncident(body) {
  const res = await apiFetch('/api/incidents', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to create incident (${res.status})`)
  }
  return res.json()
}

export async function updateIncident(fireId, body) {
  const res = await apiFetch(`/api/incidents/${fireId}`, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to update incident (${res.status})`)
  }
  return res.json()
}

export async function deleteIncident(fireId) {
  const res = await apiFetch(`/api/incidents/${fireId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to delete incident (${res.status})`)
  }
}

// The after-action report filed for a closed incident (with photo URLs).
// Returns null when no report has been filed yet.
export async function fetchIncidentReport(fireId) {
  const res = await apiFetch(`/api/incidents/${fireId}/report`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to fetch incident report (${res.status})`)
  }
  const data = await res.json()
  const report = data.report
  // Photo URLs come back pointing at PUBLIC_BASE_URL (the ngrok tunnel, for the
  // mobile app). The dashboard can't pass ngrok's skip-warning header on a plain
  // <img>, so rewrite each URL onto our own BASE_URL — same /uploads/... path,
  // served directly with no interstitial.
  if (report?.photos?.length) {
    report.photos = report.photos.map((url) => {
      try {
        return `${BASE_URL}${new URL(url).pathname}`
      } catch {
        return url
      }
    })
  }
  return report
}

// Status / alarm / severity changes for the incident timeline, oldest first:
// [{ event_id, type, from, to, actor, at }]
export async function fetchIncidentEvents(fireId) {
  const res = await apiFetch(`/api/incidents/${fireId}/events`)
  if (!res.ok) throw new Error(`Failed to fetch incident events (${res.status})`)
  return res.json()
}

// ── Dispatch ──────────────────────────────────────────────────────────────────
export async function fetchDispatches(fireId) {
  const res = await apiFetch(fireId != null ? `/api/dispatch?fire_id=${fireId}` : '/api/dispatch')
  if (!res.ok) throw new Error(`Failed to fetch dispatches (${res.status})`)
  return res.json()
}

export async function fetchIncidentRoutes(fireId) {
  const res = await apiFetch(`/api/incidents/${fireId}/routes`)
  if (!res.ok) throw new Error(`Failed to fetch routes (${res.status})`)
  return res.json()
}

export async function selectRoute(dispatchId, routeId) {
  const res = await apiFetch(`/api/dispatch/${dispatchId}/select-route`, {
    method: 'PATCH',
    body: JSON.stringify({ route_id: routeId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to select route (${res.status})`)
  }
  return res.json()
}

export async function createDispatch(body) {
  const res = await apiFetch('/api/dispatch', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to create dispatch (${res.status})`)
  }
  return res.json()
}

// Ranked shortlist of teams to send when escalating an incident's alarm level.
// Read-only — it never dispatches. `targetLevel` is the alarm level being
// escalated to, which drives `target_units` in the response.
export async function fetchDispatchRecommendations(fireId, { limit = 8, targetLevel } = {}) {
  const params = new URLSearchParams()
  params.set('limit', limit)
  if (targetLevel) params.set('target_level', targetLevel)
  const res = await apiFetch(`/api/incidents/${fireId}/dispatch-recommendations?${params}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to fetch dispatch recommendations (${res.status})`)
  }
  return res.json()
}

export async function fetchPersonnelLocations() {
  const res = await apiFetch('/api/personnel/locations')
  if (!res.ok) throw new Error(`Failed to fetch personnel locations (${res.status})`)
  return res.json()
}

export async function fullReroute(dispatchId) {
  const res = await apiFetch(`/api/dispatch/${dispatchId}/full-reroute`, { method: 'POST' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Full reroute failed (${res.status})`)
  }
  return res.json()
}

// ── Road Obstructions ────────────────────────────────────────────────────────
export async function fetchObstructions() {
  const res = await apiFetch('/api/obstructions')
  if (!res.ok) throw new Error(`Failed to fetch obstructions (${res.status})`)
  return res.json()
}

// Snap a coordinate onto the road network. Returns null when nothing is in
// range, which is the ordinary answer while the pointer is over open ground,
// so callers treat it as a state rather than a failure.
export async function snapToRoad(lat, lon, signal) {
  const res = await apiFetch(`/api/routing/snap?lat=${lat}&lon=${lon}`, { signal })
  if (!res.ok) throw new Error(`Failed to snap to road (${res.status})`)
  const data = await res.json()
  return data.snapped ?? null
}

export async function createObstruction(body) {
  const res = await apiFetch('/api/obstructions', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to create obstruction (${res.status})`)
  }
  return res.json()
}

// ── GNN Constraints ─────────────────────────────────────────────────────────
export async function fetchGnnConstraints() {
  return cachedConstraints('/api/routing/gnn-constraints')
}

// ── Metrics summary (real dashboard aggregates) ─────────────────────────────
export async function fetchMetricsSummary(period = '1m') {
  const key = `metrics-summary-${period}`
  const cached = _cacheGet(key)
  if (cached) return cached

  const res = await apiFetch(`/api/metrics/summary?period=${period}`)
  if (!res.ok) throw new Error(`Failed to fetch metrics summary (${res.status})`)
  const data = await res.json()
  _cacheSet(key, data)
  return data
}

// ── Response Coverage (reachability isochrones) ─────────────────────────────
/* `refresh` forces the backend to recompute the whole coverage result rather
   than serve its process-wide cache — it is what makes the Planning page
   reflect a station that was just added, moved or taken offline. Since one
   recompute refreshes every band at once, the local cache is dropped wholesale
   so the minute tabs don't keep serving pre-refresh rows. */
export function clearCoverageCache() {
  for (const key of Object.keys(_cache)) {
    if (key.startsWith('coverage-')) delete _cache[key]
  }
}

export async function fetchCoverageIsochrones({ refresh = false } = {}) {
  if (refresh) clearCoverageCache()
  const cached = _cacheGet('coverage-isochrones')
  if (cached) return cached

  const res = await apiFetch(`/api/coverage/isochrones${refresh ? '?refresh=true' : ''}`)
  if (!res.ok) throw new Error(`Failed to fetch coverage isochrones (${res.status})`)
  const data = await res.json()
  _cacheSet('coverage-isochrones', data)
  return data
}

export async function fetchCoverageGaps(minutes = 5) {
  const key = `coverage-gaps-${minutes}`
  const cached = _cacheGet(key)
  if (cached) return cached

  const res = await apiFetch(`/api/coverage/gaps?minutes=${minutes}`)
  if (!res.ok) throw new Error(`Failed to fetch coverage gaps (${res.status})`)
  const data = await res.json()
  _cacheSet(key, data)
  return data
}

export async function deleteObstruction(id) {
  const res = await apiFetch(`/api/obstructions/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to delete obstruction (${res.status})`)
  }
}

// ── Reporter location requests ──────────────────────────────────────────────
export async function fetchReporterSessions() {
  const res = await apiFetch('/api/report-sessions')
  if (!res.ok) throw new Error(`Failed to fetch reporter sessions (${res.status})`)
  return res.json()
}

export async function sendReporterSms(token, phoneNumber) {
  const res = await apiFetch(`/api/report-sessions/${token}/send-sms`, {
    method: 'POST',
    body: JSON.stringify({ phone_number: phoneNumber }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to send SMS (${res.status})`)
  }
  return res.json()
}

// ── Custom GNN Constraints ──────────────────────────────────────────────────
export async function fetchConstraints() {
  return cachedConstraints('/api/constraints')
}

export async function createConstraint(body) {
  const res = await apiFetch('/api/constraints', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to create constraint (${res.status})`)
  }
  constraintCache.clear()
  return res.json()
}

export async function updateConstraint(id, body) {
  const res = await apiFetch(`/api/constraints/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to update constraint (${res.status})`)
  }
  constraintCache.clear()
  return res.json()
}

export async function deleteConstraint(id) {
  const res = await apiFetch(`/api/constraints/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to delete constraint (${res.status})`)
  }
  constraintCache.clear()
}

// ── Trucks ───────────────────────────────────────────────────────────────────
export async function fetchTrucks() {
  const cached = _cacheGet('trucks')
  if (cached) return cached

  const res = await apiFetch('/api/trucks')
  if (!res.ok) throw new Error(`Failed to fetch trucks (${res.status})`)
  const data = await res.json()
  _cacheSet('trucks', data)
  return data
}

export async function createTruck(body) {
  const res = await apiFetch('/api/trucks', { method: 'POST', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to create truck (${res.status})`)
  }
  delete _cache['trucks']
  return res.json()
}

export async function updateTruck(truckId, body) {
  const res = await apiFetch(`/api/trucks/${truckId}`, { method: 'PATCH', body: JSON.stringify(body) })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to update truck (${res.status})`)
  }
  delete _cache['trucks']
  return res.json()
}

export async function deleteTruck(truckId) {
  const res = await apiFetch(`/api/trucks/${truckId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to delete truck (${res.status})`)
  }
  delete _cache['trucks']
}

export async function createStation(body) {
  const res = await apiFetch('/api/stations', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to create station (${res.status})`)
  }
  delete _cache['stations']   // invalidate so next fetch hits the DB
  clearCoverageCache()
  return res.json()
}

export async function deleteStation(stationId) {
  const res = await apiFetch(`/api/stations/${stationId}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Failed to delete station (${res.status})`)
  }
  delete _cache['stations']
  clearCoverageCache()
}

// ── Account credentials ───────────────────────────────────────────────────────
// FastAPI returns `detail` as a string for HTTPException but as a list of error
// objects for a 422 validation failure; rendering that raw gives "[object
// Object]" in the UI, so pull the first message out.
async function _detail(res, fallback) {
  const body = await res.json().catch(() => ({}))
  const d = body.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d) && d.length) return d[0].msg || fallback
  return fallback
}

/** The signed-in user's profile, straight from the server.
 *  localStorage holds whatever the profile looked like at sign-in, which goes
 *  stale when an admin edits the record — or when a deploy adds a field. */
export async function fetchCurrentUser() {
  const res = await apiFetch('/api/auth/me')
  if (!res.ok) throw new Error(await _detail(res, `Failed to load profile (${res.status})`))
  return res.json()
}

/** Patch the signed-in user's own profile. Send only the fields being changed,
 *  e.g. { contact } or { email } — the backend reads the body with
 *  exclude_unset, so an omitted field is left alone.
 *
 *  Changing the email re-mints the token (email is a JWT claim), so the caller
 *  must persist a non-null access_token from the response or the next request
 *  401s. Other fields return access_token: null. */
export async function updateAccountProfile(fields) {
  const res = await apiFetch('/api/auth/me', {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
  if (!res.ok) throw new Error(await _detail(res, `Failed to update profile (${res.status})`))
  return res.json()   // { user, access_token }
}

/** Replace the password, proving knowledge of the current one.
 *  Also returns a fresh token, since the old one is revoked server-side. */
export async function changePassword(currentPassword, newPassword) {
  const res = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({
      current_password: currentPassword,
      new_password: newPassword,
    }),
  })
  if (!res.ok) throw new Error(await _detail(res, `Failed to change password (${res.status})`))
  return res.json()   // { user, access_token }
}

/** Most recent sign-ins for the current user, newest first. Not cached — a
 *  stale login list is worse than no list on a security screen. */
export async function fetchLoginHistory(limit = 5) {
  const res = await apiFetch(`/api/auth/login-history?limit=${limit}`)
  if (!res.ok) throw new Error(await _detail(res, `Failed to load login history (${res.status})`))
  return res.json()
}
