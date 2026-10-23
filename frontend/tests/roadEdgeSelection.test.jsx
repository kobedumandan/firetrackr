// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { nearestRoadEdge, toggleRoadEdge } from '../src/utils/roadEdgeSelection'
import ConstraintEdgeSaveDialog from '../src/components/ConstraintEdgeSaveDialog'
import ConstraintLayersPanel from '../src/components/ConstraintLayersPanel'

const edge = { type: 'Feature', properties: { segment_uid: 'edge-v1-a' }, geometry: { type: 'LineString', coordinates: [[125, 7], [125.001, 7], [125.002, 7.001]] } }
describe('Road-only selection', () => {
  it('selects the entire curved edge, and toggles only that edge', () => {
    expect(nearestRoadEdge([125.0015, 7.0005], [edge], 18)).toBe(edge)
    expect(toggleRoadEdge(['a', 'b'], 'a')).toEqual(['b'])
    expect(toggleRoadEdge(['a'], 'b')).toEqual(['a', 'b'])
  })
  it('rejects buildings, empty land and clicks at city zoom', () => {
    const building = { geometry: { type: 'Polygon', coordinates: [[[125,7],[126,7],[126,8],[125,7]]] } }
    expect(nearestRoadEdge([125.001,7.0002], [edge, building], 18)).toBeNull()
    expect(nearestRoadEdge([125.0005,7], [edge], 13)).toBeNull()
  })
  it('does not guess between edges at a shared junction', () => {
    const branch = { properties: { segment_uid: 'b' }, geometry: { type: 'LineString', coordinates: [[125.001,7],[125.001,7.001]] } }
    expect(nearestRoadEdge([125.001,7], [edge, branch], 18)).toBeNull()
  })
})

globalThis.IS_REACT_ACT_ENVIRONMENT = true
async function mount(element) {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(element))
  return async () => { await act(async () => root.unmount()); host.remove() }
}
it('retains the confirmation after a failed save and permits a retry', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({})
  const close = vi.fn()
  const unmount = await mount(<ConstraintEdgeSaveDialog constraintType="narrow_road" edgeCount={2} onSave={save} onCancel={close} />)
  try {
    expect(document.querySelector('[role="dialog"]').textContent).toContain('2 edges')
    await act(async () => document.querySelector('button[type="submit"]').click())
    expect(document.querySelector('[role="alert"]').textContent).toContain('Connection lost')
    expect(close).not.toHaveBeenCalled()
    await act(async () => document.querySelector('button[type="submit"]').click())
    expect(save).toHaveBeenCalledTimes(2)
  } finally { await unmount() }
})
it('locks constraint types until completion and lists recent stored edges for focus', async () => {
  const select = vi.fn()
  const row = { key:'custom:1', name:'Saved edge', type:'narrow_road', source:'Saved road constraint', location:'Barangay', center:[125,7], color:'orange', drawing:{id:1, segment_uids:['edge-v1-a'],created_at:'2026-10-23T00:00:00Z'} }
  const unmount = await mount(<ConstraintLayersPanel rows={[row]} hidden={new Set()} selectionType="narrow_road" edgeCount={1} roadsReady onSelect={select} />)
  try {
    const buttons = [...document.querySelectorAll('button')]
    expect(buttons.find(b=>b.textContent==='Traffic congestion').disabled).toBe(true)
    await act(async () => buttons.find(b=>b.textContent==='Recently saved edges').click())
    await act(async () => document.querySelector('.constraint-layer-select').click())
    expect(select).toHaveBeenCalledWith(row)
    expect(document.body.textContent).not.toContain('Admin drawing')
  } finally { await unmount() }
})
