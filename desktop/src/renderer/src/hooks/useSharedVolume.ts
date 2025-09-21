import { useCallback, useSyncExternalStore } from 'react'

export type SharedVolumeState = {
  volume: number
  muted: boolean
}

const STORAGE_KEY = 'atropos:sharedVolume'

const clampVolume = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 1
  }
  if (value <= 0) {
    return 0
  }
  if (value >= 1) {
    return 1
  }
  return value
}

const readStoredState = (): SharedVolumeState | null => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Partial<SharedVolumeState>
    if (typeof parsed !== 'object' || parsed === null) {
      return null
    }
    const volume = clampVolume(parsed.volume ?? 1)
    const muted = Boolean(parsed.muted)
    return { volume, muted }
  } catch (error) {
    console.warn('Failed to read stored volume state', error)
    return null
  }
}

const listeners = new Set<(state: SharedVolumeState) => void>()

let currentState: SharedVolumeState = readStoredState() ?? { volume: 1, muted: false }

const persistState = (state: SharedVolumeState): void => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    console.warn('Failed to persist volume state', error)
  }
}

const notify = (): void => {
  for (const listener of listeners) {
    listener(currentState)
  }
}

const subscribe = (listener: (state: SharedVolumeState) => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): SharedVolumeState => currentState
const getServerSnapshot = (): SharedVolumeState => currentState

const setSharedVolumeState = (
  update: SharedVolumeState | ((state: SharedVolumeState) => SharedVolumeState)
): void => {
  const nextState = typeof update === 'function' ? update(currentState) : update
  const normalized: SharedVolumeState = {
    volume: clampVolume(nextState.volume),
    muted: Boolean(nextState.muted)
  }

  if (
    normalized.volume === currentState.volume &&
    normalized.muted === currentState.muted
  ) {
    return
  }

  currentState = normalized
  persistState(currentState)
  notify()
}

const useSharedVolume = (): [SharedVolumeState, typeof setSharedVolumeState] => {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const setState = useCallback(
    (update: SharedVolumeState | ((state: SharedVolumeState) => SharedVolumeState)) => {
      setSharedVolumeState(update)
    },
    []
  )

  return [state, setState]
}

export { useSharedVolume }
export default useSharedVolume
