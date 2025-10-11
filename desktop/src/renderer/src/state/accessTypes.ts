import type {
  AccessStatusPayload,
  SubscriptionInfoPayload,
  TrialStatusPayload
} from '../services/licensing'

export type PendingConsumptionStage = 'in_progress' | 'finalizing' | null

export type AccessTrialState = {
  totalRuns: number | null
  remainingRuns: number | null
  startedAt: string | null
}

export type AccessState = {
  deviceHash: string | null
  subscription: SubscriptionInfoPayload | null
  trial: AccessTrialState
  access: AccessStatusPayload['access'] | null
  isSubscriptionActive: boolean
  isTrialActive: boolean
  isAccessActive: boolean
  isOffline: boolean
  isOfflineLocked: boolean
  offlineExpiresAt: string | null
  offlineRemainingMs: number | null
  offlineLastVerifiedAt: string | null
  isLoading: boolean
  lastError: string | null
  pendingConsumption: boolean
  pendingConsumptionStage: PendingConsumptionStage
}

export type AccessContextValue = {
  state: AccessState
  deviceHash: string | null
  refresh: () => Promise<void>
  markTrialRunPending: () => void
  finalizeTrialRun: (options: { succeeded: boolean }) => Promise<void>
}

export const DEFAULT_TRIAL_RUNS = 3

export const INITIAL_STATE: AccessState = {
  deviceHash: null,
  subscription: null,
  trial: {
    totalRuns: null,
    remainingRuns: null,
    startedAt: null
  },
  access: null,
  isSubscriptionActive: false,
  isTrialActive: false,
  isAccessActive: false,
  isOffline: false,
  isOfflineLocked: false,
  offlineExpiresAt: null,
  offlineRemainingMs: null,
  offlineLastVerifiedAt: null,
  isLoading: true,
  lastError: null,
  pendingConsumption: false,
  pendingConsumptionStage: null
}

export const deriveTrialState = (trial: TrialStatusPayload | null): AccessTrialState => {
  if (!trial) {
    return {
      totalRuns: null,
      remainingRuns: null,
      startedAt: null
    }
  }
  return {
    totalRuns: trial.totalRuns,
    remainingRuns: trial.remainingRuns,
    startedAt: trial.startedAt ?? null
  }
}

export const isSubscriptionActive = (subscription: SubscriptionInfoPayload | null): boolean =>
  Boolean(subscription && (subscription.status === 'active' || subscription.status === 'trialing'))

export const isTrialAccessActive = (
  access: AccessStatusPayload['access'] | null,
  trial: AccessTrialState
): boolean => {
  if (!access || access.source !== 'trial') {
    return false
  }
  const remaining = trial.remainingRuns ?? 0
  return access.isActive && remaining > 0
}
