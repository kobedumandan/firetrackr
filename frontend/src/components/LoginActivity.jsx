import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { fetchLoginActivity } from "../api";
import { buildLoginCalendar, formatSessionDuration } from "../utils/loginActivity";
import SettingsLoading from "./SettingsLoading";

export default function LoginActivity() {
  const [activity, setActivity] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [tooltip, setTooltip] = useState(null);
  const tooltipId = useId();
  const tooltipOpen = tooltip !== null;

  useEffect(() => {
    if (!tooltipOpen) return;
    const dismiss = () => setTooltip(null);
    const onKeyDown = event => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tooltipOpen]);

  function showTooltip(target, day) {
    if (!day.inRange) return;
    const bounds = target.getBoundingClientRect();
    const width = Math.min(220, window.innerWidth - 24);
    const left = Math.max(12 + width / 2, Math.min(window.innerWidth - 12 - width / 2, bounds.left + bounds.width / 2));
    const below = bounds.top < 80;
    setTooltip({
      key: day.key, count: day.count, durationSeconds: day.durationSeconds,
      date: day.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
      left, top: below ? bounds.bottom + 8 : bounds.top - 8, below,
    });
  }

  useEffect(() => {
    let alive = true;
    fetchLoginActivity()
      .then(data => { if (alive) setActivity(data); })
      .catch(reason => { if (alive) setError(reason.message); });
    return () => { alive = false; };
  }, [attempt]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setAttempt(value => value + 1);
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const weeks = activity ? buildLoginCalendar(activity) : [];
  const total = activity?.days.reduce((sum, day) => sum + day.count, 0) ?? 0;
  const activeDays = activity?.days.filter(day => day.count > 0).length ?? 0;

  return (
    <section aria-label="Login activity" aria-busy={!activity && !error}>
      <div className="login-activity-heading">
        <h3 className="block-title">Login Activity</h3>
        {activity && <span>{total} {total === 1 ? "sign-in" : "sign-ins"} in the past year</span>}
      </div>
      <div className="settings-block login-activity">
      {error ? (
        <div className="login-activity-error" role="alert">
          <span className="row-sub-error">{error}</span>
          <button type="button" className="btn-edit" onClick={() => { setError(null); setAttempt(value => value + 1); }}>Retry</button>
        </div>
      ) : !activity ? <SettingsLoading message="Loading login activity…" compact /> : (
        <>
          <div className="login-activity-grid">
            <table className="login-activity-calendar" aria-label="Successful sign-ins by day, in Manila time">
              <thead>
                <tr><th aria-label="Day of week" />{weeks.map(week => <th key={week.days[0].key} scope="col">{week.month}</th>)}</tr>
              </thead>
              <tbody>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday, index) => (
                  <tr key={weekday}>
                    <th scope="row" aria-label={weekday}>{index % 2 === 1 ? weekday : ""}</th>
                    {weeks.map(week => {
                      const day = week.days[index];
                      const label = `${day.date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}: ${day.count} ${day.count === 1 ? "sign-in" : "sign-ins"}`;
                      return (
                        <td
                          key={day.key}
                          aria-label={day.inRange ? label : "Outside date range"}
                          aria-describedby={tooltip?.key === day.key ? tooltipId : undefined}
                          onMouseEnter={event => showTooltip(event.currentTarget, day)}
                          onMouseLeave={() => setTooltip(null)}
                        >
                          <span className={`login-activity-day login-level-${day.level}${day.inRange ? "" : " outside-range"}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="login-activity-footer">
            <span className="login-activity-summary">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              {activeDays ? `${activeDays} active ${activeDays === 1 ? "day" : "days"}` : "No recorded sign-ins in this period"}
            </span>
            <div className="login-activity-legend" aria-label="Color intensity: zero, one, two, three, four or more sign-ins per day">
              <span>Less</span>
              {[0, 1, 2, 3, 4].map(level => <span key={level} className={`login-activity-day login-level-${level}`} aria-hidden="true" />)}
              <span>More</span>
            </div>
          </div>
        </>
      )}
      </div>
      {tooltip && createPortal(
        <div
          id={tooltipId}
          role="tooltip"
          className={`login-day-tooltip${tooltip.below ? " is-below" : ""}${tooltip.count === 0 ? " is-empty" : ""}`}
          style={{ left: tooltip.left, top: tooltip.top }}
        >
          <strong>{tooltip.date}</strong>
          <span>{tooltip.count} successful {tooltip.count === 1 ? "sign-in" : "sign-ins"}</span>
          {tooltip.count > 0 && <span className="login-day-duration">{formatSessionDuration(tooltip.durationSeconds)}</span>}
        </div>,
        document.body,
      )}
    </section>
  );
}
