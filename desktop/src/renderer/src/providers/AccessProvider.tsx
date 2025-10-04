import type { PropsWithChildren } from 'react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { consumeTrialCredit, fetchAccessStatus, type AccessEnvelope } from '../services/accessApi'
import { getDeviceHash as getRendererDeviceHash } from '../services/device'

export type AccessStatus = 'loading' | 'trial' | 'active' | 'required'

export interface AccessContextValue {
  status: AccessStatus
  deviceHash: string | null
  remainingRuns: number
  startedAt: string | null
  accessActive: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  consumeTrial: () => Promise<void>
}

interface AccessState {
  deviceHash: string | null
  remainingRuns: number
  startedAt: string | null
  accessActive: boolean
  status: AccessStatus
  loading: boolean
  error: string | null
}

const AccessContext = createContext<AccessContextValue | undefined>(undefined)

const normaliseEnvelope = (envelope: AccessEnvelope) => {
  const remaining = Math.max(0, Math.trunc(envelope.trial.remaining_runs))
  const startedAt = envelope.trial.started_at
  const accessActive = Boolean(envelope.access?.active)
  const trialAllowed = envelope.trial.allowed && remaining > 0

  const status: AccessStatus = accessActive ? 'active' : trialAllowed ? 'trial' : 'required'

  return {
    remainingRuns: remaining,
    startedAt: startedAt ?? null,
    accessActive,
    status
  }
}

export const AccessProvider = ({ children }: PropsWithChildren<{}>): JSX.Element => {
  const [state, setState] = useState<AccessState>({
    deviceHash: null,
    remainingRuns: 0,
    startedAt: null,
    accessActive: false,
    status: 'loading',
    loading: true,
    error: null
  })
  const deviceHashRef = useRef<string | null>(null)

  const ensureDeviceHash = useCallback(async (): Promise<string> => {
    if (deviceHashRef.current) {
      return deviceHashRef.current
    }

    const hash = await getRendererDeviceHash()
    deviceHashRef.current = hash
    setState((prev) => ({ ...prev, deviceHash: hash }))
    return hash
  }, [])

  const applyEnvelope = useCallback((envelope: AccessEnvelope, hash: string) => {
    const snapshot = normaliseEnvelope(envelope)
    setState({
      deviceHash: hash,
      remainingRuns: snapshot.remainingRuns,
      startedAt: snapshot.startedAt,
      accessActive: snapshot.accessActive,
      status: snapshot.status,
      loading: false,
      error: null
    })
  }, [])

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const hash = await ensureDeviceHash()
      const envelope = await fetchAccessStatus(hash)
      applyEnvelope(envelope, hash)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to load the current access status.'
      setState((prev) => ({
        ...prev,
        loading: false,
        status: prev.deviceHash ? prev.status : 'required',
        error: message
      }))
    }
  }, [applyEnvelope, ensureDeviceHash])

  const consumeTrial = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const hash = await ensureDeviceHash()
      const envelope = await consumeTrialCredit(hash)
      applyEnvelope(envelope, hash)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to consume a trial credit.'
      setState((prev) => ({ ...prev, loading: false, error: message }))
      throw error instanceof Error ? error : new Error(message)
    }
  }, [applyEnvelope, ensureDeviceHash])

  useEffect(() => {
    let cancelled = false

    const bootstrap = async () => {
      try {
        await refresh()
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : 'Unable to initialise access status.'
          setState((prev) => ({
            ...prev,
            loading: false,
            status: prev.deviceHash ? prev.status : 'required',
            error: message
          }))
        }
      }
    }

    void bootstrap()

    return () => {
      cancelled = true
    }
  }, [refresh])

  const value = useMemo<AccessContextValue>(
    () => ({
      status: state.status,
      deviceHash: state.deviceHash,
      remainingRuns: state.remainingRuns,
      startedAt: state.startedAt,
      accessActive: state.accessActive,
      loading: state.loading,
      error: state.error,
      refresh,
      consumeTrial
    }),
    [consumeTrial, refresh, state]
  )

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export const useAccessContext = (): AccessContextValue => {
  const context = useContext(AccessContext)
  if (!context) {
    throw new Error('useAccessContext must be used within an AccessProvider')
  }
  return context
}
