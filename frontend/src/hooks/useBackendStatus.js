import { useCallback, useEffect, useState } from 'react'
import { fetchBackendHealth } from '../api'

const REQUEST_TIMEOUT = 15000
const SLOW_RESPONSE = 4000
const STARTUP_WINDOW = 90000

export function useBackendStatus() {
  const [state, setState] = useState({ status: 'checking', checking: true })
  const [attempt, setAttempt] = useState(0)
  const refresh = useCallback(() => setAttempt(value => value + 1), [])

  useEffect(() => {
    let disposed = false, controller, nextCheck, slowTimer, timeout
    let status = 'checking', waitingSince = null

    function update(nextStatus, checking) {
      status = nextStatus
      setState({ status, checking })
    }

    function stop() {
      clearTimeout(nextCheck)
      clearTimeout(slowTimer)
      clearTimeout(timeout)
      const pending = controller
      controller = null
      pending?.abort()
    }

    async function check() {
      // Also lets StrictMode clean up its first effect before starting a request.
      await Promise.resolve()
      if (disposed || document.hidden || controller) return
      if (navigator.onLine === false) {
        update('offline', false)
        return
      }

      waitingSince ??= Date.now()
      const request = new AbortController()
      controller = request
      update(status, true)
      slowTimer = setTimeout(() => {
        if (controller === request && status === 'checking') update('waiting', true)
      }, SLOW_RESPONSE)
      timeout = setTimeout(() => request.abort(), REQUEST_TIMEOUT)

      let nextStatus
      try {
        const health = await fetchBackendHealth(request.signal)
        if (disposed || controller !== request) return
        nextStatus = health.database === 'ok' ? 'online' : 'degraded'
        waitingSince = null
      } catch (error) {
        if (disposed || controller !== request) return
        // A timeout cannot prove that the server is booting rather than down.
        const mayBeStarting = request.signal.aborted || [502, 503, 504].includes(error?.status)
        nextStatus = mayBeStarting && Date.now() - waitingSince < STARTUP_WINDOW ? 'waiting' : 'unreachable'
      } finally {
        if (controller === request) {
          clearTimeout(slowTimer)
          clearTimeout(timeout)
          controller = null
        }
      }

      update(nextStatus, false)
      const retrySlowly = waitingSince !== null && Date.now() - waitingSince >= STARTUP_WINDOW
      const delay = nextStatus === 'online' ? 30000 : retrySlowly ? 15000 : 5000
      nextCheck = setTimeout(check, delay)
    }

    function resume() {
      stop()
      waitingSince = null
      status = 'checking'
      void check()
    }

    function onVisibilityChange() {
      if (document.hidden) stop()
      else resume()
    }

    function onOffline() {
      stop()
      update('offline', false)
    }

    void check()
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', resume)
    window.addEventListener('offline', onOffline)
    return () => {
      disposed = true
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('online', resume)
      window.removeEventListener('offline', onOffline)
    }
  }, [attempt])

  return { ...state, refresh }
}
