export function formatNotificationAge(iso, now) {
  if (!iso) return '—'
  const elapsed = now - new Date(iso).getTime()
  if (!Number.isFinite(elapsed)) return '—'
  const seconds = Math.max(0, Math.floor(elapsed / 1000))
  if (seconds < 5) return 'Just now'
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}
