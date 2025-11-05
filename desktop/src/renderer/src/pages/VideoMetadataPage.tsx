import { useCallback, useEffect, useState } from 'react'
import type { FC, FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import VideoMetadataView from '../components/video/VideoMetadataView'
import { fetchJobClip } from '../services/pipelineApi'
import { fetchLibraryClip } from '../services/clipLibrary'
import type { Clip } from '../types'
import {
  DEFAULT_CALL_TO_ACTION,
  DEFAULT_TAGS
} from '../constants/videoPageDefaults'

type VideoMetadataPageLocationState = {
  clip?: Clip
  jobId?: string | null
  accountId?: string | null
  context?: 'job' | 'library'
}

const VideoMetadataPage: FC = () => {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const state = (location.state as VideoMetadataPageLocationState | null) ?? null
  const [persistedState, setPersistedState] = useState<VideoMetadataPageLocationState | null>(() =>
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

  const [clipState, setClipState] = useState<Clip | null>(sourceClip ?? null)
  const [isLoadingClip, setIsLoadingClip] = useState(!sourceClip && Boolean(id))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [title, setTitle] = useState<string>(sourceClip?.title ?? '')
  const [description, setDescription] = useState<string>(sourceClip?.description ?? '')
  const [callToAction, setCallToAction] = useState<string>(DEFAULT_CALL_TO_ACTION)
  const [tags, setTags] = useState<string>(DEFAULT_TAGS)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!id) {
      setClipState(null)
      setIsLoadingClip(false)
      setLoadError('Clip information is unavailable. Return to the previous screen and try again.')
      return
    }
    if (sourceClip && sourceClip.id === id) {
      setClipState(sourceClip)
      setTitle(sourceClip.title ?? '')
      setDescription(sourceClip.description ?? '')
      setIsLoadingClip(false)
      setLoadError(null)
      return
    }
    setIsLoadingClip(true)
    setLoadError(null)
    const loadClip = async (): Promise<void> => {
      try {
        let clip: Clip
        if (context === 'library' && accountId) {
          clip = await fetchLibraryClip(accountId, id)
        } else {
          clip = await fetchJobClip(id)
        }
        setClipState(clip)
        setTitle(clip.title ?? '')
        setDescription(clip.description ?? '')
        setLoadError(null)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to load clip details from the server.'
        setLoadError(message)
        setClipState(null)
      } finally {
        setIsLoadingClip(false)
      }
    }
    void loadClip()
  }, [id, context, accountId, sourceClip])

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

  const handleBackToVideo = useCallback(() => {
    if (id) {
      navigate(`/video/${id}?mode=trim`, {
        state: {
          clip: clipState,
          jobId,
          accountId,
          context
        }
      })
    } else {
      navigate('/jobs')
    }
  }, [id, navigate, clipState, jobId, accountId, context])

  if (loadError) {
    return (
      <section className="flex w-full flex-1 flex-col gap-8 px-6 py-10 lg:px-8">
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold text-[var(--fg)]">Error loading clip</h1>
          <p className="text-sm text-[var(--muted)]">{loadError}</p>
          <button
            type="button"
            onClick={handleBackToVideo}
            className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-[color:var(--accent)]"
          >
            ← Back to video
          </button>
        </div>
      </section>
    )
  }

  if (isLoadingClip) {
    return (
      <section className="flex w-full flex-1 flex-col items-center justify-center gap-4 px-6 py-10">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/30 border-t-transparent" />
        <p className="text-sm text-[var(--muted)]">Loading clip details...</p>
      </section>
    )
  }

  return (
    <section className="flex w-full flex-1 flex-col gap-8 px-6 py-10 lg:px-8">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-[var(--fg)]">Edit metadata</h1>
          <p className="text-sm text-[var(--muted)]">
            Update the title, description, and other details for your clip.
          </p>
        </div>
        <button
          type="button"
          onClick={handleBackToVideo}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-[color:var(--accent)]"
        >
          ← Back to video
        </button>
      </div>

      <div className="flex max-w-2xl flex-col gap-6">
        {statusMessage ? (
          <div
            role="status"
            className="rounded-lg border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_68%,transparent)] px-4 py-3 text-sm text-[var(--fg)] shadow-[0_10px_20px_rgba(43,42,40,0.14)]"
          >
            {statusMessage}
          </div>
        ) : null}

        {clipState ? (
          <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4">
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium text-[var(--muted)]">Clip title:</span>
                <span className="text-[var(--fg)]">{clipState.title}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium text-[var(--muted)]">Channel:</span>
                <span className="text-[var(--fg)]">{clipState.channel}</span>
              </div>
            </div>
          </div>
        ) : null}

        <VideoMetadataView
          title={title}
          description={description}
          callToAction={callToAction}
          tags={tags}
          onTitleChange={setTitle}
          onDescriptionChange={setDescription}
          onCallToActionChange={setCallToAction}
          onTagsChange={setTags}
          onSave={handleSaveDetails}
        />
      </div>
    </section>
  )
}

export default VideoMetadataPage
