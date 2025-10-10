import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ReactElement, ReactNode } from 'react'
import { getOrCreateDeviceHash } from '../services/device'
import {
  LicensingOfflineError,
  LicensingRequestError,
  TrialExhaustedError,
  consumeTrial,
  fetchAccessStatus,
  startTrial,
  type AccessStatusPayload,
  type TrialStatusPayload
} from '../services/licensing'
import {
  AccessContextValue,
  AccessState,
  AccessTrialState,
  DEFAULT_TRIAL_RUNS,
  INITIAL_STATE,
  deriveTrialState,
  isSubscriptionActive,
  isTrialAccessActive
} from './accessTypes'
import {
  clearStoredPendingConsumption,
  readStoredPendingConsumption,
  writeStoredPendingConsumption
} from './accessPersistence'

export { DEFAULT_TRIAL_RUNS } from './accessTypes'

const AccessContext = createContext<AccessContextValue | undefined>(undefined)

export const AccessProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [state, setState] = useState<AccessState>(INITIAL_STATE)
  const [deviceHash, setDeviceHash] = useState<string | null>(null)
  const hasRecoveredPendingRef = useRef(false)

  const applyStatus = useCallback(
    (status: AccessStatusPayload, overrides?: Partial<AccessState>) => {
      setState((prev) => {
        const subscription = status.subscription ?? null
        const trial = deriveTrialState(status.trial)
        const subscriptionActive = isSubscriptionActive(subscription)
        const trialActive = isTrialAccessActive(status.access, trial)
        const accessActive = subscriptionActive || trialActive || Boolean(status.access?.isActive)
        const shouldResetPending = status.access?.source !== 'trial'

        return {
          deviceHash: status.deviceHash,
          subscription,
          trial,
          access: status.access,
          isSubscriptionActive: subscriptionActive,
          isTrialActive: trialActive,
          isAccessActive: accessActive,
          isOffline: overrides?.isOffline ?? false,
          isLoading: overrides?.isLoading ?? false,
          lastError: overrides?.lastError ?? null,
          pendingConsumption: shouldResetPending
            ? false
            : overrides?.pendingConsumption ?? prev.pendingConsumption,
          pendingConsumptionStage: shouldResetPending
            ? null
            : overrides?.pendingConsumptionStage ?? prev.pendingConsumptionStage
        }
      })
    },
    []
  )

  const markOffline = useCallback((message?: string) => {
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isOffline: true,
      isAccessActive: false,
      isTrialActive: false,
      isSubscriptionActive: false,
      lastError: message ?? 'Licensing service is unreachable.'
    }))
  }, [])

  const markFailure = useCallback((message: string) => {
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isOffline: false,
      lastError: message
    }))
  }, [])

  const loadStatus = useCallback(
    async (hash: string, options?: { allowCreateTrial?: boolean }) => {
      setState((prev) => ({
        ...prev,
        isLoading: true,
        isOffline: false,
        lastError: null
      }))
      try {
        let status = await fetchAccessStatus(hash)
        if (!status && (options?.allowCreateTrial ?? true)) {
          await startTrial(hash)
          status = await fetchAccessStatus(hash)
        }
        if (!status) {
          markFailure('Access record not found.')
          return
        }
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
        console.error('Unexpected licensing error while loading access status.', error)
        markFailure('Unexpected licensing error.')
      }
    },
    [applyStatus, markFailure, markOffline]
  )

  useEffect(() => {
    try {
      const hash = getOrCreateDeviceHash()
      setDeviceHash(hash)
      void loadStatus(hash, { allowCreateTrial: true })
    } catch (error) {
      console.error('Unable to initialise device hash.', error)
      markFailure('Unable to initialise device identity.')
    }
  }, [loadStatus, markFailure])

  const refresh = useCallback(async () => {
    if (!deviceHash) {
      return
    }
    await loadStatus(deviceHash, { allowCreateTrial: false })
  }, [deviceHash, loadStatus])

  const markTrialRunPending = useCallback(() => {
    setState((prev) => ({
      ...prev,
      pendingConsumption: true,
      pendingConsumptionStage:
        prev.pendingConsumptionStage === 'finalizing' ? prev.pendingConsumptionStage : 'in_progress',
      lastError: null,
      isOffline: false
    }))
  }, [])

  const applyTrialStatus = useCallback((status: TrialStatusPayload) => {
    setState((prev) => {
      const trial: AccessTrialState = {
        totalRuns: status.totalRuns,
        remainingRuns: status.remainingRuns,
        startedAt: prev.trial.startedAt
      }
      const trialActive = isTrialAccessActive(prev.access, trial)
      const access = prev.access && prev.access.source === 'trial'
        ? { ...prev.access, isActive: trialActive }
        : prev.access
      const isAccessActive = prev.isSubscriptionActive || Boolean(access?.isActive)
      return {
        ...prev,
        trial,
        access,
        isTrialActive: trialActive,
        isAccessActive,
        pendingConsumption: false,
        pendingConsumptionStage: null,
        isOffline: false,
        isLoading: false,
        lastError: null
      }
    })
  }, [])

  const consumePendingTrialRun = useCallback(async () => {
    if (!deviceHash) {
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
      applyTrialStatus(status)
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
          isTrialActive: false,
          isAccessActive: prev.isSubscriptionActive,
          trial: {
            totalRuns: prev.trial.totalRuns ?? DEFAULT_TRIAL_RUNS,
            remainingRuns: 0,
            startedAt: prev.trial.startedAt
          },
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
  }, [applyTrialStatus, deviceHash])

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
    if (!deviceHash) {
      return
    }

    if (!state.pendingConsumption) {
      clearStoredPendingConsumption()
      return
    }

    writeStoredPendingConsumption({
      deviceHash,
      stage: state.pendingConsumptionStage ?? 'in_progress'
    })
  }, [deviceHash, state.pendingConsumption, state.pendingConsumptionStage])

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
    if (typeof window === 'undefined') {
      return
    }
    const handleFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refresh])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const interval = window.setInterval(() => {
      void refresh()
    }, 5 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [refresh])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onDeepLink) {
      return
    }
    const unsubscribe = window.api.onDeepLink((url) => {
      try {
        const parsed = new URL(url)
        if (parsed.protocol.startsWith('atropos') && parsed.hostname === 'subscription') {
          void refresh()
        }
      } catch (error) {
        console.warn('Failed to parse deep link URL.', error)
      }
    })
    return unsubscribe
  }, [refresh])

  const value = useMemo(
    () => ({
      state,
      deviceHash,
      refresh,
      markTrialRunPending,
      finalizeTrialRun
    }),
    [state, deviceHash, refresh, markTrialRunPending, finalizeTrialRun]
  )

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export const useAccess = (): AccessContextValue => {
  const context = useContext(AccessContext)
  if (!context) {
    throw new Error('useAccess must be used within an AccessProvider.')
  }
  return context
}
