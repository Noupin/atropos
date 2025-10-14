import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ChangeEvent, FC, FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatDuration, formatViews, timeAgo } from '../lib/format'
import useSharedVolume from '../hooks/useSharedVolume'
import VideoPreviewStage from '../components/VideoPreviewStage'
import {
  PLATFORM_LABELS,
  SUPPORTED_PLATFORMS,
  type Clip,
  type SupportedPlatform
} from '../types'

const CAPTION_STRATEGIES = [
  { value: 'auto', label: 'Auto-generate captions' },
  { value: 'upload', label: 'Use my uploaded caption file' }
] as const

type CaptionStrategy = (typeof CAPTION_STRATEGIES)[number]['value']

type WorkspaceLocationState = {
  clip?: Clip
  accountId?: string | null
  clipTitle?: string
}

type WorkspaceMode = 'metadata' | 'upload'

const VideoWorkspace: FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state as WorkspaceLocationState | null) ?? null

  const clipFromState = state?.clip && (!id || state.clip.id === id) ? state.clip : null
  const clipTitle = clipFromState?.title ?? state?.clipTitle ?? 'Video workspace'
  const accountIdFromState = state?.accountId ?? null
  const clipId = clipFromState?.id ?? id ?? null

  const [title, setTitle] = useState<string>(clipTitle)
  const [description, setDescription] = useState<string>(clipFromState?.description ?? '')
  const [callToAction, setCallToAction] = useState<string>('Invite viewers to subscribe for more highlights.')
  const [tags, setTags] = useState<string>('clips, highlights, community')
  const [selectedPlatforms, setSelectedPlatforms] = useState<SupportedPlatform[]>([...SUPPORTED_PLATFORMS])
  const [platformNotes, setPlatformNotes] = useState<string>('Share with the community playlist and pin on the channel page.')
  const [captionStrategy, setCaptionStrategy] = useState<CaptionStrategy>('auto')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'ready' | 'scheduled'>(clipFromState ? 'ready' : 'idle')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(clipFromState ? 'metadata' : 'upload')
  const [sharedVolume, setSharedVolume] = useSharedVolume()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previousClipIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!clipFromState) {
      return
    }
    if (previousClipIdRef.current === clipFromState.id) {
      return
    }
    previousClipIdRef.current = clipFromState.id
    setTitle(clipFromState.title)
    setDescription(clipFromState.description ?? '')
    setStatusMessage(null)
    setUploadStatus('ready')
    setWorkspaceMode('metadata')
  }, [clipFromState])

  useEffect(() => {
    const element = videoRef.current
    if (!element) {
      return
    }
    element.volume = sharedVolume.volume
    element.muted = sharedVolume.muted
  }, [sharedVolume, clipFromState?.id])

  const handleVolumeChange = useCallback(() => {
    const element = videoRef.current
    if (!element) {
      return
    }
    setSharedVolume({ volume: element.volume, muted: element.muted })
  }, [setSharedVolume])

  const handleFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    setSelectedFile(file)
    if (file) {
      setUploadStatus('ready')
      setStatusMessage(`${file.name} is ready to upload.`)
    } else {
      setUploadStatus(clipFromState ? 'ready' : 'idle')
    }
  }, [clipFromState])

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
      if (!clipFromState && !selectedFile) {
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
    [clipFromState, selectedFile, selectedPlatforms.length]
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

  const handleOpenClipEditor = useCallback(() => {
    if (!clipId) {
      return
    }
    navigate(`/clip/${encodeURIComponent(clipId)}/edit`, {
      state: {
        ...(clipFromState ? { clip: clipFromState } : {}),
        accountId: accountIdFromState,
        jobId: null,
        context: 'library'
      }
    })
  }, [accountIdFromState, clipFromState, clipId, navigate])

  const handleBack = useCallback(() => {
    navigate(-1)
  }, [navigate])

  return (
    <section className="flex w-full flex-1 flex-col gap-6 px-6 py-8 lg:px-8">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleBack}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          Back
        </button>
        {clipId ? (
          <button
            type="button"
            onClick={handleOpenClipEditor}
            className="marble-button marble-button--primary px-4 py-2 text-sm font-semibold"
          >
            Open full editor
          </button>
        ) : null}
      </div>
      {statusMessage ? (
        <div className="rounded-xl border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-3 text-sm text-[var(--fg)] shadow-[0_12px_24px_rgba(43,42,40,0.16)]">
          {statusMessage}
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-[color:var(--depth)] p-4">
            <VideoPreviewStage>
              {clipFromState ? (
                <video
                  key={clipFromState.id}
                  ref={videoRef}
                  src={clipFromState.playbackUrl}
                  poster={clipFromState.thumbnail ?? undefined}
                  controls
                  playsInline
                  preload="metadata"
                  onVolumeChange={handleVolumeChange}
                  className="h-full w-auto max-h-full max-w-full bg-black object-contain"
                >
                  Your browser does not support the video tag.
                </video>
              ) : selectedFile ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-[var(--fg)]">
                  <span className="text-xl font-semibold">{selectedFile.name}</span>
                  <p className="max-w-md text-sm text-[var(--muted)]">
                    We will render a preview as soon as the upload finishes. Feel free to keep editing the details in the meantime.
                  </p>
                </div>
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-8 text-center text-[var(--fg)]">
                  <span className="text-xl font-semibold">Drop a video to begin</span>
                  <p className="max-w-md text-sm text-[var(--muted)]">
                    Upload a new file or jump back to the library to choose an existing highlight. Everything else on this page is ready when you are.
                  </p>
                </div>
              )}
            </VideoPreviewStage>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_82%,transparent)] p-6 shadow-[0_18px_34px_rgba(43,42,40,0.18)]">
            <header className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                Workspace mode
              </p>
              <h2 className="text-lg font-semibold text-[var(--fg)]">What would you like to update?</h2>
            </header>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                Switch between polishing metadata or preparing uploads. The preview stays put.
              </p>
              <div className="flex overflow-hidden rounded-lg border border-white/10">
                <button
                  type="button"
                  onClick={() => setWorkspaceMode('metadata')}
                  className={`px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                    workspaceMode === 'metadata'
                      ? 'bg-[color:color-mix(in_srgb,var(--muted)_45%,transparent)] text-[var(--fg)]'
                      : 'text-[var(--fg)] hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)]'
                  }`}
                  aria-pressed={workspaceMode === 'metadata'}
                >
                  Metadata
                </button>
                <button
                  type="button"
                  onClick={() => setWorkspaceMode('upload')}
                  className={`px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                    workspaceMode === 'upload'
                      ? 'bg-[color:color-mix(in_srgb,var(--muted)_45%,transparent)] text-[var(--fg)]'
                      : 'text-[var(--fg)] hover:bg-[color:color-mix(in_srgb,var(--muted)_20%,transparent)]'
                  }`}
                  aria-pressed={workspaceMode === 'upload'}
                >
                  Uploading
                </button>
              </div>
            </div>
          </div>

          {workspaceMode === 'metadata' ? (
            <>
              <form
                className="space-y-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_78%,transparent)] p-6 shadow-[0_18px_34px_rgba(43,42,40,0.18)]"
                onSubmit={handleSaveDetails}
              >
                <header className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Metadata
                  </p>
                  <h2 className="text-xl font-semibold text-[var(--fg)]">Polish how the video is presented</h2>
                </header>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                    Title
                  </span>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Give your clip a headline viewers can’t resist"
                    className="rounded-xl border border-white/10 bg-[color:var(--card)] px-4 py-2 text-sm text-[var(--fg)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                    Description
                  </span>
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={5}
                    placeholder="Add context, key takeaways, or a friendly shoutout to collaborators."
                    className="rounded-xl border border-white/10 bg-[color:var(--card)] px-4 py-2 text-sm leading-relaxed text-[var(--fg)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                    Call to action
                  </span>
                  <input
                    type="text"
                    value={callToAction}
                    onChange={(event) => setCallToAction(event.target.value)}
                    className="rounded-xl border border-white/10 bg-[color:var(--card)] px-4 py-2 text-sm text-[var(--fg)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                    Tags
                  </span>
                  <input
                    type="text"
                    value={tags}
                    onChange={(event) => setTags(event.target.value)}
                    className="rounded-xl border border-white/10 bg-[color:var(--card)] px-4 py-2 text-sm text-[var(--fg)] shadow-[0_12px_22px_rgba(43,42,40,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="marble-button marble-button--primary px-4 py-2 text-sm font-semibold"
                  >
                    Save details
                  </button>
                </div>
              </form>
            </>
          ) : (
            <>
              <form
                className="space-y-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_82%,transparent)] p-6 shadow-[0_18px_34px_rgba(43,42,40,0.18)]"
                onSubmit={handleSaveDistribution}
              >
                <header className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Distribution
                  </p>
                  <h2 className="text-lg font-semibold text-[var(--fg)]">Choose platforms</h2>
                </header>
                <div className="space-y-3">
                  {SUPPORTED_PLATFORMS.map((platform) => {
                    const checked = selectedPlatforms.includes(platform)
                    return (
                      <label
                        key={platform}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_78%,transparent)] px-4 py-3 text-sm text-[var(--fg)] shadow-sm"
                      >
                        <span className="flex flex-col">
                          <span className="font-semibold">{PLATFORM_LABELS[platform]}</span>
                          <span className="text-xs text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                            {checked ? 'Scheduled for upload' : 'Tap to include this platform'}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => handleTogglePlatform(platform)}
                          className="h-4 w-4 rounded border-white/20 bg-transparent text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                        />
                      </label>
                    )
                  })}
                </div>
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                    Notes for your team
                  </span>
                  <textarea
                    value={platformNotes}
                    onChange={(event) => setPlatformNotes(event.target.value)}
                    rows={3}
                    className="rounded-xl border border-white/10 bg-[color:var(--panel)] px-4 py-2 text-sm leading-relaxed text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="marble-button marble-button--outline px-4 py-2 text-sm font-semibold"
                  >
                    Save distribution plan
                  </button>
                </div>
              </form>

              <form
                className="space-y-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_82%,transparent)] p-6 shadow-[0_18px_34px_rgba(43,42,40,0.18)]"
                onSubmit={handleScheduleUpload}
              >
                <header className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Upload
                  </p>
                  <h2 className="text-lg font-semibold text-[var(--fg)]">Prepare your file</h2>
                </header>
                <div className="rounded-xl border border-dashed border-white/20 bg-[color:color-mix(in_srgb,var(--panel)_74%,transparent)] px-4 py-6 text-sm text-[var(--muted)]">
                  <label className="flex cursor-pointer flex-col items-center gap-2 text-center">
                    <span className="text-sm font-semibold text-[var(--fg)]">
                      {selectedFile ? selectedFile.name : 'Drag and drop or choose a file'}
                    </span>
                    <span className="text-xs text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                      MP4 or MOV — we will handle resizing and captioning automatically.
                    </span>
                    <input type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
                  </label>
                </div>
                <div className="rounded-xl border border-white/10 bg-[color:var(--panel)] px-4 py-3 text-sm text-[var(--fg)]">
                  {uploadStatusLabel}
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_75%,transparent)]">
                    Caption preference
                  </legend>
                  {CAPTION_STRATEGIES.map((option) => (
                    <label key={option.value} className="flex items-center gap-3 text-sm text-[var(--fg)]">
                      <input
                        type="radio"
                        name="caption-strategy"
                        value={option.value}
                        checked={captionStrategy === option.value}
                        onChange={() => setCaptionStrategy(option.value)}
                        className="h-4 w-4 border-white/20 bg-transparent text-[color:var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="flex justify-end">
                  <button
                    type="submit"
                    className="marble-button marble-button--primary px-4 py-2 text-sm font-semibold"
                  >
                    Schedule upload
                  </button>
                </div>
              </form>

              {clipFromState ? (
                <div className="space-y-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_82%,transparent)] p-6 shadow-[0_18px_34px_rgba(43,42,40,0.18)]">
                  <header className="space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                      Source details
                    </p>
                    <h2 className="text-lg font-semibold text-[var(--fg)]">Quick stats</h2>
                  </header>
                  <dl className="grid gap-3 text-sm text-[var(--muted)]">
                    <div className="flex items-center justify-between gap-2">
                      <dt className="font-medium text-[var(--fg)]">Views</dt>
                      <dd>{clipFromState.views !== null ? formatViews(clipFromState.views) : 'Unknown'}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="font-medium text-[var(--fg)]">Created</dt>
                      <dd>{new Date(clipFromState.createdAt).toLocaleString()}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="font-medium text-[var(--fg)]">Published</dt>
                      <dd>{clipFromState.sourcePublishedAt ? timeAgo(clipFromState.sourcePublishedAt) : 'Not available'}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt className="font-medium text-[var(--fg)]">Duration</dt>
                      <dd>{formatDuration(clipFromState.durationSec)}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}

              <div className="space-y-3 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_82%,transparent)] p-6 shadow-[0_18px_34px_rgba(43,42,40,0.18)]">
                <header className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_78%,transparent)]">
                    Checklist
                  </p>
                  <h2 className="text-lg font-semibold text-[var(--fg)]">Make it shine</h2>
                </header>
                <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--fg)]">
                  <li>Add a hook in the first five seconds to keep viewers watching.</li>
                  <li>Highlight a clear takeaway so the audience knows what to remember.</li>
                  <li>Double-check captions for names and jargon before publishing.</li>
                  <li>Share the clip in your community feed to spark conversation.</li>
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

export default VideoWorkspace
