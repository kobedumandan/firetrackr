// Position the existing Leaflet DOM so React popup actions keep their handlers.
export function attachProjectedPopup(leaflet, project, enabled = () => true) {
  let popup
  let source
  let observer
  let frame = null
  let disposed = false
  function update() {
    if (!enabled()) return
    const element = popup?.getElement?.()
    if (!element) return
    const point = project(popup)
    if (!point) {
      if (element.style.visibility !== 'hidden') element.style.visibility = 'hidden'
      return
    }
    if (element.style.visibility !== 'visible') element.style.visibility = 'visible'
    // Avoid creating another mutation when the projection is already correct.
    for (const [property, value] of [['left', `${point.x}px`], ['top', `${point.y - 18}px`]]) {
      if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== 'important') {
        element.style.setProperty(property, value, 'important')
      }
    }
  }
  // Leaflet/React can rewrite popup coordinates while moving a marker or
  // updating its content. Reproject after those updates, keeping the same card.
  function schedule() {
    if (disposed || !popup || frame !== null || !enabled()) return
    frame = requestAnimationFrame(() => { frame = null; update() })
  }
  function detach() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    observer?.disconnect()
    observer = null
    source?.off?.('move', schedule)
    popup?.off?.('contentupdate', schedule)
    source = null
  }
  const open = event => {
    detach()
    popup = event.popup
    source = popup?._source
    source?.on?.('move', schedule)
    popup?.on?.('contentupdate', schedule)
    const element = popup?.getElement?.()
    if (element && typeof MutationObserver !== 'undefined') {
      // Leaflet also rewrites positioning on unchanged-content route refreshes.
      // update() is idempotent so observing style changes cannot keep scheduling.
      observer = new MutationObserver(schedule)
      observer.observe(element, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['style'] })
    }
    update()
    schedule()
  }
  const close = event => {
    if (event.popup && event.popup !== popup) return
    detach()
    popup = null
  }
  leaflet.on('popupopen', open).on('popupclose', close)
  return { update, dispose() {
    disposed = true
    detach()
    popup = null
    leaflet.off('popupopen', open).off('popupclose', close)
  } }
}
