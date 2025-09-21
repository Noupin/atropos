import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FC, ChangeEvent, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatDuration } from '../lib/format'
import { adjustJobClip, fetchJobClip } from '../services/pipelineApi'
import { adjustLibraryClip, fetchLibraryClip } from '../services/clipLibrary'
import type { Clip, SearchBridge } from '../types'

type ClipEditLocationState = {
  clip?: Clip
  jobId?: string | null
  accountId?: string | null
  context?: 'job' | 'library'
}

const toSeconds = (value: number): number => Math.max(0, Number.isFinite(value) ? value : 0)
const MIN_CLIP_GAP = 0.25
const MIN_PREVIEW_DURATION = 0.05
const DEFAULT_EXPAND_SECONDS = 10

const getDefaultPreviewMode = (clip: Clip | null): 'adjusted' | 'rendered' =>
  clip && clip.previewUrl === clip.playbackUrl ? 'rendered' : 'adjusted'

const formatRelativeSeconds = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) {
    return '0'
  }
  const sign = value > 0 ? '+' : '-'
  const formatted = Math.abs(value).toFixed(2).replace(/\.?0+$/, '')
  return `${sign}${formatted}`
}

type SaveStepId = 'cut' | 'subtitles' | 'render'
type SaveStepStatus = 'pending' | 'running' | 'completed' | 'failed'

type SaveStepState = {
  id: SaveStepId
  label: string
  description: string
  status: SaveStepStatus
}

const SAVE_STEP_DEFINITIONS: ReadonlyArray<Omit<SaveStepState, 'status'>> = [
  {
    id: 'cut',
    label: 'Cut clip',
    description: 'Trim the source footage to the requested window'
  },
  {
    id: 'subtitles',
    label: 'Regenerate subtitles',
    description: 'Update transcript snippets to match the new timing'
  },
  {
    id: 'render',
    label: 'Render vertical clip',
    description: 'Apply layout and export the final short'
  }
]

const createInitialSaveSteps = (): SaveStepState[] =>
  SAVE_STEP_DEFINITIONS.map((step) => ({ ...step, status: 'pending' }))

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const ClipEdit: FC<{ registerSearch: (bridge: SearchBridge | null) => void }> = ({ registerSearch }) => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state as ClipEditLocationState | null) ?? null

  const sourceClip = state?.clip && (!id || state.clip.id === id) ? state.clip : null
  const context = state?.context ?? 'job'

  useEffect(() => {
    registerSearch(null)
    return () => registerSearch(null)
  }, [registerSearch])

  const minGap = MIN_CLIP_GAP

  const [clipState, setClipState] = useState<Clip | null>(sourceClip ?? null)
  const [isLoadingClip, setIsLoadingClip] = useState(!sourceClip && Boolean(id))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [rangeStart, setRangeStart] = useState(() => {
    if (sourceClip) {
      return sourceClip.startSeconds
    }
    return 0
  })
  const [rangeEnd, setRangeEnd] = useState(() => {
    if (sourceClip) {
      return Math.max(sourceClip.startSeconds + minGap, sourceClip.endSeconds)
    }
    return minGap
  })
  const [windowStart, setWindowStart] = useState(() => {
    if (!sourceClip) {
      return 0
    }
    return Math.max(0, Math.min(sourceClip.startSeconds, sourceClip.originalStartSeconds))
  })
  const [windowEnd, setWindowEnd] = useState(() => {
    if (!sourceClip) {
      return minGap
    }
    return Math.max(
      sourceClip.endSeconds,
      sourceClip.originalEndSeconds,
      sourceClip.startSeconds + minGap,
      sourceClip.originalStartSeconds + minGap
    )
  })
  const [expandAmount, setExpandAmount] = useState(DEFAULT_EXPAND_SECONDS)
  const [activeHandle, setActiveHandle] = useState<'start' | 'end' | null>(null)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'adjusted' | 'original' | 'rendered'>(() =>
    getDefaultPreviewMode(sourceClip ?? null)
  )
  const [previewTarget, setPreviewTarget] = useState(() => ({
    start: sourceClip ? sourceClip.startSeconds : 0,
    end: sourceClip ? Math.max(sourceClip.startSeconds + minGap, sourceClip.endSeconds) : minGap
  }))
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const [isVideoBuffering, setIsVideoBuffering] = useState(false)
  const [saveSteps, setSaveSteps] = useState<SaveStepState[]>(() => createInitialSaveSteps())

  const originalStart = clipState?.originalStartSeconds ?? 0
  const originalEnd = clipState?.originalEndSeconds ?? (originalStart + (clipState?.durationSec ?? 10))
  const supportsSourcePreview = clipState ? clipState.previewUrl !== clipState.playbackUrl : false

  useEffect(() => {
    if (!supportsSourcePreview && previewMode !== 'rendered') {
      setPreviewMode('rendered')
    }
  }, [previewMode, supportsSourcePreview])

  const applyUpdatedClip = useCallback(
    (updated: Clip) => {
      setClipState(updated)
      setRangeStart(updated.startSeconds)
      setRangeEnd(updated.endSeconds)
      setWindowStart(Math.max(0, Math.min(updated.startSeconds, updated.originalStartSeconds)))
      setWindowEnd(
        Math.max(
          updated.endSeconds,
          updated.originalEndSeconds,
          updated.startSeconds + minGap,
          updated.originalStartSeconds + minGap
        )
      )
      setPreviewTarget({ start: updated.startSeconds, end: updated.endSeconds })
      setPreviewMode(getDefaultPreviewMode(updated))
    },
    [minGap]
  )

  useEffect(() => {
    if (!id) {
      setClipState(null)
      setIsLoadingClip(false)
      setLoadError('Clip information is unavailable. Return to the previous screen and try again.')
      return
    }

    if (sourceClip) {
      setClipState(sourceClip)
      setIsLoadingClip(false)
      setLoadError(null)
      return
    }

    let cancelled = false
    const loadClip = async (): Promise<void> => {
      setIsLoadingClip(true)
      setLoadError(null)
      try {
        let clip: Clip
        if (context === 'library') {
          const accountId = state?.accountId
          if (!accountId) {
            throw new Error('This clip is no longer associated with a library account.')
          }
          clip = await fetchLibraryClip(accountId, id)
        } else {
          const jobId = state?.jobId
          if (!jobId) {
            throw new Error('The pipeline job for this clip is no longer active.')
          }
          clip = await fetchJobClip(jobId, id)
        }
        if (!cancelled) {
          setClipState(clip)
          setLoadError(null)
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unable to load clip information. Please try again.'
          setClipState(null)
          setLoadError(message)
        }
      } finally {
        if (!cancelled) {
          setIsLoadingClip(false)
        }
      }
    }

    void loadClip()
    return () => {
      cancelled = true
    }
  }, [context, id, sourceClip, state?.accountId, state?.jobId])

  useEffect(() => {
    if (!clipState) {
      setRangeStart(0)
      setRangeEnd(minGap)
      setWindowStart(0)
      setWindowEnd(minGap)
      setPreviewTarget({ start: 0, end: minGap })
      setPreviewMode('adjusted')
      setSaveSteps(createInitialSaveSteps())
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
    setPreviewTarget({ start: clipState.startSeconds, end: clipState.endSeconds })
    setPreviewMode(getDefaultPreviewMode(clipState))
    setSaveSteps(createInitialSaveSteps())
  }, [clipState, minGap])

  useEffect(() => {
    if (!clipState || previewMode !== 'adjusted') {
      return
    }
    if (typeof window === 'undefined') {
      setPreviewTarget({ start: rangeStart, end: rangeEnd })
      return
    }
    const delayMs = activeHandle ? 200 : 80
    const handle = window.setTimeout(() => {
      setPreviewTarget({ start: rangeStart, end: rangeEnd })
    }, delayMs)
    return () => {
      window.clearTimeout(handle)
    }
  }, [activeHandle, clipState, previewMode, rangeEnd, rangeStart])

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

  const offsetReference = useMemo(() => {
    if (!clipState) {
      return {
        startBase: rangeStart,
        endBase: rangeEnd,
        startLabel: 'adjusted start',
        endLabel: 'adjusted end',
        startTitle: 'Adjusted start',
        endTitle: 'Adjusted end'
      }
    }
    if (previewMode === 'original') {
      return {
        startBase: clipState.originalStartSeconds,
        endBase: clipState.originalEndSeconds,
        startLabel: 'original start',
        endLabel: 'original end',
        startTitle: 'Original start',
        endTitle: 'Original end'
      }
    }
    if (previewMode === 'rendered') {
      return {
        startBase: clipState.startSeconds,
        endBase: clipState.endSeconds,
        startLabel: 'rendered start',
        endLabel: 'rendered end',
        startTitle: 'Rendered start',
        endTitle: 'Rendered end'
      }
    }
    return {
      startBase: rangeStart,
      endBase: rangeEnd,
      startLabel: 'adjusted start',
      endLabel: 'adjusted end',
      startTitle: 'Adjusted start',
      endTitle: 'Adjusted end'
    }
  }, [clipState, previewMode, rangeEnd, rangeStart])

  const handleRangeInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>, kind: 'start' | 'end') => {
      const raw = event.target.value.trim()
      if (raw === '') {
        return
      }
      const value = Number.parseFloat(raw)
      if (Number.isNaN(value)) {
        return
      }
      if (kind === 'start') {
        handleStartChange(offsetReference.startBase + value)
      } else {
        handleEndChange(offsetReference.endBase + value)
      }
    },
    [handleEndChange, handleStartChange, offsetReference.endBase, offsetReference.startBase]
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
      setRangeEnd(minGap)
      setWindowStart(0)
      setWindowEnd(minGap)
      setPreviewTarget({ start: 0, end: minGap })
      setPreviewMode('adjusted')
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
      setPreviewTarget({
        start: clipState.originalStartSeconds,
        end: Math.max(clipState.originalStartSeconds + MIN_PREVIEW_DURATION, clipState.originalEndSeconds)
      })
      setPreviewMode(getDefaultPreviewMode(clipState) === 'adjusted' ? 'original' : 'rendered')
    }
    setSaveError(null)
    setSaveSuccess(null)
    setSaveSteps(createInitialSaveSteps())
  }, [clipState, minGap])

  const durationSeconds = Math.max(minGap, rangeEnd - rangeStart)
  const startOffsetSeconds = rangeStart - offsetReference.startBase
  const endOffsetSeconds = rangeEnd - offsetReference.endBase
  const formattedStartOffset = formatRelativeSeconds(startOffsetSeconds)
  const formattedEndOffset = formatRelativeSeconds(endOffsetSeconds)
  const startOffsetDescription =
    formattedStartOffset === '0'
      ? `Matches the ${offsetReference.startLabel}`
      : `${formattedStartOffset}s from the ${offsetReference.startLabel}`
  const endOffsetDescription =
    formattedEndOffset === '0'
      ? `Matches the ${offsetReference.endLabel}`
      : `${formattedEndOffset}s from the ${offsetReference.endLabel}`

  const shouldShowSaveSteps =
    isSaving || Boolean(saveError) || Boolean(saveSuccess) || saveSteps.some((step) => step.status !== 'pending')

  const renderedSrc = useMemo(() => {
    if (!clipState) {
      return ''
    }
    const cacheKey = `${clipState.createdAt}-${clipState.startSeconds}-${clipState.endSeconds}`
    try {
      const absolute =
        clipState.playbackUrl.startsWith('http://') ||
        clipState.playbackUrl.startsWith('https://') ||
        clipState.playbackUrl.startsWith('file://')
          ? new URL(clipState.playbackUrl)
          : typeof window !== 'undefined'
          ? new URL(clipState.playbackUrl, window.location.origin)
          : null
      if (absolute) {
        absolute.searchParams.set('_', cacheKey)
        return absolute.toString()
      }
    } catch (error) {
      // fall back to manual cache-busting below
    }
    const separator = clipState.playbackUrl.includes('?') ? '&' : '?'
    return `${clipState.playbackUrl}${separator}_=${encodeURIComponent(cacheKey)}`
  }, [clipState])

  const buildPreviewSrc = useCallback(
    (range: { start: number; end: number }, variant: string) => {
      if (!clipState) {
        return ''
      }
      const safeStart = Math.max(0, Number.isFinite(range.start) ? range.start : 0)
      const rawEnd = Number.isFinite(range.end) ? range.end : safeStart
      const safeEnd = rawEnd > safeStart + MIN_PREVIEW_DURATION ? rawEnd : safeStart + MIN_PREVIEW_DURATION
      const cacheToken = `${clipState.id}-${variant}-${safeStart.toFixed(3)}-${safeEnd.toFixed(3)}`
      const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
      try {
        const absolute =
          clipState.previewUrl.startsWith('http://') ||
          clipState.previewUrl.startsWith('https://') ||
          clipState.previewUrl.startsWith('file://')
            ? new URL(clipState.previewUrl)
            : new URL(clipState.previewUrl, baseOrigin)
        absolute.searchParams.set('start', safeStart.toFixed(3))
        absolute.searchParams.set('end', safeEnd.toFixed(3))
        absolute.searchParams.set('_', cacheToken)
        return absolute.toString()
      } catch (error) {
        const separator = clipState.previewUrl.includes('?') ? '&' : '?'
        return `${clipState.previewUrl}${separator}start=${safeStart.toFixed(3)}&end=${safeEnd
          .toFixed(3)}&_=${encodeURIComponent(cacheToken)}`
      }
    },
    [clipState]
  )

  const adjustedPreviewSrc = useMemo(() => {
    if (!clipState) {
      return ''
    }
    return buildPreviewSrc(previewTarget, 'adjusted')
  }, [buildPreviewSrc, clipState, previewTarget])

  const originalPreviewRange = useMemo(() => {
    if (!clipState) {
      return { start: 0, end: minGap }
    }
    const originalStart = Math.max(0, clipState.originalStartSeconds)
    const rawEnd = clipState.originalEndSeconds
    const safeEnd = rawEnd > originalStart + MIN_PREVIEW_DURATION ? rawEnd : originalStart + MIN_PREVIEW_DURATION
    return { start: originalStart, end: safeEnd }
  }, [clipState, minGap])

  const originalPreviewSrc = useMemo(() => {
    if (!clipState) {
      return ''
    }
    return buildPreviewSrc(originalPreviewRange, 'original')
  }, [buildPreviewSrc, clipState, originalPreviewRange])

  const previewSourceIsFile = clipState ? clipState.previewUrl.startsWith('file://') : false

  const currentPreviewRange = useMemo(() => {
    if (!clipState) {
      return { start: 0, end: 0 }
    }
    if (previewMode === 'original') {
      return originalPreviewRange
    }
    if (previewMode === 'adjusted') {
      return previewTarget
    }
    return { start: clipState.startSeconds, end: clipState.endSeconds }
  }, [clipState, originalPreviewRange, previewMode, previewTarget])

  const sanitisedPreviewRange = useMemo(() => {
    const start = Math.max(0, Number.isFinite(currentPreviewRange.start) ? currentPreviewRange.start : 0)
    const rawEnd = Number.isFinite(currentPreviewRange.end) ? currentPreviewRange.end : start
    const end = rawEnd > start + MIN_PREVIEW_DURATION ? rawEnd : start + MIN_PREVIEW_DURATION
    return { start, end }
  }, [currentPreviewRange])

  const previewStart = sanitisedPreviewRange.start
  const previewEnd = sanitisedPreviewRange.end

  const activeVideoSrc =
    previewMode === 'rendered'
      ? renderedSrc
      : previewMode === 'original'
      ? originalPreviewSrc
      : adjustedPreviewSrc

  const activePoster = previewMode === 'rendered' ? clipState?.thumbnail ?? undefined : undefined
  const videoKey = clipState ? `${clipState.id}-${previewMode}-${activeVideoSrc}` : `${previewMode}-${activeVideoSrc}`

  useEffect(() => {
    setIsVideoBuffering(false)
  }, [activeVideoSrc, previewMode])

  const handleVideoLoadStart = useCallback(() => {
    setIsVideoBuffering(true)
  }, [])

  const handleVideoCanPlay = useCallback(() => {
    setIsVideoBuffering(false)
  }, [])

  const handleVideoPlaying = useCallback(() => {
    setIsVideoBuffering(false)
  }, [])

  const handleVideoWaiting = useCallback(() => {
    setIsVideoBuffering(true)
  }, [])

  const handleVideoError = useCallback(() => {
    setIsVideoBuffering(false)
  }, [])

  const handleVideoLoadedMetadata = useCallback(() => {
    if (!clipState || previewMode === 'rendered' || !previewSourceIsFile) {
      return
    }
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    if (Math.abs(element.currentTime - previewStart) > 0.05) {
      element.currentTime = previewStart
    }
  }, [clipState, previewMode, previewSourceIsFile, previewStart])

  const handleVideoPlay = useCallback(() => {
    if (!clipState || previewMode === 'rendered' || !previewSourceIsFile) {
      return
    }
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    if (Math.abs(element.currentTime - previewStart) > 0.05) {
      element.currentTime = previewStart
    }
  }, [clipState, previewMode, previewSourceIsFile, previewStart])

  const handleVideoTimeUpdate = useCallback(() => {
    if (!clipState || previewMode === 'rendered' || !previewSourceIsFile) {
      return
    }
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    if (previewEnd > previewStart && element.currentTime > previewEnd - 0.05) {
      element.pause()
      element.currentTime = previewStart
    }
  }, [clipState, previewEnd, previewMode, previewSourceIsFile, previewStart])

  const runSaveStepAnimation = useCallback(async () => {
    for (let index = 1; index < SAVE_STEP_DEFINITIONS.length; index += 1) {
      await delay(200)
      setSaveSteps((prev) =>
        prev.map((step, stepIndex) => {
          if (stepIndex < index) {
            return { ...step, status: 'completed' }
          }
          if (stepIndex === index) {
            return { ...step, status: 'running' }
          }
          return { ...step, status: 'pending' }
        })
      )
    }
    await delay(200)
    setSaveSteps((prev) => prev.map((step) => ({ ...step, status: 'completed' })))
  }, [])

  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

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

    setSaveSteps(
      SAVE_STEP_DEFINITIONS.map((step, index) => ({
        ...step,
        status: index === 0 ? 'running' : 'pending'
      }))
    )
    setIsSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
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
      await runSaveStepAnimation()
      setSaveSuccess('Clip boundaries updated successfully.')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to update the clip boundaries. Please try again.'
      setSaveError(message)
      setSaveSteps((prev) =>
        prev.map((step) => (step.status === 'running' ? { ...step, status: 'failed' } : step))
      )
    } finally {
      setIsSaving(false)
    }
  }, [
    applyUpdatedClip,
    clipState,
    context,
    rangeEnd,
    rangeStart,
    runSaveStepAnimation,
    state?.accountId,
    state?.jobId
  ])

  if (!clipState) {
    return (
      <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-10">
        <button
          type="button"
          onClick={handleBack}
          className="self-start rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Back
        </button>
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-10 text-center">
          {isLoadingClip ? (
            <div className="flex flex-col items-center gap-4 text-[var(--muted)]">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[var(--ring)]" aria-hidden />
              <p className="text-sm">Loading clip details…</p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-[var(--fg)]">Clip information unavailable</h2>
              <p className="mt-2 max-w-md text-sm text-[var(--muted)]">
                {loadError ??
                  'We couldn’t find the clip details needed for editing. Return to the previous page and try opening the editor again.'}
              </p>
            </>
          )}
        </div>
      </section>
    )
  }

  const timelineTotal = Math.max(windowEnd - windowStart, minGap)
  const startPercent = ((rangeStart - windowStart) / timelineTotal) * 100
  const endPercent = ((rangeEnd - windowStart) / timelineTotal) * 100
  const safeTimelineTotal = timelineTotal <= 0 ? 1 : timelineTotal
  const clampRatio = (value: number): number => Math.max(0, Math.min(1, value))
  const originalStartRatio = clampRatio((clipState.originalStartSeconds - windowStart) / safeTimelineTotal)
  const originalEndRatio = clampRatio((clipState.originalEndSeconds - windowStart) / safeTimelineTotal)
  const originalOverlayLeftPercent = originalStartRatio * 100
  const originalOverlayRightPercent =
    clampRatio((windowEnd - clipState.originalEndSeconds) / safeTimelineTotal) * 100
  const originalStartMarkerPercent = originalStartRatio * 100
  const originalEndMarkerPercent = originalEndRatio * 100

  return (
    <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10">
      <button
        type="button"
        onClick={handleBack}
        className="self-start rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        Back
      </button>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4">
          <div className="flex h-full flex-col gap-4">
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-black">
              <video
                ref={previewVideoRef}
                key={videoKey}
                src={activeVideoSrc}
                poster={activePoster}
                controls
                playsInline
                preload="metadata"
                onLoadStart={handleVideoLoadStart}
                onLoadedMetadata={handleVideoLoadedMetadata}
                onCanPlay={handleVideoCanPlay}
                onPlaying={handleVideoPlaying}
                onWaiting={handleVideoWaiting}
                onError={handleVideoError}
                onTimeUpdate={handleVideoTimeUpdate}
                onPlay={handleVideoPlay}
                className="h-full w-full bg-black object-contain"
              >
                Your browser does not support the video tag.
              </video>
              {isVideoBuffering ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
                  <div
                    className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-transparent"
                    aria-hidden
                  />
                </div>
              ) : null}
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  View mode
                </span>
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => supportsSourcePreview && setPreviewMode('adjusted')}
                    className={`px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                      previewMode === 'adjusted'
                        ? 'bg-[var(--ring)] text-black'
                        : supportsSourcePreview
                          ? 'text-[var(--fg)] hover:bg-white/10'
                          : 'cursor-not-allowed text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]'
                    }`}
                    aria-pressed={previewMode === 'adjusted'}
                    aria-disabled={!supportsSourcePreview}
                    disabled={!supportsSourcePreview}
                  >
                    Adjusted preview
                  </button>
                  <button
                    type="button"
                    onClick={() => supportsSourcePreview && setPreviewMode('original')}
                    className={`px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                      previewMode === 'original'
                        ? 'bg-[var(--ring)] text-black'
                        : supportsSourcePreview
                          ? 'text-[var(--fg)] hover:bg-white/10'
                          : 'cursor-not-allowed text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]'
                    }`}
                    aria-pressed={previewMode === 'original'}
                    aria-disabled={!supportsSourcePreview}
                    disabled={!supportsSourcePreview}
                  >
                    Original clip
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('rendered')}
                    className={`px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                      previewMode === 'rendered'
                        ? 'bg-[var(--ring)] text-black'
                        : 'text-[var(--fg)] hover:bg-white/10'
                    }`}
                    aria-pressed={previewMode === 'rendered'}
                  >
                    Rendered output
                  </button>
                </div>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {!supportsSourcePreview
                  ? 'Showing the exported clip because a direct source preview is unavailable on this device.'
                  : previewMode === 'rendered'
                    ? 'Review the exported vertical clip with captions and layout applied.'
                    : previewMode === 'original'
                      ? 'Viewing the untouched source range from the original footage.'
                      : 'Previewing the adjusted range directly from the source video without captions or layout.'}
              </p>
            </div>
          </div>
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
                  className="pointer-events-none absolute inset-y-0 z-10 rounded-full bg-sky-400/40"
                  style={{ left: `${originalOverlayLeftPercent}%`, right: `${originalOverlayRightPercent}%` }}
                  aria-hidden="true"
                />
                <div
                  className="pointer-events-none absolute -top-2 z-20 h-3 w-px -translate-x-1/2 rounded bg-sky-300/80"
                  style={{ left: `${originalStartMarkerPercent}%` }}
                  aria-hidden="true"
                />
                <div
                  className="pointer-events-none absolute -top-2 z-20 h-3 w-px -translate-x-1/2 rounded bg-sky-300/80"
                  style={{ left: `${originalEndMarkerPercent}%` }}
                  aria-hidden="true"
                />
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-30 rounded-full bg-[var(--ring)]"
                  style={{ left: `${startPercent}%`, right: `${100 - endPercent}%` }}
                />
                <button
                  type="button"
                  role="slider"
                  aria-label="Adjust clip start"
                  aria-valuemin={Number(windowStart.toFixed(2))}
                  aria-valuemax={Number((rangeEnd - minGap).toFixed(2))}
                  aria-valuenow={Number(rangeStart.toFixed(2))}
                  aria-valuetext={startOffsetDescription}
                  onPointerDown={(event) => handleHandlePointerDown(event, 'start')}
                  onPointerMove={(event) => handleHandlePointerMove(event, 'start')}
                  onPointerUp={handleHandlePointerEnd}
                  onPointerCancel={handleHandlePointerEnd}
                  onKeyDown={(event) => handleHandleKeyDown(event, 'start')}
                  className="absolute top-1/2 z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--card)] shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
                  aria-valuetext={endOffsetDescription}
                  onPointerDown={(event) => handleHandlePointerDown(event, 'end')}
                  onPointerMove={(event) => handleHandlePointerMove(event, 'end')}
                  onPointerUp={handleHandlePointerEnd}
                  onPointerCancel={handleHandlePointerEnd}
                  onKeyDown={(event) => handleHandleKeyDown(event, 'end')}
                  className="absolute top-1/2 z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--card)] shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
                Start offset (s)
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[-+]?\\d*\\.?\\d*"
                  value={formattedStartOffset}
                  onChange={(event) => handleRangeInputChange(event, 'start')}
                  title={`Absolute start ${formatDuration(rangeStart)}`}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
                <span className="text-[10px] font-normal uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  Relative to the {offsetReference.startLabel}
                </span>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                End offset (s)
                <input
                  type="text"
                  inputMode="decimal"
                  pattern="[-+]?\\d*\\.?\\d*"
                  value={formattedEndOffset}
                  onChange={(event) => handleRangeInputChange(event, 'end')}
                  title={`Absolute end ${formatDuration(rangeEnd)}`}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
                <span className="text-[10px] font-normal uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  Relative to the {offsetReference.endLabel}
                </span>
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
              disabled={isSaving || isLoadingClip}
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
          {shouldShowSaveSteps ? (
            <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-4 text-sm text-[var(--muted)]">
              <h2 className="text-sm font-semibold text-[var(--fg)]">Rebuilding assets</h2>
              <ol className="mt-3 space-y-3">
                {saveSteps.map((step) => {
                  const isCompleted = step.status === 'completed'
                  const isRunning = step.status === 'running'
                  const isFailed = step.status === 'failed'
                  const indicatorClasses = isCompleted
                    ? 'bg-emerald-500/10 text-emerald-200 border border-emerald-500/40'
                    : isFailed
                    ? 'bg-rose-500/10 text-rose-200 border border-rose-500/40'
                    : isRunning
                    ? 'border-[var(--ring)] text-[var(--ring)]'
                    : 'border-white/15 text-[var(--muted)]'
                  return (
                    <li key={step.id} className="flex items-start gap-3">
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${indicatorClasses}`}
                        aria-hidden
                      >
                        {isRunning ? (
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : isCompleted ? (
                          '✓'
                        ) : isFailed ? (
                          '!'
                        ) : (
                          '•'
                        )}
                      </span>
                      <div>
                        <p className="font-medium text-[var(--fg)]">{step.label}</p>
                        <p className="text-xs">{step.description}</p>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          ) : null}
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
        <span className="flex flex-col gap-0.5">
          <span>{formatDuration(rangeStart)}</span>
          <span className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
            {startOffsetDescription}
          </span>
        </span>
        <span className="font-medium text-[var(--fg)]">Current end</span>
        <span className="flex flex-col gap-0.5">
          <span>{formatDuration(rangeEnd)}</span>
          <span className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
            {endOffsetDescription}
          </span>
        </span>
        <span className="font-medium text-[var(--fg)]">Clip title</span>
        <span>{clipState.title}</span>
        <span className="font-medium text-[var(--fg)]">Channel</span>
        <span>{clipState.channel}</span>
      </div>
    </section>
  )
}

export default ClipEdit
