import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FC, FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ClipCard from '../components/ClipCard'
import MarbleSpinner from '../components/MarbleSpinner'
import VideoPreviewStage from '../components/VideoPreviewStage'
import useSharedVolume from '../hooks/useSharedVolume'
import { formatDuration, formatViews, timeAgo } from '../lib/format'
import { buildCacheBustedPlaybackUrl } from '../lib/video'
import { fetchAccountClipsPage, fetchLibraryClip } from '../services/clipLibrary'
import {
  PLATFORM_LABELS,
  SUPPORTED_PLATFORMS,
  type Clip,
  type SupportedPlatform
} from '../types'

type VideoPageLocationState = {
  clip?: Clip
  accountId?: string | null
  clipTitle?: string
}

type VideoPageTab = 'edit' | 'select' | 'layout'

type UploadStatus = 'idle' | 'ready' | 'scheduled'

type CaptionStrategyOption = {
  value: CaptionStrategy
  label: string
}

type CaptionStrategy = 'auto' | 'upload'

type LayoutPreset = 'split' | 'side-by-side' | 'picture-in-picture'

type SubtitleStyle = 'modern' | 'bold' | 'minimal'

const CAPTION_STRATEGIES: CaptionStrategyOption[] = [
  { value: 'auto', label: 'Auto-generate captions' },
  { value: 'upload', label: 'Use my uploaded caption file' }
]

const MIN_CLIP_GAP = 0.25
const DEFAULT_TRIM_DURATION = 30

const normaliseTab = (value: string | undefined): VideoPageTab => {
  if (value === 'select') {
    return 'select'
  }
  if (value === 'layout') {
    return 'layout'
  }
  return 'edit'
}

const DEFAULT_CALL_TO_ACTION = 'Invite viewers to subscribe for more highlights.'
const DEFAULT_TAGS = 'clips, highlights, community'
const DEFAULT_PLATFORM_NOTES = 'Share with the community playlist and pin on the channel page.'

const createUniqueClipList = (items: Clip[], selectedClip: Clip | null): Clip[] => {
  const map = new Map<string, Clip>()
  if (selectedClip) {
    map.set(selectedClip.id, selectedClip)
  }
  for (const clip of items) {
    if (!map.has(clip.id)) {
      map.set(clip.id, clip)
    }
  }
  return Array.from(map.values())
}

const VideoPage: FC = () => {
  const { id: clipIdParam, '*': wildcard } = useParams<{ id: string; '*': string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = (location.state as VideoPageLocationState | null) ?? null

  const initialClip =
    locationState?.clip && (!clipIdParam || locationState.clip.id === clipIdParam)
      ? locationState.clip
      : null

  const [selectedClip, setSelectedClip] = useState<Clip | null>(initialClip ?? null)
  const [activeAccountId, setActiveAccountId] = useState<string | null>(
    locationState?.accountId ?? initialClip?.accountId ?? null
  )
  const [isLoadingClip, setIsLoadingClip] = useState(!initialClip && Boolean(clipIdParam))
  const [clipError, setClipError] = useState<string | null>(null)
  const [availableClips, setAvailableClips] = useState<Clip[]>(initialClip ? [initialClip] : [])
  const [isLoadingClipList, setIsLoadingClipList] = useState(false)
  const [clipListError, setClipListError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>(initialClip ? 'ready' : 'idle')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const [title, setTitle] = useState<string>(
    locationState?.clipTitle ?? initialClip?.title ?? 'Video workspace'
  )
  const [description, setDescription] = useState<string>(initialClip?.description ?? '')
  const [callToAction, setCallToAction] = useState<string>(DEFAULT_CALL_TO_ACTION)
  const [tags, setTags] = useState<string>(DEFAULT_TAGS)
  const [selectedPlatforms, setSelectedPlatforms] = useState<SupportedPlatform[]>([...SUPPORTED_PLATFORMS])
  const [platformNotes, setPlatformNotes] = useState<string>(DEFAULT_PLATFORM_NOTES)
  const [captionStrategy, setCaptionStrategy] = useState<CaptionStrategy>('auto')

  const [trimStart, setTrimStart] = useState<number>(initialClip?.startSeconds ?? 0)
  const [trimEnd, setTrimEnd] = useState<number>(
    initialClip?.endSeconds ?? (initialClip ? initialClip.startSeconds + MIN_CLIP_GAP : DEFAULT_TRIM_DURATION)
  )
  const [scale, setScale] = useState<number>(1)
  const [positionX, setPositionX] = useState<number>(0)
  const [positionY, setPositionY] = useState<number>(0)
  const [rotation, setRotation] = useState<number>(0)
  const [brightness, setBrightness] = useState<number>(1)
  const [contrast, setContrast] = useState<number>(1)
  const [enableStabilisation, setEnableStabilisation] = useState<boolean>(true)
  const [subtitleStyle, setSubtitleStyle] = useState<SubtitleStyle>('modern')
  const [subtitleSize, setSubtitleSize] = useState<number>(42)

  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>('split')
  const [showWatermark, setShowWatermark] = useState<boolean>(true)
  const [highlightFocus, setHighlightFocus] = useState<'auto' | 'speaker' | 'gameplay'>('auto')
  const [backgroundAccent, setBackgroundAccent] = useState<string>('electric')

  const previousClipIdRef = useRef<string | null>(initialClip?.id ?? null)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const [sharedVolume, setSharedVolume] = useSharedVolume()

  const rawTab = wildcard && wildcard.length > 0 ? wildcard.split('/')[0] : undefined
  const activeTab = normaliseTab(rawTab)

  useEffect(() => {
    if (!clipIdParam || rawTab) {
      return
    }
    const encodedId = encodeURIComponent(clipIdParam)
    navigate(`/video/${encodedId}/edit`, { replace: true, state: locationState ?? undefined })
  }, [clipIdParam, navigate, rawTab, locationState])

  useEffect(() => {
    if (!selectedFile) {
      setUploadedPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(selectedFile)
    setUploadedPreviewUrl(url)
    return () => {
      URL.revokeObjectURL(url)
    }
  }, [selectedFile])

  useEffect(() => {
    if (!selectedClip) {
      return
    }
    if (previousClipIdRef.current === selectedClip.id) {
      return
    }
    previousClipIdRef.current = selectedClip.id
    setTitle(selectedClip.title)
    setDescription(selectedClip.description ?? '')
    setTrimStart(selectedClip.startSeconds)
    setTrimEnd(Math.max(selectedClip.startSeconds + MIN_CLIP_GAP, selectedClip.endSeconds))
    setStatusMessage(null)
    setUploadStatus((previous) => (previous === 'scheduled' ? previous : 'ready'))
  }, [selectedClip])

  useEffect(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    element.volume = sharedVolume.volume
    element.muted = sharedVolume.muted
  }, [sharedVolume, selectedClip?.id, uploadedPreviewUrl])

  const handleVolumeChange = useCallback(() => {
    const element = previewVideoRef.current
    if (!element) {
      return
    }
    setSharedVolume({ volume: element.volume, muted: element.muted })
  }, [setSharedVolume])

  useEffect(() => {
    if (initialClip && (!selectedClip || selectedClip.id !== initialClip.id)) {
      setSelectedClip(initialClip)
      setActiveAccountId((previous) => initialClip.accountId ?? locationState?.accountId ?? previous ?? null)
    }
  }, [initialClip, locationState?.accountId, selectedClip])

  useEffect(() => {
    let cancelled = false
    if (!clipIdParam) {
      setSelectedClip(null)
      setIsLoadingClip(false)
      return
    }
    if (initialClip && initialClip.id === clipIdParam) {
      setIsLoadingClip(false)
      return
    }
    if (!activeAccountId) {
      setClipError('Select a clip from your library to get started.')
      setIsLoadingClip(false)
      return
    }
    setIsLoadingClip(true)
    setClipError(null)
    const load = async (): Promise<void> => {
      try {
        const clip = await fetchLibraryClip(activeAccountId, clipIdParam)
        if (cancelled) {
          return
        }
        setSelectedClip(clip)
        setAvailableClips((previous) => createUniqueClipList(previous, clip))
        setClipError(null)
      } catch (error) {
        console.error('Unable to load clip', error)
        if (!cancelled) {
          setClipError('We could not load that clip. Try picking another one from the list.')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingClip(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activeAccountId, clipIdParam, initialClip])

  useEffect(() => {
    let cancelled = false
    if (!activeAccountId) {
      setClipListError(null)
      setAvailableClips((previous) => createUniqueClipList(previous, selectedClip))
      setIsLoadingClipList(false)
      return
    }
    setIsLoadingClipList(true)
    setClipListError(null)
    const load = async (): Promise<void> => {
      try {
        const page = await fetchAccountClipsPage({ accountId: activeAccountId, limit: 12 })
        if (cancelled) {
          return
        }
        setAvailableClips(createUniqueClipList(page.clips, selectedClip))
      } catch (error) {
        console.error('Unable to load clips for account', error)
        if (!cancelled) {
          setClipListError('We had trouble loading clips for this account. Refresh or try another account.')
        }
      } finally {
        if (!cancelled) {
          setIsLoadingClipList(false)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [activeAccountId, selectedClip])

  useEffect(() => {
    setUploadStatus((previous) => {
      if (previous === 'scheduled') {
        return previous
      }
      if (selectedClip || selectedFile) {
        return 'ready'
      }
      return 'idle'
    })
  }, [selectedClip, selectedFile])

  const resolvedClipList = useMemo(
    () => createUniqueClipList(availableClips, selectedClip),
    [availableClips, selectedClip]
  )

  const previewSource = useMemo(() => {
    if (uploadedPreviewUrl) {
      return uploadedPreviewUrl
    }
    if (!selectedClip) {
      return null
    }
    const cacheBusted = buildCacheBustedPlaybackUrl(selectedClip)
    return cacheBusted.length > 0 ? cacheBusted : selectedClip.previewUrl
  }, [selectedClip, uploadedPreviewUrl])

  const previewPoster = useMemo(
    () => (selectedClip && !uploadedPreviewUrl ? selectedClip.thumbnail ?? undefined : undefined),
    [selectedClip, uploadedPreviewUrl]
  )

  const activeDuration = selectedClip?.sourceDurationSeconds ?? selectedClip?.durationSec ?? 120
  const trimDuration = Math.max(0, trimEnd - trimStart)

  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  const handleOpenFullEditor = useCallback(() => {
    if (!selectedClip) {
      return
    }
    navigate(`/clip/${encodeURIComponent(selectedClip.id)}/edit`, {
      state: {
        clip: selectedClip,
        jobId: null,
        accountId: activeAccountId,
        context: 'library'
      }
    })
  }, [activeAccountId, navigate, selectedClip])

  const handleTabChange = useCallback(
    (tab: VideoPageTab) => {
      if (!clipIdParam) {
        return
      }
      const encodedId = encodeURIComponent(clipIdParam)
      const targetPath = tab === 'edit' ? `/video/${encodedId}/edit` : `/video/${encodedId}/${tab}`
      navigate(targetPath, {
        state: selectedClip
          ? { clip: selectedClip, accountId: activeAccountId, clipTitle: selectedClip.title }
          : { accountId: activeAccountId, clipTitle: title }
      })
    },
    [activeAccountId, clipIdParam, navigate, selectedClip, title]
  )

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null
      setSelectedFile(file)
      if (file) {
        setSelectedClip(null)
        setStatusMessage(`${file.name} is ready to upload.`)
        setTitle(file.name.replace(/\.[^.]+$/, ''))
        setClipError(null)
        setIsLoadingClip(false)
      } else {
        setStatusMessage(null)
      }
    },
    []
  )

  const handleClearFile = useCallback(() => {
    setSelectedFile(null)
    setStatusMessage('Upload cleared. Pick a new file or select an existing clip.')
  }, [])

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
      const friendlyList = selectedPlatforms.map((platform) => PLATFORM_LABELS[platform]).join(', ')
      setStatusMessage(`We will prepare ${friendlyList} with your latest updates.`)
    },
    [selectedPlatforms]
  )

  const handleScheduleUpload = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!selectedClip && !selectedFile) {
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
    [selectedClip, selectedFile, selectedPlatforms.length]
  )

  const handleApplyEdits = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      setStatusMessage(
        `Edits saved. We will render ${formatDuration(trimDuration)} focused on the best moments.`
      )
    },
    [trimDuration]
  )

  const handleSelectClip = useCallback(
    (clip: Clip) => {
      setSelectedFile(null)
      setSelectedClip(clip)
      setStatusMessage(null)
      setClipError(null)
      setIsLoadingClip(false)
      setActiveAccountId((previous) => clip.accountId ?? previous ?? activeAccountId ?? null)
      const encodedId = encodeURIComponent(clip.id)
      navigate(`/video/${encodedId}/edit`, {
        state: { clip, accountId: clip.accountId ?? activeAccountId ?? null, clipTitle: clip.title }
      })
    },
    [activeAccountId, navigate]
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

  const layoutSummary = useMemo(() => {
    const focusLabel =
      highlightFocus === 'auto'
        ? 'auto framing'
        : highlightFocus === 'speaker'
          ? 'speaker spotlight'
          : 'gameplay focus'
    const watermarkLabel = showWatermark ? 'watermark on' : 'no watermark'
    return `${layoutPreset.replace(/-/g, ' ')} layout, ${focusLabel}, ${watermarkLabel}, ${backgroundAccent} accent`
  }, [backgroundAccent, highlightFocus, layoutPreset, showWatermark])

  return (
    <section className="flex w-full flex-1 flex-col gap-6 px-6 py-8 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Back
        </button>
        {selectedClip ? (
          <button
            type="button"
            onClick={handleOpenFullEditor}
            className="marble-button marble-button--primary px-4 py-2 text-sm font-semibold"
          >
            Open full editor
          </button>
        ) : null}
      </div>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex-1 space-y-4">
          <VideoPreviewStage height="clamp(260px, 68vh, 720px)">
            {previewSource ? (
              <video
                key={previewSource}
                src={previewSource}
                poster={previewPoster}
                controls
                playsInline
                preload="metadata"
                ref={previewVideoRef}
                onVolumeChange={handleVolumeChange}
                className="h-full w-full object-contain"
              >
                Your browser does not support the video tag.
              </video>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center text-sm text-[var(--muted)]">
                <span className="text-lg font-semibold text-[var(--fg)]">No video selected</span>
                <span>Choose a clip or upload a file to preview it here.</span>
              </div>
            )}
            {isLoadingClip ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <MarbleSpinner size={40} label="Loading clip" />
              </div>
            ) : null}
          </VideoPreviewStage>
          {selectedClip ? (
            <div className="rounded-xl border border-white/10 bg-[color:var(--card-strong)] p-4 text-sm text-[var(--muted)]">
              <h2 className="text-lg font-semibold text-[var(--fg)]">{selectedClip.title}</h2>
              <p className="mt-1 text-xs uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_82%,transparent)]">
                {selectedClip.channel}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                {selectedClip.views !== null ? <span>{formatViews(selectedClip.views)} views</span> : null}
                <span>• {timeAgo(selectedClip.createdAt)}</span>
                <span>• {formatDuration(selectedClip.durationSec)}</span>
              </div>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-[auto_1fr]">
                <dt className="font-medium text-[var(--fg)]">Trim range</dt>
                <dd>
                  {formatDuration(trimStart)} – {formatDuration(trimEnd)} ({formatDuration(trimDuration)})
                </dd>
                {selectedClip.timestampSeconds !== null && selectedClip.timestampSeconds !== undefined ? (
                  <>
                    <dt className="font-medium text-[var(--fg)]">Starts at</dt>
                    <dd>{formatDuration(selectedClip.timestampSeconds)}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          ) : null}
          {clipError ? (
            <div className="rounded-xl border border-[color:var(--error-soft)] bg-[color:color-mix(in_srgb,var(--error-soft)_35%,transparent)] px-4 py-3 text-sm text-[color:var(--error-strong)]">
              {clipError}
            </div>
          ) : null}
        </div>
        <aside className="flex w-full max-w-xl flex-col gap-4">
          <div className="inline-flex w-full items-center justify-between rounded-[16px] border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-1 text-sm font-medium text-[var(--fg)] shadow-[0_14px_28px_rgba(43,42,40,0.16)]">
            {([
              { id: 'edit', label: 'Edit' },
              { id: 'select', label: 'Video Select' },
              { id: 'layout', label: 'Layout Editor' }
            ] as const).map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex-1 rounded-[12px] px-3 py-2 transition ${
                    isActive
                      ? 'bg-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] text-[var(--fg)] shadow-[0_10px_18px_rgba(43,42,40,0.18)]'
                      : 'text-[var(--muted)] hover:bg-[color:color-mix(in_srgb,var(--panel)_60%,transparent)] hover:text-[var(--fg)]'
                  }`}
                >
                  {tab.label}
                </button>
              )
            })}
          </div>
          {statusMessage ? (
            <div
              role="status"
              className="rounded-lg border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_68%,transparent)] px-4 py-3 text-sm text-[var(--fg)] shadow-[0_10px_20px_rgba(43,42,40,0.14)]"
            >
              {statusMessage}
            </div>
          ) : null}
          {activeTab === 'edit' ? (
            <div className="space-y-5 rounded-xl border border-white/10 bg-[color:var(--card-strong)] p-4 text-sm">
              <form onSubmit={handleApplyEdits} className="space-y-3">
                <h3 className="text-base font-semibold text-[var(--fg)]">Editing controls</h3>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Trim window
                  </span>
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                      <span>Start: {formatDuration(trimStart)}</span>
                      <span>End: {formatDuration(trimEnd)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(MIN_CLIP_GAP, activeDuration)}
                      step={0.05}
                      value={trimStart}
                      onChange={(event) => {
                        const next = Number.parseFloat(event.target.value)
                        setTrimStart(Math.min(next, trimEnd - MIN_CLIP_GAP))
                      }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={Math.max(MIN_CLIP_GAP, activeDuration)}
                      step={0.05}
                      value={trimEnd}
                      onChange={(event) => {
                        const next = Number.parseFloat(event.target.value)
                        setTrimEnd(Math.max(next, trimStart + MIN_CLIP_GAP))
                      }}
                    />
                  </div>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                      Scale
                    </span>
                    <input
                      type="range"
                      min={0.75}
                      max={1.5}
                      step={0.01}
                      value={scale}
                      onChange={(event) => setScale(Number.parseFloat(event.target.value))}
                    />
                    <span className="text-xs text-[var(--muted)]">{(scale * 100).toFixed(0)}%</span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                      Rotation
                    </span>
                    <input
                      type="range"
                      min={-10}
                      max={10}
                      step={0.5}
                      value={rotation}
                      onChange={(event) => setRotation(Number.parseFloat(event.target.value))}
                    />
                    <span className="text-xs text-[var(--muted)]">{rotation.toFixed(1)}°</span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                      Position X
                    </span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={positionX}
                      onChange={(event) => setPositionX(Number.parseFloat(event.target.value))}
                    />
                    <span className="text-xs text-[var(--muted)]">{positionX.toFixed(0)} px</span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                      Position Y
                    </span>
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={positionY}
                      onChange={(event) => setPositionY(Number.parseFloat(event.target.value))}
                    />
                    <span className="text-xs text-[var(--muted)]">{positionY.toFixed(0)} px</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                      Brightness
                    </span>
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.01}
                      value={brightness}
                      onChange={(event) => setBrightness(Number.parseFloat(event.target.value))}
                    />
                    <span className="text-xs text-[var(--muted)]">{(brightness * 100).toFixed(0)}%</span>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                      Contrast
                    </span>
                    <input
                      type="range"
                      min={0.5}
                      max={1.5}
                      step={0.01}
                      value={contrast}
                      onChange={(event) => setContrast(Number.parseFloat(event.target.value))}
                    />
                    <span className="text-xs text-[var(--muted)]">{(contrast * 100).toFixed(0)}%</span>
                  </label>
                </div>
                <label className="inline-flex items-center gap-2 text-sm font-medium text-[var(--fg)]">
                  <input
                    type="checkbox"
                    checked={enableStabilisation}
                    onChange={(event) => setEnableStabilisation(event.target.checked)}
                    className="h-4 w-4 rounded border-white/30 bg-transparent"
                  />
                  Smooth shaky footage
                </label>
              </div>
              <div className="space-y-3">
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Subtitle strategy
                  </span>
                  <select
                    value={captionStrategy}
                    onChange={(event) => setCaptionStrategy(event.target.value as CaptionStrategy)}
                    className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    {CAPTION_STRATEGIES.map((entry) => (
                      <option key={entry.value} value={entry.value}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Subtitle style
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(['modern', 'bold', 'minimal'] as SubtitleStyle[]).map((style) => (
                      <button
                        key={style}
                        type="button"
                        onClick={() => setSubtitleStyle(style)}
                        className={`rounded-lg border px-2 py-1 text-xs font-semibold capitalize transition ${
                          subtitleStyle === style
                            ? 'border-[var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] text-[var(--fg)]'
                            : 'border-white/10 text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--fg)]'
                        }`}
                      >
                        {style}
                      </button>
                    ))}
                  </div>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Subtitle size
                  </span>
                  <input
                    type="range"
                    min={28}
                    max={56}
                    step={1}
                    value={subtitleSize}
                    onChange={(event) => setSubtitleSize(Number.parseFloat(event.target.value))}
                  />
                  <span className="text-xs text-[var(--muted)]">{subtitleSize}px</span>
                </label>
                <button
                  type="submit"
                  className="marble-button marble-button--secondary w-full justify-center px-4 py-2 text-sm font-semibold"
                >
                  Save edit settings
                </button>
              </form>
              <div className="h-px w-full bg-white/10" />
              <form className="space-y-3" onSubmit={handleSaveDetails}>
                <h4 className="text-sm font-semibold text-[var(--fg)]">Metadata</h4>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Title
                  </span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    placeholder="Give this clip a headline"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Description
                  </span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="min-h-[96px] w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    placeholder="Set the stage for viewers"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Call to action
                  </span>
                  <input
                    value={callToAction}
                    onChange={(event) => setCallToAction(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Tags
                  </span>
                  <input
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <button
                  type="submit"
                  className="marble-button marble-button--primary w-full justify-center px-4 py-2 text-sm font-semibold"
                >
                  Save details
                </button>
              </form>
              <div className="h-px w-full bg-white/10" />
              <form className="space-y-3" onSubmit={handleSaveDistribution}>
                <h4 className="text-sm font-semibold text-[var(--fg)]">Distribution plan</h4>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_PLATFORMS.map((platform) => {
                    const isActive = selectedPlatforms.includes(platform)
                    return (
                      <button
                        key={platform}
                        type="button"
                        onClick={() => handleTogglePlatform(platform)}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                          isActive
                            ? 'border-[var(--accent)] bg-[color:color-mix(in_srgb,var(--accent)_24%,transparent)] text-[var(--fg)]'
                            : 'border-white/10 text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--fg)]'
                        }`}
                      >
                        {PLATFORM_LABELS[platform]}
                      </button>
                    )
                  })}
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Platform notes
                  </span>
                  <textarea
                    value={platformNotes}
                    onChange={(event) => setPlatformNotes(event.target.value)}
                    className="min-h-[72px] w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <button
                  type="submit"
                  className="marble-button marble-button--secondary w-full justify-center px-4 py-2 text-sm font-semibold"
                >
                  Save distribution
                </button>
              </form>
              <div className="h-px w-full bg-white/10" />
              <form className="space-y-3" onSubmit={handleScheduleUpload}>
                <h4 className="text-sm font-semibold text-[var(--fg)]">Upload schedule</h4>
                <p className="text-xs text-[var(--muted)]">{uploadStatusLabel}</p>
                <button
                  type="submit"
                  className="marble-button marble-button--primary w-full justify-center px-4 py-2 text-sm font-semibold"
                  disabled={uploadStatus === 'scheduled'}
                >
                  {uploadStatus === 'scheduled' ? 'Upload scheduled' : 'Schedule upload'}
                </button>
              </form>
            </div>
          ) : null}
          {activeTab === 'select' ? (
            <div className="space-y-4 rounded-xl border border-white/10 bg-[color:var(--card-strong)] p-4 text-sm">
              <h3 className="text-base font-semibold text-[var(--fg)]">Video selection</h3>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                  Upload a new video
                </span>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileChange}
                  className="w-full rounded-lg border border-dashed border-white/20 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)]"
                />
                {selectedFile ? (
                  <div className="flex items-center justify-between rounded-lg bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-3 py-2 text-xs text-[var(--fg)]">
                    <span className="truncate">{selectedFile.name}</span>
                    <button
                      type="button"
                      onClick={handleClearFile}
                      className="text-[color:var(--accent)] underline-offset-4 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                ) : null}
              </label>
              <div className="h-px w-full bg-white/10" />
              <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                <span>Library clips</span>
                {isLoadingClipList ? (
                  <span className="inline-flex items-center gap-2">
                    <MarbleSpinner size={18} /> Loading…
                  </span>
                ) : null}
              </div>
              {clipListError ? (
                <div className="rounded-lg border border-[color:var(--error-soft)] bg-[color:color-mix(in_srgb,var(--error-soft)_35%,transparent)] px-3 py-2 text-xs text-[color:var(--error-strong)]">
                  {clipListError}
                </div>
              ) : null}
              {resolvedClipList.length === 0 && !isLoadingClipList ? (
                <p className="text-xs text-[var(--muted)]">
                  We could not find any clips for this account yet. Upload a file to get started.
                </p>
              ) : null}
              <div className="grid grid-cols-1 gap-3">
                {resolvedClipList.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    onClick={() => handleSelectClip(clip)}
                    isActive={selectedClip ? clip.id === selectedClip.id : false}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {activeTab === 'layout' ? (
            <form className="space-y-4 rounded-xl border border-white/10 bg-[color:var(--card-strong)] p-4 text-sm" onSubmit={(event) => {
              event.preventDefault()
              setStatusMessage('Layout preferences saved. We will apply them to the next render.')
            }}>
              <h3 className="text-base font-semibold text-[var(--fg)]">Layout configuration</h3>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                  Layout preset
                </span>
                <select
                  value={layoutPreset}
                  onChange={(event) => setLayoutPreset(event.target.value as LayoutPreset)}
                  className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <option value="split">Split with captions</option>
                  <option value="side-by-side">Side-by-side</option>
                  <option value="picture-in-picture">Picture-in-picture</option>
                </select>
              </label>
              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                  Emphasis
                </legend>
                {[
                  { value: 'auto', label: 'Let Atropos decide' },
                  { value: 'speaker', label: 'Keep the speaker in frame' },
                  { value: 'gameplay', label: 'Highlight gameplay moments' }
                ].map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-[var(--fg)]">
                    <input
                      type="radio"
                      name="highlight-focus"
                      value={option.value}
                      checked={highlightFocus === option.value}
                      onChange={(event) => setHighlightFocus(event.target.value as typeof highlightFocus)}
                    />
                    {option.label}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center justify-between gap-3 text-sm text-[var(--fg)]">
                <span>Show watermark</span>
                <input
                  type="checkbox"
                  checked={showWatermark}
                  onChange={(event) => setShowWatermark(event.target.checked)}
                  className="h-4 w-8 rounded-full border-white/30 bg-transparent"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                  Accent style
                </span>
                <select
                  value={backgroundAccent}
                  onChange={(event) => setBackgroundAccent(event.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[color:var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <option value="electric">Electric neon</option>
                  <option value="sunset">Sunset glow</option>
                  <option value="midnight">Midnight gradient</option>
                  <option value="minimal">Minimal neutral</option>
                </select>
              </label>
              <div className="rounded-lg border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-3 py-2 text-xs text-[var(--muted)]">
                {layoutSummary}
              </div>
              <button
                type="submit"
                className="marble-button marble-button--primary w-full justify-center px-4 py-2 text-sm font-semibold"
              >
                Save layout
              </button>
            </form>
          ) : null}
        </aside>
      </div>
    </section>
  )
}

export default VideoPage
