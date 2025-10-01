import { useSyncExternalStore } from 'react'
import { accessStore, type AccessSnapshot } from '../../../lib/accessStore'

const subscribe = (listener: (snapshot: AccessSnapshot) => void): (() => void) =>
  accessStore.subscribe(listener)

const getSnapshot = (): AccessSnapshot => accessStore.getSnapshot()

export const useAccess = (): AccessSnapshot => {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
