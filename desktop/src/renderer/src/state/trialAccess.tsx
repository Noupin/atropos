import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactNode } from 'react'
import { getOrCreateDeviceHash } from '../services/device'
import {
  LicensingOfflineError,
  LicensingRequestError,
  TrialExhaustedError,
  consumeTrial,
  createSubscriptionCheckoutSession,
  createSubscriptionPortalSession,
  fetchAccessStatus,
  startTrial,
  type AccessStatusPayload,
  type SubscriptionCheckoutSession,
  type SubscriptionPortalSession,
  type SubscriptionStatusPayload
} from '../services/licensing'

export type PendingConsumptionStage = 'in_progress' | 'finalizing' | null

export type TrialAccessState = {
  totalRuns: number | null
  remainingRuns: number | null
  isTrialAvailable: boolean
  hasActiveSubscription: boolean
  isAccessGranted: boolean
  accessSource: 'subscription' | 'trial' | 'none'
  subscription: SubscriptionStatusPayload | null
  isOffline: boolean
  isLoading: boolean
  lastError: string | null
  pendingConsumption: boolean
  pendingConsumptionStage: PendingConsumptionStage
}

export const DEFAULT_TRIAL_RUNS = 3

const PENDING_CONSUMPTION_STORAGE_KEY = 'trialAccess.pendingConsumption'

type StoredPendingConsumption = {
  deviceHash: string
  stage: PendingConsumptionStage
}

const readStoredPendingConsumption = (): StoredPendingConsumption | null => {
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
    const deviceHash = typeof parsed.deviceHash === 'string' ? parsed.deviceHash : null
    const stageValue =
      parsed.stage === 'finalizing'
        ? 'finalizing'
        : parsed.stage === 'in_progress'
          ? 'in_progress'
          : null
    if (!deviceHash || stageValue === null) {
      return null
    }
    return { deviceHash, stage: stageValue }
  } catch (error) {
    console.warn('Unable to read stored pending trial consumption state.', error)
    return null
  }
}

const writeStoredPendingConsumption = (value: StoredPendingConsumption): void => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return
  }
  try {
    window.localStorage.setItem(PENDING_CONSUMPTION_STORAGE_KEY, JSON.stringify(value))
  } catch (error) {
    console.warn('Unable to persist pending trial consumption state.', error)
  }
}

const clearStoredPendingConsumption = (): void => {
  if (typeof window === 'undefined' || !('localStorage' in window)) {
    return
  }
  try {
    window.localStorage.removeItem(PENDING_CONSUMPTION_STORAGE_KEY)
  } catch (error) {
    console.warn('Unable to clear pending trial consumption state.', error)
  }
}

const INITIAL_STATE: TrialAccessState = {
  totalRuns: null,
  remainingRuns: null,
  isTrialAvailable: false,
  hasActiveSubscription: false,
  isAccessGranted: false,
  accessSource: 'none',
  subscription: null,
  isOffline: false,
  isLoading: true,
  lastError: null,
  pendingConsumption: false,
  pendingConsumptionStage: null
}

type TrialAccessContextValue = {
  state: TrialAccessState
  refresh: () => Promise<void>
  markTrialRunPending: () => void
  finalizeTrialRun: (options: { succeeded: boolean }) => Promise<void>
  initiateSubscription: () => Promise<SubscriptionCheckoutSession>
  openSubscriptionPortal: () => Promise<SubscriptionPortalSession>
}

const TrialAccessContext = createContext<TrialAccessContextValue | undefined>(undefined)

const mapStatusToState = (
  status: AccessStatusPayload,
  previous: TrialAccessState,
  overrides?: Partial<TrialAccessState>
): TrialAccessState => {
  const subscription = status.subscription ?? null
  const hasActiveSubscription = Boolean(
    subscription && (subscription.status === 'active' || subscription.status === 'trialing')
  )
  const totalRuns = status.trial?.totalRuns ?? null
  const remainingRuns = status.trial?.remainingRuns ?? null
  const isTrialAvailable = Boolean(status.trial && status.trial.remainingRuns > 0)
  const pendingConsumption = hasActiveSubscription
    ? false
    : overrides?.pendingConsumption ?? previous.pendingConsumption
  const pendingConsumptionStage = hasActiveSubscription
    ? null
    : overrides?.pendingConsumptionStage ?? previous.pendingConsumptionStage

  return {
    totalRuns,
    remainingRuns,
    isTrialAvailable,
    hasActiveSubscription,
    isAccessGranted: status.accessGranted,
    accessSource: status.accessSource,
    subscription,
    isOffline: overrides?.isOffline ?? false,
    isLoading: overrides?.isLoading ?? false,
    lastError: overrides?.lastError ?? null,
    pendingConsumption,
    pendingConsumptionStage
  }
}

export const TrialAccessProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [state, setState] = useState<TrialAccessState>(INITIAL_STATE)
  const [deviceHash, setDeviceHash] = useState<string | null>(null)
  const hasRecoveredPendingRef = useRef(false)
  const stateRef = useRef<TrialAccessState>(INITIAL_STATE)
  const subscriptionPollHandleRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const subscriptionPollAttemptsRef = useRef(0)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const stopSubscriptionPolling = useCallback(() => {
    if (subscriptionPollHandleRef.current !== null) {
      clearTimeout(subscriptionPollHandleRef.current)
      subscriptionPollHandleRef.current = null
    }
    subscriptionPollAttemptsRef.current = 0
  }, [])

  useEffect(() => {
    if (state.hasActiveSubscription) {
      stopSubscriptionPolling()
    }
  }, [state.hasActiveSubscription, stopSubscriptionPolling])

  const applyStatus = useCallback(
    (status: AccessStatusPayload, overrides?: Partial<TrialAccessState>) => {
      setState((prev) => mapStatusToState(status, prev, overrides))
    },
    []
  )

  const markOffline = useCallback((message?: string) => {
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isOffline: true,
      isAccessGranted: false,
      hasActiveSubscription: false,
      isTrialAvailable: false,
      lastError: message ?? 'Licensing service is unreachable.',
      pendingConsumption: prev.pendingConsumption,
      pendingConsumptionStage: prev.pendingConsumptionStage
    }))
  }, [])

  const markFailure = useCallback((message: string) => {
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isOffline: false,
      lastError: message,
      pendingConsumption: prev.pendingConsumption,
      pendingConsumptionStage: prev.pendingConsumptionStage
    }))
  }, [])

  const loadStatus = useCallback(
    async (hash: string) => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        lastError: null,
        isOffline: false,
        pendingConsumption: prev.pendingConsumption,
        pendingConsumptionStage: prev.pendingConsumptionStage
      }))
      try {
        const status = (await fetchAccessStatus(hash)) ?? (await startTrial(hash))
        applyStatus(status)
      } catch (error) {
        if (error instanceof LicensingOfflineError) {
          markOffline(error.message)
          return
        }
        if (error instanceof LicensingRequestError) {
          markFailure(error.message)
          return
        }
        console.error('Unexpected licensing error while loading status.', error)
        markFailure('Unexpected licensing error.')
      }
    },
    [applyStatus, markFailure, markOffline]
  )

  useEffect(() => {
    try {
      const hash = getOrCreateDeviceHash()
      setDeviceHash(hash)
      void loadStatus(hash)
    } catch (error) {
      console.error('Unable to initialise device hash.', error)
      markFailure('Unable to initialise device identity.')
    }
  }, [loadStatus, markFailure])

  const refresh = useCallback(async () => {
    if (!deviceHash) {
      return
    }
    await loadStatus(deviceHash)
  }, [deviceHash, loadStatus])

  const scheduleSubscriptionPoll = useCallback(() => {
    if (subscriptionPollHandleRef.current !== null) {
      return
    }
    const poll = async (): Promise<void> => {
      subscriptionPollHandleRef.current = null
      subscriptionPollAttemptsRef.current += 1
      try {
        await refresh()
      } finally {
        if (
          !stateRef.current.hasActiveSubscription &&
          subscriptionPollAttemptsRef.current < 60
        ) {
          subscriptionPollHandleRef.current = window.setTimeout(poll, 5000)
        } else {
          subscriptionPollHandleRef.current = null
        }
      }
    }
    subscriptionPollHandleRef.current = window.setTimeout(poll, 5000)
  }, [refresh])

  useEffect(() => () => stopSubscriptionPolling(), [stopSubscriptionPolling])

  const markTrialRunPending = useCallback(() => {
    setState((prev) => {
      if (prev.hasActiveSubscription || !prev.isTrialAvailable) {
        return {
          ...prev,
          pendingConsumption: false,
          pendingConsumptionStage: null,
          lastError: null,
          isOffline: false
        }
      }
      return {
        ...prev,
        pendingConsumption: true,
        pendingConsumptionStage:
          prev.pendingConsumptionStage === 'finalizing' ? prev.pendingConsumptionStage : 'in_progress',
        lastError: null,
        isOffline: false
      }
    })
  }, [])

  const consumePendingTrialRun = useCallback(async () => {
    const current = stateRef.current
    if (!deviceHash || current.hasActiveSubscription || !current.isTrialAvailable) {
      setState((prev) => ({
        ...prev,
        pendingConsumption: false,
        pendingConsumptionStage: null
      }))
      clearStoredPendingConsumption()
      return
    }

    try {
      const status = await consumeTrial(deviceHash)
      applyStatus(status, { pendingConsumption: false, pendingConsumptionStage: null })
      clearStoredPendingConsumption()
    } catch (error) {
      if (error instanceof LicensingOfflineError) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isOffline: true,
          lastError: error.message,
          pendingConsumption: true,
          pendingConsumptionStage: 'finalizing'
        }))
        writeStoredPendingConsumption({ deviceHash, stage: 'finalizing' })
        return
      }
      if (error instanceof TrialExhaustedError) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isOffline: false,
          isTrialAvailable: false,
          remainingRuns: 0,
          totalRuns: prev.totalRuns ?? DEFAULT_TRIAL_RUNS,
          lastError: error.message,
          pendingConsumption: false,
          pendingConsumptionStage: null
        }))
        clearStoredPendingConsumption()
        return
      }
      if (error instanceof LicensingRequestError) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isOffline: false,
          lastError: error.message,
          pendingConsumption: true,
          pendingConsumptionStage: 'finalizing'
        }))
        writeStoredPendingConsumption({ deviceHash, stage: 'finalizing' })
        return
      }
      console.error('Unexpected licensing error while finalizing trial run.', error)
      setState((prev) => ({
        ...prev,
        isLoading: false,
        isOffline: false,
        lastError: 'Unexpected licensing error.',
        pendingConsumption: true,
        pendingConsumptionStage: 'finalizing'
      }))
      writeStoredPendingConsumption({ deviceHash, stage: 'finalizing' })
    }
  }, [applyStatus, deviceHash])

  const finalizeTrialRun = useCallback(
    async ({ succeeded }: { succeeded: boolean }) => {
      if (!succeeded) {
        setState((prev) => ({
          ...prev,
          pendingConsumption: false,
          pendingConsumptionStage: null
        }))
        clearStoredPendingConsumption()
        return
      }

      const current = stateRef.current
      if (current.hasActiveSubscription || !current.isTrialAvailable) {
        setState((prev) => ({
          ...prev,
          pendingConsumption: false,
          pendingConsumptionStage: null,
          isLoading: false,
          lastError: null
        }))
        clearStoredPendingConsumption()
        return
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        lastError: null,
        isOffline: false,
        pendingConsumption: true,
        pendingConsumptionStage: 'finalizing'
      }))

      await consumePendingTrialRun()
    },
    [consumePendingTrialRun]
  )

  useEffect(() => {
    if (!deviceHash || hasRecoveredPendingRef.current) {
      return
    }

    hasRecoveredPendingRef.current = true

    const stored = readStoredPendingConsumption()
    if (!stored || stored.deviceHash !== deviceHash) {
      return
    }

    setState((prev) => ({
      ...prev,
      isLoading: true,
      lastError: null,
      isOffline: false,
      pendingConsumption: true,
      pendingConsumptionStage: 'finalizing'
    }))

    void consumePendingTrialRun()
  }, [consumePendingTrialRun, deviceHash])

  useEffect(() => {
    if (!deviceHash) {
      return
    }

    if (!state.pendingConsumption || state.hasActiveSubscription) {
      clearStoredPendingConsumption()
      return
    }

    writeStoredPendingConsumption({
      deviceHash,
      stage: state.pendingConsumptionStage ?? 'in_progress'
    })
  }, [deviceHash, state.pendingConsumption, state.pendingConsumptionStage, state.hasActiveSubscription])

  const initiateSubscription = useCallback(async () => {
    if (!deviceHash) {
      throw new LicensingRequestError('Device identity not initialised.', 400)
    }
    try {
      const session = await createSubscriptionCheckoutSession(deviceHash)
      scheduleSubscriptionPoll()
      setState((prev) => ({ ...prev, lastError: null, isOffline: false }))
      return session
    } catch (error) {
      if (error instanceof LicensingOfflineError) {
        markOffline(error.message)
      } else if (error instanceof LicensingRequestError) {
        markFailure(error.message)
      }
      throw error
    }
  }, [deviceHash, markFailure, markOffline, scheduleSubscriptionPoll])

  const openSubscriptionPortal = useCallback(async () => {
    if (!deviceHash) {
      throw new LicensingRequestError('Device identity not initialised.', 400)
    }
    try {
      const session = await createSubscriptionPortalSession(deviceHash)
      setState((prev) => ({ ...prev, lastError: null }))
      return session
    } catch (error) {
      if (error instanceof LicensingOfflineError) {
        markOffline(error.message)
      } else if (error instanceof LicensingRequestError) {
        markFailure(error.message)
      }
      throw error
    }
  }, [deviceHash, markFailure, markOffline])

  const value = useMemo(
    () => ({
      state,
      refresh,
      markTrialRunPending,
      finalizeTrialRun,
      initiateSubscription,
      openSubscriptionPortal
    }),
    [state, refresh, markTrialRunPending, finalizeTrialRun, initiateSubscription, openSubscriptionPortal]
  )

  return <TrialAccessContext.Provider value={value}>{children}</TrialAccessContext.Provider>
}

export const useTrialAccess = (): TrialAccessContextValue => {
  const context = useContext(TrialAccessContext)
  if (!context) {
    throw new Error('useTrialAccess must be used within a TrialAccessProvider.')
  }
  return context
}
