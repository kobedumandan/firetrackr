import "../styles/KpiCard.css";

/**
 * The project's single KPI/stat card.
 *
 * Every page that shows headline figures uses this, so the cards keep the same
 * size, spacing, hover behaviour and empty-state treatment wherever they turn
 * up. Colour lives only in the tinted icon puck — the figure itself is always
 * `--text-primary`, because a row of four differently-coloured numerals reads
 * as four warnings rather than as one summary.
 *
 * Pass `loading` to get the shimmer skeleton instead of hand-rolling one per
 * page. Icons may be inline SVG or a Material Symbols span; both are sized by
 * the stylesheet.
 */

// Rendered when a figure resolved to nothing. Pages should pass this rather
// than their own dash so the dimming can't drift out of step with the text.
export const KPI_EMPTY = "—";

export default function KpiCard({
  icon,
  label,
  value,
  sub,
  trend,
  accent = "blue",
  loading = false,
  onClick,
  actionLabel,
}) {
  // A figure that resolved to nothing should recede rather than read as a real
  // measurement — same size and position, just much lower contrast.
  const isEmpty = value == null || value === KPI_EMPTY || value === "";
  const action = onClick ? (
    <button
      type="button"
      className="kpi-card-action"
      onClick={onClick}
      aria-label={actionLabel || label}
      title={actionLabel || label}
    />
  ) : null;

  if (loading) {
    return (
      <div className="kpi-card">
        <div className="kpi-card-head">
          <span className="kpi-sk" style={{ width: 66, height: 10 }} />
          <span className="kpi-sk kpi-sk-circle" style={{ width: 34, height: 34 }} />
        </div>
        <span className="kpi-sk" style={{ width: 74, height: 26, marginTop: 2 }} />
        <span className="kpi-sk" style={{ width: 112, height: 9 }} />
        {action}
      </div>
    );
  }

  return (
    <div className="kpi-card">
      <div className="kpi-card-head">
        <div className="kpi-card-label">{label}</div>
        <div className={`kpi-card-icon kpi-card-icon-${accent}`}>{icon}</div>
      </div>
      <div className={`kpi-card-value${isEmpty ? " is-empty" : ""}`}>{value}</div>
      {sub && <div className="kpi-card-sub">{sub}</div>}
      {trend && (
        <div className={`kpi-card-trend ${trend.dir === "up" ? "trend-up" : "trend-down"}`}>
          {trend.dir === "up" ? "▲" : "▼"} {trend.text}
        </div>
      )}
      {action}
    </div>
  );
}
