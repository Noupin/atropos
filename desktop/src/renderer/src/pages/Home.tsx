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
import ClipDrawer from '../components/ClipDrawer'
import PipelineProgress from '../components/PipelineProgress'
import { CLIPS } from '../mock/clips'
import { BACKEND_MODE } from '../config/backend'
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
import type { Clip, PipelineStep, SearchBridge } from '../types'

const CLIP_PREVIEW_LIMIT = 6

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
}

const Home: FC<HomeProps> = ({ registerSearch }) => {
  const [videoUrl, setVideoUrl] = useState('')
  const [urlError, setUrlError] = useState<string | null>(null)
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [steps, setSteps] = useState<PipelineStep[]>(() => createInitialPipelineSteps())
  const [isProcessing, setIsProcessing] = useState(false)
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)

  const timersRef = useRef<number[]>([])
  const runStepRef = useRef<(index: number) => void>(() => {})
  const connectionCleanupRef = useRef<(() => void) | null>(null)

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
        setIsProcessing(false)
        return
      }

      const definition = PIPELINE_STEP_DEFINITIONS[stepIndex]
      const increments = 5
      const incrementDuration = Math.max(500, Math.round(definition.durationMs / increments))

      setSteps((prev) =>
        prev.map((step, index) => {
          if (index < stepIndex) {
            return { ...step, status: 'completed', progress: 1 }
          }
          if (index === stepIndex) {
            return { ...step, status: 'running', progress: 0 }
          }
          return { ...step, status: 'pending', progress: 0 }
        })
      )

      for (let i = 1; i <= increments; i += 1) {
        const timeout = window.setTimeout(() => {
          setSteps((prev) =>
            prev.map((step, index) => {
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
          )

          if (i === increments) {
            if (stepIndex === PIPELINE_STEP_DEFINITIONS.length - 1) {
              setIsProcessing(false)
            } else {
              const nextTimeout = window.setTimeout(() => runStepRef.current(stepIndex + 1), 500)
              timersRef.current.push(nextTimeout)
            }
          }
        }, incrementDuration * i)

        timersRef.current.push(timeout)
      }
    }
  }, [clearTimers, isMockBackend])

  const handlePipelineEvent = useCallback(
    (event: PipelineEventMessage) => {
      if (event.type === 'pipeline_started') {
        setSteps(createInitialPipelineSteps())
        setPipelineError(null)
        setIsProcessing(true)
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

        setSteps((prev) =>
          prev.map((step, index) => {
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
        )

        if (event.type === 'step_failed') {
          setPipelineError(event.message ?? 'Pipeline step failed.')
        }
        return
      }

      if (event.type === 'pipeline_completed') {
        const successValue = event.data?.success
        const success = typeof successValue === 'boolean' ? successValue : true
        const errorValue = event.data?.error
        const errorMessage =
          typeof errorValue === 'string' ? errorValue : typeof event.message === 'string' ? event.message : null

        setPipelineError(success ? null : errorMessage ?? 'Pipeline failed.')
        setIsProcessing(false)
        setSteps((prev) =>
          prev.map((step) => {
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
        )
        cleanupConnection()
      }
    },
    [cleanupConnection]
  )

  const startRealProcessing = useCallback(
    async (urlToProcess: string) => {
      setIsProcessing(true)
      setPipelineError(null)
      cleanupConnection()

      try {
        const { jobId } = await startPipelineJob({ url: urlToProcess })
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
            setPipelineError(error.message)
            setIsProcessing(false)
            cleanupConnection()
          },
          onClose: () => {
            if (connectionCleanupRef.current === cleanup) {
              connectionCleanupRef.current = null
            }
          }
        })
      } catch (error) {
        setPipelineError(error instanceof Error ? error.message : 'Unable to start the pipeline.')
        setIsProcessing(false)
      }
    },
    [cleanupConnection, handlePipelineEvent]
  )

  useEffect(() => {
    if (clips.length === 0) {
      if (selectedClipId !== null) {
        setSelectedClipId(null)
      }
      return
    }

    if (!selectedClipId || !clips.some((clip) => clip.id === selectedClipId)) {
      setSelectedClipId(clips[0].id)
    }
  }, [clips, selectedClipId])

  useEffect(() => {
    const candidatesStep = steps.find((step) => step.id === 'find-candidates')
    if (candidatesStep && candidatesStep.status === 'completed') {
      setClips((current) => (current.length > 0 ? current : CLIPS.slice(0, CLIP_PREVIEW_LIMIT)))
    }
  }, [steps])

  const handleUrlChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setVideoUrl(event.target.value)
      if (urlError) {
        setUrlError(null)
      }
    },
    [urlError]
  )

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const trimmed = videoUrl.trim()

      if (!trimmed) {
        setUrlError('Enter a video URL to start processing.')
        return
      }

      if (!isValidVideoUrl(trimmed)) {
        setUrlError('Enter a valid YouTube or Twitch URL.')
        return
      }

      setUrlError(null)
      setPipelineError(null)
      clearTimers()
      cleanupConnection()
      setClips([])
      setSelectedClipId(null)
      setSteps(createInitialPipelineSteps())
      setIsProcessing(true)

      if (isMockBackend) {
        const startTimeout = window.setTimeout(() => runStepRef.current(0), 150)
        timersRef.current.push(startTimeout)
        return
      }

      void startRealProcessing(trimmed)
    },
    [cleanupConnection, clearTimers, isMockBackend, startRealProcessing, videoUrl]
  )

  const handleReset = useCallback(() => {
    clearTimers()
    cleanupConnection()
    setSteps(createInitialPipelineSteps())
    setIsProcessing(false)
    setClips([])
    setPipelineError(null)
    setUrlError(null)
    setSelectedClipId(null)
  }, [cleanupConnection, clearTimers])

  const handleClipRemove = useCallback((clipId: string) => {
    setClips((current) => current.filter((clip) => clip.id !== clipId))
  }, [])

  const handleClipSelect = useCallback((clipId: string) => {
    setSelectedClipId(clipId)
  }, [])

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
            <div className="flex flex-col gap-3 sm:flex-row">
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
                  <img
                    src={selectedClip.thumbnail}
                    alt={selectedClip.title}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="space-y-2 text-sm text-[var(--muted)]">
                  <p className="text-base font-semibold text-[var(--fg)] leading-tight">{selectedClip.title}</p>
                  <p>{selectedClip.channel} • {formatViews(selectedClip.views)} views</p>
                  <p>
                    Duration: {formatDuration(selectedClip.durationSec)} • Published {timeAgo(selectedClip.createdAt)}
                  </p>
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
