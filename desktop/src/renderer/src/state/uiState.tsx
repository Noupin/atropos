import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { FC, PropsWithChildren } from 'react'

const UI_STATE_STORAGE_KEY = 'atropos:uiState'

type LibraryUiState = {
  expandedAccountIds: string[]
  expandedProjectIds: string[]
  selectedClipId: string | null
  pageCounts: Record<string, number>
  scrollTop: number
  activeAccountId: string | null
  pageSize: number
  accountScrollPositions: Record<string, number>
}

export type UiState = {
  activeTab: string
  activeAccountId: string | null
  library: LibraryUiState
}

const createDefaultLibraryState = (): LibraryUiState => ({
  expandedAccountIds: [],
  expandedProjectIds: [],
  selectedClipId: null,
  pageCounts: {},
  scrollTop: 0,
  activeAccountId: null,
  pageSize: 20,
  accountScrollPositions: {}
})

const DEFAULT_UI_STATE: UiState = {
  activeTab: '/',
  activeAccountId: null,
  library: createDefaultLibraryState()
}

const readStoredUiState = (): UiState => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return DEFAULT_UI_STATE
  }

  try {
    const raw = window.localStorage.getItem(UI_STATE_STORAGE_KEY)
    if (!raw) {
      return DEFAULT_UI_STATE
    }

    const parsed = JSON.parse(raw) as Partial<UiState> | null
    if (!parsed || typeof parsed !== 'object') {
      return DEFAULT_UI_STATE
    }

    const library: Partial<LibraryUiState> = typeof parsed.library === 'object' && parsed.library
      ? parsed.library
      : {}

    const expandedAccountIds = Array.isArray(library.expandedAccountIds)
      ? library.expandedAccountIds.filter((value): value is string => typeof value === 'string')
      : []
    const expandedProjectIds = Array.isArray(library.expandedProjectIds)
      ? library.expandedProjectIds.filter((value): value is string => typeof value === 'string')
      : []
    const pageCounts = library.pageCounts && typeof library.pageCounts === 'object'
      ? Object.fromEntries(
          Object.entries(library.pageCounts).map(([key, value]) => [
            key,
            typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
          ])
        )
      : {}
    const accountScrollPositions = library.accountScrollPositions && typeof library.accountScrollPositions === 'object'
      ? Object.fromEntries(
          Object.entries(library.accountScrollPositions).map(([key, value]) => [
            key,
            typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
          ])
        )
      : {}

    const baseLibrary = createDefaultLibraryState()
    return {
      activeTab: typeof parsed.activeTab === 'string' ? parsed.activeTab : DEFAULT_UI_STATE.activeTab,
      activeAccountId:
        typeof parsed.activeAccountId === 'string' ? parsed.activeAccountId : DEFAULT_UI_STATE.activeAccountId,
      library: {
        ...baseLibrary,
        expandedAccountIds,
        expandedProjectIds,
        selectedClipId:
          typeof library.selectedClipId === 'string' ? library.selectedClipId : DEFAULT_UI_STATE.library.selectedClipId,
        pageCounts,
        scrollTop:
          typeof library.scrollTop === 'number' && Number.isFinite(library.scrollTop) && library.scrollTop >= 0
            ? library.scrollTop
            : DEFAULT_UI_STATE.library.scrollTop,
        activeAccountId:
          typeof library.activeAccountId === 'string'
            ? library.activeAccountId
            : DEFAULT_UI_STATE.library.activeAccountId,
        pageSize:
          typeof library.pageSize === 'number' && Number.isFinite(library.pageSize) && library.pageSize > 0
            ? Math.min(Math.max(Math.floor(library.pageSize), 1), 100)
            : DEFAULT_UI_STATE.library.pageSize,
        accountScrollPositions
      }
    }
  } catch (error) {
    console.warn('Unable to read stored UI state.', error)
    return DEFAULT_UI_STATE
  }
}

const persistUiState = (state: UiState): void => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return
  }

  try {
    window.localStorage.setItem(UI_STATE_STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.warn('Unable to persist UI state.', error)
  }
}

type UiStateContextValue = {
  state: UiState
  updateState: (updater: (previous: UiState) => UiState) => void
}

const UiStateContext = createContext<UiStateContextValue | null>(null)

export const UiStateProvider: FC<PropsWithChildren> = ({ children }) => {
  const [state, setState] = useState<UiState>(() => readStoredUiState())
  const stateRef = useRef(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const updateState = useCallback((updater: (previous: UiState) => UiState) => {
    setState((previous) => {
      const next = updater(previous)
      if (next === previous) {
        return previous
      }
      persistUiState(next)
      return next
    })
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const handleBeforeUnload = () => {
      persistUiState(stateRef.current)
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const value = useMemo<UiStateContextValue>(
    () => ({
      state,
      updateState
    }),
    [state, updateState]
  )

  return <UiStateContext.Provider value={value}>{children}</UiStateContext.Provider>
}

export const useUiState = (): UiStateContextValue => {
  const context = useContext(UiStateContext)
  if (!context) {
    throw new Error('useUiState must be used within a UiStateProvider')
  }
  return context
}

export const useLibraryUiState = () => {
  const { state, updateState } = useUiState()

  const updateLibrary = useCallback(
    (updater: (prev: LibraryUiState) => LibraryUiState) => {
      updateState((previous) => {
        const previousLibrary = previous.library ?? createDefaultLibraryState()
        const nextLibrary = updater(previousLibrary)
        if (nextLibrary === previous.library) {
          return previous
        }
        return { ...previous, library: nextLibrary }
      })
    },
    [updateState]
  )

  const libraryState = useMemo(
    () => state.library ?? createDefaultLibraryState(),
    [state.library]
  )

  return { libraryState, updateLibrary }
}

export const resetUiState = (): void => {
  persistUiState(DEFAULT_UI_STATE)
}

export default UiStateContext
