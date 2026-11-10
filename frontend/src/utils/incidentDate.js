export const isDateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

export function dateOnlyLabel(value) {
  return `${new Date(`${value}T00:00:00+08:00`).toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric',
  })} · time not recorded`
}
