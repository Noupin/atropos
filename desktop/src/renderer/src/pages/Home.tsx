import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { FC } from 'react'
import { useNavigate } from 'react-router-dom'
import PipelineProgress from '../components/PipelineProgress'
import { BACKEND_MODE, buildJobClipVideoUrl } from '../config/backend'
import {
  createInitialPipelineSteps,
  PIPELINE_STEP_DEFINITIONS,
  resolvePipelineLocation
} from '../data/pipeline'
import {
  normaliseJobClip,
  resumePipelineJob,
  startPipelineJob,
  subscribeToPipelineEvents,
  type PipelineEventMessage
} from '../services/pipelineApi'
import { formatDuration, timeAgo } from '../lib/format'
import { canOpenAccountClipsFolder, openAccountClipsFolder } from '../services/clipLibrary'
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
  const navigate = useNavigate()
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
    activeJobId,
    reviewMode,
    awaitingReview
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

      if (event.type === 'log') {
        const statusValue =
          event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>).status : null
        if (statusValue === 'waiting_for_review') {
          updateState((prev) => ({ ...prev, awaitingReview: true }))
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
        const sourceUrl = typeof data.source_url === 'string' ? data.source_url : null
        const sourceTitle = typeof data.source_title === 'string' ? data.source_title : null

        if (!clipId || !description || !createdAt || durationValue === null || !sourceUrl || !sourceTitle) {
          return
        }

        const playbackUrl = buildJobClipVideoUrl(jobId, clipId)
        const manifestPayload: Record<string, unknown> = {
          ...data,
          id: clipId,
          playback_url: playbackUrl,
          description,
          duration_seconds: durationValue,
          created_at: createdAt,
          source_url: sourceUrl,
          source_title: sourceTitle,
          source_published_at:
            typeof data.source_published_at === 'string' ? data.source_published_at : null,
          views: typeof data.views === 'number' ? data.views : null,
          rating: typeof data.rating === 'number' ? data.rating : null,
          quote: typeof data.quote === 'string' ? data.quote : null,
          reason: typeof data.reason === 'string' ? data.reason : null,
          account: typeof data.account === 'string' ? data.account : null,
          video_id: typeof data.video_id === 'string' ? data.video_id : clipId,
          video_title: typeof data.video_title === 'string' ? data.video_title : sourceTitle
        }

        const incomingClip = normaliseJobClip(manifestPayload)
        if (!incomingClip) {
          return
        }

        updateState((prev) => {
          const existingIndex = prev.clips.findIndex((clip) => clip.id === incomingClip.id)
          const mergedClips =
            existingIndex === -1
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
          awaitingReview: false,
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
    async (urlToProcess: string, accountId: string, shouldPauseForReview: boolean) => {
      updateState((prev) => ({
        ...prev,
        isProcessing: true,
        pipelineError: null,
        awaitingReview: false
      }))
      cleanupConnection()

      try {
        const { jobId } = await startPipelineJob({
          url: urlToProcess,
          account: accountId,
          reviewMode: shouldPauseForReview
        })
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
        updateState((prev) => ({ ...prev, activeJobId: jobId, awaitingReview: false }))
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
    if (clips.length === 0) {
      if (selectedClipId !== null) {
        updateState((prev) => ({ ...prev, selectedClipId: null }))
      }
      return
    }

    if (!selectedClipId || !clips.some((clip) => clip.id === selectedClipId)) {
      const nextId = clips[0]?.id ?? null
      if (nextId !== selectedClipId) {
        updateState((prev) => ({ ...prev, selectedClipId: nextId }))
      }
    }
  }, [clips, selectedClipId, updateState])

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

  const handleReviewModeChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { checked } = event.target
      updateState((prev) => ({ ...prev, reviewMode: checked }))
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
        activeJobId: null,
        awaitingReview: false
      }))

      if (isMockBackend) {
        const startTimeout = window.setTimeout(() => runStepRef.current(0), 150)
        timersRef.current.push(startTimeout)
        return
      }

      void startRealProcessing(trimmed, accountId, reviewMode)
    },
    [
      accountOptions.length,
      cleanupConnection,
      clearTimers,
      isMockBackend,
      selectedAccountId,
      startRealProcessing,
      reviewMode,
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
      activeJobId: null,
      awaitingReview: false
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

  const handleReviewClip = useCallback(
    (clipId: string) => {
      const clip = clips.find((item) => item.id === clipId)
      if (!clip) {
        return
      }
      navigate(`/clip/${encodeURIComponent(clip.id)}/edit`, {
        state: {
          clip,
          jobId: activeJobIdRef.current,
          accountId: clip.accountId ?? null,
          context: 'job'
        }
      })
    },
    [clips, navigate]
  )

  const handleResumePipeline = useCallback(async () => {
    const jobId = activeJobIdRef.current
    if (!jobId) {
      return
    }
    try {
      await resumePipelineJob(jobId)
      updateState((prev) => ({ ...prev, awaitingReview: false }))
    } catch (error) {
      updateState((prev) => ({
        ...prev,
        pipelineError:
          error instanceof Error ? error.message : 'Unable to resume the pipeline. Try again shortly.'
      }))
    }
  }, [updateState])

  const hasProgress = useMemo(
    () => steps.some((step) => step.status !== 'pending' || step.progress > 0),
    [steps]
  )

  const currentStep = useMemo(() => steps.find((step) => step.status === 'running') ?? null, [steps])
  const timelineDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }),
    []
  )

  const timelineClips = useMemo(() => {
    const relevantClips = selectedAccountId
      ? clips.filter(
          (clip) =>
            clip.accountId === selectedAccountId ||
            clip.accountId === null ||
            clip.accountId === undefined
        )
      : clips

    return [...relevantClips].sort((a, b) => {
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

  const pipelineMessage = useMemo(() => {
    if (pipelineError) {
      return pipelineError
    }
    if (awaitingReview) {
      return 'Pipeline paused for manual clip review. Adjust boundaries, then resume when ready.'
    }
    if (currentStep) {
      return `Currently processing: ${currentStep.title}`
    }
    if (clips.length > 0 && !isProcessing) {
      return 'Processing complete. Review the generated clips below.'
    }
    return 'Paste a supported link to kick off the Atropos pipeline.'
  }, [awaitingReview, clips.length, currentStep, isProcessing, pipelineError])

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,1fr)] xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <div className="flex flex-col gap-6">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-[var(--fg)]">Process a new video</h2>
              <p className="text-sm text-[var(--muted)]">
                Select an account, paste a link, and start the pipeline when you are ready.
              </p>
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
                  className="rounded-lg border border-transparent bg-[var(--ring)] px-3 py-2 text-xs font-semibold leading-tight text-[color:var(--accent-contrast)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:text-sm whitespace-nowrap"
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
            <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
              <input
                type="checkbox"
                checked={reviewMode}
                onChange={handleReviewModeChange}
                className="h-4 w-4 rounded border border-white/20 bg-[var(--card)] text-[var(--ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
              <span>Pause after producing clips to review boundaries manually.</span>
            </label>
            {reviewMode ? (
              <p className="text-xs text-[var(--muted)]">
                The pipeline will wait after step 7 so you can fine-tune each clip before resuming.
              </p>
            ) : null}
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
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-[var(--fg)]">Pipeline progress</h3>
              <p className="text-sm text-[var(--muted)]">{pipelineMessage}</p>
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_75%,transparent)] p-4">
              <PipelineProgress steps={steps} />
            </div>
            {awaitingReview ? (
              <div className="mt-4 rounded-lg border border-amber-400/40 bg-[color:color-mix(in_srgb,var(--card)_75%,transparent)] p-4 text-sm text-amber-200">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>Review the clips below and resume the pipeline once you&apos;re happy with the trims.</span>
                  <button
                    type="button"
                    onClick={handleResumePipeline}
                    className="inline-flex items-center justify-center rounded-lg border border-white/20 bg-amber-500/20 px-3 py-1.5 text-xs font-semibold text-amber-50 transition hover:bg-amber-500/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    Resume pipeline
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-[var(--fg)]">Generated clips</h3>
              <p className="text-sm text-[var(--muted)]">
                Fine-tune the start and end points to give each highlight a polished finish.
              </p>
            </div>
            {clips.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-4">
                {clips.map((clip) => {
                  const isActive = clip.id === selectedClipId
                  return (
                    <li
                      key={clip.id}
                      className={`flex flex-col gap-3 rounded-xl border px-4 py-3 transition ${
                        isActive
                          ? 'border-[var(--ring)] bg-[color:color-mix(in_srgb,var(--card)_80%,transparent)]'
                          : 'border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] hover:border-[var(--ring)]'
                      }`}
                    >
                      <div className="flex flex-col gap-1">
                        <h4 className="text-sm font-semibold text-[var(--fg)]">{clip.title || 'Clip ready for review'}</h4>
                        <p className="text-xs text-[var(--muted)]">
                          {clip.channel ? `${clip.channel} • ` : ''}
                          {formatDuration(clip.durationSec)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleReviewClip(clip.id)}
                          className="inline-flex items-center justify-center rounded-lg border border-white/20 px-3 py-1.5 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                        >
                          Review clip window
                        </button>
                        {clip.accountId ? (
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                            {clip.accountId}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] p-6 text-sm text-[var(--muted)]">
                No clips generated yet. Start the pipeline to create highlights ready for review.
              </div>
            )}
          </div>
        </div>

        <aside className="lg:sticky lg:top-6">
          <div className="flex h-full flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <h2 className="text-lg font-semibold text-[var(--fg)]">Upload timeline</h2>
                <p className="text-sm text-[var(--muted)]">
                  {selectedAccount
                    ? `Scheduled clips for ${selectedAccount.displayName}.`
                    : 'Scheduled clips for all connected accounts.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenClipsFolder}
                disabled={isOpeningFolder}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-60 sm:px-4 sm:text-sm"
              >
                {isOpeningFolder ? 'Opening…' : 'Open clips folder'}
              </button>
            </div>
            {folderMessage ? <p className="text-sm text-emerald-300">{folderMessage}</p> : null}
            {folderErrorMessage ? <p className="text-sm text-rose-400">{folderErrorMessage}</p> : null}
            {timelineClips.length > 0 ? (
              <div className="relative mt-2">
                <div className="absolute left-3 top-0 bottom-0 w-px bg-white/10" aria-hidden="true" />
                <ol className="flex flex-col gap-5">
                  {timelineClips.map((clip) => {
                    const scheduledDate = new Date(clip.createdAt)
                    const hasDate = !Number.isNaN(scheduledDate.getTime())
                    return (
                      <li key={clip.id} className="relative pl-8">
                        <span className="absolute left-3 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--ring)] shadow-[0_0_0_4px_rgba(148,163,184,0.25)]" aria-hidden="true" />
                        <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_75%,transparent)] p-4">
                          <div className="space-y-1">
                            <h3 className="text-sm font-semibold leading-snug text-[var(--fg)]">
                              {clip.title || 'Clip ready to upload'}
                            </h3>
                            <p className="text-xs text-[var(--muted)]">
                              {clip.channel ? `${clip.channel} • ` : ''}Duration {formatDuration(clip.durationSec)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--muted)]">
                            {hasDate ? (
                              <>
                                <span className="font-medium text-[var(--fg)]">
                                  {timelineDateFormatter.format(scheduledDate)}
                                </span>
                                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                                  {timeAgo(clip.createdAt)}
                                </span>
                              </>
                            ) : (
                              <span>Awaiting schedule</span>
                            )}
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ol>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_65%,transparent)] p-6 text-sm text-[var(--muted)]">
                Process a video to populate your upload timeline.
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

export default Home
