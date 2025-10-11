import { PendingConsumptionStage } from './accessTypes'

const PENDING_CONSUMPTION_STORAGE_KEY = 'trialAccess.pendingConsumption'
const LAST_VERIFIED_AT_STORAGE_KEY = 'trialAccess.lastVerifiedAt'

export type StoredPendingConsumption = {
  deviceHash: string
  stage: Exclude<PendingConsumptionStage, null>
}

export const readStoredPendingConsumption = (): StoredPendingConsumption | null => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(PENDING_CONSUMPTION_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') {
      return null
    }
    const deviceHash = typeof (parsed as { deviceHash?: unknown }).deviceHash === 'string'
      ? (parsed as { deviceHash: string }).deviceHash
      : null
    const stageValue = (parsed as { stage?: unknown }).stage
    const stage = stageValue === 'finalizing' || stageValue === 'in_progress' ? stageValue : null
    if (!deviceHash || !stage) {
      return null
    }
    return { deviceHash, stage }
  } catch (error) {
    console.warn('Unable to read stored pending access state.', error)
    return null
  }
}

export const writeStoredPendingConsumption = (value: StoredPendingConsumption): void => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return
  }
  try {
    window.localStorage.setItem(PENDING_CONSUMPTION_STORAGE_KEY, JSON.stringify(value))
  } catch (error) {
    console.warn('Unable to persist pending access state.', error)
  }
}

export const clearStoredPendingConsumption = (): void => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return
  }
  try {
    window.localStorage.removeItem(PENDING_CONSUMPTION_STORAGE_KEY)
  } catch (error) {
    console.warn('Unable to clear pending access state.', error)
  }
}

export const readLastVerifiedAt = (): number | null => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return null
  }
  try {
    const raw = window.localStorage.getItem(LAST_VERIFIED_AT_STORAGE_KEY)
    if (!raw) {
      return null
    }
    const value = Number.parseInt(raw, 10)
    if (Number.isNaN(value) || value <= 0) {
      return null
    }
    return value
  } catch (error) {
    console.warn('Unable to read last verified timestamp.', error)
    return null
  }
}

export const writeLastVerifiedAt = (timestampMs: number): void => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return
  }
  try {
    window.localStorage.setItem(LAST_VERIFIED_AT_STORAGE_KEY, `${timestampMs}`)
  } catch (error) {
    console.warn('Unable to persist last verified timestamp.', error)
  }
}
