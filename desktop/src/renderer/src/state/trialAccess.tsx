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
  fetchTrialStatus,
  startTrial
} from '../services/licensing'
import type { TrialStatusPayload } from '../services/licensing'

type PendingConsumptionStage = 'in_progress' | 'finalizing' | null

export type TrialAccessState = {
  totalRuns: number | null
  remainingRuns: number | null
  isTrialActive: boolean
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
  isTrialActive: false,
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
}

const TrialAccessContext = createContext<TrialAccessContextValue | undefined>(undefined)

const mapStatusToState = (status: TrialStatusPayload): TrialAccessState => ({
  totalRuns: status.totalRuns,
  remainingRuns: status.remainingRuns,
  isTrialActive: status.isTrialAllowed,
  isOffline: false,
  isLoading: false,
  lastError: null,
  pendingConsumption: false,
  pendingConsumptionStage: null
})

export const TrialAccessProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [state, setState] = useState<TrialAccessState>(INITIAL_STATE)
  const [deviceHash, setDeviceHash] = useState<string | null>(null)
  const hasRecoveredPendingRef = useRef(false)

  const applyStatus = useCallback(
    (status: TrialStatusPayload, overrides?: Partial<TrialAccessState>) => {
      setState((prev) => ({
        ...mapStatusToState(status),
        pendingConsumption: overrides?.pendingConsumption ?? prev.pendingConsumption,
        pendingConsumptionStage:
          overrides?.pendingConsumptionStage ?? prev.pendingConsumptionStage,
        lastError: overrides?.lastError ?? null,
        isOffline: overrides?.isOffline ?? false,
        isLoading: overrides?.isLoading ?? false
      }))
    },
    []
  )

  const markOffline = useCallback((message?: string) => {
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isOffline: true,
      isTrialActive: false,
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
        pendingConsumption: prev.pendingConsumption,
        pendingConsumptionStage: prev.pendingConsumptionStage
      }))
      try {
        const status = (await fetchTrialStatus(hash)) ?? (await startTrial(hash))
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

  const markTrialRunPending = useCallback(() => {
    setState((prev) => ({
      ...prev,
      pendingConsumption: true,
      pendingConsumptionStage: prev.pendingConsumptionStage === 'finalizing'
        ? prev.pendingConsumptionStage
        : 'in_progress',
      lastError: null,
      isOffline: false
    }))
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
          isTrialActive: false,
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

  const value = useMemo(
    () => ({
      state,
      refresh,
      markTrialRunPending,
      finalizeTrialRun
    }),
    [state, refresh, markTrialRunPending, finalizeTrialRun]
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
