export default function PanelToggleIcon({ expanded = false }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960"
      className={expanded ? 'minimize_icon' : 'maximize_icon'} fill="currentColor" aria-hidden="true">
      <path d={expanded
        ? 'M440-440v240h-80v-160H200v-80h240Zm160-320v160h160v80H520v-240h80Z'
        : 'M200-200v-240h80v160h160v80H200Zm480-320v-160H520v-80h240v240h-80Z'} />
    </svg>
  )
}
