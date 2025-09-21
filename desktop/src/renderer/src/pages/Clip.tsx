import { useCallback, useEffect, useRef } from 'react'
import type { FC } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { formatDuration, formatViews, timeAgo } from '../lib/format'
import ClipDescription from '../components/ClipDescription'
import type { Clip, SearchBridge } from '../types'
import useSharedVolume from '../hooks/useSharedVolume'

type ClipPageProps = {
  registerSearch: (bridge: SearchBridge | null) => void
}

const ClipPage: FC<ClipPageProps> = ({ registerSearch }) => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    registerSearch(null)
  }, [registerSearch])

  const locationState = location.state as { clip?: Clip } | null
  const clip = locationState?.clip && locationState.clip.id === id ? locationState.clip : null

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [sharedVolume, setSharedVolume] = useSharedVolume()

  useEffect(() => {
    const element = videoRef.current
    if (!element) {
      return
    }
    element.volume = sharedVolume.volume
    element.muted = sharedVolume.muted
  }, [sharedVolume, clip?.id])

  const handleVolumeChange = useCallback(() => {
    const element = videoRef.current
    if (!element) {
      return
    }
    setSharedVolume({ volume: element.volume, muted: element.muted })
  }, [setSharedVolume])

  if (!clip) {
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
          <h2 className="text-xl font-semibold text-[var(--fg)]">Clip not found</h2>
          <p className="mt-2 max-w-md text-sm text-[var(--muted)]">
            We couldn’t find the clip you were looking for. Try returning to the library to browse other highlights.
          </p>
        </div>
      </section>
    )
  }

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
        <div className="flex-1 overflow-hidden rounded-2xl bg-black/50">
          <video
            key={clip.id}
            src={clip.playbackUrl}
            poster={clip.thumbnail ?? undefined}
            controls
            playsInline
            preload="metadata"
            ref={videoRef}
            onVolumeChange={handleVolumeChange}
            className="h-full w-full object-cover"
          >
            Your browser does not support the video tag.
          </video>
        </div>
        <div className="flex w-full max-w-xl flex-col gap-6">
          <div className="space-y-4">
            {clip.quote ? (
              <h1 className="text-3xl font-semibold text-[var(--fg)] leading-tight">
                “{clip.quote}”
              </h1>
            ) : clip.title ? (
              <h1 className="text-3xl font-semibold text-[var(--fg)] leading-tight">{clip.title}</h1>
            ) : (
              <h1 className="text-3xl font-semibold text-[var(--fg)] leading-tight">Highlight clip</h1>
            )}
            {clip.reason ? (
              <div className="space-y-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
                  Reason
                </span>
                <p className="rounded-lg border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_60%,transparent)] p-3 text-sm leading-relaxed text-[var(--fg)]/80">
                  {clip.reason}
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--muted)]">
              <span className="font-medium text-[var(--fg)]">{clip.channel}</span>
              {clip.views !== null ? <span>• {formatViews(clip.views)} views</span> : null}
              {clip.sourcePublishedAt ? <span>• {timeAgo(clip.sourcePublishedAt)}</span> : null}
            </div>
          </div>
          <dl className="grid gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 text-sm text-[var(--muted)] sm:grid-cols-[auto_1fr]">
            <dt className="font-medium text-[var(--fg)]">Duration</dt>
            <dd>{formatDuration(clip.durationSec)}</dd>
            {clip.rating !== null && clip.rating !== undefined ? (
              <>
                <dt className="font-medium text-[var(--fg)]">Score</dt>
                <dd className="text-[var(--fg)]">{clip.rating.toFixed(1).replace(/\.0$/, '')}</dd>
              </>
            ) : null}
            <dt className="font-medium text-[var(--fg)]">Clip created</dt>
            <dd>
              {new Date(clip.createdAt).toLocaleString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
              })}
            </dd>
            <dt className="font-medium text-[var(--fg)]">Source uploaded</dt>
            <dd>
              {clip.sourcePublishedAt
                ? new Date(clip.sourcePublishedAt).toLocaleString(undefined, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                  })
                : 'Unknown'}
            </dd>
            {clip.timestampSeconds !== null && clip.timestampSeconds !== undefined ? (
              <>
                <dt className="font-medium text-[var(--fg)]">Starts at</dt>
                <dd>{formatDuration(clip.timestampSeconds)}</dd>
              </>
            ) : null}
          </dl>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={clip.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white"
            >
              View full video
            </a>
            {clip.timestampUrl ? (
              <a
                href={clip.timestampUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:border-[var(--ring)] hover:text-white"
              >
                Jump to
                <span className="font-semibold text-white">
                  {clip.timestampSeconds !== null && clip.timestampSeconds !== undefined
                    ? formatDuration(clip.timestampSeconds)
                    : 'timestamp'}
                </span>
              </a>
            ) : null}
          </div>
          <div className="space-y-2">
            <h2 className="text-lg font-semibold text-[var(--fg)]">Description</h2>
            <ClipDescription
              text={clip.description}
              className="text-sm leading-relaxed text-[var(--muted)]"
            />
          </div>
          <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 text-sm text-[var(--muted)]">
            Bookmark this clip to revisit the key moment or share it with your team for quick inspiration.
          </div>
        </div>
      </div>
    </section>
  )
}

export default ClipPage
