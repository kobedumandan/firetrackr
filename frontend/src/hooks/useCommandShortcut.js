import { useEffect } from 'react'

export const COMMAND_SHORTCUT = 'Alt+C'

export default function useCommandShortcut(onNavigate, enabled) {
  useEffect(() => {
    if (!enabled) return
    const onKey = event => {
      if (event.defaultPrevented || event.repeat || event.isComposing ||
          !event.altKey || event.shiftKey || event.ctrlKey || event.metaKey ||
          event.key.toLowerCase() !== 'c') return
      const target = event.target
      if (target?.isContentEditable || target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') ||
          document.querySelector('dialog[open], [aria-modal="true"]')) return
      event.preventDefault()
      onNavigate('Command')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, onNavigate])
}
