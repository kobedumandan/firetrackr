export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
export const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]

export function scheduleSummary(schedule) {
  if (!schedule) return 'Legacy traffic constraint'
  const days = schedule.days.length === 7 ? 'Every day' : schedule.days.map(day => WEEKDAYS[day]).join(', ')
  const times = schedule.all_day ? 'All day' : schedule.windows.map(window => `${window.start}–${window.end}${window.start > window.end ? ' (next day)' : ''}`).join('; ')
  return `${days} · ${times} · PHT`
}

export function scheduleError(schedule) {
  if (!schedule.days.length) return 'Choose at least one day.'
  if (schedule.all_day) return ''
  if (!schedule.windows.length) return 'Add a time range or choose All day.'
  const occupied = new Set()
  for (const window of schedule.windows) {
    if (![window.start, window.end].every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) return 'Enter a start and end time for every range.'
    if (window.start === window.end) return 'Start and end must differ. Choose All day for a full day.'
    const minute = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    const start = minute(window.start), duration = (minute(window.end) - start + 1440) % 1440
    for (const day of schedule.days) {
      for (let offset = 0; offset < duration; offset++) {
        const position = (day * 1440 + start + offset) % 10080
        if (occupied.has(position)) return 'Time ranges must not overlap.'
        occupied.add(position)
      }
    }
  }
  return ''
}
