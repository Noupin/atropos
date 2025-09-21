import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FC, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import PipelineProgress from '../components/PipelineProgress'
import { BACKEND_MODE, buildJobClipVideoUrl } from '../config/backend'
import {
  createInitialPipelineSteps,
  PIPELINE_STEP_DEFINITIONS,
  resolvePipelineLocation
} from '../data/pipeline'
import {
  startPipelineJob,
  subscribeToPipelineEvents,
  type PipelineEventMessage
} from '../services/pipelineApi'
import { parseClipTimestamp } from '../lib/clipMetadata'
import { timeAgo } from '../lib/format'
import {
  canOpenAccountClipsFolder,
  openAccountClipsFolder
} from '../services/clipLibrary'
import type { AccountSummary, HomePipelineState, SearchBridge } from '../types'

const SUPPORTED_HOSTS = ['youtube.com', 'youtu.be', 'twitch.tv'] as const

const isValidVideoUrl = (value: string): boolean => {
  try {
    const url = new URL(value.trim())
    const host = url.hostname.toLowerCase()
    return SUPPORTED_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  } catch (error) {
    return false
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

type HomeProps = {
  registerSearch: (bridge: SearchBridge | null) => void
  initialState: HomePipelineState
  onStateChange: (state: HomePipelineState) => void
  accounts: AccountSummary[]
}

const Home: FC<HomeProps> = ({ registerSearch, initialState, onStateChange, accounts }) => {
  const [state, setState] = useState<HomePipelineState>(initialState)
  const [folderMessage, setFolderMessage] = useState<string | null>(null)
  const [folderErrorMessage, setFolderErrorMessage] = useState<string | null>(null)
  const [isOpeningFolder, setIsOpeningFolder] = useState(false)
  const canAttemptToOpenFolder = useMemo(() => canOpenAccountClipsFolder(), [])

  useEffect(() => {
    setState(initialState)
  }, [initialState])

  const updateState = useCallback(
    (updater: (prev: HomePipelineState) => HomePipelineState) =>
      setState((prev) => {
        const next = updater(prev)
        if (next !== prev) {
          onStateChange(next)
        }
        return next
      }),
    [onStateChange]
  )

  const {
    videoUrl,
    urlError,
    pipelineError,
    steps,
    isProcessing,
    clips,
    selectedClipId,
    selectedAccountId,
    accountError,
    activeJobId
  } = state

  useEffect(() => {
    setFolderMessage(null)
    setFolderErrorMessage(null)
  }, [selectedAccountId])

  const availableAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.active && account.platforms.some((platform) => platform.active)
      ),
    [accounts]
  )

  const selectedAccount = useMemo(
    () => availableAccounts.find((account) => account.id === selectedAccountId) ?? null,
    [availableAccounts, selectedAccountId]
  )

  useEffect(() => {
    if (selectedAccountId && !availableAccounts.some((account) => account.id === selectedAccountId)) {
      updateState((prev) => ({ ...prev, selectedAccountId: null }))
    }
  }, [availableAccounts, selectedAccountId, updateState])

  const timersRef = useRef<number[]>([])
  const runStepRef = useRef<(index: number) => void>(() => {})
  const connectionCleanupRef = useRef<(() => void) | null>(null)
  const activeJobIdRef = useRef<string | null>(initialState.activeJobId ?? null)

  const isMockBackend = BACKEND_MODE === 'mock'

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id)
    }
    timersRef.current = []
  }, [])

  const cleanupConnection = useCallback(() => {
    const cleanup = connectionCleanupRef.current
    if (cleanup) {
      cleanup()
      connectionCleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    registerSearch(null)
    return () => {
      registerSearch(null)
      clearTimers()
      cleanupConnection()
    }
  }, [cleanupConnection, clearTimers, registerSearch])

  useEffect(() => {
    if (!isMockBackend) {
      clearTimers()
      runStepRef.current = () => {}
      return
    }

    runStepRef.current = (stepIndex: number) => {
      if (stepIndex >= PIPELINE_STEP_DEFINITIONS.length) {
        updateState((prev) => ({ ...prev, isProcessing: false }))
        return
      }

      const definition = PIPELINE_STEP_DEFINITIONS[stepIndex]
      const increments = 5
      const incrementDuration = Math.max(500, Math.round(definition.durationMs / increments))

      updateState((prev) => ({
        ...prev,
        steps: prev.steps.map((step, index) => {
          if (index < stepIndex) {
            return { ...step, status: 'completed', progress: 1, etaSeconds: null }
          }
          if (index === stepIndex) {
            return {
              ...step,
              status: 'running',
              progress: 0,
              etaSeconds: Math.max(0, Math.round(definition.durationMs / 1000))
            }
          }
          return { ...step, status: 'pending', progress: 0, etaSeconds: null }
        })
      }))

      for (let i = 1; i <= increments; i += 1) {
        const timeout = window.setTimeout(() => {
          updateState((prev) => ({
            ...prev,
            steps: prev.steps.map((step, index) => {
              if (index === stepIndex) {
                const progress = clamp01(i / increments)
                return {
                  ...step,
                  progress,
                  status: progress >= 1 ? 'completed' : 'running',
                  etaSeconds:
                    progress >= 1
                      ? null
                      : Math.max(0, Math.round(((increments - i) * incrementDuration) / 1000))
                }
              }

              if (index < stepIndex && (step.status !== 'completed' || step.progress !== 1)) {
                return { ...step, status: 'completed', progress: 1, etaSeconds: null }
              }

              return step
            })
          }))

          if (i === increments) {
            if (stepIndex === PIPELINE_STEP_DEFINITIONS.length - 1) {
              updateState((prev) => ({ ...prev, isProcessing: false }))
            } else {
              const nextTimeout = window.setTimeout(() => runStepRef.current(stepIndex + 1), 500)
              timersRef.current.push(nextTimeout)
            }
          }
        }, incrementDuration * i)

        timersRef.current.push(timeout)
      }
    }
  }, [clearTimers, isMockBackend, updateState])

  const handlePipelineEvent = useCallback(
    (event: PipelineEventMessage) => {
      if (event.type === 'pipeline_started') {
        updateState((prev) => ({
          ...prev,
          steps: createInitialPipelineSteps(),
          pipelineError: null,
          isProcessing: true
        }))
        return
      }

      if (event.type === 'step_progress') {
        const location = resolvePipelineLocation(event.step)
        if (!location || typeof event.data?.progress !== 'number') {
          return
        }
        const progressValue = clamp01(event.data.progress)
        const completedValue =
          typeof event.data.completed === 'number' ? Math.max(0, event.data.completed) : null
        const totalValue =
          typeof event.data.total === 'number' ? Math.max(0, event.data.total) : null
        const rawEta =
          typeof event.data.eta_seconds === 'number'
            ? event.data.eta_seconds
            : typeof event.data.eta === 'number'
              ? event.data.eta
              : null
        const etaValue =
          rawEta !== null && Number.isFinite(rawEta) && rawEta >= 0 ? rawEta : null

        updateState((prev) => ({
          ...prev,
          steps: prev.steps.map((step) => {
            if (location.kind === 'step') {
              if (step.id !== location.stepId) {
                return step
              }

              const nextClipProgress = step.clipStage
                ? {
                    completed:
                      completedValue !== null
                        ? completedValue
                        : step.clipProgress?.completed ?? 0,
                    total:
                      totalValue !== null ? totalValue : step.clipProgress?.total ?? 0
                  }
                : step.clipProgress

              if (step.status === 'completed') {
                return { ...step, clipProgress: nextClipProgress, etaSeconds: null }
              }

              return {
                ...step,
                status: 'running',
                progress: progressValue,
                clipProgress: nextClipProgress,
                etaSeconds: etaValue
              }
            }

            if (step.id !== location.stepId) {
              return step
            }

            return {
              ...step,
              status: step.status === 'pending' ? 'running' : step.status,
              substeps: step.substeps.map((substep) => {
                if (substep.id !== location.substepId) {
                  return substep
                }

                const totalClips = totalValue !== null ? totalValue : substep.totalClips
                const boundedTotal = Math.max(0, totalClips)

                if (location.clipIndex !== null) {
                  const clipPosition =
                    boundedTotal > 0
                      ? Math.min(boundedTotal, Math.max(1, location.clipIndex))
                      : Math.max(1, location.clipIndex)
                  const previousCompleted = substep.completedClips
                  const rawCompleted =
                    completedValue !== null ? Math.max(0, completedValue) : previousCompleted
                  let boundedCompleted =
                    boundedTotal > 0 ? Math.min(boundedTotal, rawCompleted) : rawCompleted
                  if (progressValue >= 1) {
                    boundedCompleted = Math.max(boundedCompleted, clipPosition)
                  }
                  const allDone =
                    (boundedTotal === 0 && totalValue !== null) ||
                    (boundedTotal > 0 && boundedCompleted >= boundedTotal)

                  return {
                    ...substep,
                    status: allDone ? 'completed' : 'running',
                    progress: progressValue,
                    etaSeconds: etaValue,
                    completedClips: boundedCompleted,
                    totalClips: boundedTotal,
                    activeClipIndex: allDone ? null : clipPosition
                  }
                }

                const previousCompleted = substep.completedClips
                const rawCompleted =
                  completedValue !== null ? Math.max(0, completedValue) : previousCompleted
                const boundedCompleted =
                  boundedTotal > 0 ? Math.min(boundedTotal, rawCompleted) : rawCompleted
                const progressed = boundedCompleted > previousCompleted
                const allDone =
                  (boundedTotal === 0 && totalValue !== null) ||
                  (boundedTotal > 0 && boundedCompleted >= boundedTotal)

                const nextStatus = allDone
                  ? 'completed'
                  : substep.status === 'pending' && !progressed && previousCompleted === 0
                    ? substep.status
                    : 'running'

                const nextProgress = allDone ? 1 : progressed ? 0 : substep.progress

                const nextActiveClipIndex = allDone
                  ? null
                  : totalValue !== null && boundedTotal > 0
                    ? Math.min(boundedTotal, boundedCompleted + 1)
                    : substep.activeClipIndex

                return {
                  ...substep,
                  status: nextStatus,
                  progress: nextProgress,
                  etaSeconds: etaValue,
                  completedClips: boundedCompleted,
                  totalClips: boundedTotal,
                  activeClipIndex: nextActiveClipIndex
                }
              })
            }
          })
        }))
        return
      }

      if (event.type === 'step_started' || event.type === 'step_completed' || event.type === 'step_failed') {
        const location = resolvePipelineLocation(event.step)
        if (!location) {
          return
        }
        const targetIndex = PIPELINE_STEP_DEFINITIONS.findIndex((definition) => definition.id === location.stepId)
        if (targetIndex === -1) {
          return
        }

        updateState((prev) => ({
          ...prev,
          steps: prev.steps.map((step, index) => {
            const shouldForceCompleted = index < targetIndex && step.status !== 'completed'

            if (location.kind === 'step') {
              if (shouldForceCompleted) {
                return { ...step, status: 'completed', progress: 1, etaSeconds: null }
              }
              if (index === targetIndex) {
                if (event.type === 'step_started') {
                  return { ...step, status: 'running', progress: 0, etaSeconds: null }
                }
                if (event.type === 'step_completed') {
                  return { ...step, status: 'completed', progress: 1, etaSeconds: null }
                }
                return { ...step, status: 'failed', progress: 1, etaSeconds: null }
              }
              return step
            }

            if (shouldForceCompleted) {
              return { ...step, status: 'completed', progress: 1, etaSeconds: null }
            }

            if (step.id !== location.stepId) {
              return step
            }

            const updatedSubsteps = step.substeps.map((substep) => {
              if (substep.id !== location.substepId) {
                return substep
              }
              if (event.type === 'step_started') {
                const nextActiveClip =
                  location.clipIndex ?? substep.activeClipIndex ?? substep.completedClips + 1
                return {
                  ...substep,
                  status: 'running',
                  progress: 0,
                  etaSeconds: null,
                  activeClipIndex: nextActiveClip
                }
              }
              if (event.type === 'step_completed') {
                const completedClips =
                  location.clipIndex !== null
                    ? Math.max(substep.completedClips, location.clipIndex)
                    : substep.completedClips
                const allDone = substep.totalClips > 0 && completedClips >= substep.totalClips
                return {
                  ...substep,
                  status: allDone ? 'completed' : 'running',
                  progress: 1,
                  etaSeconds: null,
                  completedClips,
                  activeClipIndex: allDone
                    ? null
                    : location.clipIndex ?? substep.activeClipIndex
                }
              }
              return {
                ...substep,
                status: 'failed',
                etaSeconds: null,
                progress: 1,
                activeClipIndex: location.clipIndex ?? substep.activeClipIndex
              }
            })

            const allCompleted = updatedSubsteps.length > 0 &&
              updatedSubsteps.every((substep) => substep.status === 'completed')

            if (event.type === 'step_failed') {
              return {
                ...step,
                status: 'failed',
                progress: 1,
                etaSeconds: null,
                substeps: updatedSubsteps
              }
            }

            if (event.type === 'step_completed' && allCompleted) {
              return {
                ...step,
                status: 'completed',
                progress: 1,
                etaSeconds: null,
                substeps: updatedSubsteps
              }
            }

            if (event.type === 'step_started' && step.status === 'pending') {
              return {
                ...step,
                status: 'running',
                substeps: updatedSubsteps
              }
            }

            return { ...step, substeps: updatedSubsteps }
          })
        }))

        if (event.type === 'step_failed') {
          updateState((prev) => ({
            ...prev,
            pipelineError: event.message ?? 'Pipeline step failed.'
          }))
        }
        return
      }

      if (event.type === 'clip_ready') {
        const jobId = activeJobIdRef.current
        const data = event.data ?? {}
        if (!jobId || typeof data !== 'object') {
          return
        }

        const clipId = typeof data.clip_id === 'string' ? data.clip_id : null
        const description = typeof data.description === 'string' ? data.description : null
        const durationValue = typeof data.duration_seconds === 'number' ? data.duration_seconds : null
        const createdAt = typeof data.created_at === 'string' ? data.created_at : null
        const channel = typeof data.channel === 'string' ? data.channel : 'Unknown channel'
        const title = typeof data.title === 'string' && data.title.length > 0 ? data.title : `Clip ${clipId ?? ''}`
        const sourceUrl = typeof data.source_url === 'string' ? data.source_url : ''
        const sourceTitle = typeof data.source_title === 'string' ? data.source_title : title
        const sourcePublishedAt =
          typeof data.source_published_at === 'string' ? data.source_published_at : null
        const videoId = typeof data.video_id === 'string' && data.video_id.length > 0 ? data.video_id : clipId
        const videoTitle =
          typeof data.video_title === 'string' && data.video_title.length > 0 ? data.video_title : sourceTitle
        const views = typeof data.views === 'number' ? data.views : null
        const quote = typeof data.quote === 'string' ? data.quote : null
        const reason = typeof data.reason === 'string' ? data.reason : null
        const rating = typeof data.rating === 'number' ? data.rating : null
        const playbackClipId = typeof data.clip_id === 'string' ? data.clip_id : null
        const accountIdValue = typeof data.account === 'string' ? data.account : null

        if (!clipId || !description || !createdAt || !playbackClipId || !durationValue || !sourceUrl) {
          return
        }

        const playbackUrl = buildJobClipVideoUrl(jobId, playbackClipId)
        const { timestampUrl, timestampSeconds } = parseClipTimestamp(description)

        updateState((prev) => {
          const incomingClip = {
            id: clipId,
            title,
            channel,
            views,
            createdAt,
            durationSec: durationValue,
            thumbnail: null,
            playbackUrl,
            description,
            sourceUrl,
            sourceTitle,
            sourcePublishedAt,
            videoId,
            videoTitle,
            quote,
            reason,
            rating,
            timestampUrl,
            timestampSeconds,
            accountId: accountIdValue
          }

          const existingIndex = prev.clips.findIndex((clip) => clip.id === clipId)
          const mergedClips = existingIndex === -1
            ? [...prev.clips, incomingClip]
            : prev.clips.map((clip, index) => (index === existingIndex ? incomingClip : clip))

          mergedClips.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

          const hasSelection = mergedClips.some((clip) => clip.id === prev.selectedClipId)
          return {
            ...prev,
            clips: mergedClips,
            selectedClipId: hasSelection ? prev.selectedClipId : mergedClips[0]?.id ?? null
          }
        })

        return
      }

      if (event.type === 'pipeline_completed') {
        const successValue = event.data?.success
        const success = typeof successValue === 'boolean' ? successValue : true
        const errorValue = event.data?.error
        const errorMessage =
          typeof errorValue === 'string' ? errorValue : typeof event.message === 'string' ? event.message : null

        updateState((prev) => ({
          ...prev,
          pipelineError: success ? null : errorMessage ?? 'Pipeline failed.',
          isProcessing: false,
          steps: prev.steps.map((step) => {
            if (success) {
              if (step.status === 'completed' || step.status === 'failed') {
                return { ...step, etaSeconds: null }
              }
              return { ...step, status: 'completed', progress: 1, etaSeconds: null }
            }
            if (step.status === 'completed' || step.status === 'failed') {
              return { ...step, etaSeconds: null }
            }
            return { ...step, status: 'failed', progress: 1, etaSeconds: null }
          })
        }))
        cleanupConnection()
      }
    },
    [cleanupConnection, updateState]
  )

  const accountOptions = useMemo(
    () => availableAccounts.map((account) => ({ value: account.id, label: account.displayName })),
    [availableAccounts]
  )

  const startRealProcessing = useCallback(
    async (urlToProcess: string, accountId: string) => {
      updateState((prev) => ({
        ...prev,
        isProcessing: true,
        pipelineError: null
      }))
      cleanupConnection()

      try {
        const { jobId } = await startPipelineJob({ url: urlToProcess, account: accountId })
        activeJobIdRef.current = jobId
        let unsubscribe: (() => void) | null = null
        const cleanup = () => {
          if (unsubscribe) {
            unsubscribe()
            unsubscribe = null
          }
        }
        connectionCleanupRef.current = cleanup

        unsubscribe = subscribeToPipelineEvents(jobId, {
          onEvent: handlePipelineEvent,
          onError: (error) => {
            updateState((prev) => ({
              ...prev,
              pipelineError: error.message,
              isProcessing: false
            }))
            cleanupConnection()
          },
          onClose: () => {
            if (connectionCleanupRef.current === cleanup) {
              connectionCleanupRef.current = null
            }
          }
        })
        updateState((prev) => ({ ...prev, activeJobId: jobId }))
      } catch (error) {
        updateState((prev) => ({
          ...prev,
          pipelineError:
            error instanceof Error ? error.message : 'Unable to start the pipeline.',
          isProcessing: false
        }))
      }
    },
    [cleanupConnection, handlePipelineEvent, updateState]
  )

  useEffect(() => {
    activeJobIdRef.current = activeJobId
  }, [activeJobId])

  const handleUrlChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      updateState((prev) => ({
        ...prev,
        videoUrl: value,
        urlError: prev.urlError ? null : prev.urlError
      }))
    },
    [updateState]
  )

  const handleAccountChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value
      updateState((prev) => ({
        ...prev,
        selectedAccountId: value.length > 0 ? value : null,
        accountError: prev.accountError ? null : prev.accountError,
        clips: [],
        selectedClipId: null
      }))
    },
    [updateState]
  )

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = videoUrl.trim()
      const accountId = selectedAccountId
      const isUrlPresent = trimmed.length > 0
      const isUrlValid = isUrlPresent && isValidVideoUrl(trimmed)
      let hasError = false

      if (!accountId) {
        hasError = true
        updateState((prev) => ({
          ...prev,
          accountError:
            accountOptions.length === 0
              ? 'Enable an account with an active platform before starting the pipeline.'
              : 'Select an account to start processing.'
        }))
      }

      if (!isUrlPresent) {
        hasError = true
        updateState((prev) => ({
          ...prev,
          urlError: 'Enter a video URL to start processing.'
        }))
      } else if (!isUrlValid) {
        hasError = true
        updateState((prev) => ({
          ...prev,
          urlError: 'Enter a valid YouTube or Twitch URL.'
        }))
      }

      if (hasError || !accountId || !isUrlValid) {
        return
      }

      clearTimers()
      cleanupConnection()
      updateState((prev) => ({
        ...prev,
        urlError: null,
        pipelineError: null,
        clips: [],
        selectedClipId: null,
        steps: createInitialPipelineSteps(),
        isProcessing: true,
        accountError: null,
        activeJobId: null
      }))

      if (isMockBackend) {
        const startTimeout = window.setTimeout(() => runStepRef.current(0), 150)
        timersRef.current.push(startTimeout)
        return
      }

      void startRealProcessing(trimmed, accountId)
    },
    [
      accountOptions.length,
      cleanupConnection,
      clearTimers,
      isMockBackend,
      selectedAccountId,
      startRealProcessing,
      updateState,
      videoUrl
    ]
  )

  const handleReset = useCallback(() => {
    clearTimers()
    cleanupConnection()
    updateState((prev) => ({
      ...prev,
      steps: createInitialPipelineSteps(),
      isProcessing: false,
      clips: [],
      pipelineError: null,
      urlError: null,
      selectedClipId: null,
      accountError: null,
      activeJobId: null
    }))
    activeJobIdRef.current = null
  }, [cleanupConnection, clearTimers, updateState])

  const handleOpenClipsFolder = useCallback(async () => {
    if (!canAttemptToOpenFolder) {
      setFolderErrorMessage('Opening the clips folder is only available in the desktop app.')
      setFolderMessage(null)
      return
    }

    if (!selectedAccountId) {
      setFolderErrorMessage('Select an account to open its clips folder.')
      setFolderMessage(null)
      return
    }

    setIsOpeningFolder(true)
    setFolderErrorMessage(null)
    setFolderMessage(null)

    try {
      const opened = await openAccountClipsFolder(selectedAccountId)
      if (opened) {
        setFolderMessage('Opened the clips folder in your file explorer.')
      } else {
        setFolderErrorMessage('Unable to open the clips folder for this account.')
      }
    } catch (error) {
      setFolderErrorMessage('Unable to open the clips folder for this account.')
    } finally {
      setIsOpeningFolder(false)
    }
  }, [canAttemptToOpenFolder, selectedAccountId])

  const hasProgress = useMemo(
    () => steps.some((step) => step.status !== 'pending' || step.progress > 0),
    [steps]
  )

  const currentStep = useMemo(() => steps.find((step) => step.status === 'running') ?? null, [steps])
  const clipProductionStep = useMemo(
    () => steps.find((step) => step.id === 'produce-clips') ?? null,
    [steps]
  )

  const accountLookup = useMemo(() => {
    const map = new Map<string, AccountSummary>()
    for (const account of accounts) {
      map.set(account.id, account)
    }
    return map
  }, [accounts])

  const readyDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }),
    []
  )

  const timelineClips = useMemo(() => {
    const targetClips = selectedAccountId
      ? clips.filter(
          (clip) =>
            clip.accountId === selectedAccountId || clip.accountId === null || clip.accountId === undefined
        )
      : clips

    return [...targetClips].sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime()
      const bTime = new Date(b.createdAt).getTime()
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) {
        return 0
      }
      if (Number.isNaN(aTime)) {
        return 1
      }
      if (Number.isNaN(bTime)) {
        return -1
      }
      return aTime - bTime
    })
  }, [clips, selectedAccountId])

  const pipelineMessageContent = useMemo<ReactNode>(() => {
    if (pipelineError) {
      return pipelineError
    }
    if (clipProductionStep && (clipProductionStep.status === 'running' || clipProductionStep.status === 'completed')) {
      return (
        <>
          Clips are being generated.{' '}
          <Link to="/library" className="font-semibold text-[var(--ring)] hover:underline">
            Open the library
          </Link>{' '}
          to review them as they arrive.
        </>
      )
    }
    if (currentStep) {
      return `Currently processing: ${currentStep.title}`
    }
    if (clips.length > 0 && !isProcessing) {
      return (
        <>
          Processing complete.{' '}
          <Link to="/library" className="font-semibold text-[var(--ring)] hover:underline">
            View your clips in the library
          </Link>
          .
        </>
      )
    }
    return 'Paste a supported link to kick off the Atropos pipeline.'
  }, [clipProductionStep, clips.length, currentStep, isProcessing, pipelineError])

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-[var(--fg)]">Process a new video</h2>
              <p className="text-sm text-[var(--muted)]">{pipelineMessageContent}</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex w-full flex-col gap-2 sm:max-w-xs">
                <label className="sr-only" htmlFor="processing-account">
                  Account
                </label>
                <select
                  id="processing-account"
                  value={selectedAccountId ?? ''}
                  onChange={handleAccountChange}
                  aria-invalid={accountError ? 'true' : 'false'}
                  aria-describedby={accountError ? 'account-error' : undefined}
                  disabled={accountOptions.length === 0}
                  className={`w-full rounded-lg border bg-[var(--card)] px-4 py-2 text-sm text-[var(--fg)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] ${accountError ? 'border-rose-400 focus-visible:ring-rose-400' : 'border-white/10 focus-visible:ring-[var(--ring)]'}`}
                >
                  <option value="" disabled>
                    Select an account
                  </option>
                  {accountOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {accountOptions.length === 0 && !accountError ? (
                  <p className="text-xs text-amber-300">
                    Enable an account with an active platform from your profile before starting the pipeline.
                  </p>
                ) : null}
              </div>
              <label className="sr-only" htmlFor="video-url">
                Video URL
              </label>
              <input
                id="video-url"
                type="url"
                value={videoUrl}
                onChange={handleUrlChange}
                placeholder="https://www.youtube.com/watch?v=..."
                className="flex-1 rounded-lg border border-white/10 bg-[var(--card)] px-4 py-2 text-sm text-[var(--fg)] shadow-sm placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!videoUrl.trim() || isProcessing}
                  className="rounded-lg border border-transparent bg-[var(--ring)] px-3 py-2 text-xs font-semibold leading-tight text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:text-sm whitespace-nowrap"
                >
                  {isProcessing ? 'Processing…' : 'Start processing'}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!hasProgress && clips.length === 0 && !pipelineError}
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-medium leading-tight text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4 sm:text-sm whitespace-nowrap"
                >
                  Reset
                </button>
              </div>
            </div>
            <div className="text-xs text-[var(--muted)]">
              Supports YouTube and Twitch URLs. The pipeline runs{' '}
              {isMockBackend
                ? 'in simulation mode with mocked events.'
                : 'against the backend API for live progress updates.'}
            </div>
            {accountError ? (
              <p id="account-error" className="text-xs font-medium text-rose-400">
                {accountError}
              </p>
            ) : null}
            {urlError ? <p className="text-xs font-medium text-rose-400">{urlError}</p> : null}
          </form>
          <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-lg font-semibold text-[var(--fg)]">Pipeline</h3>
                <p className="text-sm text-[var(--muted)]">
                  Track each stage of the Atropos pipeline as your job runs.
                </p>
              </div>
              <PipelineProgress steps={steps} />
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-6">
          <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-[var(--fg)]">Upload timeline</h2>
                  <p className="text-sm text-[var(--muted)]">
                    {selectedAccount
                      ? `Clips queued for ${selectedAccount.displayName}.`
                      : 'Upcoming clips across your connected accounts.'}
                  </p>
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <Link
                    to="/library"
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white"
                  >
                    Go to library
                    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                      <path
                        fill="currentColor"
                        d="M13.5 2h-5a.75.75 0 0 0 0 1.5H11l-6.72 6.72a.75.75 0 0 0 1.06 1.06L12 4.56v2.5a.75.75 0 0 0 1.5 0v-5A.75.75 0 0 0 13.5 2"
                      />
                    </svg>
                  </Link>
                  <button
                    type="button"
                    onClick={handleOpenClipsFolder}
                    disabled={isOpeningFolder}
                    className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isOpeningFolder ? 'Opening…' : 'Open clips folder'}
                  </button>
                </div>
              </div>
              {folderMessage ? (
                <p className="text-sm text-emerald-300">{folderMessage}</p>
              ) : null}
              {folderErrorMessage ? (
                <p className="text-sm text-rose-400">{folderErrorMessage}</p>
              ) : null}
              {timelineClips.length > 0 ? (
                <ol className="relative mt-2 space-y-6 border-l border-white/10 pl-5">
                  {timelineClips.map((clip) => {
                    const readyDate = new Date(clip.createdAt)
                    const readyTime = readyDate.getTime()
                    const hasValidDate = Number.isFinite(readyTime)
                    const readyLabel = hasValidDate ? readyDateFormatter.format(readyDate) : 'Schedule pending'
                    const relativeLabel = hasValidDate ? timeAgo(clip.createdAt) : null
                    const accountName = clip.accountId
                      ? accountLookup.get(clip.accountId)?.displayName ?? 'Shared library'
                      : 'Unassigned account'

                    return (
                      <li key={clip.id} className="relative pl-4">
                        <span
                          className="absolute -left-[0.65rem] top-2 h-3 w-3 rounded-full border-2 border-[var(--ring)] bg-[var(--card)]"
                          aria-hidden="true"
                        />
                        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] p-4">
                          <div className="flex flex-col gap-1">
                            <span className="text-[11px] font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                              Ready {readyLabel}
                            </span>
                            <h3 className="text-sm font-semibold leading-snug text-[var(--fg)]">{clip.title}</h3>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                            <span className="font-medium text-[var(--fg)]">{accountName}</span>
                            {relativeLabel ? <span>{relativeLabel}</span> : null}
                            {clip.videoTitle ? <span className="truncate text-ellipsis">From {clip.videoTitle}</span> : null}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-6 text-sm text-[var(--muted)]">
                  No scheduled clips yet. Start processing a video to populate your upload timeline.
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}

export default Home
