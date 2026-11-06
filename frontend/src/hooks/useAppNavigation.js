import { useEffect, useSyncExternalStore } from 'react'
import { backInApp, currentAppPath, navigateApp, parseAppPath, resolveAppPath, subscribeToNavigation } from '../utils/appNavigation'

export default function useAppNavigation(authenticated) {
  const currentPath = useSyncExternalStore(subscribeToNavigation, currentAppPath)
  const path = resolveAppPath(currentPath, authenticated)
  useEffect(() => {
    if (currentPath !== path) navigateApp(path, { replace: true })
  }, [currentPath, path])
  return { page: parseAppPath(path), navigate: navigateApp, back: backInApp }
}
