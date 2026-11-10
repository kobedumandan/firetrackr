export const PAGE_PATHS = {
  Command: '/command',
  Metrics: '/metrics',
  Analysis: '/analysis/response',
  Incidents: '/incidents',
  Personnel: '/personnel',
  Teams: '/teams',
  Stations: '/stations',
  Trucks: '/trucks',
}

const NAVIGATION_EVENT = 'firetrackr:navigate'
const HISTORY_KEY = 'firetrackrNavigation'
const positiveId = value => /^[1-9]\d*$/.test(value || '') && Number.isSafeInteger(Number(value)) ? Number(value) : null

// Only recognised local routes can be navigation or post-login destinations.
export function parseAppPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null
  const url = new URL(value, 'http://firetrackr.local')
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (path === '/login') return { path, login: true }
  if (path === '/settings') return { path, nav: 'Command', settings: true }
  for (const [nav, target] of Object.entries(PAGE_PATHS)) {
    if (path !== target) continue
    if (nav === 'Analysis') return { path, nav, tab: 'response' }
    const stationId = nav === 'Stations' ? positiveId(url.searchParams.get('station')) : null
    const personnelId = nav === 'Personnel' ? positiveId(url.searchParams.get('personnel')) : null
    const teamId = nav === 'Teams' ? positiveId(url.searchParams.get('team')) : null
    const truckId = nav === 'Trucks' ? positiveId(url.searchParams.get('truck')) : null
    return { path: path + (stationId ? `?station=${stationId}` : personnelId ? `?personnel=${personnelId}` : teamId ? `?team=${teamId}` : truckId ? `?truck=${truckId}` : ''), nav, stationId,
      ...(nav === 'Personnel' ? { personnelId } : {}),
      ...(nav === 'Teams' ? { teamId } : {}),
      ...(nav === 'Trucks' ? { truckId } : {}) }
  }
  if (path === '/analysis' || path === '/analysis/operational') return { path: PAGE_PATHS.Analysis, nav: 'Analysis', tab: 'response' }
  if (path === '/analysis/coverage' || path === '/analysis/reports') return { path, nav: 'Analysis', tab: path.split('/')[2] }
  const incident = path.match(/^\/incidents\/([1-9]\d*)$/)
  if (incident && positiveId(incident[1])) {
    const incidentSection = url.searchParams.get('section') === 'response-reporting' ? 'response-reporting' : null
    return { path: path + (incidentSection ? `?section=${incidentSection}` : ''), nav: 'Incidents', incidentId: Number(incident[1]), incidentSection }
  }
  const detail = path.match(/^\/analysis\/response\/(incidents|dispatches)\/([1-9]\d*)$/)
  if (detail && positiveId(detail[2])) {
    const fireId = detail[1] === 'dispatches' ? positiveId(url.searchParams.get('incident')) : null
    const analysisSection = detail[1] === 'incidents' && url.searchParams.get('section') === 'incident-milestones' ? 'incident-milestones' : null
    const query = fireId ? `?incident=${fireId}` : analysisSection ? `?section=${analysisSection}` : ''
    return {
      path: path + query, nav: 'Analysis', tab: 'response', analysisSection,
      detail: { kind: detail[1] === 'incidents' ? 'incident' : 'dispatch', id: Number(detail[2]), fireId },
    }
  }
  return null
}

export function resolveAppPath(value, authenticated) {
  const page = parseAppPath(value)
  const requested = page?.login ? parseAppPath(new URL(value, 'http://firetrackr.local').searchParams.get('next')) : page
  const destination = requested && !requested.login ? requested.path : null
  if (!authenticated) return destination ? `/login?next=${encodeURIComponent(destination)}` : '/login'
  return destination || PAGE_PATHS.Command
}

export function currentAppPath() {
  return window.location.pathname + window.location.search
}

export function subscribeToNavigation(listener) {
  window.addEventListener('popstate', listener)
  window.addEventListener(NAVIGATION_EVENT, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(NAVIGATION_EVENT, listener)
  }
}

export function navigateApp(path, { replace = false } = {}) {
  if (!parseAppPath(path)) return
  const previous = currentAppPath()
  if (previous === path) return
  const state = {
    ...window.history.state,
    [HISTORY_KEY]: { from: replace ? window.history.state?.[HISTORY_KEY]?.from : previous },
  }
  window.history[replace ? 'replaceState' : 'pushState'](state, '', path)
  window.dispatchEvent(new Event(NAVIGATION_EVENT))
}

export function backInApp(fallback) {
  const previous = window.history.state?.[HISTORY_KEY]?.from
  const page = parseAppPath(previous)
  if (page && !page.login && previous !== currentAppPath()) window.history.back()
  else navigateApp(fallback, { replace: true })
}
