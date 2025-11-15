import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FC,
  ChangeEvent,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent
} from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { formatDuration } from '../lib/format'
import { buildCacheBustedPlaybackUrl } from '../lib/video'
import useSharedVolume from '../hooks/useSharedVolume'
import VideoPreviewStage from '../components/VideoPreviewStage'
import LayoutModeView from './video/LayoutModeView'
import TrimModeView from './video/TrimModeView'
import MetadataModeView from './video/MetadataModeView'
import UploadModeView from './video/UploadModeView'
import {
  SAVE_STEP_DEFINITIONS,
  createInitialSaveSteps,
  type SaveStepState
} from './video/saveSteps'
import { adjustJobClip, fetchJobClip } from '../services/pipelineApi'
import { adjustLibraryClip, fetchLibraryClip } from '../services/clipLibrary'
import {
  fetchLayoutCollection as fetchLayoutCollectionApi,
  loadLayoutDefinition as loadLayoutDefinitionApi,
  saveLayoutDefinition as saveLayoutDefinitionApi,
  importLayoutDefinition as importLayoutDefinitionApi,
  exportLayoutDefinition as exportLayoutDefinitionApi,
  deleteLayoutDefinition as deleteLayoutDefinitionApi
} from '../services/layouts'
import { fetchConfigEntries } from '../services/configApi'
import {
  PLATFORM_LABELS,
  SUPPORTED_PLATFORMS,
  type Clip,
  type SupportedPlatform
} from '../types'
import type { LayoutCollection } from '../../../types/api'
import type { LayoutCategory, LayoutDefinition } from '../../../types/layouts'
import {
  ensureCspAndElectronAllowLocalMedia,
  resolveOriginalSource,
  buildTrimmedPreviewSource,
  releaseTrimmedPreviewToken,
  attachTrimmedPlaybackGuards,
  type TrimmedPlaybackGuards,
  type WindowRangeWarning
} from '../services/preview/adjustedPreview'

type VideoPageLocationState = {
  clip?: Clip
  jobId?: string | null
  accountId?: string | null
  context?: 'job' | 'library'
}

const toSeconds = (value: number): number => Math.max(0, Number.isFinite(value) ? value : 0)
const MIN_CLIP_GAP = 0.25
const MIN_PREVIEW_DURATION = 0.05
const DEFAULT_EXPAND_SECONDS = 10
const CLIP_WINDOW_PADDING_SECONDS = 10

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

type VideoPageMode = 'layout' | 'trim' | 'metadata' | 'upload'

const VIDEO_PAGE_MODES: Array<{ id: VideoPageMode; label: string }> = [
  { id: 'layout', label: 'Layout' },
  { id: 'trim', label: 'Trim' },
  { id: 'metadata', label: 'Metadata' },
  { id: 'upload', label: 'Upload' }
]

const normaliseMode = (value: string | null | undefined): VideoPageMode => {
  if (value === 'layout' || value === 'metadata' || value === 'upload') {
    return value
  }
  return 'trim'
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

const deriveBaseWindowStart = (clip: Clip): number =>
  Math.max(0, Math.min(clip.startSeconds, clip.originalStartSeconds))

const deriveBaseWindowEnd = (clip: Clip, minGap: number): number =>
  Math.max(
    clip.endSeconds,
    clip.originalEndSeconds,
    clip.startSeconds + minGap,
    clip.originalStartSeconds + minGap
  )

const resolveSourceEndBoundFromClip = (clip: Clip, minGap: number): number => {
  const fallbackSourceEnd = Math.max(
    minGap,
    clip.originalEndSeconds,
    clip.endSeconds,
    clip.originalStartSeconds + Math.max(clip.durationSec, minGap)
  )

  if (clip.sourceDurationSeconds != null && Number.isFinite(clip.sourceDurationSeconds)) {
    return Math.max(minGap, clip.sourceDurationSeconds)
  }

  return fallbackSourceEnd
}

const clampStartWithinBounds = (start: number, sourceEnd: number, minGap: number): number => {
  const maxStart = Math.max(0, sourceEnd - minGap)
  return Math.min(Math.max(0, start), maxStart)
}

const computePaddedWindowBounds = (
  clip: Clip,
  minGap: number,
  paddingSeconds: number,
  sourceEndOverride?: number
): { start: number; end: number } => {
  const sourceEnd = sourceEndOverride ?? resolveSourceEndBoundFromClip(clip, minGap)
  const padding = Math.max(0, paddingSeconds)
  const baseStart = deriveBaseWindowStart(clip)
  const paddedStart = clampStartWithinBounds(Math.max(0, baseStart - padding), sourceEnd, minGap)
  const desiredEnd = Math.max(deriveBaseWindowEnd(clip, minGap), paddedStart + minGap)
  const paddedEnd = Math.min(sourceEnd, desiredEnd + padding)

  return {
    start: paddedStart,
    end: paddedEnd
  }
}

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

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const DEFAULT_CALL_TO_ACTION = 'Invite viewers to subscribe for more highlights.'
const DEFAULT_TAGS = 'clips, highlights, community'
const DEFAULT_PLATFORM_NOTES = 'Share with the community playlist and pin on the channel page.'
const WARNING_REVERSED_MESSAGE =
  'End time must come after the start. We reset playback to the clip start.'
const WARNING_OUT_OF_BOUNDS_MESSAGE = 'Playback window adjusted to stay within the video length.'

type AdjustedSourceState =
  | { status: 'idle' }
  | { status: 'loading'; key: string }
  | {
      status: 'ready'
      key: string
      fileUrl: string
      filePath: string
      origin: 'canonical' | 'preferred' | 'discovered'
      projectDir: string | null
    }
  | {
      status: 'missing'
      key: string
      expectedPath: string | null
      projectDir: string | null
      triedPreferred: boolean
    }
  | { status: 'error'; key: string; message: string }

type AdjustedTrimmedState =
  | { status: 'idle' }
  | { status: 'loading'; token: string | null }
  | {
      status: 'ready'
      token: string
      url: string
      duration: number
      strategy: 'ffmpeg'
      applied: { start: number; end: number }
      warning: WindowRangeWarning | null
    }
  | { status: 'error'; message: string; warning: WindowRangeWarning | null }

const VideoPage: FC = () => {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const state = (location.state as VideoPageLocationState | null) ?? null
  const [persistedState, setPersistedState] = useState<VideoPageLocationState | null>(() =>
    state ? { ...state } : null
  )

  useEffect(() => {
    if (!state) {
      return
    }
    setPersistedState((previous) => {
      if (!previous) {
        return { ...state }
      }
      return {
        ...previous,
        ...state,
        clip: state.clip ?? previous.clip,
        jobId: state.jobId ?? previous.jobId ?? null,
        accountId: state.accountId ?? previous.accountId ?? null,
        context: state.context ?? previous.context
      }
    })
  }, [state])

  const effectiveState = persistedState ?? state ?? null

  const sourceClip =
    effectiveState?.clip && (!id || effectiveState.clip.id === id) ? effectiveState.clip : null
  const context = effectiveState?.context ?? 'job'
  const jobId = effectiveState?.jobId ?? null
  const accountId = effectiveState?.accountId ?? null

  const activeMode = normaliseMode(searchParams.get('mode'))

  useEffect(() => {
    if (searchParams.get('mode')) {
      return
    }
    const next = new URLSearchParams(searchParams)
    next.set('mode', 'trim')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

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
    const sourceBound = resolveSourceEndBoundFromClip(sourceClip, minGap)
    const { start } = computePaddedWindowBounds(
      sourceClip,
      minGap,
      CLIP_WINDOW_PADDING_SECONDS,
      sourceBound
    )
    return start
  })
  const [windowEnd, setWindowEnd] = useState(() => {
    if (!sourceClip) {
      return minGap
    }
    const sourceBound = resolveSourceEndBoundFromClip(sourceClip, minGap)
    const { end } = computePaddedWindowBounds(
      sourceClip,
      minGap,
      CLIP_WINDOW_PADDING_SECONDS,
      sourceBound
    )
    return end
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
  const [previewMode, setPreviewMode] = useState<'adjusted' | 'rendered'>(() =>
    getDefaultPreviewMode(sourceClip ?? null)
  )
  const [previewTarget, setPreviewTarget] = useState(() => ({
    start: sourceClip ? sourceClip.startSeconds : 0,
    end: sourceClip ? Math.max(sourceClip.startSeconds + minGap, sourceClip.endSeconds) : minGap
  }))
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const [sharedVolume, setSharedVolume] = useSharedVolume()
  const [isVideoBuffering, setIsVideoBuffering] = useState(false)
  const [adjustedSourceState, setAdjustedSourceState] = useState<AdjustedSourceState>({ status: 'idle' })
  const [trimmedPreviewState, setTrimmedPreviewState] = useState<AdjustedTrimmedState>({ status: 'idle' })
  const trimmedPlaybackGuardsRef = useRef<TrimmedPlaybackGuards | null>(null)
  const trimmedTokenRef = useRef<string | null>(null)
  const playbackResumeIntentRef = useRef(false)
  const [adjustedWarning, setAdjustedWarning] = useState<string | null>(null)
  const [adjustedPlaybackError, setAdjustedPlaybackError] = useState<string | null>(null)
  const [adjustedBuffering, setAdjustedBuffering] = useState(false)
  const [pendingSourceOverride, setPendingSourceOverride] = useState<string | null>(null)
  const playbackWindowRef = useRef({ start: previewTarget.start, end: previewTarget.end })
  const layoutClipIdRef = useRef<string | null>(clipState?.id ?? null)
  const layoutAppliedIdRef = useRef<string | null>(clipState?.layoutId ?? null)
  const [saveSteps, setSaveSteps] = useState<SaveStepState[]>(() => createInitialSaveSteps())
  const [title, setTitle] = useState<string>(sourceClip?.title ?? '')
  const [description, setDescription] = useState<string>(sourceClip?.description ?? '')
  const [callToAction, setCallToAction] = useState<string>(DEFAULT_CALL_TO_ACTION)
  const [tags, setTags] = useState<string>(DEFAULT_TAGS)
  const [platformNotes, setPlatformNotes] = useState<string>(DEFAULT_PLATFORM_NOTES)
  const [selectedPlatforms, setSelectedPlatforms] = useState<SupportedPlatform[]>([
    ...SUPPORTED_PLATFORMS
  ])
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'ready' | 'scheduled'>(() =>
    sourceClip ? 'ready' : 'idle'
  )
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [layoutCollection, setLayoutCollection] = useState<LayoutCollection | null>(null)
  const [isLayoutCollectionLoading, setIsLayoutCollectionLoading] = useState(false)
  const [layoutCollectionError, setLayoutCollectionError] = useState<string | null>(null)
  const [activeLayoutDefinition, setActiveLayoutDefinition] = useState<LayoutDefinition | null>(null)
  const [activeLayoutReference, setActiveLayoutReference] = useState<{
    id: string
    category: LayoutCategory | null
  } | null>(null)
  const [isLayoutLoading, setIsLayoutLoading] = useState(false)
  const [isSavingLayout, setIsSavingLayout] = useState(false)
  const [isApplyingLayout, setIsApplyingLayout] = useState(false)
  const [layoutStatusMessage, setLayoutStatusMessage] = useState<string | null>(null)
  const [layoutErrorMessage, setLayoutErrorMessage] = useState<string | null>(null)
  const [layoutRenderSteps, setLayoutRenderSteps] = useState<SaveStepState[]>(() => createInitialSaveSteps())
  const [isLayoutRendering, setIsLayoutRendering] = useState(false)
  const [layoutRenderStatusMessage, setLayoutRenderStatusMessage] = useState<string | null>(null)
  const [layoutRenderErrorMessage, setLayoutRenderErrorMessage] = useState<string | null>(null)
  const layoutRenderInFlightRef = useRef(false)
  const layoutRenderResetPendingRef = useRef(false)

  const resolveLayoutCategory = useCallback(
    (identifier: string | null | undefined): LayoutCategory | null => {
      if (!identifier || !layoutCollection) {
        return null
      }
      if (layoutCollection.custom.some((entry) => entry.id === identifier)) {
        return 'custom'
      }
      if (layoutCollection.builtin.some((entry) => entry.id === identifier)) {
        return 'builtin'
      }
      return null
    },
    [layoutCollection]
  )

  useEffect(() => {
    if (layoutRenderInFlightRef.current) {
      layoutRenderResetPendingRef.current = true
      return
    }
    setLayoutRenderSteps(createInitialSaveSteps())
    setLayoutRenderStatusMessage(null)
    setLayoutRenderErrorMessage(null)
    layoutRenderResetPendingRef.current = false
  }, [activeLayoutDefinition?.id, layoutRenderInFlightRef, layoutRenderResetPendingRef])

  const refreshLayoutCollection = useCallback(async () => {
    setIsLayoutCollectionLoading(true)
    setLayoutCollectionError(null)
    try {
      const collection = await fetchLayoutCollectionApi()
      setLayoutCollection(collection)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to load layouts. Please try again.'
      setLayoutCollectionError(message)
    } finally {
      setIsLayoutCollectionLoading(false)
    }
  }, [])

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

  useEffect(() => {
    void refreshLayoutCollection()
  }, [refreshLayoutCollection])

  useEffect(() => {
    const clipId = clipState?.id ?? null
    const layoutId = clipState?.layoutId ?? null
    if (!clipId) {
      layoutClipIdRef.current = null
      layoutAppliedIdRef.current = null
      setActiveLayoutReference(null)
      setActiveLayoutDefinition(null)
      return
    }
    const clipChanged = layoutClipIdRef.current !== clipId
    const layoutChanged = layoutAppliedIdRef.current !== layoutId
    if (!clipChanged && !layoutChanged) {
      return
    }
    layoutClipIdRef.current = clipId
    layoutAppliedIdRef.current = layoutId
    if (layoutId) {
      setActiveLayoutReference({ id: layoutId, category: resolveLayoutCategory(layoutId) })
    } else {
      setActiveLayoutReference(null)
    }
  }, [clipState, resolveLayoutCategory])

  useEffect(() => {
    if (!activeLayoutReference) {
      return
    }
    let cancelled = false
    setIsLayoutLoading(true)
    setLayoutErrorMessage(null)
    ;(async () => {
      try {
        const definition = await loadLayoutDefinitionApi(
          activeLayoutReference.id,
          activeLayoutReference.category ?? null
        )
        if (cancelled) {
          return
        }
        setActiveLayoutDefinition(definition)
      } catch (error) {
        if (cancelled) {
          return
        }
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to load the selected layout. Please try a different layout.'
        setLayoutErrorMessage(message)
      } finally {
        if (!cancelled) {
          setIsLayoutLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeLayoutReference])

  const handleLayoutChange = useCallback((layout: LayoutDefinition) => {
    setActiveLayoutDefinition(layout)
    setLayoutStatusMessage(null)
    setLayoutErrorMessage(null)
  }, [])

  const handleSelectLayout = useCallback((id: string, category: LayoutCategory) => {
    setActiveLayoutReference({ id, category })
    setLayoutStatusMessage(null)
    setLayoutErrorMessage(null)
  }, [])

  const handleCreateBlankLayout = useCallback(() => {
    setActiveLayoutReference(null)
    setLayoutStatusMessage(null)
    setLayoutErrorMessage(null)
  }, [])

  const handleSaveLayoutDefinition = useCallback(
    async (
      layout: LayoutDefinition,
      options?: { originalId?: string | null; originalCategory?: LayoutCategory | null }
    ): Promise<LayoutDefinition> => {
      setIsSavingLayout(true)
      setLayoutStatusMessage(null)
      setLayoutErrorMessage(null)
      try {
        const saved = await saveLayoutDefinitionApi({
          layout,
          originalId: options?.originalId ?? null,
          originalCategory: options?.originalCategory ?? null
        })
        setActiveLayoutDefinition(saved)
        setActiveLayoutReference({ id: saved.id, category: 'custom' })
        await refreshLayoutCollection()
        setLayoutStatusMessage('Layout saved to your custom layouts.')
        return saved
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to save the layout. Please try again.'
        setLayoutErrorMessage(message)
        throw error
      } finally {
        setIsSavingLayout(false)
      }
    },
    [refreshLayoutCollection]
  )

  const handleImportLayoutDefinition = useCallback(async () => {
    setLayoutStatusMessage(null)
    setLayoutErrorMessage(null)
    try {
      const imported = await importLayoutDefinitionApi()
      if (!imported) {
        return
      }
      await refreshLayoutCollection()
      setActiveLayoutDefinition(imported)
      setActiveLayoutReference({ id: imported.id, category: 'custom' })
      setLayoutStatusMessage(`Imported layout “${imported.name}”.`)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to import the layout. Please try again.'
      setLayoutErrorMessage(message)
    }
  }, [refreshLayoutCollection])

  const handleExportLayoutDefinition = useCallback(
    async (id: string, category: LayoutCategory) => {
      setLayoutStatusMessage(null)
      setLayoutErrorMessage(null)
      try {
        await exportLayoutDefinitionApi(id, category)
        setLayoutStatusMessage('Layout exported successfully.')
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to export the layout. Please try again.'
        setLayoutErrorMessage(message)
      }
    },
    []
  )

  const applyUpdatedClip = useCallback(
    (updated: Clip) => {
      setClipState(updated)
      setRangeStart(updated.startSeconds)
      setRangeEnd(updated.endSeconds)
      setTitle(updated.title)
      setDescription(updated.description ?? '')
      setStatusMessage(null)
      setUploadStatus((previous) => (previous === 'scheduled' ? previous : 'ready'))
      const updatedSourceEnd = resolveSourceEndBoundFromClip(updated, minGap)
      const { start, end } = computePaddedWindowBounds(
        updated,
        minGap,
        CLIP_WINDOW_PADDING_SECONDS,
        updatedSourceEnd
      )
      setWindowStart(start)
      setWindowEnd(end)
      setPreviewTarget({ start: updated.startSeconds, end: updated.endSeconds })
      setPreviewMode(getDefaultPreviewMode(updated))
      layoutAppliedIdRef.current = updated.layoutId ?? null
      if (updated.layoutId) {
        setActiveLayoutReference({ id: updated.layoutId, category: resolveLayoutCategory(updated.layoutId) })
      } else {
        setActiveLayoutReference(null)
      }
      setPersistedState((previous) => ({
        ...(previous ?? {}),
        clip: updated,
        context: previous?.context ?? context,
        jobId: previous?.jobId ?? jobId ?? null,
        accountId: previous?.accountId ?? accountId ?? null
      }))
    },
    [accountId, context, jobId, minGap, resolveLayoutCategory, setPersistedState]
  )

  const submitClipAdjustment = useCallback(
    async (adjustment: { startSeconds: number; endSeconds: number; layoutId: string | null }) => {
      if (!clipState) {
        throw new Error('Load a clip before applying changes.')
      }

      const clipAccountId =
        accountId ?? (typeof clipState.accountId === 'string' && clipState.accountId.length > 0
          ? clipState.accountId
          : null)

      if (context === 'library' || (!jobId && clipAccountId)) {
        if (!clipAccountId) {
          throw new Error('We need an account to rebuild this clip. Try reopening it from the library.')
        }
        const updated = await adjustLibraryClip(clipAccountId, clipState.id, adjustment)
        applyUpdatedClip(updated)
        setPersistedState((previous) => ({
          ...(previous ?? {}),
          clip: updated,
          context: 'library',
          accountId: clipAccountId,
          jobId: previous?.jobId ?? null
        }))
        return updated
      }

      if (!jobId) {
        throw new Error('We lost the job that produced this clip. Save it to your library and try again.')
      }

      const updated = await adjustJobClip(jobId, clipState.id, adjustment)
      applyUpdatedClip(updated)
      setPersistedState((previous) => ({
        ...(previous ?? {}),
        clip: updated,
        context: 'job',
        jobId,
        accountId: previous?.accountId ?? clipAccountId ?? null
      }))
      return updated
    },
    [accountId, applyUpdatedClip, clipState, context, jobId, setPersistedState]
  )

  const handleApplyLayoutDefinition = useCallback(
    async (layout: LayoutDefinition) => {
      if (!clipState) {
        setLayoutErrorMessage('Load a clip before applying a layout.')
        return
      }
      setIsApplyingLayout(true)
      setLayoutStatusMessage(null)
      setLayoutErrorMessage(null)
      try {
        let reference = activeLayoutReference
        let currentLayout = layout
        const requiresSave =
          !reference || reference.id !== layout.id || reference.category !== 'custom'
        if (requiresSave) {
          currentLayout = await handleSaveLayoutDefinition(layout, {
            originalId: reference?.id ?? null,
            originalCategory: reference?.category ?? null
          })
          reference = { id: currentLayout.id, category: 'custom' }
        } else {
          await handleSaveLayoutDefinition(layout, {
            originalId: reference.id,
            originalCategory: reference.category
          })
        }

        const layoutIdToApply = reference?.id ?? currentLayout.id
        if (!layoutIdToApply) {
          throw new Error('Layout must be saved before applying.')
        }

        await submitClipAdjustment({
          startSeconds: clipState.startSeconds,
          endSeconds: clipState.endSeconds,
          layoutId: layoutIdToApply
        })
        setLayoutStatusMessage('Layout applied to this clip.')
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to apply the layout. Please try again.'
        setLayoutErrorMessage(message)
      } finally {
        setIsApplyingLayout(false)
      }
    },
    [
      accountId,
      activeLayoutReference,
      applyUpdatedClip,
      clipState,
      context,
      handleSaveLayoutDefinition,
      jobId,
      submitClipAdjustment
    ]
  )

  const handleDeleteLayoutDefinition = useCallback(
    async (id: string, category: LayoutCategory) => {
      if (category !== 'custom') {
        return
      }
      setLayoutStatusMessage(null)
      setLayoutErrorMessage(null)
      try {
        const deleted = await deleteLayoutDefinitionApi(id, category)
        if (activeLayoutReference?.id === id) {
          setActiveLayoutReference(null)
          setActiveLayoutDefinition(null)
        }
        if (layoutAppliedIdRef.current === id) {
          layoutAppliedIdRef.current = null
        }
        await refreshLayoutCollection()
        setLayoutStatusMessage(
          deleted
            ? 'Layout removed from your custom layouts.'
            : 'Layout was already removed from your custom layouts.'
        )
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to delete the layout. Please try again.'
        setLayoutErrorMessage(message)
        throw error
      }
    },
    [activeLayoutReference?.id, refreshLayoutCollection]
  )

  const runStepAnimation = useCallback(async (setSteps: (updater: (prev: SaveStepState[]) => SaveStepState[]) => void) => {
    for (let index = 1; index < SAVE_STEP_DEFINITIONS.length; index += 1) {
      await delay(200)
      setSteps((prev) =>
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
    setSteps((prev) => prev.map((step) => ({ ...step, status: 'completed' })))
  }, [])

  const handleRenderLayoutDefinition = useCallback(
    async (layout: LayoutDefinition) => {
      if (!clipState) {
        setLayoutErrorMessage('Load a clip before rendering a layout.')
        return
      }
      layoutRenderInFlightRef.current = true
      setLayoutRenderSteps(
        SAVE_STEP_DEFINITIONS.map((step, index) => ({
          ...step,
          status: index === 0 ? 'running' : 'pending'
        }))
      )
      setIsLayoutRendering(true)
      setLayoutRenderStatusMessage(null)
      setLayoutRenderErrorMessage(null)
      let resetWithSuccess = false
      try {
        await handleApplyLayoutDefinition(layout)
        await runStepAnimation(setLayoutRenderSteps)
        setLayoutRenderStatusMessage('Rendering started with the latest layout. We will notify you when it finishes.')
        resetWithSuccess = true
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Unable to render the clip with this layout. Please try again.'
        setLayoutRenderErrorMessage(message)
        setLayoutRenderSteps((prev) =>
          prev.map((step) => (step.status === 'running' ? { ...step, status: 'failed' } : step))
        )
      } finally {
        layoutRenderInFlightRef.current = false
        setIsLayoutRendering(false)
        if (layoutRenderResetPendingRef.current) {
          layoutRenderResetPendingRef.current = false
          setLayoutRenderSteps(createInitialSaveSteps())
          if (resetWithSuccess) {
            setLayoutRenderStatusMessage(null)
            setLayoutRenderErrorMessage(null)
          }
        }
      }
    },
    [
      clipState,
      handleApplyLayoutDefinition,
      layoutRenderInFlightRef,
      layoutRenderResetPendingRef,
      runStepAnimation
    ]
  )

  const originalStart = clipState?.originalStartSeconds ?? 0
  const originalEnd =
    clipState?.originalEndSeconds ?? originalStart + (clipState?.durationSec ?? 10)
  const supportsSourcePreview = Boolean(clipState)
  const adjustedButtonEnabled =
    supportsSourcePreview &&
    adjustedSourceState.status !== 'missing' &&
    adjustedSourceState.status !== 'error'

  const sourceStartBound = 0
  const sourceEndBound = useMemo(() => {
    if (!clipState) {
      return minGap
    }
    return resolveSourceEndBoundFromClip(clipState, minGap)
  }, [clipState, minGap])

  useEffect(() => {
    if (!clipState && previewMode !== 'rendered') {
      setPreviewMode('rendered')
    }
  }, [clipState, previewMode])

  const handleModeChange = useCallback(
    (mode: VideoPageMode) => {
      if (mode === activeMode) {
        return
      }
      const next = new URLSearchParams(searchParams)
      next.set('mode', mode)
      setSearchParams(next, { replace: true })
    },
    [activeMode, searchParams, setSearchParams]
  )

  const handleTogglePlatform = useCallback((platform: SupportedPlatform) => {
    setSelectedPlatforms((previous) => {
      if (previous.includes(platform)) {
        return previous.filter((item) => item !== platform)
      }
      return [...previous, platform]
    })
  }, [])

  const handleSaveDetails = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!title.trim()) {
        setStatusMessage('Add a clear title so viewers instantly know why the video matters.')
        return
      }
      setStatusMessage('Your video details are saved. You can keep tweaking without losing changes.')
    },
    [title]
  )

  const handleSaveDistribution = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (selectedPlatforms.length === 0) {
        setStatusMessage('Pick at least one platform so we know where to share your story.')
        return
      }
      setUploadStatus((previous) => (previous === 'idle' ? 'ready' : previous))
      const friendlyList = selectedPlatforms
        .map((platform) => PLATFORM_LABELS[platform])
        .join(', ')
      setStatusMessage(`We will prepare ${friendlyList} with your latest updates.`)
    },
    [selectedPlatforms]
  )

  const handleScheduleUpload = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!clipState) {
        setStatusMessage('Upload a video file or select an existing clip to continue.')
        return
      }
      if (selectedPlatforms.length === 0) {
        setStatusMessage('Select at least one platform before scheduling the upload.')
        return
      }
      setUploadStatus('scheduled')
      setStatusMessage('Great! Your video is queued. We will notify you when the upload is complete.')
    },
    [clipState, selectedPlatforms]
  )

  const uploadStatusLabel = useMemo(() => {
    if (uploadStatus === 'scheduled') {
      return 'Upload scheduled — we will take it from here.'
    }
    if (uploadStatus === 'ready') {
      return 'Ready to upload once you give the green light.'
    }
    return 'No upload planned yet.'
  }, [uploadStatus])

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
      setTitle(sourceClip.title)
      setDescription(sourceClip.description ?? '')
      setUploadStatus('ready')
      return
    }

    let cancelled = false
    const loadClip = async (): Promise<void> => {
      setIsLoadingClip(true)
      setLoadError(null)
      try {
        let clip: Clip
        if (context === 'library') {
          if (!accountId) {
            throw new Error('This clip is no longer associated with a library account.')
          }
          clip = await fetchLibraryClip(accountId, id)
        } else {
          if (!jobId) {
            throw new Error('The pipeline job for this clip is no longer active.')
          }
          clip = await fetchJobClip(jobId, id)
        }
        if (!cancelled) {
          setClipState(clip)
          setLoadError(null)
          setPersistedState((previous) => ({
            ...(previous ?? {}),
            clip,
            context,
            jobId,
            accountId
          }))
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
  }, [accountId, context, id, jobId, sourceClip])

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
    const { start, end } = computePaddedWindowBounds(
      clipState,
      minGap,
      CLIP_WINDOW_PADDING_SECONDS,
      sourceEndBound
    )
    setWindowStart(start)
    setWindowEnd(end)
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
      setRangeStart(clipState.originalStartSeconds)
      setRangeEnd(Math.max(clipState.originalStartSeconds + minGap, clipState.originalEndSeconds))
      const { start, end } = computePaddedWindowBounds(
        clipState,
        minGap,
        CLIP_WINDOW_PADDING_SECONDS,
        sourceEndBound
      )
      setWindowStart(start)
      setWindowEnd(end)
      setPreviewTarget({
        start: clipState.originalStartSeconds,
        end: Math.max(
          clipState.originalStartSeconds + MIN_PREVIEW_DURATION,
          clipState.originalEndSeconds
        )
      })
      setPreviewMode(getDefaultPreviewMode(clipState))
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

  const adjustedPreviewSrc = useMemo(() => {
    if (trimmedPreviewState.status === 'ready') {
      return trimmedPreviewState.url
    }
    return null
  }, [trimmedPreviewState])

  const previewSourceIsFile =
    previewMode === 'adjusted'
      ? trimmedPreviewState.status === 'ready'
      : clipState
          ? clipState.previewUrl.startsWith('file://')
          : false

  const currentPreviewRange = useMemo(() => {
    if (!clipState) {
      return { start: 0, end: 0 }
    }
    if (previewMode === 'adjusted') {
      if (trimmedPreviewState.status === 'ready') {
        const { applied } = trimmedPreviewState
        const target = previewTarget
        const startAligned = Math.abs(applied.start - target.start) < 0.001
        const endAligned = Math.abs(applied.end - target.end) < 0.001
        if (startAligned && endAligned) {
          return applied
        }
      }
      return previewTarget
    }
    return { start: clipState.startSeconds, end: clipState.endSeconds }
  }, [clipState, previewMode, previewTarget, trimmedPreviewState])

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

  useEffect(() => {
    playbackWindowRef.current = { start: previewStart, end: previewEnd }
  }, [previewStart, previewEnd])

  const releaseCurrentTrimmedToken = useCallback(() => {
    const token = trimmedTokenRef.current
    if (!token) {
      return
    }
    trimmedTokenRef.current = null
    void releaseTrimmedPreviewToken(token)
  }, [])

  useEffect(() => {
    if (!clipState) {
      setAdjustedSourceState({ status: 'idle' })
      setPendingSourceOverride(null)
      setTrimmedPreviewState({ status: 'idle' })
      releaseCurrentTrimmedToken()
    }
  }, [clipState, releaseCurrentTrimmedToken])

  const activeVideoSrcCandidate = previewMode === 'rendered' ? renderedSrc : adjustedPreviewSrc

  const activeVideoSrc =
    activeVideoSrcCandidate && activeVideoSrcCandidate.length > 0
      ? activeVideoSrcCandidate
      : null

  const activePoster = previewMode === 'rendered' ? (clipState?.thumbnail ?? undefined) : undefined
  const videoKey = clipState
    ? `${clipState.id}-${previewMode}-${activeVideoSrc}`
    : `${previewMode}-${activeVideoSrc}`

  const showVideoLoadingOverlay =
    isVideoBuffering ||
    (previewMode === 'adjusted' && (adjustedBuffering || adjustedSourceState.status === 'loading'))

  const adjustedReadyPath =
    adjustedSourceState.status === 'ready' ? adjustedSourceState.filePath : null
  const adjustedMissingPath =
    adjustedSourceState.status === 'missing'
      ? adjustedSourceState.expectedPath ?? adjustedSourceState.projectDir
      : null

  useEffect(() => {
    setIsVideoBuffering(false)
  }, [activeVideoSrc, previewMode])

  useEffect(() => {
    if (!clipState || previewMode !== 'adjusted') {
      if (previewMode !== 'adjusted') {
        setAdjustedBuffering(false)
      }
      return
    }

    ensureCspAndElectronAllowLocalMedia()
    const key = clipState.videoId ?? clipState.id
    setAdjustedSourceState((previous) => {
      if (previous.status === 'ready' && previous.key === key && !pendingSourceOverride) {
        return previous
      }
      return { status: 'loading', key }
    })
    setAdjustedPlaybackError(null)
    setAdjustedWarning(null)

    let cancelled = false
    ;(async () => {
      const result = await resolveOriginalSource({
        clipId: clipState.id,
        projectId: clipState.videoId ?? null,
        accountId: clipState.accountId ?? null,
        playbackUrl: clipState.playbackUrl,
        previewUrl: clipState.previewUrl,
        overridePath: pendingSourceOverride
      })
      if (cancelled) {
        return
      }
      if (result.kind === 'ready') {
        console.info('[adjusted-preview] source ready', {
          clipId: clipState.id,
          filePath: result.filePath,
          start: playbackWindowRef.current.start,
          end: playbackWindowRef.current.end
        })
        setAdjustedSourceState({
          status: 'ready',
          key,
          fileUrl: result.fileUrl,
          filePath: result.filePath,
          origin: result.origin,
          projectDir: result.projectDir ?? null
        })
      } else if (result.kind === 'missing') {
        setAdjustedSourceState({
          status: 'missing',
          key,
          expectedPath: result.expectedPath ?? null,
          projectDir: result.projectDir ?? null,
          triedPreferred: result.triedPreferred
        })
      } else {
        setAdjustedSourceState({ status: 'error', key, message: result.message })
      }
      setPendingSourceOverride(null)
    })()

    return () => {
      cancelled = true
    }
  }, [clipState, pendingSourceOverride, playbackWindowRef, previewMode])

  useEffect(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    element.volume = sharedVolume.volume
    element.muted = sharedVolume.muted
  }, [sharedVolume, videoKey])

  useEffect(() => {
    if (previewMode !== 'adjusted') {
      trimmedPlaybackGuardsRef.current?.dispose()
      trimmedPlaybackGuardsRef.current = null
      setTrimmedPreviewState({ status: 'idle' })
      setAdjustedBuffering(false)
      setAdjustedWarning(null)
      setAdjustedPlaybackError(null)
      releaseCurrentTrimmedToken()
      playbackResumeIntentRef.current = false
      return
    }

    if (adjustedSourceState.status !== 'ready') {
      trimmedPlaybackGuardsRef.current?.dispose()
      trimmedPlaybackGuardsRef.current = null
      setTrimmedPreviewState({ status: 'idle' })
      setAdjustedBuffering(false)
      releaseCurrentTrimmedToken()
      playbackResumeIntentRef.current = false
      return
    }

    const element = previewVideoRef.current
    if (!element) {
      setTrimmedPreviewState({ status: 'idle' })
      setAdjustedBuffering(false)
      playbackResumeIntentRef.current = false
      return
    }

    const { filePath } = adjustedSourceState
    const previousToken = trimmedTokenRef.current
    let cancelled = false

    const shouldResumePlayback = !element.paused && !element.ended
    playbackResumeIntentRef.current = shouldResumePlayback

    setAdjustedBuffering(true)
    setAdjustedPlaybackError(null)
    setTrimmedPreviewState((previous) => ({
      status: 'loading',
      token: previous.status === 'ready' ? previous.token : null
    }))

    ;(async () => {
      const result = await buildTrimmedPreviewSource({
        filePath,
        start: previewStart,
        end: previewEnd
      })

      if (cancelled) {
        if (result.kind === 'ready') {
          await releaseTrimmedPreviewToken(result.token)
        }
        return
      }

      if (result.kind === 'ready') {
        console.info('[adjusted-preview] trimmed source ready', {
          clipId: clipState?.id ?? null,
          start: result.applied.start,
          end: result.applied.end,
          duration: result.duration,
          strategy: result.strategy
        })
        trimmedTokenRef.current = result.token
        playbackWindowRef.current = { ...result.applied }
        setTrimmedPreviewState({
          status: 'ready',
          token: result.token,
          url: result.url,
          duration: result.duration,
          strategy: result.strategy,
          applied: result.applied,
          warning: result.warning
        })
        setAdjustedBuffering(false)
        setAdjustedPlaybackError(null)
        if (result.warning) {
          setAdjustedWarning(
            result.warning.reason === 'reversed'
              ? WARNING_REVERSED_MESSAGE
              : WARNING_OUT_OF_BOUNDS_MESSAGE
          )
        } else {
          setAdjustedWarning(null)
        }
        if (previousToken && previousToken !== result.token) {
          void releaseTrimmedPreviewToken(previousToken)
        }
      } else {
        console.error('[adjusted-preview] trimmed preview error', result.message)
        trimmedTokenRef.current = null
        setTrimmedPreviewState({
          status: 'error',
          message: result.message,
          warning: result.warning
        })
        setAdjustedBuffering(false)
        if (result.warning) {
          setAdjustedWarning(
            result.warning.reason === 'reversed'
              ? WARNING_REVERSED_MESSAGE
              : WARNING_OUT_OF_BOUNDS_MESSAGE
          )
        } else {
          setAdjustedWarning(null)
        }
        setAdjustedPlaybackError(result.message)
        if (previousToken) {
          void releaseTrimmedPreviewToken(previousToken)
        }
        playbackResumeIntentRef.current = false
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    adjustedSourceState,
    clipState,
    previewEnd,
    previewMode,
    previewStart,
    releaseCurrentTrimmedToken
  ])

  useEffect(() => {
    console.info('[adjusted-preview] preview mode selected', { mode: previewMode })
    if (previewMode !== 'adjusted') {
      setAdjustedWarning(null)
      setAdjustedPlaybackError(null)
      playbackResumeIntentRef.current = false
    }
  }, [previewMode])

  useEffect(() => {
    return () => {
      trimmedPlaybackGuardsRef.current?.dispose()
      trimmedPlaybackGuardsRef.current = null
      releaseCurrentTrimmedToken()
    }
  }, [releaseCurrentTrimmedToken])

  useEffect(() => {
    trimmedPlaybackGuardsRef.current?.dispose()
    trimmedPlaybackGuardsRef.current = null

    if (previewMode !== 'adjusted' || trimmedPreviewState.status !== 'ready') {
      return
    }

    const element = previewVideoRef.current
    if (!element) {
      return
    }

    const guards = attachTrimmedPlaybackGuards(element, {
      duration: trimmedPreviewState.duration,
      onEnded: () => {
        if (clipState) {
          console.info('[adjusted-preview] playback reached end', {
            clipId: clipState.id,
            start: trimmedPreviewState.applied.start,
            end: trimmedPreviewState.applied.end
          })
        }
      },
      onError: (error) => {
        console.error('[adjusted-preview] playback error', error)
        setAdjustedPlaybackError(
          `We couldn't play the original video (${error.message}). Try installing the necessary codecs or locating the file again.`
        )
      }
    })

    trimmedPlaybackGuardsRef.current = guards

    return () => {
      guards.dispose()
      if (trimmedPlaybackGuardsRef.current === guards) {
        trimmedPlaybackGuardsRef.current = null
      }
    }
  }, [clipState, previewMode, trimmedPreviewState])

  const handleVideoLoadStart = useCallback(() => {
    setIsVideoBuffering(true)
  }, [])

  const handleVideoCanPlay = useCallback(() => {
    setIsVideoBuffering(false)
    if (previewMode === 'adjusted' && playbackResumeIntentRef.current) {
      playbackResumeIntentRef.current = false
      const element = previewVideoRef.current
      if (!element) {
        return
      }
      const playback = element.play()
      if (playback && typeof playback.catch === 'function') {
        playback.catch(() => undefined)
      }
    }
  }, [previewMode])

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

  const handleLocateOriginalSource = useCallback(async () => {
    if (!clipState) {
      return
    }
    if (typeof window.api?.openVideoFile !== 'function') {
      setAdjustedPlaybackError('File chooser is not available. Please locate the file manually in your project folder.')
      return
    }
    try {
      const selectedPath = await window.api.openVideoFile()
      if (!selectedPath) {
        return
      }
      setPendingSourceOverride(selectedPath)
      setAdjustedSourceState({ status: 'loading', key: clipState.videoId ?? clipState.id })
    } catch (error) {
      console.error('[adjusted-preview] locate original source failed', error)
      setAdjustedPlaybackError('We could not open the file picker. Please try again or select the file from your project folder.')
    }
  }, [clipState])

  const handleVideoLoadedMetadata = useCallback(() => {
    if (!clipState || previewMode === 'rendered' || previewMode === 'adjusted' || !previewSourceIsFile) {
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
    if (!clipState || previewMode === 'rendered' || previewMode === 'adjusted' || !previewSourceIsFile) {
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
    if (!clipState || previewMode === 'rendered' || previewMode === 'adjusted' || !previewSourceIsFile) {
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
    if (!clipState || previewMode === 'rendered' || previewMode === 'adjusted' || !previewSourceIsFile) {
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
      await submitClipAdjustment({
        startSeconds: adjustedStart,
        endSeconds: adjustedEnd,
        layoutId: clipState.layoutId ?? null
      })
      await runStepAnimation(setSaveSteps)
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
    clipState,
    rangeEnd,
    rangeStart,
    runStepAnimation,
    submitClipAdjustment
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
  const layoutPanelStatus = layoutStatusMessage
  const layoutPanelError = layoutErrorMessage ?? layoutCollectionError

  const tabNavigation = (
    <nav
      aria-label="Video modes"
      className="inline-flex rounded-[16px] border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-1 text-sm font-semibold text-[var(--fg)] shadow-[0_14px_28px_rgba(43,42,40,0.16)]"
    >
      {VIDEO_PAGE_MODES.map((tab) => {
        const isActive = activeMode === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => handleModeChange(tab.id)}
            aria-pressed={isActive}
            className={`flex-1 whitespace-nowrap rounded-[12px] px-4 py-2 transition ${
              isActive
                ? 'bg-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] text-[var(--fg)] shadow-[0_10px_18px_rgba(43,42,40,0.18)]'
                : 'text-[var(--muted)] hover:bg-[color:color-mix(in_srgb,var(--panel)_60%,transparent)] hover:text-[var(--fg)]'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )

  if (activeMode === 'layout') {
    return (
      <LayoutModeView
        tabNavigation={tabNavigation}
        clip={clipState}
        layoutCollection={layoutCollection}
        isCollectionLoading={isLayoutCollectionLoading}
        selectedLayout={activeLayoutDefinition}
        selectedLayoutReference={activeLayoutReference}
        isLayoutLoading={isLayoutLoading}
        appliedLayoutId={clipState?.layoutId ?? null}
        isSavingLayout={isSavingLayout}
        isApplyingLayout={isApplyingLayout}
        statusMessage={layoutPanelStatus}
        errorMessage={layoutPanelError}
        onSelectLayout={handleSelectLayout}
        onCreateBlankLayout={handleCreateBlankLayout}
        onLayoutChange={handleLayoutChange}
        onSaveLayout={handleSaveLayoutDefinition}
        onImportLayout={handleImportLayoutDefinition}
        onExportLayout={handleExportLayoutDefinition}
        onApplyLayout={handleApplyLayoutDefinition}
        onRenderLayout={handleRenderLayoutDefinition}
        renderSteps={layoutRenderSteps}
        isRenderingLayout={isLayoutRendering}
        renderStatusMessage={layoutRenderStatusMessage}
        renderErrorMessage={layoutRenderErrorMessage}
        onDeleteLayout={handleDeleteLayoutDefinition}
      />
    )
  }

  return (
    <section className="flex w-full flex-1 flex-col gap-8 px-6 py-10 lg:px-8">
      <div className="flex flex-wrap justify-start gap-3">{tabNavigation}</div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4">
          <div className="flex h-full flex-col gap-4">
            <VideoPreviewStage>
              <video
                ref={previewVideoRef}
                key={videoKey}
                src={activeVideoSrc ?? undefined}
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
              {showVideoLoadingOverlay ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40">
                  <div
                    className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-transparent"
                    aria-hidden
                  />
                </div>
              ) : null}
            </VideoPreviewStage>
            {activeMode !== 'layout' && previewMode === 'adjusted' ? (
              <div className="space-y-2">
                {adjustedSourceState.status === 'missing' ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] px-3 py-2 text-sm text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]">
                    <p className="font-semibold">Original video not found</p>
                    <p>
                      We looked for the full-length download
                      {adjustedMissingPath ? (
                        <>
                          {' '}
                          at <code className="break-all text-xs">{adjustedMissingPath}</code>
                        </>
                      ) : null}
                      , but it’s missing. Choose <strong>Locate file</strong> to point us to the correct video.
                    </p>
                    <div>
                      <button
                        type="button"
                        onClick={handleLocateOriginalSource}
                        className="inline-flex items-center gap-2 rounded-lg border border-transparent bg-[color:var(--ring)] px-3 py-1.5 text-xs font-semibold text-[color:var(--accent-contrast)] shadow-[0_10px_18px_rgba(15,23,42,0.28)] transition hover:-translate-y-0.5 hover:bg-[color:color-mix(in_srgb,var(--ring-strong)_75%,var(--ring))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-strong)]"
                      >
                        Locate file
                      </button>
                    </div>
                  </div>
                ) : null}
                {adjustedSourceState.status === 'error' ? (
                  <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--warning-strong)_45%,var(--edge))] bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--warning-contrast)]">
                    <p className="font-semibold">Adjusted preview unavailable</p>
                    <p className="mt-1">
                      {adjustedSourceState.message}{' '}
                      <button
                        type="button"
                        onClick={handleLocateOriginalSource}
                        className="font-semibold text-[color:var(--ring)] underline-offset-2 hover:underline"
                      >
                        Locate file
                      </button>{' '}
                      to pick the correct source video.
                    </p>
                  </div>
                ) : null}
                {adjustedPlaybackError ? (
                  <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--warning-strong)_45%,var(--edge))] bg-[color:var(--warning-soft)] px-3 py-2 text-sm text-[color:var(--warning-contrast)]">
                    <p className="font-semibold">Playback issue</p>
                    <p className="mt-1">{adjustedPlaybackError}</p>
                    {adjustedReadyPath ? (
                      <p className="mt-1 text-xs opacity-80">
                        File: <code className="break-all">{adjustedReadyPath}</code>
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {adjustedWarning ? (
                  <div className="rounded-xl border border-[color:color-mix(in_srgb,var(--warning-strong)_45%,var(--edge))] bg-[color:var(--warning-soft)] px-3 py-2 text-xs text-[color:var(--warning-contrast)]">
                    {adjustedWarning}
                  </div>
                ) : null}
              </div>
            ) : null}
            {activeMode !== 'layout' ? (
              <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  View mode
                </span>
                <div className="flex overflow-hidden rounded-lg border border-white/10">
                  <button
                    type="button"
                    onClick={() => adjustedButtonEnabled && setPreviewMode('adjusted')}
                    className={`px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                      previewMode === 'adjusted'
                        ? 'bg-[color:color-mix(in_srgb,var(--muted)_50%,transparent)] text-[var(--fg)]'
                        : adjustedButtonEnabled
                          ? 'text-[var(--fg)] hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)]'
                          : 'cursor-not-allowed text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]'
                    }`}
                    aria-pressed={previewMode === 'adjusted'}
                    aria-disabled={!adjustedButtonEnabled}
                    disabled={!adjustedButtonEnabled}
                  >
                    Adjusted preview
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
                    : adjustedSourceState.status === 'missing'
                      ? 'Adjusted preview requires the original full-length video. Locate the file to enable trimming.'
                      : 'Previewing the trimmed range directly from the original video without captions or layout.'}
              </p>
              {renderedOutOfSync ? (
                <p className="text-xs font-medium text-[color:color-mix(in_srgb,var(--warning-strong)_80%,var(--accent-contrast))]">
                  The rendered output does not yet reflect these boundaries. Save the clip to rerun
                  step 7 and refresh the export.
                </p>
              ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex w-full max-w-xl flex-col gap-6">
          {statusMessage ? (
            <div
              role="status"
              className="rounded-lg border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_68%,transparent)] px-4 py-3 text-sm text-[var(--fg)] shadow-[0_10px_20px_rgba(43,42,40,0.14)]"
            >
              {statusMessage}
            </div>
          ) : null}
          {activeMode === 'metadata' ? (
            <MetadataModeView
              title={title}
              description={description}
              callToAction={callToAction}
              tags={tags}
              onTitleChange={setTitle}
              onDescriptionChange={setDescription}
              onCallToActionChange={setCallToAction}
              onTagsChange={setTags}
              onSubmit={handleSaveDetails}
            />
          ) : null}
          {activeMode === 'upload' ? (
            <UploadModeView
              selectedPlatforms={selectedPlatforms}
              onTogglePlatform={handleTogglePlatform}
              platformNotes={platformNotes}
              onPlatformNotesChange={setPlatformNotes}
              onSaveDistribution={handleSaveDistribution}
              onScheduleUpload={handleScheduleUpload}
              uploadStatus={uploadStatus}
              uploadStatusLabel={uploadStatusLabel}
            />
          ) : null}
          {activeMode === 'trim' ? (
            <TrimModeView
              clip={clipState}
              timelineRef={timelineRef}
              originalOverlayLayer={originalOverlayLayer}
              renderedOverlayLayer={renderedOverlayLayer}
              originalOverlayLeftInset={originalOverlayLeftInset}
              originalOverlayRightInset={originalOverlayRightInset}
              renderedOverlayLeftInset={renderedOverlayLeftInset}
              renderedOverlayRightInset={renderedOverlayRightInset}
              originalStartMarkerPercent={originalStartMarkerPercent}
              originalEndMarkerPercent={originalEndMarkerPercent}
              renderedStartMarkerPercent={renderedStartMarkerPercent}
              renderedEndMarkerPercent={renderedEndMarkerPercent}
              currentOverlayLeftInset={currentOverlayLeftInset}
              currentOverlayRightInset={currentOverlayRightInset}
              showStartTooltip={showStartTooltip}
              showEndTooltip={showEndTooltip}
              startPercent={startPercent}
              endPercent={endPercent}
              startOffsetTooltip={startOffsetTooltip}
              endOffsetTooltip={endOffsetTooltip}
              startHandleValueMin={startHandleValueMin}
              startHandleValueMax={startHandleValueMax}
              endHandleValueMin={endHandleValueMin}
              endHandleValueMax={endHandleValueMax}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              windowStart={windowStart}
              windowEnd={windowEnd}
              startAriaValueText={startAriaValueText}
              endAriaValueText={endAriaValueText}
              onHandlePointerDown={handleHandlePointerDown}
              onHandlePointerMove={handleHandlePointerMove}
              onHandlePointerEnd={handleHandlePointerEnd}
              onHandleKeyDown={handleHandleKeyDown}
              onHandleBlur={handleHandleBlur}
              onSnapToOriginal={handleSnapToOriginal}
              onSnapToRendered={handleSnapToRendered}
              shouldShowRenderedOverlay={shouldShowRenderedOverlay}
              formattedStartOffset={formattedStartOffset}
              formattedEndOffset={formattedEndOffset}
              onRangeInputChange={handleRangeInputChange}
              onRangeInputKeyDown={handleRangeInputKeyDown}
              onRangeInputBlur={handleRangeInputBlur}
              offsetReference={offsetReference}
              durationSeconds={durationSeconds}
              durationWithinLimits={durationWithinLimits}
              minClipDurationSeconds={minClipDurationSeconds}
              maxClipDurationSeconds={maxClipDurationSeconds}
              durationWithinSweetSpot={durationWithinSweetSpot}
              sweetSpotMinSeconds={sweetSpotMinSeconds}
              sweetSpotMaxSeconds={sweetSpotMaxSeconds}
              expandAmount={expandAmount}
              onExpandAmountChange={handleExpandAmountChange}
              onExpandLeft={handleExpandLeft}
              onExpandRight={handleExpandRight}
              onSave={handleSave}
              onReset={handleReset}
              isSaving={isSaving}
              isLoadingClip={isLoadingClip}
              shouldShowSaveSteps={shouldShowSaveSteps}
              saveSteps={saveSteps}
              saveError={saveError}
              saveSuccess={saveSuccess}
            />
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

export default VideoPage
