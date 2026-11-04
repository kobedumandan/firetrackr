import { useBackendStatus } from '../hooks/useBackendStatus'

const STATUS_COPY = {
  checking: ['Checking backend', 'Checking whether the sign-in service is ready.'],
  waiting: ['Backend starting or reconnecting', 'Waiting for a response. The server may be waking up. We’ll retry automatically.'],
  online: ['Backend online', 'Server and database are ready for sign-in.'],
  degraded: ['Backend partially available', 'Server is online, but the database is unavailable. Retrying automatically.'],
  unreachable: ['Backend status unavailable', 'This browser could not confirm the server status. Check your connection or try signing in.'],
  offline: ['You’re offline', 'Reconnect to the internet to check the backend.'],
}

export default function BackendStatus() {
  const { status, checking, refresh } = useBackendStatus()
  const [title, description] = STATUS_COPY[status]

  return (
    <div className={`lp-backend-status is-${status}`}>
      <div className="lp-backend-copy" role="status" aria-live="polite" aria-atomic="true">
        <div className="lp-backend-heading">
          <span className="lp-backend-dot" aria-hidden="true" />
          <strong>{title}</strong>
        </div>
        <p>{description}</p>
      </div>
      <button className="lp-backend-retry" type="button" onClick={refresh} disabled={checking}>
        {checking ? 'Checking…' : 'Check again'}
      </button>
    </div>
  )
}
