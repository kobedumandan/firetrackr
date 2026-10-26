// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import ConstraintEdgeSaveDialog from '../src/components/ConstraintEdgeSaveDialog'
import { scheduleError, scheduleSummary } from '../src/utils/constraintSchedule'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
async function mount(type, save) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<ConstraintEdgeSaveDialog constraintType={type} edgeCount={2} onSave={save} onCancel={() => {}} />))
  return async () => { await act(async () => root.unmount()); host.remove() }
}

it('submits chosen narrow severity without traffic settings', async () => {
  const save = vi.fn().mockResolvedValue({})
  const unmount = await mount('narrow_road', save)
  try {
    await act(async () => document.querySelector('input[value="severe"]').click())
    await act(async () => document.querySelector('button[type="submit"]').click())
    expect(save).toHaveBeenCalledWith({ name: null, narrow_severity: 'severe' })
  } finally { await unmount() }
})

it('saves an all-day, every-day traffic schedule without stale windows', async () => {
  const save = vi.fn().mockResolvedValue({})
  const unmount = await mount('traffic_area', save)
  try {
    expect(document.querySelector('input[type="time"]')).toBeNull()
    await act(async () => document.querySelector('button[type="submit"]').click())
    expect(save).toHaveBeenCalledWith({ name: null, traffic_schedule: { all_day: true, days: [0,1,2,3,4,5,6], windows: [] } })
  } finally { await unmount() }
})

it('allows additional ranges and blocks saving until every day/time selection is valid', async () => {
  const save = vi.fn().mockResolvedValue({})
  const unmount = await mount('traffic_area', save)
  try {
    const checkbox = text => [...document.querySelectorAll('label')].find(label => label.textContent === text).querySelector('input')
    await act(async () => checkbox('All day').click())
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(2)
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Add time range').click())
    expect(document.querySelectorAll('input[type="time"]')).toHaveLength(4)
    await act(async () => document.querySelector('[aria-label="Remove time range 2"]').click())
    await act(async () => checkbox('Every day').click())
    await act(async () => document.querySelector('button[type="submit"]').click())
    expect(save).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alert"]').textContent).toContain('Choose at least one day')
    await act(async () => checkbox('Mon').click())
    await act(async () => document.querySelector('button[type="submit"]').click())
    expect(save).toHaveBeenCalledWith({ name: null, traffic_schedule: { all_day: false, days: [0], windows: [{ start:'08:00', end:'10:00' }] } })
  } finally { await unmount() }
})

it('validates disjoint ranges and rejects weekly overlaps across midnight', () => {
  const valid = { all_day:false, days:[0,1,2,3,4], windows:[{start:'08:00',end:'10:00'}, {start:'17:00',end:'20:00'}] }
  expect(scheduleError(valid)).toBe('')
  expect(scheduleSummary(valid)).toContain('08:00–10:00; 17:00–20:00')
  expect(scheduleError({...valid, windows:[{start:'08:00',end:'08:00'}]})).toContain('must differ')
  expect(scheduleError({...valid, days:[6,0], windows:[{start:'22:00',end:'02:00'}, {start:'01:00',end:'03:00'}]})).toContain('overlap')
})
