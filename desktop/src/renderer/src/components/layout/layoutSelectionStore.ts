import { useCallback, useSyncExternalStore } from 'react'

import type { LayoutCanvasSelection } from './LayoutCanvas'

type Listener = () => void

let selection: LayoutCanvasSelection = []
const listeners = new Set<Listener>()

const arraysEqual = (a: LayoutCanvasSelection, b: LayoutCanvasSelection): boolean => {
  if (a === b) {
    return true
  }
  if (a.length !== b.length) {
    return false
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }
  return true
}

const getSnapshot = (): LayoutCanvasSelection => selection

const emit = (): void => {
  listeners.forEach((listener) => {
    listener()
  })
}

const setInternalSelection = (next: LayoutCanvasSelection): void => {
  if (arraysEqual(selection, next)) {
    return
  }
  selection = [...next]
  emit()
}

const updateInternalSelection = (
  updater: LayoutCanvasSelection | ((current: LayoutCanvasSelection) => LayoutCanvasSelection)
): void => {
  const next = typeof updater === 'function' ? (updater as (current: LayoutCanvasSelection) => LayoutCanvasSelection)(selection) : updater
  setInternalSelection(next)
}

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useLayoutSelection = (): [LayoutCanvasSelection, (selection: LayoutCanvasSelection | ((current: LayoutCanvasSelection) => LayoutCanvasSelection)) => void] => {
  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const setSelection = useCallback(
    (
      updater: LayoutCanvasSelection | ((current: LayoutCanvasSelection) => LayoutCanvasSelection)
    ) => {
      updateInternalSelection(updater)
    },
    []
  )
  return [value, setSelection]
}

export const resetLayoutSelection = (): void => {
  setInternalSelection([])
}

