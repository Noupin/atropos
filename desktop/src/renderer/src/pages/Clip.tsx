import { useEffect, useMemo } from 'react'
import type { FC } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { formatDuration, formatViews, timeAgo } from '../lib/format'
import { CLIPS } from '../mock/clips'
import type { SearchBridge } from '../types'

type ClipPageProps = {
  registerSearch: (bridge: SearchBridge | null) => void
}

const ClipPage: FC<ClipPageProps> = ({ registerSearch }) => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  useEffect(() => {
    registerSearch(null)
  }, [registerSearch])

  const clip = useMemo(() => CLIPS.find((item) => item.id === id), [id])

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
          <img src={clip.thumbnail} alt={clip.title} className="h-full w-full object-cover" />
        </div>
        <div className="flex w-full max-w-xl flex-col gap-4">
          <h1 className="text-2xl font-semibold text-[var(--fg)]">{clip.title}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-[var(--muted)]">
            <span className="font-medium text-[var(--fg)]">{clip.channel}</span>
            <span>• {formatViews(clip.views)} views</span>
            <span>• {timeAgo(clip.createdAt)}</span>
          </div>
          <dl className="grid gap-3 text-sm text-[var(--muted)] sm:grid-cols-[auto_1fr]">
            <dt className="font-medium text-[var(--fg)]">Duration</dt>
            <dd>{formatDuration(clip.durationSec)}</dd>
            <dt className="font-medium text-[var(--fg)]">Uploaded</dt>
            <dd>{new Date(clip.createdAt).toLocaleString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })}</dd>
          </dl>
          <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] p-4 text-sm text-[var(--muted)]">
            Bookmark this clip to revisit the key moment or share it with your team for quick inspiration.
          </div>
        </div>
      </div>
    </section>
  )
}

export default ClipPage
