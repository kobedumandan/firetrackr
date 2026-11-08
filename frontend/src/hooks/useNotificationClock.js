import { useEffect, useState } from 'react'

// One clock per visible notification surface; use wall time so a backgrounded
// tab catches up instead of counting only the ticks the browser delivered.
export default function useNotificationClock(enabled = true) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const refresh = () => setNow(Date.now())
    const timer = setInterval(refresh, 1000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [enabled])
  return now
}
