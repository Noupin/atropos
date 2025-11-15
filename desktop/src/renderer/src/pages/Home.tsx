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
import { getBadgeClassName } from '../components/badgeStyles'
import { BACKEND_MODE, getApiBaseUrl } from '../config/backend'
import {
  createInitialPipelineSteps,
  createInitialPipelineStepsForStart,
  getPipelineStepIndex,
  getPipelineStepStartOrder,
  PIPELINE_STEP_DEFINITIONS
} from '../data/pipeline'
import { TONE_LABELS } from '../constants/tone'
import { formatDuration, timeAgo } from '../lib/format'
import { canOpenAccountClipsFolder, openAccountClipsFolder } from '../services/clipLibrary'
import type { AccountSummary, HomePipelineState } from '../types'
import { useAccess } from '../state/access'
import { formatOfflineCountdown } from '../state/accessFormatting'

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

type SourceMode = 'url' | 'file'

type HomeProps = {
  initialState: HomePipelineState
  onStateChange: (state: HomePipelineState) => void
  accounts: AccountSummary[]
  onStartPipeline: (
    source: { url?: string | null; filePath?: string | null },
    accountId: string,
    reviewMode: boolean,
    startStepId?: string | null
  ) => Promise<void> | void
  onResumePipeline: () => Promise<void> | void
  onCancelPipeline: () => Promise<void> | void
}

const Home: FC<HomeProps> = ({
  initialState,
  onStateChange,
  accounts,
  onStartPipeline,
  onResumePipeline,
  onCancelPipeline
}) => {
  const navigate = useNavigate()
  const [state, setState] = useState<HomePipelineState>(initialState)
  const [folderMessage, setFolderMessage] = useState<string | null>(null)
  const [folderErrorMessage, setFolderErrorMessage] = useState<string | null>(null)
  const [isOpeningFolder, setIsOpeningFolder] = useState(false)
  const [fileSelectionError, setFileSelectionError] = useState<string | null>(null)
  const [sourceMode, setSourceMode] = useState<SourceMode>(
    initialState.localFilePath ? 'file' : 'url'
  )
  const canAttemptToOpenFolder = useMemo(() => canOpenAccountClipsFolder(), [])
  const { state: accessState, markTrialRunPending, finalizeTrialRun } = useAccess()

  useEffect(() => {
    setState(initialState)
    setFileSelectionError(null)
  }, [initialState])

  useEffect(() => {
    setSourceMode(initialState.localFilePath ? 'file' : 'url')
  }, [initialState.localFilePath])

  const updateState = useCallback(
    (updater: (prev: HomePipelineState) => HomePipelineState) => {
      let nextState: HomePipelineState | null = null
      setState((prev) => {
        const next = updater(prev)
        if (next === prev) {
          return prev
        }
        nextState = next
        return next
      })
      if (nextState !== null) {
        onStateChange(nextState)
      }
    },
    [onStateChange]
  )

  const {
    videoUrl,
    localFilePath,
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
    awaitingReview,
    lastRunClipSummary,
    lastRunClipStatus,
    downloads
  } = state

  const isFileMode = sourceMode === 'file'
  const trimmedVideoUrl = videoUrl.trim()

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

  const accountToneLabel = useMemo(() => {
    if (!selectedAccount) {
      return null
    }
    const toneKey = selectedAccount.effectiveTone
    if (!toneKey) {
      return 'Default tone'
    }
    return TONE_LABELS[toneKey] ?? toneKey
  }, [selectedAccount])

  const resolveDownloadUrl = useCallback((path: string | null) => {
    if (!path) {
      return null
    }
    try {
      return new URL(path, getApiBaseUrl()).toString()
    } catch (error) {
      console.error('Failed to resolve download URL', error)
      return null
    }
  }, [])

  const audioDownloadUrl = useMemo(
    () => resolveDownloadUrl(downloads.audioUrl),
    [downloads.audioUrl, resolveDownloadUrl]
  )
  const transcriptDownloadUrl = useMemo(
    () => resolveDownloadUrl(downloads.transcriptUrl),
    [downloads.transcriptUrl, resolveDownloadUrl]
  )
  const subtitlesDownloadUrl = useMemo(
    () => resolveDownloadUrl(downloads.subtitlesUrl),
    [downloads.subtitlesUrl, resolveDownloadUrl]
  )
  const hasDownloadLinks = Boolean(
    audioDownloadUrl || transcriptDownloadUrl || subtitlesDownloadUrl
  )

  useEffect(() => {
    if (selectedAccountId && !availableAccounts.some((account) => account.id === selectedAccountId)) {
      updateState((prev) => ({ ...prev, selectedAccountId: null }))
    }
  }, [availableAccounts, selectedAccountId, updateState])

  const timersRef = useRef<number[]>([])
  const runStepRef = useRef<(index: number) => void>(() => {})
  const offlineRestrictionMessageRef = useRef<string | null>(null)

  const isMockBackend = BACKEND_MODE === 'mock'

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) {
      window.clearTimeout(id)
    }
    timersRef.current = []
  }, [])

  useEffect(() => () => clearTimers(), [clearTimers])

  useEffect(() => {
    if (!isMockBackend) {
      clearTimers()
      runStepRef.current = () => {}
      return
    }

    runStepRef.current = (stepIndex: number) => {
      if (stepIndex >= PIPELINE_STEP_DEFINITIONS.length) {
        updateState((prev) => ({ ...prev, isProcessing: false }))
        if (accessState.pendingConsumption) {
          void finalizeTrialRun({ succeeded: true })
        }
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
              if (accessState.pendingConsumption) {
                void finalizeTrialRun({ succeeded: true })
              }
            } else {
              const nextTimeout = window.setTimeout(() => runStepRef.current(stepIndex + 1), 500)
              timersRef.current.push(nextTimeout)
            }
          }
        }, incrementDuration * i)

        timersRef.current.push(timeout)
      }
    }
  }, [clearTimers, finalizeTrialRun, isMockBackend, accessState.pendingConsumption, updateState])


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

  const handleSourceModeChange = useCallback(
    (mode: SourceMode) => {
      setSourceMode(mode)
      if (mode === 'file') {
        updateState((prev) => ({ ...prev, urlError: null }))
      }
      if (mode === 'url') {
        setFileSelectionError(null)
      }
    },
    [updateState]
  )

  const handleSelectLocalFile = useCallback(() => {
    const picker = window?.api?.openVideoFile
    if (!picker) {
      setFileSelectionError('We could not access the file picker. Restart the app and try again.')
      return
    }

    setFileSelectionError(null)
    picker()
      .then((selectedPath) => {
        if (!selectedPath) {
          return
        }
        updateState((prev) => ({
          ...prev,
          localFilePath: selectedPath,
          urlError: null
        }))
        setSourceMode('file')
      })
      .catch((error: unknown) => {
        console.error('Failed to select local video', error)
        setFileSelectionError('We could not access the file picker. Restart the app and try again.')
      })
  }, [updateState])

  const handleClearLocalFile = useCallback(() => {
    setFileSelectionError(null)
    updateState((prev) => ({ ...prev, localFilePath: null }))
    setSourceMode('url')
  }, [updateState])

  const offlineRestrictionMessage = useMemo(() => {
    if (!accessState.isOffline) {
      return null
    }
    if (accessState.isOfflineLocked) {
      return 'Offline access expired. Reconnect to verify your subscription before processing.'
    }
    if (accessState.access?.source === 'subscription') {
      return null
    }
    if (accessState.access?.source === 'trial') {
      return 'Trial runs require an internet connection. Reconnect to continue processing.'
    }
    return 'Reconnect to the internet to verify your access before processing.'
  }, [accessState.access?.source, accessState.isOffline, accessState.isOfflineLocked])

  const offlineCountdownMessage = useMemo(() => {
    if (!accessState.isOffline || accessState.isOfflineLocked) {
      return null
    }
    if (accessState.access?.source !== 'subscription') {
      return null
    }
    const countdownLabel = formatOfflineCountdown(accessState.offlineRemainingMs)
    if (countdownLabel) {
      return `Offline mode — reconnect within ${countdownLabel} to keep your subscription active.`
    }
    return 'Offline mode — reconnect soon to keep your subscription active.'
  }, [
    accessState.access?.source,
    accessState.isOffline,
    accessState.isOfflineLocked,
    accessState.offlineRemainingMs
  ])

  const isStartDisabled =
    (isFileMode ? !localFilePath : trimmedVideoUrl.length === 0) ||
    isProcessing ||
    accessState.pendingConsumption ||
    Boolean(offlineRestrictionMessage)

  useEffect(() => {
    if (!offlineRestrictionMessage) {
      const lastMessage = offlineRestrictionMessageRef.current
      if (!lastMessage) {
        return
      }
      offlineRestrictionMessageRef.current = null
      updateState((prev) => {
        if (prev.pipelineError === lastMessage) {
          return { ...prev, pipelineError: null }
        }
        return prev
      })
      return
    }

    offlineRestrictionMessageRef.current = offlineRestrictionMessage
  }, [offlineRestrictionMessage, updateState])

  const startPipelineRun = useCallback(
    async (startStepId?: string | null) => {
      const trimmed = videoUrl.trim()
      const selectedFile = (localFilePath ?? '').trim()
      const accountId = selectedAccountId
      const hasLocalSource = selectedFile.length > 0
      const isUrlPresent = trimmed.length > 0
      const isUrlValid = isUrlPresent && isValidVideoUrl(trimmed)
      const isUrlMode = sourceMode === 'url'
      const isFileMode = sourceMode === 'file'
      let hasError = false

      setFileSelectionError(null)

      if (!accountId) {
        hasError = true
        updateState((prev) => ({
          ...prev,
          accountError:
            availableAccounts.length === 0
              ? 'Enable an account with an active platform before starting the pipeline.'
              : 'Select an account from the top navigation to start processing.'
        }))
      }

      if (isFileMode) {
        if (!hasLocalSource) {
          hasError = true
          setFileSelectionError('Choose a local video before starting.')
        }
        updateState((prev) => ({ ...prev, urlError: null }))
      } else if (!hasLocalSource) {
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
        } else {
          updateState((prev) => ({ ...prev, urlError: null }))
        }
      } else if (isUrlMode) {
        if (isUrlPresent && !isUrlValid) {
          hasError = true
          updateState((prev) => ({
            ...prev,
            urlError: 'Enter a valid YouTube or Twitch URL.'
          }))
        } else {
          updateState((prev) => ({ ...prev, urlError: null }))
        }
      }

      if (
        hasError ||
        !accountId ||
        (!hasLocalSource && !isUrlValid) ||
        (isFileMode && !hasLocalSource)
      ) {
        return
      }

      if (offlineRestrictionMessage) {
        offlineRestrictionMessageRef.current = offlineRestrictionMessage
        updateState((prev) => ({
          ...prev,
          pipelineError: offlineRestrictionMessage,
          isProcessing: false
        }))
        return
      }

      if (accessState.pendingConsumption) {
        if (accessState.pendingConsumptionStage === 'finalizing') {
          void finalizeTrialRun({ succeeded: true })
        }
        updateState((prev) => ({
          ...prev,
          pipelineError:
            accessState.pendingConsumptionStage === 'finalizing'
              ? 'Finishing the last trial run. Please wait a moment before starting a new video.'
              : 'A trial run is already in progress. Let it complete before starting another video.',
          isProcessing: false
        }))
        return
      }

      const sourcePayload: { url?: string | null; filePath?: string | null } = {}
      if (hasLocalSource) {
        sourcePayload.filePath = selectedFile
      }
      if (isUrlValid) {
        sourcePayload.url = trimmed
      } else if (!hasLocalSource) {
        sourcePayload.url = trimmed
      }

      const startOrder = startStepId ? getPipelineStepStartOrder(startStepId) : null
      const initialSteps = createInitialPipelineStepsForStart(startOrder)
      const stepIndex = startStepId ? getPipelineStepIndex(startStepId) : 0
      const safeStartIndex = stepIndex >= 0 ? stepIndex : 0

      clearTimers()
      updateState((prev) => ({
        ...prev,
        urlError: null,
        pipelineError: null,
        clips: [],
        selectedClipId: null,
        steps: initialSteps,
        isProcessing: true,
        accountError: null,
        activeJobId: null,
        awaitingReview: false,
        lastRunProducedNoClips: false,
        lastRunClipSummary: null,
        lastRunClipStatus: null,
        downloads: {
          audioUrl: null,
          transcriptUrl: null,
          subtitlesUrl: null,
          sourceKind: null
        }
      }))

      if (isMockBackend) {
        const startTimeout = window.setTimeout(() => runStepRef.current(safeStartIndex), 150)
        timersRef.current.push(startTimeout)
        if (accessState.isTrialActive) {
          markTrialRunPending()
        }
        return
      }

      await onStartPipeline(sourcePayload, accountId, reviewMode, startStepId ?? null)
    },
    [
      videoUrl,
      localFilePath,
      selectedAccountId,
      sourceMode,
      updateState,
      availableAccounts.length,
      offlineRestrictionMessage,
      accessState.pendingConsumption,
      accessState.pendingConsumptionStage,
      accessState.isTrialActive,
      finalizeTrialRun,
      clearTimers,
      isMockBackend,
      markTrialRunPending,
      onStartPipeline,
      reviewMode
    ]
  )

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void startPipelineRun()
    },
    [startPipelineRun]
  )

  const handleRerunStep = useCallback(
    (stepId: string) => {
      void startPipelineRun(stepId)
    },
    [startPipelineRun]
  )

  const handleReset = useCallback(() => {
    clearTimers()
    setFileSelectionError(null)
    setSourceMode('url')
    updateState((prev) => ({
      ...prev,
      steps: createInitialPipelineSteps(),
      isProcessing: false,
      clips: [],
      pipelineError: null,
      urlError: null,
      localFilePath: null,
      selectedClipId: null,
      accountError: null,
      activeJobId: null,
      awaitingReview: false,
      lastRunProducedNoClips: false,
      lastRunClipSummary: null,
      lastRunClipStatus: null,
      downloads: {
        audioUrl: null,
        transcriptUrl: null,
        subtitlesUrl: null,
        sourceKind: null
      }
    }))
  }, [clearTimers, updateState])

  const handleOpenClipsFolder = useCallback(async () => {
    if (!canAttemptToOpenFolder) {
      setFolderErrorMessage('Opening the clips folder is only available in the desktop app.')
      setFolderMessage(null)
      return
    }

    if (!selectedAccountId) {
      setFolderErrorMessage('Select an account from the top navigation to open its clips folder.')
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
      const encodedId = encodeURIComponent(clip.id)
      navigate(`/video/${encodedId}?mode=trim`, {
        state: {
          clip,
          jobId: activeJobId,
          accountId: clip.accountId ?? null,
          context: 'job'
        }
      })
    },
    [activeJobId, clips, navigate]
  )

  const handleResumePipeline = useCallback(() => {
    void onResumePipeline()
  }, [onResumePipeline])

  const handleCancelPipeline = useCallback(() => {
    void onCancelPipeline()
  }, [onCancelPipeline])

  const hasProgress = useMemo(
    () => steps.some((step) => step.status !== 'pending' || step.progress > 0),
    [steps]
  )

  const hasCancelledSteps = useMemo(
    () => steps.some((step) => step.status === 'cancelled'),
    [steps]
  )

  const canDisplayRerun = useMemo(
    () => !isProcessing && hasProgress,
    [hasProgress, isProcessing]
  )

  const isRerunActionDisabled =
    isProcessing || awaitingReview || Boolean(offlineRestrictionMessage) || accessState.pendingConsumption

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

  const clipStatusDetails = useMemo(() => {
    if (isProcessing || !lastRunClipStatus) {
      return null
    }

    const summary = lastRunClipSummary ?? { expected: 0, rendered: 0 }
    const clipCountLabel = summary.expected === 1 ? 'clip' : 'clips'

    if (lastRunClipStatus === 'rendered_none') {
      const attemptedText = summary.expected > 0 ? `${summary.expected} ${clipCountLabel}` : 'any clips'
      return {
        shortMessage: 'Processing finished, but none of the scheduled clips could be rendered.',
        bannerHeadline: 'No clips were rendered.',
        bannerBody:
          summary.expected > 0
            ? `The pipeline finished, but none of the ${attemptedText} could be rendered. Adjust the clip boundaries or rerun the pipeline to try again.`
            : 'The pipeline finished, but none of the clips could be rendered. Adjust the clip boundaries or rerun the pipeline to try again.',
        emptyStateMessage:
          summary.expected > 0
            ? `The last pipeline run tried to render ${summary.expected} ${clipCountLabel}, but none of them succeeded. Run the pipeline again after adjusting your settings.`
            : 'The last pipeline run finished, but no clips were rendered. Try adjusting your settings and run it again.',
        summary,
        attemptedLabel:
          summary.expected > 0
            ? `Attempted to render ${summary.expected} ${clipCountLabel}.`
            : 'No clips were queued for rendering.'
      }
    }

    return {
      shortMessage:
        'Processing finished, but no clip candidates were ready to render from that video. Try another source or tweak your filters.',
      bannerHeadline: 'No clips were available to render.',
      bannerBody:
        'The pipeline completed successfully, but it did not find any clips to produce from that video. Try a different source or adjust your pipeline settings for broader matches.',
      emptyStateMessage:
        'The last pipeline run finished without finding any clips to render. Try another video or broaden your pipeline settings.',
      summary,
      attemptedLabel: 'No clips were queued for rendering.'
    }
  }, [isProcessing, lastRunClipStatus, lastRunClipSummary])

  const pipelineMessage = useMemo(() => {
    if (pipelineError) {
      return pipelineError
    }
    if (offlineRestrictionMessage) {
      return offlineRestrictionMessage
    }
    if (offlineCountdownMessage) {
      return offlineCountdownMessage
    }
    if (awaitingReview) {
      return 'Pipeline paused for manual clip review. Adjust boundaries, then resume when ready.'
    }
    if (hasCancelledSteps) {
      return 'Processing cancelled. Resume the pipeline to pick up where you left off.'
    }
    if (currentStep) {
      return `Currently processing: ${currentStep.title}`
    }
    if (accessState.pendingConsumption) {
      return accessState.pendingConsumptionStage === 'finalizing'
        ? 'Finalising your trial run. Please wait before starting another video.'
        : 'A trial run is already in progress. Let it finish to free up your next attempt.'
    }
    if (clips.length > 0 && !isProcessing) {
      return 'Processing complete. Review the generated clips below.'
    }
    if (clipStatusDetails) {
      return clipStatusDetails.shortMessage
    }
    return 'Paste a supported link to kick off the Atropos pipeline.'
  }, [
    awaitingReview,
    clipStatusDetails,
    clips.length,
    currentStep,
    isProcessing,
    pipelineError,
    offlineCountdownMessage,
    offlineRestrictionMessage,
    accessState.pendingConsumption,
    accessState.pendingConsumptionStage,
    hasCancelledSteps
  ])

  return (
    <section className="flex w-full flex-1 flex-col gap-6 px-6 py-8 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,1fr)] xl:grid-cols-[minmax(0,1.4fr)_360px]">
        <div className="flex flex-col gap-6">
          {!isProcessing && clipStatusDetails ? (
            <div
              aria-live="polite"
              className="rounded-2xl border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] p-5 text-sm text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))] shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]"
            >
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-[color:color-mix(in_srgb,var(--error-strong)_92%,var(--accent-contrast))]">
                  {clipStatusDetails.bannerHeadline}
                </p>
                <p>{clipStatusDetails.bannerBody}</p>
                <p className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--error-strong)_72%,var(--accent-contrast))]">
                  {clipStatusDetails.attemptedLabel}
                </p>
              </div>
            </div>
          ) : null}
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]"
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold text-[var(--fg)]">Process a new video</h2>
                  <p className="text-sm text-[var(--muted)]">
                    Select an account, paste a link, or choose a local file. Local videos are processed directly without an extra download.
                  </p>
                </div>
                <div
                  aria-live="polite"
                  className="flex flex-col items-start gap-2 text-left sm:items-end sm:text-right"
                >
                  {selectedAccount ? (
                    <div className="flex flex-col items-start gap-1 sm:items-end">
                      <div className="flex flex-wrap justify-end gap-2">
                        <span
                          className={getBadgeClassName(
                            'accent',
                            'max-w-full truncate text-[0.7rem] sm:text-xs'
                          )}
                          title={`Account ${selectedAccount.displayName}`}
                        >
                          Account · {selectedAccount.displayName}
                        </span>
                        <span
                          className={getBadgeClassName(
                            selectedAccount.tone ? 'info' : 'neutral',
                            'text-[0.7rem] sm:text-xs'
                          )}
                          title={
                            selectedAccount.tone
                              ? 'Using an account-specific tone override'
                              : 'Using the default clip tone'
                          }
                        >
                          Tone · {accountToneLabel ?? 'Default tone'}
                        </span>
                      </div>
                      <p className="text-xs text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
                        Clips will render with this account&apos;s settings.
                      </p>
                    </div>
                  ) : availableAccounts.length === 0 ? (
                    <p className="text-xs text-[var(--muted)]">No active accounts available.</p>
                  ) : (
                    <p className="text-xs text-[var(--muted)]">
                      Select an account from the top navigation to start processing.
                    </p>
                  )}
                </div>
              </div>
              {availableAccounts.length === 0 ? (
                <p className="text-xs text-[color:color-mix(in_srgb,var(--warning-strong)_72%,var(--accent-contrast))]">
                  Enable an account with an active platform from your profile before starting the pipeline.
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                  Video source
                </span>
                <div
                  role="tablist"
                  aria-label="Video source"
                  className="inline-flex w-full max-w-full items-center rounded-full border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-1 text-xs"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!isFileMode}
                    onClick={() => handleSourceModeChange('url')}
                    className={`flex-1 rounded-full px-3 py-1.5 font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                      !isFileMode
                        ? 'bg-[color:var(--ring)] text-[color:var(--accent-contrast)] shadow-sm'
                        : 'text-[var(--muted)]'
                    }`}
                  >
                    Link
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isFileMode}
                    onClick={() => handleSourceModeChange('file')}
                    className={`flex-1 rounded-full px-3 py-1.5 font-semibold uppercase tracking-wide transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                      isFileMode
                        ? 'bg-[color:var(--ring)] text-[color:var(--accent-contrast)] shadow-sm'
                        : 'text-[var(--muted)]'
                    }`}
                  >
                    Local file
                  </button>
                </div>
              </div>
              {sourceMode === 'url' ? (
                <div className="flex flex-col gap-2">
                  <label className="sr-only" htmlFor="video-url">
                    Video URL
                  </label>
                  <input
                    id="video-url"
                    type="url"
                    value={videoUrl}
                    onChange={handleUrlChange}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full max-w-full rounded-lg border border-white/10 bg-[var(--card)] px-4 py-2 text-sm text-[var(--fg)] shadow-sm placeholder:text-[var(--muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                  {urlError ? (
                    <p className="text-xs font-medium text-[color:color-mix(in_srgb,var(--error-strong)_82%,var(--accent-contrast))]">
                      {urlError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_78%,transparent)] px-3 py-3 text-sm text-[var(--fg)] shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">Local video</span>
                    <button
                      type="button"
                      onClick={handleSelectLocalFile}
                      className="marble-button marble-button--outline whitespace-nowrap px-3 py-1.5 text-xs font-semibold"
                    >
                      Choose local video…
                    </button>
                  </div>
                  {localFilePath ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--muted)] sm:text-sm">
                      <span className="min-w-0 flex-1 truncate" title={localFilePath}>
                        {localFilePath}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearLocalFile}
                        className="marble-button marble-button--outline whitespace-nowrap px-2 py-1 text-xs font-semibold"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-[var(--muted)]">
                      We&apos;ll process your local video directly. Add a fallback link from the Link tab if needed.
                    </p>
                  )}
                  {fileSelectionError ? (
                    <p className="mt-2 text-xs font-medium text-[color:color-mix(in_srgb,var(--error-strong)_82%,var(--accent-contrast))]">
                      {fileSelectionError}
                    </p>
                  ) : null}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={isStartDisabled}
                  className="marble-button marble-button--primary whitespace-nowrap px-5 py-2.5 text-sm font-semibold sm:px-6 sm:py-2.5 sm:text-base"
                >
                  {isProcessing ? 'Processing…' : 'Start processing'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelPipeline}
                  disabled={!isProcessing && !awaitingReview}
                  className="marble-button marble-button--danger whitespace-nowrap px-4 py-2.5 text-sm font-semibold sm:px-5"
                >
                  Cancel processing
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!hasProgress && clips.length === 0 && !pipelineError}
                  className="marble-button marble-button--outline whitespace-nowrap px-4 py-2.5 text-sm font-semibold sm:px-5"
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
              <p
                id="account-error"
                className="text-xs font-medium text-[color:color-mix(in_srgb,var(--error-strong)_82%,var(--accent-contrast))]"
              >
                {accountError}
              </p>
            ) : null}
          </form>

          <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-[var(--fg)]">Pipeline progress</h3>
              <p className="text-sm text-[var(--muted)]">{pipelineMessage}</p>
            </div>
            <div className="mt-4 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_75%,transparent)] p-4">
              <PipelineProgress
                steps={steps}
                onRerunStep={canDisplayRerun ? handleRerunStep : undefined}
                rerunDisabled={isRerunActionDisabled}
              />
            </div>
            {awaitingReview ? (
              <div className="mt-4 rounded-lg border border-[color:color-mix(in_srgb,var(--warning-strong)_45%,var(--edge))] bg-[color:var(--warning-soft)] p-4 text-sm text-[color:var(--warning-contrast)]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>Review the clips below and resume the pipeline once you&apos;re happy with the trims.</span>
                  <button
                    type="button"
                    onClick={handleResumePipeline}
                    className="inline-flex items-center justify-center rounded-lg border border-[color:color-mix(in_srgb,var(--warning-strong)_45%,var(--edge))] bg-[color:color-mix(in_srgb,var(--warning-strong)_38%,transparent)] px-3 py-1.5 text-xs font-semibold text-[color:var(--warning-contrast)] transition hover:bg-[color:color-mix(in_srgb,var(--warning-strong)_48%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--warning-strong)_70%,transparent)]"
                  >
                    Resume pipeline
                  </button>
                </div>
              </div>
            ) : null}
            {hasDownloadLinks ? (
              <div className="mt-4 rounded-lg border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_78%,transparent)] p-4 text-sm text-[var(--fg)]">
                <h4 className="font-semibold">Download pipeline outputs</h4>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {downloads.sourceKind === 'local'
                    ? 'We used your local video directly. Save the generated audio and captions below.'
                    : 'Download the audio and caption files generated for this video.'}
                </p>
                <ul className="mt-3 flex flex-col gap-2 text-sm">
                  {audioDownloadUrl ? (
                    <li>
                      <a
                        href={audioDownloadUrl}
                        className="text-[var(--ring)] hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download audio track
                      </a>
                    </li>
                  ) : null}
                  {transcriptDownloadUrl ? (
                    <li>
                      <a
                        href={transcriptDownloadUrl}
                        className="text-[var(--ring)] hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download Whisper transcript
                      </a>
                    </li>
                  ) : null}
                  {subtitlesDownloadUrl ? (
                    <li>
                      <a
                        href={subtitlesDownloadUrl}
                        className="text-[var(--ring)] hover:underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download caption bundle
                      </a>
                    </li>
                  ) : null}
                </ul>
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
                {clipStatusDetails
                  ? clipStatusDetails.emptyStateMessage
                  : 'No clips generated yet. Start the pipeline to create highlights ready for review.'}
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
            {folderMessage ? (
              <p className="text-sm text-[color:color-mix(in_srgb,var(--success-strong)_78%,var(--accent-contrast))]">
                {folderMessage}
              </p>
            ) : null}
            {folderErrorMessage ? (
              <p className="text-sm text-[color:color-mix(in_srgb,var(--error-strong)_82%,var(--accent-contrast))]">
                {folderErrorMessage}
              </p>
            ) : null}
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
