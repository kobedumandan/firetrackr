import '../styles/AnalysisValue.css'

export default function AnalysisValue({ value }) {
  return value == null || value === '' || value === 'No data'
    ? <span className="analysis-empty-value" aria-label="No data">—</span>
    : value
}
