import { useState } from 'react'
import type { FC, MouseEvent } from 'react'
import { formatDuration, formatViews, timeAgo } from '../lib/format'
import type { Clip } from '../types'

type ClipDrawerProps = {
  clips: Clip[]
  selectedClipId: string | null
  onSelect: (clipId: string) => void
  onRemove: (clipId: string) => void
  className?: string
}

const ClipDrawer: FC<ClipDrawerProps> = ({ clips, selectedClipId, onSelect, onRemove, className }) => {
  const [isOpen, setIsOpen] = useState(true)

  const handleRemove = (event: MouseEvent<HTMLButtonElement>, clipId: string): void => {
    event.stopPropagation()
    onRemove(clipId)
  }

  return (
    <aside
      className={`flex h-full flex-col rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_70%,transparent)] shadow-[0_10px_30px_-12px_rgba(15,23,42,0.45)] ${className ?? ''}`.trim()}
    >
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium text-[var(--fg)] transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <span>Clip library</span>
        <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
          {clips.length} {clips.length === 1 ? 'clip' : 'clips'}
          <svg
            viewBox="0 0 12 12"
            aria-hidden="true"
            className={`h-3 w-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          >
            <path
              fill="currentColor"
              d="M6 8.5a.75.75 0 0 1-.53-.22l-3-3a.75.75 0 0 1 1.06-1.06L6 6.69l2.47-2.47a.75.75 0 0 1 1.06 1.06l-3 3A.75.75 0 0 1 6 8.5"
            />
          </svg>
        </span>
      </button>
      <div className="h-px w-full bg-white/10" aria-hidden="true" />

      {isOpen ? (
        clips.length > 0 ? (
          <ul className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {clips.map((clip) => {
              const isActive = clip.id === selectedClipId
              return (
                <li key={clip.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(clip.id)}
                    className={`group flex w-full items-start gap-3 rounded-xl border border-white/5 bg-black/10 p-3 text-left transition hover:border-[var(--ring)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                      isActive ? 'border-[var(--ring)] shadow-[0_0_0_1px_var(--ring)]' : ''
                    }`}
                  >
                    <div className="h-16 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-black/40">
                      {clip.thumbnail ? (
                        <img src={clip.thumbnail} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <video
                          src={clip.playbackUrl}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="flex flex-1 flex-col">
                      <span className="text-sm font-medium text-[var(--fg)] leading-snug">{clip.title}</span>
                      <span className="mt-1 text-xs text-[var(--muted)]">
                        {clip.channel} • {formatDuration(clip.durationSec)} •{' '}
                        {clip.views !== null ? `${formatViews(clip.views)} views` : 'freshly generated'}
                      </span>
                      <span className="text-[10px] uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                        {clip.sourcePublishedAt ? timeAgo(clip.sourcePublishedAt) : timeAgo(clip.createdAt)}
                      </span>
                    </div>
                    <button
                      type="button"
                      aria-label={`Remove ${clip.title}`}
                      onClick={(event) => handleRemove(event, clip.id)}
                      className="ml-2 rounded-md border border-transparent p-1 text-[var(--muted)] transition hover:border-white/10 hover:text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M7.25 2A2.25 2.25 0 0 0 5 4.25V5H3.5a.75.75 0 0 0 0 1.5h.54l.63 8.32A2.75 2.75 0 0 0 7.41 17.5h5.18a2.75 2.75 0 0 0 2.74-2.68l.63-8.32h.54a.75.75 0 0 0 0-1.5H15v-.75A2.25 2.25 0 0 0 12.75 2zm.25 1.5h5a.75.75 0 0 1 .75.75V5H6.5v-.75a.75.75 0 0 1 .75-.75m-.49 11.47-.6-8.22h8.18l-.6 8.22a1.25 1.25 0 0 1-1.24 1.18H7.41a1.25 1.25 0 0 1-1.24-1.18M8.75 7.75a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V8.5a.75.75 0 0 1 .75-.75m2.5 0a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V8.5a.75.75 0 0 1 .75-.75"
                        />
                      </svg>
                    </button>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center text-sm text-[var(--muted)]">
            No clips generated yet. Start the pipeline to create highlights.
          </div>
        )
      ) : (
        <div className="px-4 pb-4 text-xs text-[var(--muted)]">Drawer collapsed</div>
      )}
    </aside>
  )
}

export default ClipDrawer
