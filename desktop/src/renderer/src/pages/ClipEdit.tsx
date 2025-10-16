import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FC,
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatDuration } from '../lib/format'
import { buildCacheBustedPlaybackUrl } from '../lib/video'
import useSharedVolume from '../hooks/useSharedVolume'
import VideoPreviewStage from '../components/VideoPreviewStage'
import { adjustJobClip, fetchJobClip } from '../services/pipelineApi'
import { adjustLibraryClip, fetchLibraryClip } from '../services/clipLibrary'
import { fetchConfigEntries } from '../services/configApi'
import type { Clip } from '../types'

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

type DurationGuardrails = {
  minDuration: number
  maxDuration: number
  sweetSpotMin: number
  sweetSpotMax: number
}

// Keep duration guardrails aligned with the backend defaults in server/config.py.
const DEFAULT_DURATION_GUARDRAILS: DurationGuardrails = {
  minDuration: 10,
  maxDuration: 85,
  sweetSpotMin: 25,
  sweetSpotMax: 60
}

const parseGuardrailValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

const resolveGuardrailKey = (name: string): keyof DurationGuardrails | null => {
  switch (name) {
    case 'MIN_DURATION_SECONDS':
      return 'minDuration'
    case 'MAX_DURATION_SECONDS':
      return 'maxDuration'
    case 'SWEET_SPOT_MIN_SECONDS':
      return 'sweetSpotMin'
    case 'SWEET_SPOT_MAX_SECONDS':
      return 'sweetSpotMax'
    default:
      return null
  }
}

const getDefaultPreviewMode = (clip: Clip | null): 'adjusted' | 'rendered' =>
  clip && clip.previewUrl === clip.playbackUrl ? 'rendered' : 'adjusted'

const formatRelativeSeconds = (value: number): string => {
  if (!Number.isFinite(value) || value === 0) {
    return '0'
  }
  const sign = value > 0 ? '+' : '-'
  const formatted = Math.abs(value)
    .toFixed(2)
    .replace(/\.?0+$/, '')
  return `${sign}${formatted}`
}

const formatTooltipLabel = (offset: string, change: string | null): string => {
  const offsetValue = offset === '0' ? '0s' : `${offset}s`
  if (!change) {
    return offsetValue
  }
  const changeValue = change === '0' ? 'Δ 0s' : `Δ ${change}s`
  return `${offsetValue} • ${changeValue}`
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

const ClipEdit: FC = () => {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state as ClipEditLocationState | null) ?? null

  const sourceClip = state?.clip && (!id || state.clip.id === id) ? state.clip : null
  const context = state?.context ?? 'job'

  const minGap = MIN_CLIP_GAP

  const [guardrails, setGuardrails] = useState<DurationGuardrails>(() => ({
    ...DEFAULT_DURATION_GUARDRAILS
  }))
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
  const [engagedHandle, setEngagedHandle] = useState<'start' | 'end' | null>(null)
  const [startInteractionOrigin, setStartInteractionOrigin] = useState<number | null>(null)
  const [endInteractionOrigin, setEndInteractionOrigin] = useState<number | null>(null)
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
  const [sharedVolume, setSharedVolume] = useSharedVolume()
  const [isVideoBuffering, setIsVideoBuffering] = useState(false)
  const [saveSteps, setSaveSteps] = useState<SaveStepState[]>(() => createInitialSaveSteps())

  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const handleGoToVideoView = useCallback(() => {
    if (!clipState) {
      return
    }
    navigate(`/video/${encodeURIComponent(clipState.id)}/edit`, {
      state: {
        clip: clipState,
        accountId: state?.accountId ?? clipState.accountId ?? null,
        clipTitle: clipState.title
      }
    })
  }, [clipState, navigate, state?.accountId])

  useEffect(() => {
    let isActive = true

    const loadGuardrails = async (): Promise<void> => {
      try {
        const entries = await fetchConfigEntries()
        if (!isActive) {
          return
        }
        setGuardrails((prev) => {
          let changed = false
          const next = { ...prev }
          for (const entry of entries) {
            const key = resolveGuardrailKey(entry.name)
            if (!key) {
              continue
            }
            const numeric = parseGuardrailValue(entry.value)
            if (numeric == null) {
              continue
            }
            if (next[key] !== numeric) {
              next[key] = numeric
              changed = true
            }
          }
          return changed ? next : prev
        })
      } catch (error) {
        console.error('Unable to load clip duration guardrails', error)
      }
    }

    void loadGuardrails()

    return () => {
      isActive = false
    }
  }, [])

  const originalStart = clipState?.originalStartSeconds ?? 0
  const originalEnd =
    clipState?.originalEndSeconds ?? originalStart + (clipState?.durationSec ?? 10)
  const supportsSourcePreview = clipState ? clipState.previewUrl !== clipState.playbackUrl : false

  const sourceStartBound = 0
  const sourceEndBound = useMemo(() => {
    if (!clipState) {
      return minGap
    }
    const sourceDuration =
      clipState.sourceDurationSeconds != null && Number.isFinite(clipState.sourceDurationSeconds)
        ? Math.max(minGap, clipState.sourceDurationSeconds)
        : null
    if (sourceDuration !== null) {
      return sourceDuration
    }
    const derivedFromDuration = clipState.originalStartSeconds + Math.max(clipState.durationSec, minGap)
    return Math.max(
      minGap,
      clipState.originalEndSeconds,
      clipState.endSeconds,
      derivedFromDuration
    )
  }, [clipState, minGap])

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
      const fallbackSourceEnd = Math.max(
        minGap,
        updated.originalEndSeconds,
        updated.endSeconds,
        updated.originalStartSeconds + Math.max(updated.durationSec, minGap)
      )
      const updatedSourceEnd =
        updated.sourceDurationSeconds != null && Number.isFinite(updated.sourceDurationSeconds)
          ? Math.max(minGap, updated.sourceDurationSeconds)
          : fallbackSourceEnd
      const desiredWindowEnd = Math.max(
        updated.endSeconds,
        updated.originalEndSeconds,
        updated.startSeconds + minGap,
        updated.originalStartSeconds + minGap
      )
      setWindowEnd(Math.min(updatedSourceEnd, desiredWindowEnd))
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
      Math.min(
        sourceEndBound,
        Math.max(
          clipState.endSeconds,
          clipState.originalEndSeconds,
          clipState.startSeconds + minGap,
          clipState.originalStartSeconds + minGap
        )
      )
    )
    setPreviewTarget({ start: clipState.startSeconds, end: clipState.endSeconds })
    setPreviewMode(getDefaultPreviewMode(clipState))
    setSaveSteps(createInitialSaveSteps())
  }, [clipState, minGap, sourceEndBound])

  useEffect(() => {
    setWindowStart((prevStart) => {
      const maxStart = sourceEndBound - minGap
      const clamped = Math.max(sourceStartBound, Math.min(prevStart, maxStart))
      return clamped === prevStart ? prevStart : clamped
    })
  }, [minGap, sourceEndBound, sourceStartBound])

  useEffect(() => {
    setWindowEnd((prevEnd) => {
      const lowerBound = windowStart + minGap
      const clamped = Math.min(sourceEndBound, Math.max(prevEnd, lowerBound))
      return clamped === prevEnd ? prevEnd : clamped
    })
  }, [minGap, sourceEndBound, windowStart])

  useEffect(() => {
    setRangeEnd((prevEnd) => {
      const upperBound = Math.min(sourceEndBound, windowEnd)
      const limited = Math.max(rangeStart + minGap, Math.min(prevEnd, upperBound))
      return Math.abs(limited - prevEnd) < 0.0005 ? prevEnd : limited
    })
  }, [minGap, rangeStart, sourceEndBound, windowEnd])

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

  const syncPreviewToRange = useCallback(
    (startValue: number, endValue: number) => {
      const nextStart = Math.max(0, Number.isFinite(startValue) ? startValue : 0)
      const rawEnd = Number.isFinite(endValue) ? endValue : nextStart
      const nextEnd =
        rawEnd > nextStart + MIN_PREVIEW_DURATION ? rawEnd : nextStart + MIN_PREVIEW_DURATION

      setPreviewTarget((prev) => {
        if (
          Math.abs(prev.start - nextStart) < 0.0005 &&
          Math.abs(prev.end - nextEnd) < 0.0005
        ) {
          return prev
        }
        return { start: nextStart, end: nextEnd }
      })
    },
    []
  )

  const commitPreviewTarget = useCallback(() => {
    syncPreviewToRange(rangeStart, rangeEnd)
  }, [rangeEnd, rangeStart, syncPreviewToRange])

  const snapRangeToValues = useCallback(
    (startValue: number, endValue: number) => {
      const baseStart = Math.max(0, Number.isFinite(startValue) ? startValue : 0)
      const rawEnd = Number.isFinite(endValue) ? endValue : baseStart
      const baseEnd = rawEnd > baseStart + minGap ? rawEnd : baseStart + minGap

      let nextWindowStart = windowStart
      let nextWindowEnd = windowEnd

      const clampedBaseStart = Math.max(
        sourceStartBound,
        Math.min(baseStart, sourceEndBound - minGap)
      )
      const clampedBaseEnd = Math.min(
        sourceEndBound,
        Math.max(baseEnd, clampedBaseStart + minGap)
      )

      if (clampedBaseStart < windowStart) {
        nextWindowStart = clampedBaseStart
      }
      if (clampedBaseEnd > windowEnd) {
        nextWindowEnd = Math.max(clampedBaseEnd, nextWindowStart + minGap)
      }

      const safeWindowStart = Math.max(
        sourceStartBound,
        Math.min(nextWindowStart, sourceEndBound - minGap)
      )
      const safeWindowEnd = Math.min(
        sourceEndBound,
        Math.max(nextWindowEnd, safeWindowStart + minGap)
      )

      if (safeWindowStart !== windowStart) {
        setWindowStart(safeWindowStart)
      }
      if (safeWindowEnd !== windowEnd) {
        setWindowEnd(safeWindowEnd)
      }

      setRangeStart(clampedBaseStart)
      setRangeEnd(clampedBaseEnd)
      setActiveHandle(null)
      setEngagedHandle(null)
      setStartInteractionOrigin(null)
      setEndInteractionOrigin(null)

      syncPreviewToRange(clampedBaseStart, clampedBaseEnd)
    },
    [
      minGap,
      sourceEndBound,
      sourceStartBound,
      syncPreviewToRange,
      windowEnd,
      windowStart
    ]
  )

  const handleSnapToOriginal = useCallback(() => {
    if (!clipState) {
      return
    }
    snapRangeToValues(
      clipState.originalStartSeconds,
      Math.max(clipState.originalEndSeconds, clipState.originalStartSeconds + minGap)
    )
  }, [clipState, minGap, snapRangeToValues])

  const handleSnapToRendered = useCallback(() => {
    if (!clipState) {
      return
    }
    snapRangeToValues(
      clipState.startSeconds,
      Math.max(clipState.endSeconds, clipState.startSeconds + minGap)
    )
  }, [clipState, minGap, snapRangeToValues])

  const offsetReference = useMemo(() => {
    if (!clipState) {
      return {
        startBase: rangeStart,
        endBase: rangeEnd,
        startLabel: 'current start',
        endLabel: 'current end',
        startTitle: 'Current start',
        endTitle: 'Current end'
      }
    }
    const startBase = Number.isFinite(clipState.originalStartSeconds)
      ? clipState.originalStartSeconds
      : clipState.startSeconds
    const endBase = Number.isFinite(clipState.originalEndSeconds)
      ? clipState.originalEndSeconds
      : clipState.endSeconds
    return {
      startBase,
      endBase,
      startLabel: 'original start',
      endLabel: 'original end',
      startTitle: 'Original start',
      endTitle: 'Original end'
    }
  }, [clipState, rangeEnd, rangeStart])

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
        snapRangeToValues(offsetReference.startBase + value, rangeEnd)
      } else {
        snapRangeToValues(rangeStart, offsetReference.endBase + value)
      }
    },
    [
      offsetReference.endBase,
      offsetReference.startBase,
      rangeEnd,
      rangeStart,
      snapRangeToValues
    ]
  )

  const handleRangeInputKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commitPreviewTarget()
      }
    },
    [commitPreviewTarget]
  )

  const handleRangeInputBlur = useCallback(() => {
    commitPreviewTarget()
  }, [commitPreviewTarget])

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
      setEngagedHandle(kind)
      if (kind === 'start') {
        setStartInteractionOrigin(rangeStart)
      } else {
        setEndInteractionOrigin(rangeEnd)
      }
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch (error) {
        // ignore pointer capture errors for unsupported browsers
      }
      updateRangeFromPointer(event, kind)
    },
    [rangeEnd, rangeStart, updateRangeFromPointer]
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

  const handleHandlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch (error) {
        // ignore release errors
      }
      setActiveHandle(null)
      setEngagedHandle(null)
      setStartInteractionOrigin(null)
      setEndInteractionOrigin(null)
      commitPreviewTarget()
    },
    [commitPreviewTarget]
  )

  const handleHandleBlur = useCallback(() => {
    setEngagedHandle(null)
    setStartInteractionOrigin(null)
    setEndInteractionOrigin(null)
    commitPreviewTarget()
  }, [commitPreviewTarget])

  const handleHandleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, kind: 'start' | 'end') => {
      const { key } = event
      const step = event.shiftKey ? 1 : 0.1
      setEngagedHandle(kind)
      if (kind === 'start') {
        setStartInteractionOrigin((prev) => prev ?? rangeStart)
      } else {
        setEndInteractionOrigin((prev) => prev ?? rangeEnd)
      }
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
      } else if (key === 'Enter') {
        commitPreviewTarget()
      } else if (key === 'End') {
        event.preventDefault()
        if (kind === 'start') {
          handleStartChange(rangeEnd - minGap)
        } else {
          handleEndChange(windowEnd)
        }
      }
    },
    [
      commitPreviewTarget,
      handleEndChange,
      handleStartChange,
      minGap,
      rangeEnd,
      rangeStart,
      windowEnd,
      windowStart
    ]
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
    setWindowStart((prev) => {
      const next = Math.max(sourceStartBound, prev - expandAmount)
      const limited = Math.min(next, windowEnd - minGap)
      return limited === prev ? prev : limited
    })
  }, [expandAmount, minGap, sourceStartBound, windowEnd])

  const handleExpandRight = useCallback(() => {
    if (expandAmount <= 0) {
      return
    }
    setWindowEnd((prev) => {
      const next = Math.min(sourceEndBound, prev + expandAmount)
      const limited = Math.max(next, windowStart + minGap)
      return limited === prev ? prev : limited
    })
  }, [expandAmount, minGap, sourceEndBound, windowStart])

  const handleReset = useCallback(() => {
    if (!clipState) {
      setRangeStart(0)
      setRangeEnd(minGap)
      setWindowStart(0)
      setWindowEnd(minGap)
      setPreviewTarget({ start: 0, end: minGap })
      setPreviewMode('adjusted')
    } else {
      const baseStart = Math.max(
        0,
        Math.min(clipState.originalStartSeconds, clipState.startSeconds)
      )
      const baseEnd = Math.max(
        clipState.originalEndSeconds,
        clipState.endSeconds,
        clipState.originalStartSeconds + minGap,
        clipState.startSeconds + minGap
      )
      setRangeStart(clipState.originalStartSeconds)
      setRangeEnd(Math.max(clipState.originalStartSeconds + minGap, clipState.originalEndSeconds))
      setWindowStart(baseStart)
      setWindowEnd(Math.min(baseEnd, sourceEndBound))
      setPreviewTarget({
        start: clipState.originalStartSeconds,
        end: Math.max(
          clipState.originalStartSeconds + MIN_PREVIEW_DURATION,
          clipState.originalEndSeconds
        )
      })
      setPreviewMode(getDefaultPreviewMode(clipState) === 'adjusted' ? 'original' : 'rendered')
    }
    setSaveError(null)
    setSaveSuccess(null)
    setSaveSteps(createInitialSaveSteps())
  }, [clipState, minGap, sourceEndBound])

  const minClipDurationSeconds = guardrails.minDuration
  const maxClipDurationSeconds = guardrails.maxDuration
  const sweetSpotMinSeconds = guardrails.sweetSpotMin
  const sweetSpotMaxSeconds = guardrails.sweetSpotMax

  const durationSeconds = Math.max(minGap, rangeEnd - rangeStart)
  const durationEpsilon = 0.0005
  const durationBelowMin = durationSeconds < minClipDurationSeconds - durationEpsilon
  const durationAboveMax = durationSeconds > maxClipDurationSeconds + durationEpsilon
  const durationWithinLimits = !durationBelowMin && !durationAboveMax
  const durationWithinSweetSpot =
    durationSeconds >= sweetSpotMinSeconds - durationEpsilon &&
    durationSeconds <= sweetSpotMaxSeconds + durationEpsilon
  const startOffsetSeconds = rangeStart - offsetReference.startBase
  const endOffsetSeconds = rangeEnd - offsetReference.endBase
  const formattedStartOffset = formatRelativeSeconds(startOffsetSeconds)
  const formattedEndOffset = formatRelativeSeconds(endOffsetSeconds)
  const startInteractionChangeSeconds =
    startInteractionOrigin == null ? null : rangeStart - startInteractionOrigin
  const endInteractionChangeSeconds =
    endInteractionOrigin == null ? null : rangeEnd - endInteractionOrigin
  const formattedStartChange =
    startInteractionChangeSeconds == null
      ? null
      : formatRelativeSeconds(startInteractionChangeSeconds)
  const formattedEndChange =
    endInteractionChangeSeconds == null ? null : formatRelativeSeconds(endInteractionChangeSeconds)
  const startOffsetDescription =
    formattedStartOffset === '0'
      ? 'Matches the original start'
      : `${formattedStartOffset}s from the original start`
  const endOffsetDescription =
    formattedEndOffset === '0'
      ? 'Matches the original end'
      : `${formattedEndOffset}s from the original end`
  const startChangeDescription =
    formattedStartChange && startInteractionOrigin != null
      ? formattedStartChange === '0'
        ? 'Change 0s from the last position'
        : `Change ${formattedStartChange}s from the last position`
      : null
  const endChangeDescription =
    formattedEndChange && endInteractionOrigin != null
      ? formattedEndChange === '0'
        ? 'Change 0s from the last position'
        : `Change ${formattedEndChange}s from the last position`
      : null
  const startAriaValueText = startChangeDescription
    ? `${startOffsetDescription}; ${startChangeDescription}`
    : startOffsetDescription
  const endAriaValueText = endChangeDescription
    ? `${endOffsetDescription}; ${endChangeDescription}`
    : endOffsetDescription

  const renderedOutOfSync = useMemo(() => {
    if (!clipState) {
      return false
    }
    const startDelta = Math.abs(rangeStart - clipState.startSeconds)
    const endDelta = Math.abs(rangeEnd - clipState.endSeconds)
    return startDelta > 0.005 || endDelta > 0.005
  }, [clipState, rangeEnd, rangeStart])

  const shouldShowSaveSteps =
    isSaving ||
    Boolean(saveError) ||
    Boolean(saveSuccess) ||
    saveSteps.some((step) => step.status !== 'pending')

  const renderedSrc = useMemo(() => {
    if (!clipState) {
      return ''
    }
    const cacheBusted = buildCacheBustedPlaybackUrl(clipState)
    return cacheBusted.length > 0 ? cacheBusted : clipState.playbackUrl
  }, [clipState])

  const buildPreviewSrc = useCallback(
    (range: { start: number; end: number }, variant: string) => {
      if (!clipState) {
        return ''
      }
      const safeStart = Math.max(0, Number.isFinite(range.start) ? range.start : 0)
      const rawEnd = Number.isFinite(range.end) ? range.end : safeStart
      const safeEnd =
        rawEnd > safeStart + MIN_PREVIEW_DURATION ? rawEnd : safeStart + MIN_PREVIEW_DURATION
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
        return `${clipState.previewUrl}${separator}start=${safeStart.toFixed(3)}&end=${safeEnd.toFixed(
          3
        )}&_=${encodeURIComponent(cacheToken)}`
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
    const safeEnd =
      rawEnd > originalStart + MIN_PREVIEW_DURATION ? rawEnd : originalStart + MIN_PREVIEW_DURATION
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
    const start = Math.max(
      0,
      Number.isFinite(currentPreviewRange.start) ? currentPreviewRange.start : 0
    )
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

  const activePoster = previewMode === 'rendered' ? (clipState?.thumbnail ?? undefined) : undefined
  const videoKey = clipState
    ? `${clipState.id}-${previewMode}-${activeVideoSrc}`
    : `${previewMode}-${activeVideoSrc}`

  useEffect(() => {
    setIsVideoBuffering(false)
  }, [activeVideoSrc, previewMode])

  useEffect(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    element.volume = sharedVolume.volume
    element.muted = sharedVolume.muted
  }, [sharedVolume, videoKey])

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

  const handleVideoVolumeChange = useCallback(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    setSharedVolume({ volume: element.volume, muted: element.muted })
  }, [setSharedVolume])

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

  useEffect(() => {
    if (!clipState || previewMode === 'rendered' || !previewSourceIsFile) {
      return
    }
    const element = previewVideoRef.current
    if (!element || element.readyState < 1) {
      return
    }
    const tolerance = 0.05
    const beforeStart = element.currentTime < previewStart - tolerance
    const afterWindow = element.currentTime > previewEnd + tolerance
    if (!beforeStart && !afterWindow) {
      return
    }
    const wasPlaying = !element.paused && !element.ended
    element.currentTime = previewStart
    if (wasPlaying) {
      const playback = element.play()
      if (playback && typeof playback.catch === 'function') {
        playback.catch(() => undefined)
      }
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
        error instanceof Error
          ? error.message
          : 'Unable to update the clip boundaries. Please try again.'
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
      <section className="flex w-full flex-1 flex-col gap-6 px-6 py-10 lg:px-8">
        <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-10 text-center">
          {isLoadingClip ? (
            <div className="flex flex-col items-center gap-4 text-[var(--muted)]">
              <div
                className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-[var(--ring)]"
                aria-hidden
              />
              <p className="text-sm">Loading clip details…</p>
            </div>
          ) : (
            <>
              <h2 className="text-xl font-semibold text-[var(--fg)]">
                Clip information unavailable
              </h2>
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
  const toHandleInset = (percent: number): string => {
    if (!Number.isFinite(percent)) {
      return '0px'
    }
    const clamped = Math.max(0, Math.min(100, percent))
    return `max(0px, calc(${clamped}% - 0.5rem))`
  }
  const toPercentInset = (percent: number): string => {
    if (!Number.isFinite(percent)) {
      return '0%'
    }
    const clamped = Math.max(0, Math.min(100, percent))
    const normalized = Math.round(clamped * 1_000_000) / 1_000_000
    return `${normalized}%`
  }
  const safeTimelineTotal = timelineTotal <= 0 ? 1 : timelineTotal
  const clampRatio = (value: number): number => Math.max(0, Math.min(1, value))
  const originalStartRatio = clampRatio(
    (clipState.originalStartSeconds - windowStart) / safeTimelineTotal
  )
  const originalEndRatio = clampRatio(
    (clipState.originalEndSeconds - windowStart) / safeTimelineTotal
  )
  const originalOverlayLeftPercent = originalStartRatio * 100
  const originalOverlayRightPercent =
    clampRatio((windowEnd - clipState.originalEndSeconds) / safeTimelineTotal) * 100
  const originalOverlayLeftInset = toPercentInset(originalOverlayLeftPercent)
  const originalOverlayRightInset = toPercentInset(originalOverlayRightPercent)
  const originalStartMarkerPercent = originalStartRatio * 100
  const originalEndMarkerPercent = originalEndRatio * 100
  const renderedStartRatio = clampRatio((clipState.startSeconds - windowStart) / safeTimelineTotal)
  const renderedEndRatio = clampRatio((clipState.endSeconds - windowStart) / safeTimelineTotal)
  const renderedOverlayLeftPercent = renderedStartRatio * 100
  const renderedOverlayRightPercent =
    clampRatio((windowEnd - clipState.endSeconds) / safeTimelineTotal) * 100
  const renderedOverlayLeftInset = toPercentInset(renderedOverlayLeftPercent)
  const renderedOverlayRightInset = toPercentInset(renderedOverlayRightPercent)
  const renderedStartMarkerPercent = renderedStartRatio * 100
  const renderedEndMarkerPercent = renderedEndRatio * 100
  const currentOverlayLeftInset = toHandleInset(startPercent)
  const currentOverlayRightInset = toHandleInset(100 - endPercent)
  const originalDuration = Math.max(
    0,
    clipState.originalEndSeconds - clipState.originalStartSeconds
  )
  const renderedDuration = Math.max(0, clipState.endSeconds - clipState.startSeconds)
  const renderMatchesOriginal =
    clipState.startSeconds === clipState.originalStartSeconds &&
    clipState.endSeconds === clipState.originalEndSeconds
  const shouldShowRenderedOverlay = !renderMatchesOriginal
  const renderedExtendsOriginal = renderedDuration >= originalDuration
  const originalOverlayLayer = renderedExtendsOriginal ? 'z-20' : 'z-10'
  const renderedOverlayLayer = renderedExtendsOriginal ? 'z-10' : 'z-20'
  const showStartTooltip = engagedHandle === 'start'
  const showEndTooltip = engagedHandle === 'end'
  const startTooltipChange = showStartTooltip && formattedStartChange ? formattedStartChange : null
  const endTooltipChange = showEndTooltip && formattedEndChange ? formattedEndChange : null
  const startOffsetTooltip = formatTooltipLabel(formattedStartOffset, startTooltipChange)
  const endOffsetTooltip = formatTooltipLabel(formattedEndOffset, endTooltipChange)

  const startHandleValueMin = Number.isFinite(windowStart) ? windowStart : 0
  const startHandleValueMax = Number.isFinite(rangeEnd - minGap) ? rangeEnd - minGap : rangeEnd
  const endHandleValueMin = Number.isFinite(rangeStart + minGap) ? rangeStart + minGap : rangeStart
  const endHandleValueMax = Number.isFinite(windowEnd) ? windowEnd : rangeEnd

  return (
    <section className="flex w-full flex-1 flex-col gap-8 px-6 py-10 lg:px-8">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleGoToVideoView}
          className="marble-button marble-button--primary px-4 py-2 text-sm font-semibold"
        >
          Go to video view
        </button>
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4">
          <div className="flex h-full flex-col gap-4">
            <VideoPreviewStage>
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
                onVolumeChange={handleVideoVolumeChange}
                className="h-full w-auto max-h-full max-w-full bg-black object-contain"
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
            </VideoPreviewStage>
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
                        ? 'bg-[color:color-mix(in_srgb,var(--muted)_50%,transparent)] text-[var(--fg)]'
                        : supportsSourcePreview
                          ? 'text-[var(--fg)] hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)]'
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
                        ? 'bg-[color:color-mix(in_srgb,var(--muted)_50%,transparent)] text-[var(--fg)]'
                        : supportsSourcePreview
                          ? 'text-[var(--fg)] hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)]'
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
                        ? 'bg-[color:color-mix(in_srgb,var(--muted)_50%,transparent)] text-[var(--fg)]'
                        : 'text-[var(--fg)] hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)]'
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
                    ? renderedOutOfSync
                      ? 'Viewing the last saved render. The exported clip will update after you save these adjustments.'
                      : 'Review the exported vertical clip with captions and layout applied.'
                    : previewMode === 'original'
                      ? 'Viewing the untouched source range from the original footage.'
                      : 'Previewing the adjusted range directly from the source video without captions or layout.'}
              </p>
              {renderedOutOfSync ? (
                <p className="text-xs font-medium text-[color:color-mix(in_srgb,var(--warning-strong)_80%,var(--accent-contrast))]">
                  The rendered output does not yet reflect these boundaries. Save the clip to rerun
                  step 7 and refresh the export.
                </p>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex w-full max-w-xl flex-col gap-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-[var(--fg)]">Refine clip boundaries</h1>
            <p className="text-sm text-[var(--muted)]">
              Drag the handles or enter precise timestamps to trim the clip before regenerating
              subtitles and renders.
            </p>
          </div>
          <div className="space-y-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Clip window
              </div>
              <div
                ref={timelineRef}
                className="relative mt-6 h-2 rounded-full bg-[color:var(--clip-track)] shadow-inner"
              >
                <div
                  className={`pointer-events-none absolute -top-1 -bottom-1 ${originalOverlayLayer} rounded-none bg-[color:color-mix(in_srgb,var(--clip-original)_65%,transparent)]`}
                  style={{
                    left: originalOverlayLeftInset,
                    right: originalOverlayRightInset
                  }}
                  aria-hidden="true"
                />
                {shouldShowRenderedOverlay ? (
                  <div
                    className={`pointer-events-none absolute -top-1 -bottom-1 ${renderedOverlayLayer} rounded-none bg-[color:color-mix(in_srgb,var(--clip-rendered)_65%,transparent)]`}
                    style={{
                      left: renderedOverlayLeftInset,
                      right: renderedOverlayRightInset
                    }}
                    aria-hidden="true"
                  />
                ) : null}
                <div
                  className="pointer-events-none absolute -top-3 -bottom-3 z-30 w-[6px] -translate-x-1/2 rounded-full bg-[color:var(--clip-original-marker)]"
                  style={{ left: `${originalStartMarkerPercent}%` }}
                  aria-hidden="true"
                />
                <div
                  className="pointer-events-none absolute -top-3 -bottom-3 z-30 w-[6px] -translate-x-1/2 rounded-full bg-[color:var(--clip-original-marker)]"
                  style={{ left: `${originalEndMarkerPercent}%` }}
                  aria-hidden="true"
                />
                {shouldShowRenderedOverlay ? (
                  <div
                    className="pointer-events-none absolute -top-2 -bottom-2 z-30 w-[6px] -translate-x-1/2 rounded-full bg-[color:var(--clip-rendered-marker)]"
                    style={{ left: `${renderedStartMarkerPercent}%` }}
                    aria-hidden="true"
                  />
                ) : null}
                {shouldShowRenderedOverlay ? (
                  <div
                    className="pointer-events-none absolute -top-2 -bottom-2 z-30 w-[6px] -translate-x-1/2 rounded-full bg-[color:var(--clip-rendered-marker)]"
                    style={{ left: `${renderedEndMarkerPercent}%` }}
                    aria-hidden="true"
                  />
                ) : null}
                <div
                  className="pointer-events-none absolute -top-1 -bottom-1 z-40 rounded-full bg-[color:var(--clip-current)]"
                  style={{ left: currentOverlayLeftInset, right: currentOverlayRightInset }}
                />
                {showStartTooltip ? (
                  <div
                    className="pointer-events-none absolute -top-7 z-50 -translate-x-1/2 rounded-md bg-black/85 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--clip-tooltip-text)] shadow-lg"
                    style={{ left: `${startPercent}%` }}
                  >
                    {startOffsetTooltip}
                  </div>
                ) : null}
                {showEndTooltip ? (
                  <div
                    className="pointer-events-none absolute -top-7 z-50 -translate-x-1/2 rounded-md bg-black/85 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--clip-tooltip-text)] shadow-lg"
                    style={{ left: `${endPercent}%` }}
                  >
                    {endOffsetTooltip}
                  </div>
                ) : null}
                <button
                  type="button"
                  role="slider"
                  aria-label="Adjust clip start"
                  aria-valuemin={startHandleValueMin}
                  aria-valuemax={startHandleValueMax}
                  aria-valuenow={rangeStart}
                  aria-valuetext={startAriaValueText}
                  onPointerDown={(event) => handleHandlePointerDown(event, 'start')}
                  onPointerMove={(event) => handleHandlePointerMove(event, 'start')}
                  onPointerUp={handleHandlePointerEnd}
                  onPointerCancel={handleHandlePointerEnd}
                  onKeyDown={(event) => handleHandleKeyDown(event, 'start')}
                  onBlur={handleHandleBlur}
                  className="absolute top-1/2 z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--clip-handle-border)] bg-[color:var(--clip-handle)] shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] hover:bg-[color:var(--clip-handle-hover)]"
                  style={{ left: `${startPercent}%` }}
                >
                  <span className="sr-only">Drag to adjust start</span>
                </button>
                <button
                  type="button"
                  role="slider"
                  aria-label="Adjust clip end"
                  aria-valuemin={endHandleValueMin}
                  aria-valuemax={endHandleValueMax}
                  aria-valuenow={rangeEnd}
                  aria-valuetext={endAriaValueText}
                  onPointerDown={(event) => handleHandlePointerDown(event, 'end')}
                  onPointerMove={(event) => handleHandlePointerMove(event, 'end')}
                  onPointerUp={handleHandlePointerEnd}
                  onPointerCancel={handleHandlePointerEnd}
                  onKeyDown={(event) => handleHandleKeyDown(event, 'end')}
                  onBlur={handleHandleBlur}
                  className="absolute top-1/2 z-40 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[color:var(--clip-handle-border)] bg-[color:var(--clip-handle)] shadow transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] hover:bg-[color:var(--clip-handle-hover)]"
                  style={{ left: `${endPercent}%` }}
                >
                  <span className="sr-only">Drag to adjust end</span>
                </button>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-medium uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                <button
                  type="button"
                  onClick={handleSnapToOriginal}
                  disabled={!clipState}
                  className="flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-inherit transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] enabled:hover:border-white/10 enabled:hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)] enabled:hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span
                    className="h-2 w-6 rounded-full bg-[color:var(--clip-original)]"
                    aria-hidden="true"
                  />
                  Original range
                </button>
                {shouldShowRenderedOverlay ? (
                  <button
                    type="button"
                    onClick={handleSnapToRendered}
                    disabled={!clipState}
                    className="flex items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-inherit transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] enabled:hover:border-white/10 enabled:hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)] enabled:hover:text-[var(--fg)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      className="h-2 w-6 rounded-full bg-[color:var(--clip-rendered)]"
                      aria-hidden="true"
                    />
                    Rendered output
                  </button>
                ) : null}
                <span className="flex items-center gap-2">
                  <span
                    className="h-2 w-6 rounded-full bg-[color:var(--clip-current)]"
                    aria-hidden="true"
                  />
                  Current window
                </span>
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
                  onKeyDown={handleRangeInputKeyDown}
                  onBlur={handleRangeInputBlur}
                  title={`Absolute start ${formatDuration(rangeStart)}`}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
                <span className="text-[10px] font-normal uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  Relative to the original start
                </span>
                <span className="text-[10px] font-normal text-[color:color-mix(in_srgb,var(--muted)_60%,transparent)]">
                  Original {formatDuration(offsetReference.startBase)} → Current{' '}
                  {formatDuration(rangeStart)}
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
                  onKeyDown={handleRangeInputKeyDown}
                  onBlur={handleRangeInputBlur}
                  title={`Absolute end ${formatDuration(rangeEnd)}`}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
                <span className="text-[10px] font-normal uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  Relative to the original end
                </span>
                <span className="text-[10px] font-normal text-[color:color-mix(in_srgb,var(--muted)_60%,transparent)]">
                  Original {formatDuration(offsetReference.endBase)} → Current{' '}
                  {formatDuration(rangeEnd)}
                </span>
              </label>
            </div>
            <div className="flex flex-col gap-2 text-sm text-[var(--muted)]">
              <div className="flex items-center justify-between">
                <span>Adjusted duration</span>
                <span className="font-semibold text-[var(--fg)]">
                  {formatDuration(durationSeconds)}
                </span>
              </div>
              {!durationWithinLimits ? (
                <div className="flex items-start gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] px-3 py-2 text-xs text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]">
                  <span
                    className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--error-strong)]"
                    aria-hidden="true"
                  />
                  <div className="space-y-1">
                    <p className="font-semibold uppercase tracking-wide">Outside clip limits</p>
                    <p>
                      Clips must stay between {minClipDurationSeconds.toFixed(0)}s and{' '}
                      {maxClipDurationSeconds.toFixed(0)}s. Adjust the boundaries to bring this
                      clip back in range. Current duration: {formatDuration(durationSeconds)}.
                    </p>
                  </div>
                </div>
              ) : null}
              {durationWithinLimits && !durationWithinSweetSpot ? (
                <div className="flex items-start gap-2 rounded-lg border border-[color:color-mix(in_srgb,var(--warning-strong)_45%,var(--edge))] bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--warning-contrast)]">
                  <span
                    className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-[color:var(--warning-strong)]"
                    aria-hidden="true"
                  />
                  <div className="space-y-1">
                    <p className="font-semibold uppercase tracking-wide">Outside sweet spot</p>
                    <p>
                      The recommended sweet spot is {sweetSpotMinSeconds.toFixed(0)}–
                      {sweetSpotMaxSeconds.toFixed(0)} seconds. Tweaking the boundaries can help this
                      clip land inside the preferred window. Current duration:{' '}
                      {formatDuration(durationSeconds)}.
                    </p>
                  </div>
                </div>
              ) : null}
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
                    className="rounded-lg border border-white/10 px-2 py-1 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    Expand left
                  </button>
                  <button
                    type="button"
                    onClick={handleExpandRight}
                    className="rounded-lg border border-white/10 px-2 py-1 text-xs font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    Expand right
                  </button>
                </div>
              </div>
              <p className="text-xs">
                Expanding the window lets you pull the clip start earlier or extend the ending
                without moving the saved boundaries.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || isLoadingClip}
              className="inline-flex items-center justify-center rounded-[14px] border border-transparent bg-[color:var(--ring)] px-4 py-2 text-sm font-semibold text-[color:var(--accent-contrast)] shadow-[0_18px_36px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:bg-[color:color-mix(in_srgb,var(--ring-strong)_75%,var(--ring))] hover:shadow-[0_24px_48px_rgba(15,23,42,0.36)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : 'Save adjustments'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center justify-center rounded-[14px] border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--fg)] shadow-[0_12px_24px_rgba(15,23,42,0.2)] transition hover:-translate-y-0.5 hover:border-[var(--ring)] hover:bg-[color:color-mix(in_srgb,var(--panel-strong)_72%,transparent)] hover:text-[color:var(--accent)] hover:shadow-[0_18px_36px_rgba(15,23,42,0.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]"
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
                    ? 'border-[color:color-mix(in_srgb,var(--success-strong)_45%,var(--edge))] bg-[color:var(--success-soft)] text-[color:color-mix(in_srgb,var(--success-strong)_85%,var(--accent-contrast))]'
                    : isFailed
                      ? 'border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]'
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
          {saveError ? (
            <p className="text-sm text-[color:color-mix(in_srgb,var(--error-strong)_82%,var(--accent-contrast))]">
              {saveError}
            </p>
          ) : null}
          {saveSuccess ? (
            <p className="text-sm text-[color:color-mix(in_srgb,var(--success-strong)_82%,var(--accent-contrast))]">
              {saveSuccess}
            </p>
          ) : null}
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
