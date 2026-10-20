// Position the existing Leaflet DOM so React popup actions keep their handlers.
export function attachProjectedPopup(leaflet, project, enabled = () => true) {
  let popup
  function update() {
    if (!enabled()) return
    const element = popup?.getElement?.()
    if (!element) return
    const point = project(popup)
    if (!point) { element.style.visibility = 'hidden'; return }
    element.style.visibility = 'visible'
    element.style.setProperty('left', `${point.x}px`, 'important')
    element.style.setProperty('top', `${point.y - 18}px`, 'important')
  }
  const open = event => { popup = event.popup; update() }
  const close = () => { popup = null }
  leaflet.on('popupopen', open).on('popupclose', close)
  return { update, dispose() { leaflet.off('popupopen', open).off('popupclose', close) } }
}
