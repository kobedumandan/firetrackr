import { useEffect, useId, useRef, useState } from 'react'
import AnalysisIcon from './AnalysisIcon'

function DispatchChoice({ dispatch }) {
  return <span className="rar-dispatch-choice">
    <span className="rar-picker-id">DISP-{dispatch.dispatch_id}</span>
    <span className="rar-picker-pipe" aria-hidden="true">|</span>
    <span className="rar-picker-team">{dispatch.team || 'Unknown team'}</span>
  </span>
}

export default function DispatchPicker({ dispatches, value, onChange }) {
  const listId = useId()
  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const searchRef = useRef({ text: '', at: 0 })
  const [menu, setMenu] = useState(null)
  const selectedIndex = Math.max(0, dispatches.findIndex(dispatch => dispatch.dispatch_id === value))
  const selected = dispatches[selectedIndex]
  const activeIndex = menu ? Math.max(0, dispatches.findIndex(dispatch => dispatch.dispatch_id === menu.activeId)) : selectedIndex
  const activeId = dispatches[activeIndex]?.dispatch_id
  const open = menu != null

  useEffect(() => {
    if (!open) return
    const outside = event => { if (!rootRef.current?.contains(event.target)) setMenu(null) }
    const resize = () => setMenu(null)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', resize)
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize) }
  }, [open])
  useEffect(() => {
    if (open) document.getElementById(`${listId}-option-${activeId}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, activeId, listId])

  function show(index = selectedIndex) {
    if (!dispatches.length) return
    const rect = triggerRef.current.getBoundingClientRect()
    const frame = rootRef.current.closest('.dl-body')?.getBoundingClientRect()
    const below = Math.min(window.innerHeight, frame?.bottom ?? window.innerHeight) - rect.bottom - 8
    const above = rect.top - Math.max(0, frame?.top ?? 0) - 8
    const height = Math.min(248, dispatches.length * 36 + 10)
    const up = below < height && above > below
    setMenu({ activeId: dispatches[index].dispatch_id, up, maxHeight: Math.max(80, Math.min(248, up ? above : below)) })
  }
  function highlight(index) {
    if (open) setMenu(previous => ({ ...previous, activeId: dispatches[index].dispatch_id }))
    else show(index)
  }
  function choose(index) {
    const next = dispatches[index]
    setMenu(null)
    searchRef.current = { text: '', at: 0 }
    if (next && next.dispatch_id !== value) onChange(next.dispatch_id)
  }
  function keyDown(event) {
    if (!dispatches.length || event.ctrlKey || event.metaKey) return
    const key = event.key
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
      event.preventDefault()
      const next = key === 'Home' ? 0 : key === 'End' ? dispatches.length - 1
        : !open ? selectedIndex : (activeIndex + (key === 'ArrowDown' ? 1 : -1) + dispatches.length) % dispatches.length
      highlight(next)
    } else if (key === 'Enter' || key === ' ') {
      event.preventDefault()
      if (open) choose(activeIndex)
      else show()
    } else if (key === 'Escape' && open) {
      event.preventDefault(); event.stopPropagation(); searchRef.current = { text: '', at: 0 }; setMenu(null)
    } else if (key === 'Tab' && open) {
      choose(activeIndex)
    } else if (key.length === 1 && !event.altKey) {
      event.preventDefault()
      const at = Date.now()
      const text = (at - searchRef.current.at < 700 ? searchRef.current.text : '') + key.toLowerCase()
      searchRef.current = { text, at }
      const query = [...text].every(character => character === text[0]) ? text[0] : text
      const indices = dispatches.map((_, index) => (activeIndex + index + 1) % dispatches.length)
      const match = indices.find(index => {
        const dispatch = dispatches[index]
        return [dispatch.team || 'Unknown team', `DISP-${dispatch.dispatch_id}`, String(dispatch.dispatch_id)].some(label => label.toLowerCase().startsWith(query))
      })
      if (match != null) highlight(match)
    }
  }

  if (!selected) return null
  return <div ref={rootRef} className="rar-dispatch-field" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null) }}>
    <button ref={triggerRef} type="button" className="rar-dispatch-trigger" role="combobox" value={selected.dispatch_id} aria-label="Responding dispatch" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open ? `${listId}-option-${activeId}` : undefined} title={`DISP-${selected.dispatch_id} | ${selected.team || 'Unknown team'}`} onClick={() => { searchRef.current = { text: '', at: 0 }; if (open) setMenu(null); else show() }} onKeyDown={keyDown}>
      <DispatchChoice dispatch={selected} /><AnalysisIcon name="chevron" className="rar-picker-chevron" />
    </button>
    {open && <div id={listId} className="rar-dispatch-menu" role="listbox" aria-label="Responding dispatch" data-side={menu.up ? 'top' : 'bottom'} style={{ maxHeight: menu.maxHeight }} onPointerDown={event => event.preventDefault()}>
      {dispatches.map((dispatch, index) => <div key={dispatch.dispatch_id} id={`${listId}-option-${dispatch.dispatch_id}`} role="option" aria-label={`DISP-${dispatch.dispatch_id} | ${dispatch.team || 'Unknown team'}`} title={`DISP-${dispatch.dispatch_id} | ${dispatch.team || 'Unknown team'}`} aria-selected={dispatch.dispatch_id === value} data-dispatch-id={dispatch.dispatch_id} data-active={dispatch.dispatch_id === activeId} className="rar-dispatch-option" onPointerEnter={() => setMenu(previous => previous && previous.activeId !== dispatch.dispatch_id ? { ...previous, activeId: dispatch.dispatch_id } : previous)} onClick={() => { choose(index); triggerRef.current?.focus({ preventScroll: true }) }}>
        <DispatchChoice dispatch={dispatch} />{dispatch.dispatch_id === value && <AnalysisIcon name="acknowledgement" className="rar-picker-check" />}
      </div>)}
    </div>}
  </div>
}
