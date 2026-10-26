import '../styles/SettingsLoading.css'

export default function SettingsLoading({ message = 'Loading settings…', description, compact = false }) {
  return <div className={`settings-loading${compact ? ' settings-loading-compact' : ''}`} role="status">
    <span className="settings-loading-circle" aria-hidden="true" />
    <span>{message}</span>
    {description && !compact && <span className="settings-loading-description">{description}</span>}
  </div>
}
