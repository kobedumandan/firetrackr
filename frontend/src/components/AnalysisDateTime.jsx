import AnalysisValue from './AnalysisValue'

export default function AnalysisDateTime({ value }) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return <AnalysisValue value={null} />
  const options = { timeZone: 'Asia/Manila' }
  return <time className="rar-date-time" dateTime={value}>
    <span className="rar-date">{date.toLocaleDateString('en-PH', { ...options, year: 'numeric', month: 'short', day: 'numeric' })}</span>
    <span className="rar-clock">{date.toLocaleTimeString('en-PH', { ...options, hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>
  </time>
}
