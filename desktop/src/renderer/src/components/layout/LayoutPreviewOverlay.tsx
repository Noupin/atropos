import type { FC, PointerEvent as ReactPointerEvent } from 'react'
import type {
  LayoutDefinition,
  LayoutItem,
  LayoutShapeItem,
  LayoutTextItem,
  LayoutVideoItem
} from '../../../../types/layouts'

type LayoutPreviewOverlayProps = {
  layout: LayoutDefinition | null
  selectedItemId?: string | null
  interactive?: boolean
  onItemPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, item: LayoutItem) => void
  highlightCaptionArea?: boolean
  className?: string
}

const formatLabel = (item: LayoutItem): string => {
  if ((item as LayoutVideoItem).kind === 'video') {
    const video = item as LayoutVideoItem
    return video.name?.trim() || 'Video'
  }
  if ((item as LayoutTextItem).kind === 'text') {
    const text = item as LayoutTextItem
    const snippet = text.content.trim()
    return snippet.length > 0 ? (snippet.length > 20 ? `${snippet.slice(0, 20)}…` : snippet) : 'Text'
  }
  const shape = item as LayoutShapeItem
  return shape.color ? `Shape ${shape.color}` : 'Shape'
}

const getItemClassName = (item: LayoutItem, selected: boolean): string => {
  const base = ['absolute', 'rounded-lg', 'border', 'backdrop-blur-sm', 'transition-all', 'shadow-lg']
  if ((item as LayoutVideoItem).kind === 'video') {
    base.push('bg-blue-500/20', 'border-blue-300/60', 'text-blue-200')
  } else if ((item as LayoutTextItem).kind === 'text') {
    base.push('bg-emerald-500/15', 'border-emerald-300/60', 'text-emerald-100')
  } else {
    base.push('bg-amber-500/15', 'border-amber-300/60', 'text-amber-100')
  }
  if (selected) {
    base.push('ring-2', 'ring-[var(--ring)]')
  } else {
    base.push('ring-0')
  }
  return base.join(' ')
}

const LayoutPreviewOverlay: FC<LayoutPreviewOverlayProps> = ({
  layout,
  selectedItemId = null,
  interactive = false,
  onItemPointerDown,
  highlightCaptionArea = false,
  className
}) => {
  if (!layout) {
    return null
  }

  const sortedItems = [...layout.items].sort((a, b) => {
    const aIndex = 'zIndex' in a && typeof a.zIndex === 'number' ? a.zIndex : 0
    const bIndex = 'zIndex' in b && typeof b.zIndex === 'number' ? b.zIndex : 0
    if (aIndex !== bIndex) {
      return aIndex - bIndex
    }
    return a.id.localeCompare(b.id)
  })

  const captionArea = layout.captionArea ?? null

  return (
    <div
      className={`pointer-events-none absolute inset-0 ${interactive ? 'pointer-events-auto' : ''} ${className ?? ''}`}
    >
      {captionArea && highlightCaptionArea ? (
        <div
          aria-label="Caption area"
          className="absolute rounded-lg border-2 border-dashed border-white/40 bg-white/5"
          style={{
            left: `${captionArea.x * 100}%`,
            top: `${captionArea.y * 100}%`,
            width: `${captionArea.width * 100}%`,
            height: `${captionArea.height * 100}%`
          }}
        >
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold uppercase text-white/70">
            Captions
          </div>
        </div>
      ) : null}
      {sortedItems.map((item) => {
        const frame = item.frame
        const left = Math.min(Math.max(frame.x, 0), 1) * 100
        const top = Math.min(Math.max(frame.y, 0), 1) * 100
        const width = Math.max(0, Math.min(frame.width, 1)) * 100
        const height = Math.max(0, Math.min(frame.height, 1)) * 100
        const selected = selectedItemId === item.id
        const label = formatLabel(item)
        return (
          <div
            key={item.id}
            role="presentation"
            aria-label={`Layout item ${label}`}
            className={`${getItemClassName(item, selected)} ${interactive ? 'cursor-grab active:cursor-grabbing' : ''}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${width}%`,
              height: `${height}%`
            }}
            onPointerDown={interactive && onItemPointerDown ? (event) => onItemPointerDown(event, item) : undefined}
          >
            <div className="flex h-full w-full items-center justify-center p-1 text-center text-[10px] font-semibold uppercase">
              {label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default LayoutPreviewOverlay
