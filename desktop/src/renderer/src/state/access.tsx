import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { getOrCreateDeviceHash } from '../services/device'
import {
  LicensingOfflineError,
  LicensingRequestError,
  TrialExhaustedError,
  acceptSubscriptionTransfer,
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
  readLastVerifiedAt,
  readStoredPendingConsumption,
  writeLastVerifiedAt,
  writeStoredPendingConsumption
} from './accessPersistence'

export { DEFAULT_TRIAL_RUNS } from './accessTypes'

const AccessContext = createContext<AccessContextValue | undefined>(undefined)

const OFFLINE_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000
const ACTIVE_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const DORMANT_REFRESH_INTERVAL_MS = 60 * 60 * 1000
const INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000

type OfflineSnapshot = {
  expiresAt: string | null
  remainingMs: number | null
  isLocked: boolean
  lastVerifiedAt: string | null
}

const resolveOfflineSnapshot = (lastVerifiedAtMs: number | null): OfflineSnapshot => {
  if (!lastVerifiedAtMs) {
    return {
      expiresAt: null,
      remainingMs: 0,
      isLocked: true,
      lastVerifiedAt: null
    }
  }

  const expiresAtMs = lastVerifiedAtMs + OFFLINE_GRACE_PERIOD_MS
  const remainingMs = Math.max(0, expiresAtMs - Date.now())

  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    remainingMs,
    isLocked: remainingMs <= 0,
    lastVerifiedAt: new Date(lastVerifiedAtMs).toISOString()
  }
}

export const AccessProvider = ({ children }: { children: ReactNode }): ReactElement => {
  const [state, setState] = useState<AccessState>(INITIAL_STATE)
  const [deviceHash, setDeviceHash] = useState<string | null>(null)
  const [isUserActive, setIsUserActive] = useState(true)
  const hasRecoveredPendingRef = useRef(false)
  const pendingTransferTokenRef = useRef<string | null>(null)
  const lastVerifiedAtRef = useRef<number | null>(readLastVerifiedAt())
  const isUserActiveRef = useRef(true)
  const inactivityTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)
  const lastRefreshAtRef = useRef<number | null>(null)

  const applyStatus = useCallback(
    (status: AccessStatusPayload, overrides?: Partial<AccessState>) => {
      setState((prev) => {
        const subscription = status.subscription ?? null
        const transfer = status.transfer ?? {
          status: 'none',
          email: null,
          initiatedAt: null,
          expiresAt: null,
          completedAt: null,
          targetDeviceHash: null
        }
        const trial = deriveTrialState(status.trial)
        const subscriptionActive = isSubscriptionActive(subscription)
        const trialActive = isTrialAccessActive(status.access, trial)
        const accessActive = subscriptionActive || trialActive || Boolean(status.access?.isActive)
        const shouldResetPending = status.access?.source !== 'trial'
        const now = Date.now()
        lastVerifiedAtRef.current = now
        writeLastVerifiedAt(now)

        return {
          deviceHash: status.deviceHash,
          subscription,
          trial,
          access: status.access,
          transfer,
          isSubscriptionActive: subscriptionActive,
          isTrialActive: trialActive,
          isAccessActive: accessActive,
          isOffline: overrides?.isOffline ?? false,
          isOfflineLocked: overrides?.isOfflineLocked ?? false,
          offlineExpiresAt: overrides?.offlineExpiresAt ?? null,
          offlineRemainingMs: overrides?.offlineRemainingMs ?? null,
          offlineLastVerifiedAt: overrides?.offlineLastVerifiedAt ?? null,
          isLoading: overrides?.isLoading ?? false,
          lastError: overrides?.lastError ?? null,
          pendingConsumption: shouldResetPending
            ? false
            : (overrides?.pendingConsumption ?? prev.pendingConsumption),
          pendingConsumptionStage: shouldResetPending
            ? null
            : (overrides?.pendingConsumptionStage ?? prev.pendingConsumptionStage)
        }
      })
    },
    []
  )

  const markOffline = useCallback((message?: string) => {
    const snapshot = resolveOfflineSnapshot(lastVerifiedAtRef.current ?? readLastVerifiedAt())
    setState((prev) => {
      const wasSubscriptionActive = prev.isSubscriptionActive
      const accessSource = prev.access?.source ?? 'none'
      const nextIsSubscriptionActive = snapshot.isLocked ? false : wasSubscriptionActive
      const nextIsAccessActive = snapshot.isLocked
        ? false
        : accessSource === 'subscription' && wasSubscriptionActive
      let nextError = message
      if (!nextError) {
        if (snapshot.isLocked) {
          nextError =
            accessSource === 'subscription'
              ? 'Offline access expired. Reconnect to verify your subscription before processing.'
              : 'Offline access expired. Reconnect to the internet to resume processing.'
        } else if (accessSource === 'trial') {
          nextError = 'Trial runs require an internet connection. Reconnect to continue processing.'
        } else if (accessSource === 'subscription' && wasSubscriptionActive) {
          nextError =
            'Licensing service is unreachable. Reconnect within 24 hours to keep your subscription active.'
        } else {
          nextError =
            'Licensing service is unreachable. Check your connection and refresh to verify access.'
        }
      }

      return {
        ...prev,
        isLoading: false,
        isOffline: true,
        isOfflineLocked: snapshot.isLocked,
        offlineExpiresAt: snapshot.expiresAt,
        offlineRemainingMs: snapshot.remainingMs,
        offlineLastVerifiedAt: snapshot.lastVerifiedAt,
        isAccessActive: nextIsAccessActive,
        isTrialActive: false,
        isSubscriptionActive: nextIsSubscriptionActive,
        lastError: nextError
      }
    })
  }, [])

  const markFailure = useCallback((message: string) => {
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isOffline: false,
      isOfflineLocked: false,
      offlineExpiresAt: null,
      offlineRemainingMs: null,
      offlineLastVerifiedAt: null,
      lastError: message
    }))
  }, [])

  const loadStatus = useCallback(
    async (hash: string, options?: { allowCreateTrial?: boolean }) => {
      lastRefreshAtRef.current = Date.now()
      setState((prev) => ({
        ...prev,
        isLoading: true,
        isOffline: false,
        isOfflineLocked: false,
        offlineExpiresAt: null,
        offlineRemainingMs: null,
        offlineLastVerifiedAt: null,
        lastError: null
      }))
      try {
        let status = await fetchAccessStatus(hash)
        if (!status && (options?.allowCreateTrial ?? true)) {
          await startTrial(hash)
          status = await fetchAccessStatus(hash)
        }
        if (!status) {
          markFailure(
            "We're having trouble confirming your access. Please refresh or contact support if this continues."
          )
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
        markFailure(
          'Something went wrong while checking your access. Please try again in a moment.'
        )
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
      markFailure("We couldn't prepare this device for access. Restart Atropos and try again.")
    }
  }, [loadStatus, markFailure])

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    if (!deviceHash) {
      return
    }
    const forceRefresh = options?.force ?? true
    if (!forceRefresh) {
      const lastRefreshAt = lastRefreshAtRef.current
      const now = Date.now()
      if (lastRefreshAt !== null && now - lastRefreshAt < ACTIVE_REFRESH_INTERVAL_MS) {
        return
      }
    }
    await loadStatus(deviceHash, { allowCreateTrial: false })
  }, [deviceHash, loadStatus])

  const markTrialRunPending = useCallback(() => {
    setState((prev) => ({
      ...prev,
      pendingConsumption: true,
      pendingConsumptionStage:
        prev.pendingConsumptionStage === 'finalizing'
          ? prev.pendingConsumptionStage
          : 'in_progress',
      lastError: null,
      isOffline: false,
      isOfflineLocked: false,
      offlineExpiresAt: null,
      offlineRemainingMs: null,
      offlineLastVerifiedAt: null
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
      const access =
        prev.access && prev.access.source === 'trial'
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
        isOfflineLocked: false,
        offlineExpiresAt: null,
        offlineRemainingMs: null,
        offlineLastVerifiedAt: null,
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
        const snapshot = resolveOfflineSnapshot(lastVerifiedAtRef.current ?? readLastVerifiedAt())
        setState((prev) => {
          const wasSubscriptionActive = prev.isSubscriptionActive
          const accessSource = prev.access?.source ?? 'none'
          const nextIsSubscriptionActive = snapshot.isLocked ? false : wasSubscriptionActive
          const nextIsAccessActive = snapshot.isLocked
            ? false
            : accessSource === 'subscription' && wasSubscriptionActive
          return {
            ...prev,
            isLoading: false,
            isOffline: true,
            isOfflineLocked: snapshot.isLocked,
            offlineExpiresAt: snapshot.expiresAt,
            offlineRemainingMs: snapshot.remainingMs,
            offlineLastVerifiedAt: snapshot.lastVerifiedAt,
            isAccessActive: nextIsAccessActive,
            isSubscriptionActive: nextIsSubscriptionActive,
            isTrialActive: false,
            lastError:
              error.message ??
              'Licensing service is unreachable. Check your connection and refresh to verify access.',
            pendingConsumption: true,
            pendingConsumptionStage: 'finalizing'
          }
        })
        writeStoredPendingConsumption({ deviceHash, stage: 'finalizing' })
        return
      }
      if (error instanceof TrialExhaustedError) {
        setState((prev) => ({
          ...prev,
          isLoading: false,
          isOffline: false,
          isOfflineLocked: false,
          offlineExpiresAt: null,
          offlineRemainingMs: null,
          offlineLastVerifiedAt: null,
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
          isOfflineLocked: false,
          offlineExpiresAt: null,
          offlineRemainingMs: null,
          offlineLastVerifiedAt: null,
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
        isOfflineLocked: false,
        offlineExpiresAt: null,
        offlineRemainingMs: null,
        offlineLastVerifiedAt: null,
        lastError: 'Something went wrong while finalizing your access. Please try again.',
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
        isOfflineLocked: false,
        offlineExpiresAt: null,
        offlineRemainingMs: null,
        offlineLastVerifiedAt: null,
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
      isOfflineLocked: false,
      offlineExpiresAt: null,
      offlineRemainingMs: null,
      offlineLastVerifiedAt: null,
      pendingConsumption: true,
      pendingConsumptionStage: 'finalizing'
    }))
    void consumePendingTrialRun()
  }, [consumePendingTrialRun, deviceHash])

  const processTransferToken = useCallback(
    async (token: string) => {
      if (!deviceHash) {
        pendingTransferTokenRef.current = token
        return
      }

      setState((prev) => ({
        ...prev,
        isLoading: true,
        lastError: null,
        isOffline: false,
        isOfflineLocked: false,
        offlineExpiresAt: null,
        offlineRemainingMs: null,
        offlineLastVerifiedAt: null
      }))

      try {
        await acceptSubscriptionTransfer(deviceHash, token)
        pendingTransferTokenRef.current = null
        await refresh({ force: true })
      } catch (error) {
        if (error instanceof LicensingOfflineError) {
          pendingTransferTokenRef.current = null
          markOffline(error.message)
          return
        }
        let message = 'Unable to accept subscription transfer.'
        if (error instanceof LicensingRequestError) {
          message = error.message
        } else if (error instanceof Error && error.message) {
          message = error.message
        }
        console.error('Failed to accept subscription transfer.', error)
        pendingTransferTokenRef.current = null
        setState((prev) => ({
          ...prev,
          isLoading: false,
          lastError: message
        }))
      }
    },
    [deviceHash, markOffline, refresh]
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return
    }
    const activityEvents: (keyof WindowEventMap)[] = [
      'pointerdown',
      'pointermove',
      'keydown',
      'wheel',
      'scroll',
      'focus',
      'touchstart',
      'touchmove'
    ]

    const scheduleInactivityCheck = (): void => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current)
      }
      inactivityTimerRef.current = window.setTimeout(() => {
        isUserActiveRef.current = false
        setIsUserActive(false)
        inactivityTimerRef.current = null
      }, INACTIVITY_THRESHOLD_MS)
    }

    const markActive = (): void => {
      if (!isUserActiveRef.current) {
        isUserActiveRef.current = true
        setIsUserActive(true)
      }
      scheduleInactivityCheck()
    }

    const markInactive = (): void => {
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
      if (isUserActiveRef.current) {
        isUserActiveRef.current = false
        setIsUserActive(false)
      }
    }

    const handleVisibilityChange = (): void => {
      if (document.hidden) {
        markInactive()
      } else {
        markActive()
      }
    }

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, markActive)
    }
    window.addEventListener('blur', markInactive)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    markActive()

    return () => {
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, markActive)
      }
      window.removeEventListener('blur', markInactive)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (inactivityTimerRef.current) {
        window.clearTimeout(inactivityTimerRef.current)
        inactivityTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    let interval: ReturnType<typeof window.setInterval> | null = null
    let dormantTimeout: ReturnType<typeof window.setTimeout> | null = null

    if (isUserActive) {
      interval = window.setInterval(() => {
        void refresh({ force: true })
      }, ACTIVE_REFRESH_INTERVAL_MS)
    } else {
      const scheduleDormantRefresh = (): void => {
        dormantTimeout = window.setTimeout(() => {
          void refresh({ force: true })
          scheduleDormantRefresh()
        }, DORMANT_REFRESH_INTERVAL_MS)
      }
      scheduleDormantRefresh()
    }

    return () => {
      if (interval) {
        window.clearInterval(interval)
      }
      if (dormantTimeout) {
        window.clearTimeout(dormantTimeout)
      }
    }
  }, [isUserActive, refresh])

  useEffect(() => {
    if (!isUserActive) {
      return
    }

    void refresh({ force: false })
  }, [isUserActive, refresh])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const handleFocus = (): void => {
      void refresh({ force: false })
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [refresh])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    if (!state.isOffline || !state.offlineExpiresAt) {
      return
    }

    const updateCountdown = (): void => {
      setState((prev) => {
        if (!prev.isOffline || !prev.offlineExpiresAt) {
          return prev
        }
        const expiresAtMs = Date.parse(prev.offlineExpiresAt)
        if (Number.isNaN(expiresAtMs)) {
          return {
            ...prev,
            offlineRemainingMs: 0,
            isOfflineLocked: true
          }
        }
        const remainingMs = Math.max(0, expiresAtMs - Date.now())
        const isLocked = remainingMs <= 0
        if (prev.offlineRemainingMs === remainingMs && prev.isOfflineLocked === isLocked) {
          return prev
        }
        return {
          ...prev,
          offlineRemainingMs: remainingMs,
          isOfflineLocked: isLocked
        }
      })
    }

    updateCountdown()
    const timer = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(timer)
  }, [state.isOffline, state.offlineExpiresAt])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.api?.onDeepLink) {
      return
    }
    const unsubscribe = window.api.onDeepLink((url) => {
      try {
        const parsed = new URL(url)
        if (!parsed.protocol.startsWith('atropos')) {
          return
        }
        if (parsed.hostname === 'subscription') {
          void refresh({ force: true })
          return
        }
        if (parsed.hostname === 'transfer') {
          const token = parsed.searchParams.get('token')
          const action = parsed.pathname.replace(/\/+$/u, '').replace(/^\/+/, '')
          if (action === 'accept' && token) {
            void processTransferToken(token)
          }
        }
      } catch (error) {
        console.warn('Failed to parse deep link URL.', error)
      }
    })
    return unsubscribe
  }, [processTransferToken, refresh])

  useEffect(() => {
    if (!deviceHash && pendingTransferTokenRef.current) {
      return
    }
    if (deviceHash && pendingTransferTokenRef.current) {
      const token = pendingTransferTokenRef.current
      pendingTransferTokenRef.current = null
      void processTransferToken(token)
    }
  }, [deviceHash, processTransferToken])

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
