import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

export type TrialAccessState = {
  totalRuns: number | null
  remainingRuns: number | null
  isTrialActive: boolean
  isOffline: boolean
  isLoading: boolean
  lastError: string | null
}

export const DEFAULT_TRIAL_RUNS = 3

const INITIAL_STATE: TrialAccessState = {
  totalRuns: null,
  remainingRuns: null,
  isTrialActive: false,
  isOffline: false,
  isLoading: true,
  lastError: null
}

type TrialAccessContextValue = {
  state: TrialAccessState
  refresh: () => Promise<void>
  consumeTrialRun: () => Promise<void>
}

const TrialAccessContext = createContext<TrialAccessContextValue | undefined>(undefined)

const mapStatusToState = (status: TrialStatusPayload): TrialAccessState => ({
  totalRuns: status.totalRuns,
  remainingRuns: status.remainingRuns,
  isTrialActive: status.isTrialAllowed,
  isOffline: false,
  isLoading: false,
  lastError: null
})

export const TrialAccessProvider = ({ children }: { children: ReactNode }): JSX.Element => {
  const [state, setState] = useState<TrialAccessState>(INITIAL_STATE)
  const [deviceHash, setDeviceHash] = useState<string | null>(null)

  const applyStatus = useCallback((status: TrialStatusPayload) => {
    setState(mapStatusToState(status))
  }, [])

  const markOffline = useCallback((message?: string) => {
    setState((prev) => ({
      ...prev,
      isLoading: false,
      isOffline: true,
      isTrialActive: false,
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
    async (hash: string) => {
      setState((prev) => ({ ...prev, isLoading: true, lastError: null }))
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

  const consumeTrialRun = useCallback(async () => {
    if (!deviceHash) {
      return
    }
    setState((prev) => ({ ...prev, isLoading: true, lastError: null }))
    try {
      const status = await consumeTrial(deviceHash)
      applyStatus(status)
    } catch (error) {
      if (error instanceof LicensingOfflineError) {
        markOffline(error.message)
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
          lastError: error.message
        }))
        return
      }
      if (error instanceof LicensingRequestError) {
        markFailure(error.message)
        return
      }
      console.error('Unexpected licensing error while consuming trial.', error)
      markFailure('Unexpected licensing error.')
    }
  }, [applyStatus, deviceHash, markFailure, markOffline])

  const value = useMemo(
    () => ({
      state,
      refresh,
      consumeTrialRun
    }),
    [state, refresh, consumeTrialRun]
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
