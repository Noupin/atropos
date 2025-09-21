import { useCallback, useEffect, useRef, useState } from 'react'
import type { FC, ChangeEvent, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatDuration } from '../lib/format'
import { adjustJobClip } from '../services/pipelineApi'
import { adjustLibraryClip } from '../services/clipLibrary'
import type { Clip, SearchBridge } from '../types'

type ClipEditLocationState = {
  clip?: Clip
  jobId?: string | null
  accountId?: string | null
  context?: 'job' | 'library'
}

const toSeconds = (value: number): number => Math.max(0, Number.isFinite(value) ? value : 0)
const MIN_CLIP_GAP = 0.25
const DEFAULT_EXPAND_SECONDS = 10

const ClipEdit: FC<{ registerSearch: (bridge: SearchBridge | null) => void }> = ({ registerSearch }) => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state as ClipEditLocationState | null) ?? null

  const sourceClip = state?.clip && (!id || state.clip.id === id) ? state.clip : null

  useEffect(() => {
    registerSearch(null)
    return () => registerSearch(null)
  }, [registerSearch])

  const [clipState, setClipState] = useState<Clip | null>(sourceClip ?? null)
  const [rangeStart, setRangeStart] = useState(() => {
    if (sourceClip) {
      return sourceClip.startSeconds
    }
    return 0
  })
  const [rangeEnd, setRangeEnd] = useState(() => {
    if (sourceClip) {
      return Math.max(sourceClip.startSeconds + MIN_CLIP_GAP, sourceClip.endSeconds)
    }
    return MIN_CLIP_GAP
  })
  const [windowStart, setWindowStart] = useState(() => {
    if (!sourceClip) {
      return 0
    }
    return Math.max(0, Math.min(sourceClip.startSeconds, sourceClip.originalStartSeconds))
  })
  const [windowEnd, setWindowEnd] = useState(() => {
    if (!sourceClip) {
      return MIN_CLIP_GAP
    }
    return Math.max(
      sourceClip.endSeconds,
      sourceClip.originalEndSeconds,
      sourceClip.startSeconds + MIN_CLIP_GAP,
      sourceClip.originalStartSeconds + MIN_CLIP_GAP
    )
  })
  const [expandAmount, setExpandAmount] = useState(DEFAULT_EXPAND_SECONDS)
  const [activeHandle, setActiveHandle] = useState<'start' | 'end' | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  const originalStart = clipState?.originalStartSeconds ?? 0
  const originalEnd = clipState?.originalEndSeconds ?? (originalStart + (clipState?.durationSec ?? 10))

  const applyUpdatedClip = useCallback((updated: Clip) => {
    setClipState(updated)
    setRangeStart(updated.startSeconds)
    setRangeEnd(updated.endSeconds)
    setWindowStart(Math.max(0, Math.min(updated.startSeconds, updated.originalStartSeconds)))
    setWindowEnd(Math.max(updated.endSeconds, updated.originalEndSeconds))
  }, [])

  useEffect(() => {
    setClipState(sourceClip ?? null)
  }, [sourceClip])

  useEffect(() => {
    if (!clipState) {
      setRangeStart(0)
      setRangeEnd(MIN_CLIP_GAP)
      setWindowStart(0)
      setWindowEnd(MIN_CLIP_GAP)
      return
    }
    setRangeStart(clipState.startSeconds)
    setRangeEnd(clipState.endSeconds)
    setWindowStart(Math.max(0, Math.min(clipState.startSeconds, clipState.originalStartSeconds)))
    setWindowEnd(
      Math.max(
        clipState.endSeconds,
        clipState.originalEndSeconds,
        clipState.startSeconds + minGap,
        clipState.originalStartSeconds + minGap
      )
    )
  }, [clipState, minGap])

  const minGap = MIN_CLIP_GAP

  const clampWithinWindow = useCallback(
    (value: number, kind: 'start' | 'end'): number => {
      if (kind === 'start') {
        return Math.min(Math.max(windowStart, value), rangeEnd - minGap)
      }
      return Math.max(Math.min(windowEnd, value), rangeStart + minGap)
    },
    [rangeEnd, rangeStart, windowEnd, windowStart]
  )

  const handleStartChange = useCallback(
    (value: number) => {
      const next = clampWithinWindow(value, 'start')
      setRangeStart(Math.min(next, rangeEnd - minGap))
    },
    [clampWithinWindow, rangeEnd]
  )

  const handleEndChange = useCallback(
    (value: number) => {
      const next = clampWithinWindow(value, 'end')
      setRangeEnd(Math.max(next, rangeStart + minGap))
    },
    [clampWithinWindow, rangeStart]
  )

  const handleRangeInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>, kind: 'start' | 'end') => {
      const value = Number.parseFloat(event.target.value)
      if (Number.isNaN(value)) {
        return
      }
      if (kind === 'start') {
        handleStartChange(value)
      } else {
        handleEndChange(value)
      }
    },
    [handleEndChange, handleStartChange]
  )

  const updateRangeFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, kind: 'start' | 'end') => {
      if (!timelineRef.current) {
        return
      }
      const rect = timelineRef.current.getBoundingClientRect()
      if (rect.width <= 0) {
        return
      }
      const ratio = (event.clientX - rect.left) / rect.width
      const clamped = Math.min(1, Math.max(0, ratio))
      const value = windowStart + clamped * (windowEnd - windowStart)
      if (kind === 'start') {
        handleStartChange(value)
      } else {
        handleEndChange(value)
      }
    },
    [handleEndChange, handleStartChange, windowEnd, windowStart]
  )

  const handleHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, kind: 'start' | 'end') => {
      event.preventDefault()
      setActiveHandle(kind)
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch (error) {
        // ignore pointer capture errors for unsupported browsers
      }
      updateRangeFromPointer(event, kind)
    },
    [updateRangeFromPointer]
  )

  const handleHandlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, kind: 'start' | 'end') => {
      if (activeHandle !== kind) {
        return
      }
      event.preventDefault()
      updateRangeFromPointer(event, kind)
    },
    [activeHandle, updateRangeFromPointer]
  )

  const handleHandlePointerEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch (error) {
      // ignore release errors
    }
    setActiveHandle(null)
  }, [])

  const handleHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, kind: 'start' | 'end') => {
      const { key } = event
      const step = event.shiftKey ? 1 : 0.1
      if (key === 'ArrowLeft' || key === 'ArrowDown') {
        event.preventDefault()
        if (kind === 'start') {
          handleStartChange(rangeStart - step)
        } else {
          handleEndChange(rangeEnd - step)
        }
      } else if (key === 'ArrowRight' || key === 'ArrowUp') {
        event.preventDefault()
        if (kind === 'start') {
          handleStartChange(rangeStart + step)
        } else {
          handleEndChange(rangeEnd + step)
        }
      } else if (key === 'Home') {
        event.preventDefault()
        if (kind === 'start') {
          handleStartChange(windowStart)
        } else {
          handleEndChange(rangeStart + minGap)
        }
      } else if (key === 'End') {
        event.preventDefault()
        if (kind === 'start') {
          handleStartChange(rangeEnd - minGap)
        } else {
          handleEndChange(windowEnd)
        }
      }
    },
    [handleEndChange, handleStartChange, minGap, rangeEnd, rangeStart, windowEnd, windowStart]
  )

  const handleExpandAmountChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value)
    if (Number.isNaN(value)) {
      return
    }
    setExpandAmount(value >= 0 ? value : 0)
  }, [])

  const handleExpandLeft = useCallback(() => {
    if (expandAmount <= 0) {
      return
    }
    setWindowStart((prev) => Math.max(0, prev - expandAmount))
  }, [expandAmount])

  const handleExpandRight = useCallback(() => {
    if (expandAmount <= 0) {
      return
    }
    setWindowEnd((prev) => prev + expandAmount)
  }, [expandAmount])

  const handleReset = useCallback(() => {
    if (!clipState) {
      setRangeStart(0)
      setRangeEnd(MIN_CLIP_GAP)
      setWindowStart(0)
      setWindowEnd(MIN_CLIP_GAP)
    } else {
      const baseStart = Math.max(0, Math.min(clipState.originalStartSeconds, clipState.startSeconds))
      const baseEnd = Math.max(
        clipState.originalEndSeconds,
        clipState.endSeconds,
        clipState.originalStartSeconds + minGap,
        clipState.startSeconds + minGap
      )
      setRangeStart(clipState.originalStartSeconds)
      setRangeEnd(Math.max(clipState.originalStartSeconds + minGap, clipState.originalEndSeconds))
      setWindowStart(baseStart)
      setWindowEnd(baseEnd)
    }
    setSaveError(null)
    setSaveSuccess(null)
  }, [clipState, minGap])

  const durationSeconds = Math.max(minGap, rangeEnd - rangeStart)
  const context = state?.context ?? 'job'

  const handleSave = useCallback(async () => {
    if (!clipState) {
      return
    }
    const adjustedStart = toSeconds(rangeStart)
    const adjustedEnd = toSeconds(rangeEnd)
    if (adjustedEnd - adjustedStart < minGap) {
      setSaveError('Clip length must be at least 0.25 seconds.')
      setSaveSuccess(null)
      return
    }

    setIsSaving(true)
    setSaveError(null)
    try {
      if (context === 'library') {
        const accountId = state?.accountId ?? clipState.accountId
        if (!accountId) {
          throw new Error('Missing account information for this clip.')
        }
        const updated = await adjustLibraryClip(accountId, clipState.id, {
          startSeconds: adjustedStart,
          endSeconds: adjustedEnd
        })
        applyUpdatedClip(updated)
      } else {
        const jobId = state?.jobId
        if (!jobId) {
          throw new Error('Missing job information for this clip.')
        }
        const updated = await adjustJobClip(jobId, clipState.id, {
          startSeconds: adjustedStart,
          endSeconds: adjustedEnd
        })
        applyUpdatedClip(updated)
      }
      setSaveSuccess('Clip boundaries updated successfully.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to update the clip boundaries. Please try again.'
      setSaveError(message)
      setSaveSuccess(null)
    } finally {
      setIsSaving(false)
    }
  }, [
    applyUpdatedClip,
    clipState,
    context,
    rangeEnd,
    rangeStart,
    state?.accountId,
    state?.jobId
  ])

  if (!clipState || !id) {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="self-start rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Back
        </button>
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-10 text-center">
          <h2 className="text-xl font-semibold text-[var(--fg)]">Clip information unavailable</h2>
          <p className="mt-2 max-w-md text-sm text-[var(--muted)]">
            We couldn’t find the clip details needed for editing. Return to the previous page and try opening the editor again.
          </p>
        </div>
      </section>
    )
  }

  const timelineTotal = Math.max(windowEnd - windowStart, minGap)
  const startPercent = ((rangeStart - windowStart) / timelineTotal) * 100
  const endPercent = ((rangeEnd - windowStart) / timelineTotal) * 100

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="self-start rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Back
      </button>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4">
          <video
            key={`${clipState.id}-${clipState.playbackUrl}`}
            src={clipState.playbackUrl}
            poster={clipState.thumbnail ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full rounded-xl bg-black/50 object-contain"
          >
            Your browser does not support the video tag.
          </video>
        </div>
        <div className="flex w-full max-w-xl flex-col gap-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-[var(--fg)]">Refine clip boundaries</h1>
            <p className="text-sm text-[var(--muted)]">
              Drag the handles or enter precise timestamps to trim the clip before regenerating subtitles and renders.
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Clip window
              </div>
              <div
                ref={timelineRef}
                className="relative mt-6 h-2 rounded-full bg-white/10"
              >
                <div
                  className="pointer-events-none absolute top-0 bottom-0 rounded-full bg-[var(--ring)]"
                  style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
                />
                <button
                  type="button"
                  role="slider"
                  aria-label="Adjust clip start"
                  aria-valuemin={Number(windowStart.toFixed(2))}
                  aria-valuemax={Number((rangeEnd - minGap).toFixed(2))}
                  aria-valuenow={Number(rangeStart.toFixed(2))}
                  aria-valuetext={formatDuration(rangeStart)}
                  onPointerDown={(event) => handleHandlePointerDown(event, 'start')}
                  onPointerMove={(event) => handleHandlePointerMove(event, 'start')}
                  onPointerUp={handleHandlePointerEnd}
                  onPointerCancel={handleHandlePointerEnd}
                  onKeyDown={(event) => handleHandleKeyDown(event, 'start')}
                  className="absolute top-1/2 z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--card)] shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  style={{ left: `${startPercent}%` }}
                >
                  <span className="sr-only">Drag to adjust start</span>
                </button>
                <button
                  type="button"
                  role="slider"
                  aria-label="Adjust clip end"
                  aria-valuemin={Number((rangeStart + minGap).toFixed(2))}
                  aria-valuemax={Number(windowEnd.toFixed(2))}
                  aria-valuenow={Number(rangeEnd.toFixed(2))}
                  aria-valuetext={formatDuration(rangeEnd)}
                  onPointerDown={(event) => handleHandlePointerDown(event, 'end')}
                  onPointerMove={(event) => handleHandlePointerMove(event, 'end')}
                  onPointerUp={handleHandlePointerEnd}
                  onPointerCancel={handleHandlePointerEnd}
                  onKeyDown={(event) => handleHandleKeyDown(event, 'end')}
                  className="absolute top-1/2 z-20 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--card)] shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  style={{ left: `${endPercent}%` }}
                >
                  <span className="sr-only">Drag to adjust end</span>
                </button>
              </div>
              <div className="flex justify-between text-xs text-[var(--muted)]">
                <span>{formatDuration(windowStart)}</span>
                <span>{formatDuration(windowEnd)}</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Start time
                <input
                  type="number"
                  step="0.1"
                  min={windowStart}
                  max={rangeEnd - minGap}
                  value={rangeStart.toFixed(1)}
                  onChange={(event) => handleRangeInputChange(event, 'start')}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                End time
                <input
                  type="number"
                  step="0.1"
                  min={rangeStart + minGap}
                  max={windowEnd}
                  value={rangeEnd.toFixed(1)}
                  onChange={(event) => handleRangeInputChange(event, 'end')}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </label>
            </div>
            <div className="flex flex-col gap-2 text-sm text-[var(--muted)]">
              <div className="flex items-center justify-between">
                <span>Adjusted duration</span>
                <span className="font-semibold text-[var(--fg)]">{formatDuration(durationSeconds)}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                <label className="flex items-center gap-2">
                  Expand window (seconds)
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={expandAmount}
                    onChange={handleExpandAmountChange}
                    className="w-20 rounded-lg border border-white/10 bg-[var(--card)] px-2 py-1 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleExpandLeft}
                    className="rounded-lg border border-white/10 px-2 py-1 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    Expand left
                  </button>
                  <button
                    type="button"
                    onClick={handleExpandRight}
                    className="rounded-lg border border-white/10 px-2 py-1 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    Expand right
                  </button>
                </div>
              </div>
              <p className="text-xs">
                Expanding the window lets you pull the clip start earlier or extend the ending without moving the saved boundaries.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded-lg border border-transparent bg-[var(--ring)] px-3 py-2 text-sm font-semibold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save adjustments'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg border border-white/10 px-3 py-2 text-sm font-medium text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              Reset to original
            </button>
          </div>
          {saveError ? <p className="text-sm text-rose-400">{saveError}</p> : null}
          {saveSuccess ? <p className="text-sm text-emerald-300">{saveSuccess}</p> : null}
        </div>
      </div>
      <div className="grid gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 text-sm text-[var(--muted)] sm:grid-cols-[auto_1fr]">
        <span className="font-medium text-[var(--fg)]">Original start</span>
        <span>{formatDuration(originalStart)}</span>
        <span className="font-medium text-[var(--fg)]">Original end</span>
        <span>{formatDuration(originalEnd)}</span>
        <span className="font-medium text-[var(--fg)]">Current start</span>
        <span>{formatDuration(rangeStart)}</span>
        <span className="font-medium text-[var(--fg)]">Current end</span>
        <span>{formatDuration(rangeEnd)}</span>
        <span className="font-medium text-[var(--fg)]">Clip title</span>
        <span>{clipState.title}</span>
        <span className="font-medium text-[var(--fg)]">Channel</span>
        <span>{clipState.channel}</span>
      </div>
    </section>
  )
}

export default ClipEdit
