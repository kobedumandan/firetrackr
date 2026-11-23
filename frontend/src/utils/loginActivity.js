const DAY_MS = 86_400_000;

export function buildLoginCalendar(activity) {
  const start = new Date(`${activity.start_date}T00:00:00Z`);
  const end = new Date(`${activity.end_date}T00:00:00Z`);
  const firstSunday = start.getTime() - start.getUTCDay() * DAY_MS;
  const records = new Map(activity.days.map(day => [day.date, day]));
  const weeks = [];
  for (let weekStart = firstSunday; weekStart <= end.getTime(); weekStart += 7 * DAY_MS) {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(weekStart + index * DAY_MS);
      const key = date.toISOString().slice(0, 10);
      const inRange = date >= start && date <= end;
      const record = inRange ? records.get(key) : null;
      const count = record?.count ?? 0;
      return { date, key, inRange, count, durationSeconds: record?.duration_seconds ?? null, level: Math.min(count, 4) };
    });
    const monthStart = days.find(day => day.inRange && (day.date.getUTCDate() === 1 || day.key === activity.start_date));
    weeks.push({ days, month: monthStart?.date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) ?? '' });
  }
  // Hide a short opening month when its label would crowd the next month.
  if (weeks.slice(1, 3).some(week => week.month)) weeks[0].month = '';
  return weeks;
}

export function formatSessionDuration(seconds) {
  if (seconds === null || seconds === undefined) return 'Duration unavailable';
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const remainder = total % 60;
  return `Total duration: ${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${remainder}s`;
}
