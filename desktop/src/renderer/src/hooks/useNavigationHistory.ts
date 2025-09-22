import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'

type NavigationDirection = 'back' | 'forward'

type HistoryEntry = {
  key: string
  path: string
  state: unknown
}

type HistoryState = {
  entries: HistoryEntry[]
  index: number
}

const createHistoryEntry = (location: Location): HistoryEntry => ({
  key: location.key,
  path: `${location.pathname}${location.search}${location.hash}`,
  state: location.state
})

const mapDirectionToHandler = (
  direction: NavigationDirection,
  handlers: Record<NavigationDirection, () => void>
): (() => void) | null => {
  return handlers[direction] ?? null
}

const useNavigationHistory = (): void => {
  const location = useLocation()
  const navigate = useNavigate()

  const historyRef = useRef<HistoryState>({
    entries: [createHistoryEntry(location)],
    index: 0
  })
  const pendingIndexRef = useRef<number | null>(null)

  const updateNavigationState = useCallback(() => {
    const history = historyRef.current
    window.api?.updateNavigationState({
      canGoBack: history.index > 0,
      canGoForward: history.index < history.entries.length - 1
    })
  }, [])

  const goToIndex = useCallback(
    (nextIndex: number) => {
      const history = historyRef.current
      const target = history.entries[nextIndex]

      if (!target) {
        return
      }

      pendingIndexRef.current = nextIndex
      navigate(target.path, { replace: true, state: target.state })
    },
    [navigate]
  )

  const goBack = useCallback(() => {
    const history = historyRef.current
    if (history.index === 0) {
      return
    }
    goToIndex(history.index - 1)
  }, [goToIndex])

  const goForward = useCallback(() => {
    const history = historyRef.current
    if (history.index >= history.entries.length - 1) {
      return
    }
    goToIndex(history.index + 1)
  }, [goToIndex])

  const navigationHandlers = useMemo(
    () => ({
      back: goBack,
      forward: goForward
    }),
    [goBack, goForward]
  )

  useEffect(() => {
    const entry = createHistoryEntry(location)
    const history = historyRef.current

    if (pendingIndexRef.current !== null) {
      const nextIndex = pendingIndexRef.current
      history.index = nextIndex
      history.entries[nextIndex] = entry
      pendingIndexRef.current = null
    } else {
      const currentEntry = history.entries[history.index]
      if (!currentEntry || currentEntry.key !== entry.key) {
        const nextEntries = history.entries.slice(0, history.index + 1)
        nextEntries.push(entry)
        historyRef.current = {
          entries: nextEntries,
          index: nextEntries.length - 1
        }
      } else {
        history.entries[history.index] = entry
      }
    }

    updateNavigationState()
  }, [location, updateNavigationState])

  useEffect(() => {
    updateNavigationState()
  }, [updateNavigationState])

  useEffect(() => {
    const unsubscribe = window.api?.onNavigationCommand((direction) => {
      const handler = mapDirectionToHandler(direction, navigationHandlers)
      handler?.()
    })

    return () => {
      unsubscribe?.()
    }
  }, [navigationHandlers])
}

export default useNavigationHistory
