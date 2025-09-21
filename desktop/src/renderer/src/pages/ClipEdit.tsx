import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FC, ChangeEvent } from 'react'
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

const parseClipBounds = (clipId: string): { start: number; end: number } | null => {
  const match = clipId.match(/clip_(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/i)
  if (!match) {
    return null
  }
  const [, startRaw, endRaw] = match
  const start = Number.parseFloat(startRaw ?? '')
  const end = Number.parseFloat(endRaw ?? '')
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    return null
  }
  return { start, end }
}

const toSeconds = (value: number): number => Math.max(0, Number.isFinite(value) ? value : 0)

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

  const parsedBounds = useMemo(() => (sourceClip ? parseClipBounds(sourceClip.id) : null), [sourceClip])
  const originalStart = parsedBounds?.start ?? 0
  const originalEnd = parsedBounds?.end ?? (sourceClip ? originalStart + sourceClip.durationSec : originalStart + 10)

  const [windowPadding, setWindowPadding] = useState(5)
  const [rangeStart, setRangeStart] = useState(originalStart)
  const [rangeEnd, setRangeEnd] = useState(originalEnd)
  const [clipState, setClipState] = useState(sourceClip)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)

  const applyUpdatedClip = useCallback(
    (updated: Clip, fallbackStart: number, fallbackEnd: number) => {
      setClipState(updated)
      const bounds = parseClipBounds(updated.id)
      if (bounds) {
        setRangeStart(bounds.start)
        setRangeEnd(bounds.end)
      } else {
        setRangeStart(fallbackStart)
        setRangeEnd(fallbackEnd)
      }
    },
    []
  )

  useEffect(() => {
    setClipState(sourceClip)
    if (sourceClip) {
      const bounds = parseClipBounds(sourceClip.id)
      if (bounds) {
        setRangeStart(bounds.start)
        setRangeEnd(bounds.end)
      } else {
        setRangeStart(0)
        setRangeEnd(sourceClip.durationSec)
      }
    }
  }, [sourceClip])

  const windowStartBase = Math.min(originalStart, rangeStart)
  const windowEndBase = Math.max(originalEnd, rangeEnd)
  const windowStart = Math.max(0, windowStartBase - windowPadding)
  const windowEnd = windowEndBase + windowPadding
  const minGap = 0.25

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

  const handleReset = useCallback(() => {
    setRangeStart(originalStart)
    setRangeEnd(originalEnd)
    setWindowPadding(5)
    setSaveError(null)
    setSaveSuccess(null)
  }, [originalEnd, originalStart])

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
        applyUpdatedClip(updated, adjustedStart, adjustedEnd)
      } else {
        const jobId = state?.jobId
        if (!jobId) {
          throw new Error('Missing job information for this clip.')
        }
        const updated = await adjustJobClip(jobId, clipState.id, {
          startSeconds: adjustedStart,
          endSeconds: adjustedEnd
        })
        applyUpdatedClip(updated, adjustedStart, adjustedEnd)
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
              <div className="relative h-2 rounded-full bg-white/10">
                <div
                  className="absolute h-2 rounded-full bg-[var(--ring)]"
                  style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
                />
              </div>
              <div className="relative mt-6 flex items-center">
                <input
                  type="range"
                  min={windowStart}
                  max={windowEnd}
                  step="0.1"
                  value={rangeStart}
                  onChange={(event) => handleRangeInputChange(event, 'start')}
                  className="pointer-events-auto absolute z-20 h-2 w-full appearance-none bg-transparent"
                />
                <input
                  type="range"
                  min={windowStart}
                  max={windowEnd}
                  step="0.1"
                  value={rangeEnd}
                  onChange={(event) => handleRangeInputChange(event, 'end')}
                  className="pointer-events-auto absolute z-10 h-2 w-full appearance-none bg-transparent"
                />
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
              <label className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Review window
                <input
                  type="range"
                  min={0}
                  max={30}
                  step={1}
                  value={windowPadding}
                  onChange={(event) => setWindowPadding(Number.parseFloat(event.target.value) || 0)}
                  className="ml-4 flex-1"
                />
              </label>
              <p className="text-xs">
                Expanding the window gives you more room to pull the clip start earlier or extend the ending for additional context.
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
