import { useEffect, useState } from 'react'
import KpiCard, { KPI_EMPTY } from '../components/KpiCard'
import OperationalTrendChart from '../components/OperationalTrendChart'
import ResponseAnalysisModal from '../components/ResponseAnalysisModal'
import { fetchOperationalTimes, invalidateOperationalTimes } from '../api'
import { STAGES, dateTime, duration } from '../utils/operationalTimes'
import '../styles/MetricsPage.css'
import '../styles/OperationalTimePage.css'

export default function OperationalTimePage({ theme }) {
  const [period, setPeriod] = useState('1y')
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState(null)
  const [selected, setSelected] = useState(null)
  const key = `${period}:${page}:${revision}`
  const data = result?.key === key ? result.data : null
  const error = result?.key === key ? result.error : null
  const loading = !data && !error
  useEffect(() => {
    let alive = true
    fetchOperationalTimes(period, page).then(data => { if (alive) setResult({ key, data }) }, error => { if (alive) setResult({ key, error: error.message }) })
    return () => { alive = false }
  }, [period, page, key])
  useEffect(() => {
    const refresh = () => setRevision(n => n + 1)
    window.addEventListener('operational-times-updated', refresh)
    const timer = setInterval(() => { if (!document.hidden) invalidateOperationalTimes() }, 60000)
    return () => { window.removeEventListener('operational-times-updated', refresh); clearInterval(timer) }
  }, [])
  const breakdown = data?.breakdown
  const total = Object.values(breakdown?.seconds || {}).reduce((a, b) => a + (b || 0), 0)
  return <main className="ota-page">
    <header className="ota-header"><div><h1>Operational Time Analysis</h1><p>Analysis of time spent in each stage of emergency response.</p></div>
      <div className="m-period-group" role="group" aria-label="Reporting period">{['1d', '1w', '1m', '6m', '1y'].map(p => <button key={p} className={`m-period-btn ${p === period ? 'active' : ''}`} aria-pressed={p === period} onClick={() => { setPeriod(p); setPage(1) }}>{p}</button>)}</div>
    </header>
    <div className="ota-body" aria-busy={loading}>
      {error && <div className="ota-error" role="alert">{error} <button onClick={invalidateOperationalTimes}>Retry</button></div>}
      {data?.missing_receipt_count > 0 && <p className="ota-note">{data.missing_receipt_count} records have no verified report receipt time. They are listed by incident occurrence date and excluded from period averages.</p>}
      <div className="ota-kpis">{STAGES.map(s => {
        const stat = data?.summary?.[s.key]
        return <KpiCard key={s.key} loading={loading} label={s.label} icon={<span className="material-symbols-outlined">{s.icon}</span>} accent="fire" value={stat?.seconds == null ? KPI_EMPTY : `${(stat.seconds / 60).toFixed(1)} min`}
          sub={`${stat?.count || 0} measured ${['preparation', 'travel'].includes(s.key) ? 'units' : 'incidents'}`}
          trend={stat?.change_percent == null ? null : { dir: stat.change_percent > 0 ? 'up' : 'down', text: `${Math.abs(stat.change_percent).toFixed(1)}% vs previous period` }} />
      })}</div>
      <section className="ota-card"><div className="ota-section-head"><div><h2>Operational Time Breakdown</h2><p>First arriving unit in {breakdown?.count || 0} fire incidents with all four stages measured.</p></div><span>Average Call-to-Arrival: <strong>{duration(data?.summary?.cta?.seconds)}</strong></span></div>
        {total > 0 ? <><div className="ota-breakdown">{STAGES.map(s => <div key={s.key} style={{ flex: breakdown.seconds[s.key] / total }} title={`${s.label}: ${duration(breakdown.seconds[s.key])}`}><span>{duration(breakdown.seconds[s.key])}<small>{(breakdown.seconds[s.key] / total * 100).toFixed(1)}%</small></span><i style={{ background: s.color }} /></div>)}</div><div className="ota-legend">{STAGES.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div></> : <div className="ota-empty">{breakdown?.count > 0 ? 'Recorded stages total 0 min; percentage shares are undefined.' : 'No complete four-stage records in this period.'}</div>}
        <p className="ota-note">Shares of measured intervals, not a continuous timeline. Any arrival-to-suppression delay is excluded. Call-to-arrival is measured independently.</p>
      </section>
      <OperationalTrendChart points={data?.trends} period={period} />
      <section className="ota-card"><div className="ota-section-head"><div><h2>Recent Operational Records</h2><p>One row per incident. Unit intervals refer to the first arriving unit; inspect a record to see every truck.</p></div><button onClick={invalidateOperationalTimes}>Refresh</button></div>
        <div className="ota-table-scroll"><table><thead><tr>{['Incident #', 'Report Date & Time · PHT', 'Type', ...STAGES.map(s => s.label), 'Call-to-Arrival'].map(h => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{data?.records.map(r => <tr key={r.fire_id} onClick={() => setSelected(r.fire_id)}><td><button className="ota-record-link" onClick={e => { e.stopPropagation(); setSelected(r.fire_id) }}>INC-{r.fire_id}</button></td><td>{dateTime(r.reported_at || r.occurred_at)}{!r.reported_at && <small>Occurrence date · receipt unknown</small>}</td><td>{r.response_kind || 'Unknown'}</td>{[...STAGES.map(s => s.key), 'cta'].map(s => <td key={s}>{s === 'suppression' && r.response_kind && r.response_kind !== 'fire' ? 'N/A' : duration(r.durations[s])}</td>)}</tr>)}</tbody>
        </table></div>
        {!loading && !data?.records.length && <div className="ota-empty">No operational records in this period.</div>}
        {loading && <div className="ota-empty" role="status">Loading operational records…</div>}
        <div className="ota-pagination"><span>{data?.total || 0} incidents · page {page}</span><button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</button><button disabled={loading || page * 15 >= (data?.total || 0)} onClick={() => setPage(p => p + 1)}>Next</button></div>
      </section>
    </div>
    {selected != null && <ResponseAnalysisModal fireId={selected} theme={theme} onClose={() => setSelected(null)} />}
  </main>
}
