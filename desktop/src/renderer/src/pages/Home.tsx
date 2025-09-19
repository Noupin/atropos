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
import ClipDescription from '../components/ClipDescription'
import ClipDrawer from '../components/ClipDrawer'
import PipelineProgress from '../components/PipelineProgress'
import { BACKEND_MODE, buildJobClipVideoUrl } from '../config/backend'
import {
  createInitialPipelineSteps,
  PIPELINE_STEP_DEFINITIONS,
  resolvePipelineStepId
} from '../data/pipeline'
import {
  startPipelineJob,
  subscribeToPipelineEvents,
  type PipelineEventMessage
} from '../services/pipelineApi'
import { formatDuration, formatViews, timeAgo } from '../lib/format'
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
  const [state, setState] = useState<HomePipelineState>(() => initialState)

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

  const availableAccounts = useMemo(
    () =>
      accounts.filter(
        (account) => account.active && account.platforms.some((platform) => platform.active)
      ),
    [accounts]
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
            return { ...step, status: 'completed', progress: 1 }
          }
          if (index === stepIndex) {
            return { ...step, status: 'running', progress: 0 }
          }
          return { ...step, status: 'pending', progress: 0 }
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
                  status: progress >= 1 ? 'completed' : 'running'
                }
              }

              if (index < stepIndex && (step.status !== 'completed' || step.progress !== 1)) {
                return { ...step, status: 'completed', progress: 1 }
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
        const resolvedId = resolvePipelineStepId(event.step)
        if (!resolvedId || typeof event.data?.progress !== 'number') {
          return
        }
        const progressValue = clamp01(event.data.progress)
        const completedValue =
          typeof event.data.completed === 'number' ? Math.max(0, event.data.completed) : null
        const totalValue =
          typeof event.data.total === 'number' ? Math.max(0, event.data.total) : null

        updateState((prev) => ({
          ...prev,
          steps: prev.steps.map((step, index) => {
            if (PIPELINE_STEP_DEFINITIONS[index]?.id !== resolvedId) {
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
              return { ...step, clipProgress: nextClipProgress }
            }
            return {
              ...step,
              status: 'running',
              progress: progressValue,
              clipProgress: nextClipProgress
            }
          })
        }))
        return
      }

      if (event.type === 'step_started' || event.type === 'step_completed' || event.type === 'step_failed') {
        const resolvedId = resolvePipelineStepId(event.step)
        if (!resolvedId) {
          return
        }
        const targetIndex = PIPELINE_STEP_DEFINITIONS.findIndex((definition) => definition.id === resolvedId)
        if (targetIndex === -1) {
          return
        }

        updateState((prev) => ({
          ...prev,
          steps: prev.steps.map((step, index) => {
            if (index < targetIndex && step.status !== 'completed') {
              return { ...step, status: 'completed', progress: 1 }
            }
            if (index === targetIndex) {
              if (event.type === 'step_started') {
                return { ...step, status: 'running', progress: 0 }
              }
              if (event.type === 'step_completed') {
                return { ...step, status: 'completed', progress: 1 }
              }
              return { ...step, status: 'failed', progress: 1 }
            }
            return step
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
        const views = typeof data.views === 'number' ? data.views : null
        const quote = typeof data.quote === 'string' ? data.quote : null
        const reason = typeof data.reason === 'string' ? data.reason : null
        const rating = typeof data.rating === 'number' ? data.rating : null
        const playbackClipId = typeof data.clip_id === 'string' ? data.clip_id : null

        if (!clipId || !description || !createdAt || !playbackClipId || !durationValue || !sourceUrl) {
          return
        }

        const playbackUrl = buildJobClipVideoUrl(jobId, playbackClipId)

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
            quote,
            reason,
            rating
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
                return step
              }
              return { ...step, status: 'completed', progress: 1 }
            }
            if (step.status === 'completed' || step.status === 'failed') {
              return step
            }
            return { ...step, status: 'failed', progress: 1 }
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
        accountError: prev.accountError ? null : prev.accountError
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

  const handleClipRemove = useCallback((clipId: string) => {
    updateState((prev) => ({
      ...prev,
      clips: prev.clips.filter((clip) => clip.id !== clipId)
    }))
  }, [updateState])

  const handleClipSelect = useCallback((clipId: string) => {
    updateState((prev) => ({ ...prev, selectedClipId: clipId }))
  }, [updateState])

  const hasProgress = useMemo(
    () => steps.some((step) => step.status !== 'pending' || step.progress > 0),
    [steps]
  )

  const currentStep = useMemo(() => steps.find((step) => step.status === 'running') ?? null, [steps])
  const selectedClip = useMemo(
    () => clips.find((clip) => clip.id === selectedClipId) ?? null,
    [clips, selectedClipId]
  )

  const pipelineMessage = useMemo(() => {
    if (pipelineError) {
      return pipelineError
    }
    if (currentStep) {
      return `Currently processing: ${currentStep.title}`
    }
    if (clips.length > 0 && !isProcessing) {
      return 'Processing complete. Review the generated clips below.'
    }
    return 'Paste a supported link to kick off the Atropos pipeline.'
  }, [clips.length, currentStep, isProcessing, pipelineError])

  return (
    <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-6">
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]"
          >
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold text-[var(--fg)]">Process a new video</h2>
              <p className="text-sm text-[var(--muted)]">{pipelineMessage}</p>
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
                  className="rounded-lg border border-transparent bg-[var(--ring)] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isProcessing ? 'Processing…' : 'Start processing'}
                </button>
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={!hasProgress && clips.length === 0 && !pipelineError}
                  className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
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
            <PipelineProgress steps={steps} />
          </div>

          <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-6 shadow-[0_20px_40px_-24px_rgba(15,23,42,0.6)]">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-semibold text-[var(--fg)]">Selected clip</h3>
              <p className="text-sm text-[var(--muted)]">
                {selectedClip
                  ? 'Preview the highlight before exporting or sharing it.'
                  : 'Generated clips will appear once the pipeline reaches the candidate stage.'}
              </p>
            </div>
            {selectedClip ? (
              <div className="mt-4 flex flex-col gap-4">
                <div className="aspect-video w-full overflow-hidden rounded-xl bg-black/60">
                  <video
                    key={selectedClip.id}
                    src={selectedClip.playbackUrl}
                    poster={selectedClip.thumbnail}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full object-cover"
                  >
                    Your browser does not support the video tag.
                  </video>
                </div>
                <div className="space-y-4 text-sm text-[var(--muted)]">
                  <div className="space-y-2">
                    <p className="text-base font-semibold text-[var(--fg)] leading-tight">
                      {selectedClip.title}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-semibold text-[var(--fg)] text-sm">{selectedClip.channel}</span>
                      {selectedClip.views !== null ? <span>{formatViews(selectedClip.views)} views</span> : null}
                      {selectedClip.sourcePublishedAt ? (
                        <span>Published {timeAgo(selectedClip.sourcePublishedAt)}</span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <span>Duration {formatDuration(selectedClip.durationSec)}</span>
                      <span>Generated {timeAgo(selectedClip.createdAt)}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <a
                      href={selectedClip.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white"
                    >
                      View full video
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M13.5 2h-5a.75.75 0 0 0 0 1.5H11l-6.72 6.72a.75.75 0 0 0 1.06 1.06L12 4.56v2.5a.75.75 0 0 0 1.5 0v-5A.75.75 0 0 0 13.5 2"
                        />
                      </svg>
                    </a>
                    {selectedClip.quote ? (
                      <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-[var(--muted)]">
                        “{selectedClip.quote}”
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-[var(--fg)]">Description</h4>
                    <ClipDescription
                      text={selectedClip.description}
                      className="text-sm leading-relaxed text-[var(--muted)]"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-8 text-center text-sm text-[var(--muted)]">
                No clips have been generated yet. Start processing a video to populate the clip drawer.
              </div>
            )}
          </div>
        </div>

        <ClipDrawer
          clips={clips}
          selectedClipId={selectedClipId}
          onSelect={handleClipSelect}
          onRemove={handleClipRemove}
          className="lg:sticky lg:top-6"
        />
      </div>
    </section>
  )
}

export default Home
