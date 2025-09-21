import { memo } from 'react'
import type { FC, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Clip } from '../types'
import { formatDuration, formatViews, timeAgo } from '../lib/format'

type ClipCardProps = {
  clip: Clip
  onClick: () => void
  isActive?: boolean
}

const ClipCard: FC<ClipCardProps> = ({ clip, onClick, isActive = false }) => {
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-pressed={isActive}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl bg-[var(--card)] shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
        isActive
          ? 'ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--card)]'
          : 'hover:-translate-y-1 hover:shadow-lg'
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden">
        {clip.thumbnail ? (
          <img
            src={clip.thumbnail}
            alt={clip.title}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <video
            src={clip.playbackUrl}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        )}
        <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-medium text-white">
          {formatDuration(clip.durationSec)}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 px-4 py-3">
        <h3 className="text-sm font-semibold leading-snug text-[var(--fg)] [display:-webkit-box] [overflow:hidden] [text-overflow:ellipsis] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]">
          {clip.title}
        </h3>
        <p className="text-xs font-medium text-[var(--muted)]">{clip.channel}</p>
        <p className="text-xs text-[var(--muted)]">
          {formatViews(clip.views)} views · {timeAgo(clip.createdAt)}
        </p>
      </div>
    </article>
  )
}

export default memo(ClipCard)
