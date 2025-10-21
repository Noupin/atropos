import type {
  FC,
  PointerEvent as ReactPointerEvent,
  MutableRefObject,
  ReactNode,
  CSSProperties
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LayoutDefinition,
  LayoutFrame,
  LayoutItem,
  LayoutTextItem,
  LayoutVideoItem
} from '../../../../types/layouts'

export type LayoutCanvasSelection = string[]

type LayoutCanvasTransform = {
  itemId: string
  frame: LayoutFrame
}

type DragMode = 'move' | 'resize'

type ResizeHandle =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'

type DragState = {
  mode: DragMode
  pointerId: number
  handle?: ResizeHandle
  startX: number
  startY: number
  maintainAspect: boolean
  snapEnabled: boolean
  originalFrames: Map<string, LayoutFrame>
  aspectRatio?: number
}

type LayoutCanvasProps = {
  layout: LayoutDefinition | null
  selectedItemIds: LayoutCanvasSelection
  onSelectionChange: (selection: LayoutCanvasSelection) => void
  onTransform: (
    transforms: LayoutCanvasTransform[],
    options: { commit: boolean },
    target: 'frame' | 'crop'
  ) => void
  onRequestBringForward: () => void
  onRequestSendBackward: () => void
  onRequestDuplicate: () => void
  onRequestDelete: () => void
  showGrid: boolean
  showSafeMargins: boolean
  previewContent: ReactNode
  transformTarget: 'frame' | 'crop'
  aspectRatioOverride?: number | null
  renderItemContent?: (item: LayoutItem, context: { isSelected: boolean }) => ReactNode
  getItemClasses?: (item: LayoutItem, isSelected: boolean) => string
  labelVisibility?: 'always' | 'selected' | 'never'
  isItemEditable?: (item: LayoutItem) => boolean
  className?: string
  style?: CSSProperties
  ariaLabel?: string
}

type Guide = {
  orientation: 'horizontal' | 'vertical'
  position: number
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(Math.max(value, min), max)

const fractionToPercent = (value: number): string => `${(value * 100).toFixed(2)}%`

const SNAP_POINTS = [0, 0.25, 0.5, 0.75, 1]
const SNAP_THRESHOLD = 0.02

const GUIDE_FADE_DELAY = 200

const getItemLabel = (item: LayoutItem): string => {
  if ((item as LayoutVideoItem).kind === 'video') {
    const video = item as LayoutVideoItem
    return video.name?.trim() || 'Video window'
  }
  if ((item as LayoutTextItem).kind === 'text') {
    const text = item as LayoutTextItem
    const content = text.content.trim()
    if (!content) {
      return 'Text overlay'
    }
    return content.length > 18 ? `${content.slice(0, 18)}…` : content
  }
  return 'Background layer'
}

const getItemColorClasses = (item: LayoutItem): string => {
  if ((item as LayoutVideoItem).kind === 'video') {
    return 'border-blue-300/70 bg-blue-500/15'
  }
  if ((item as LayoutTextItem).kind === 'text') {
    return 'border-emerald-300/60 bg-emerald-500/15'
  }
  return 'border-amber-300/60 bg-amber-500/15'
}

const defaultCrop = { x: 0, y: 0, width: 1, height: 1 }

const normaliseCropFrame = (item: LayoutItem): LayoutFrame => {
  if ((item as LayoutVideoItem).kind !== 'video') {
    return cloneFrame(item.frame)
  }
  const video = item as LayoutVideoItem
  const crop = video.crop ?? defaultCrop
  return {
    x: clamp(crop.x),
    y: clamp(crop.y),
    width: clamp(crop.width),
    height: clamp(crop.height)
  }
}

const cloneFrame = (frame: LayoutFrame): LayoutFrame => ({ ...frame })

const maintainAspectResize = (
  frame: LayoutFrame,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  aspectRatio?: number
): LayoutFrame => {
  const ratio =
    aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0
      ? aspectRatio
      : frame.width === 0
        ? 1
        : frame.width / Math.max(frame.height, 0.0001)
  const resized = resizeFrame(frame, handle, deltaX, deltaY)
  let { x, y, width, height } = resized

  if (width <= 0 || height <= 0) {
    return {
      x: clamp(x),
      y: clamp(y),
      width: clamp(width),
      height: clamp(height)
    }
  }

  const widthFromHeight = height * ratio
  const heightFromWidth = width / ratio

  if (handle.includes('e') || handle.includes('w')) {
    height = heightFromWidth
  } else if (handle.includes('n') || handle.includes('s')) {
    width = widthFromHeight
  } else {
    if (Math.abs(heightFromWidth - height) < Math.abs(widthFromHeight - width)) {
      height = heightFromWidth
    } else {
      width = widthFromHeight
    }
  }

  if (width > 1 - x) {
    width = 1 - x
    height = width / ratio
  }
  if (height > 1 - y) {
    height = 1 - y
    width = height * ratio
  }

  width = clamp(width)
  height = clamp(height)

  if (handle.includes('w')) {
    x = clamp(resized.x + resized.width - width)
  }
  if (handle.includes('n')) {
    y = clamp(resized.y + resized.height - height)
  }

  return {
    x: clamp(x),
    y: clamp(y),
    width,
    height
  }
}

const itemHasAspectLock = (item: LayoutItem): boolean => {
  if ((item as LayoutVideoItem).kind !== 'video') {
    return false
  }
  const video = item as LayoutVideoItem
  return video.lockAspectRatio !== false
}

const resizeFrame = (
  frame: LayoutFrame,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number
): LayoutFrame => {
  const next = cloneFrame(frame)
  if (handle.includes('e')) {
    next.width = clamp(frame.width + deltaX, 0, 1 - frame.x)
  }
  if (handle.includes('s')) {
    next.height = clamp(frame.height + deltaY, 0, 1 - frame.y)
  }
  if (handle.includes('w')) {
    const width = clamp(frame.width - deltaX, 0, frame.x + frame.width)
    next.x = clamp(frame.x + (frame.width - width))
    next.width = width
  }
  if (handle.includes('n')) {
    const height = clamp(frame.height - deltaY, 0, frame.y + frame.height)
    next.y = clamp(frame.y + (frame.height - height))
    next.height = height
  }
  return next
}

const useGuideFade = (guidesRef: MutableRefObject<Guide[]>, setGuides: (guides: Guide[]) => void) => {
  const timeoutRef = useRef<number | null>(null)

  useEffect(() => {
    if (!guidesRef.current.length) {
      return
    }
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }
    timeoutRef.current = window.setTimeout(() => {
      setGuides([])
      guidesRef.current = []
    }, GUIDE_FADE_DELAY)
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [guidesRef, setGuides])
}

const LayoutCanvas: FC<LayoutCanvasProps> = ({
  layout,
  selectedItemIds,
  onSelectionChange,
  onTransform,
  onRequestBringForward,
  onRequestSendBackward,
  onRequestDuplicate,
  onRequestDelete,
  showGrid,
  showSafeMargins,
  previewContent,
  transformTarget,
  renderItemContent,
  getItemClasses,
  labelVisibility = 'always',
  isItemEditable,
  className,
  style,
  aspectRatioOverride,
  ariaLabel
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const guidesRef = useRef<Guide[]>([])
  const [activeGuides, setActiveGuides] = useState<Guide[]>([])
  const [floatingLabel, setFloatingLabel] = useState<string | null>(null)
  const [floatingPosition, setFloatingPosition] = useState<{ x: number; y: number } | null>(null)

  useGuideFade(guidesRef, setActiveGuides)

  const getDisplayFrame = useCallback(
    (item: LayoutItem): LayoutFrame => {
      if (transformTarget === 'crop') {
        return normaliseCropFrame(item)
      }
      return cloneFrame(item.frame)
    },
    [transformTarget]
  )

  const itemIsEditable = useCallback(
    (item: LayoutItem): boolean => {
      if (typeof isItemEditable === 'function') {
        return isItemEditable(item)
      }
      if (transformTarget === 'crop') {
        return (item as LayoutVideoItem).kind === 'video'
      }
      return true
    },
    [isItemEditable, transformTarget]
  )

  const sortedItems = useMemo(() => {
    if (!layout) {
      return []
    }
    return [...layout.items].sort((a, b) => {
      const aIndex = 'zIndex' in a && typeof a.zIndex === 'number' ? a.zIndex : 0
      const bIndex = 'zIndex' in b && typeof b.zIndex === 'number' ? b.zIndex : 0
      if (aIndex !== bIndex) {
        return aIndex - bIndex
      }
      return a.id.localeCompare(b.id)
    })
  }, [layout])

  const clearDragState = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    dragStateRef.current = null
    setFloatingLabel(null)
    setFloatingPosition(null)
  }, [])

  const applyGuides = useCallback((frame: LayoutFrame) => {
    if (!layout) {
      return frame
    }
    if (!dragStateRef.current?.snapEnabled) {
      guidesRef.current = []
      setActiveGuides([])
      return frame
    }
    const updated: LayoutFrame = { ...frame }
    const guides: Guide[] = []

    const snap = (value: number): number => {
      for (const point of SNAP_POINTS) {
        if (Math.abs(value - point) <= SNAP_THRESHOLD) {
          return point
        }
      }
      return value
    }

    const snappedX = snap(frame.x)
    if (snappedX !== frame.x) {
      updated.x = snappedX
      guides.push({ orientation: 'vertical', position: snappedX })
    }
    const snappedY = snap(frame.y)
    if (snappedY !== frame.y) {
      updated.y = snappedY
      guides.push({ orientation: 'horizontal', position: snappedY })
    }
    const snappedRight = snap(frame.x + frame.width)
    if (snappedRight !== frame.x + frame.width) {
      updated.width = clamp(snappedRight - updated.x)
      guides.push({ orientation: 'vertical', position: snappedRight })
    }
    const snappedBottom = snap(frame.y + frame.height)
    if (snappedBottom !== frame.y + frame.height) {
      updated.height = clamp(snappedBottom - updated.y)
      guides.push({ orientation: 'horizontal', position: snappedBottom })
    }
    const centerX = frame.x + frame.width / 2
    const snappedCenterX = snap(centerX)
    if (snappedCenterX !== centerX) {
      const delta = snappedCenterX - centerX
      updated.x = clamp(updated.x + delta)
      guides.push({ orientation: 'vertical', position: snappedCenterX })
    }
    const centerY = frame.y + frame.height / 2
    const snappedCenterY = snap(centerY)
    if (snappedCenterY !== centerY) {
      const delta = snappedCenterY - centerY
      updated.y = clamp(updated.y + delta)
      guides.push({ orientation: 'horizontal', position: snappedCenterY })
    }

    guidesRef.current = guides
    setActiveGuides(guides)
    return updated
  }, [layout])

  const scheduleTransform = useCallback(
    (transforms: LayoutCanvasTransform[], options: { commit: boolean }) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      rafRef.current = requestAnimationFrame(() => {
        onTransform(transforms, options, transformTarget)
      })
    },
    [onTransform, transformTarget]
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, item: LayoutItem) => {
      if (!containerRef.current) {
        return
      }
      event.stopPropagation()
      const maintainAspect = event.shiftKey
      const snapEnabled = event.altKey || event.metaKey
      const selection = event.shiftKey
        ? selectedItemIds.includes(item.id)
          ? selectedItemIds.filter((id) => id !== item.id)
          : [...selectedItemIds, item.id]
        : [item.id]
      onSelectionChange(selection)
      if (!itemIsEditable(item)) {
        return
      }
      const originalFrames = new Map<string, LayoutFrame>()
      const targetIds = selection.length ? selection : [item.id]
      targetIds.forEach((id) => {
        const match = layout?.items.find((candidate) => candidate.id === id)
        if (match && itemIsEditable(match)) {
          originalFrames.set(id, getDisplayFrame(match))
        }
      })
      if (originalFrames.size === 0) {
        return
      }
      dragStateRef.current = {
        mode: 'move',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        maintainAspect,
        snapEnabled,
        originalFrames
      }
      ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [getDisplayFrame, itemIsEditable, layout?.items, onSelectionChange, selectedItemIds]
  )

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, item: LayoutItem, handle: ResizeHandle) => {
      if (!containerRef.current) {
        return
      }
      event.stopPropagation()
      if (!itemIsEditable(item)) {
        return
      }
      const maintainAspect = itemHasAspectLock(item) || event.shiftKey
      const snapEnabled = event.altKey || event.metaKey
      onSelectionChange([item.id])
      const originalFrame = getDisplayFrame(item)
      let aspectRatioValue: number | undefined
      if (transformTarget === 'crop' && (item as LayoutVideoItem).kind === 'video') {
        const video = item as LayoutVideoItem
        const frameWidth = clamp(video.frame.width)
        const frameHeight = clamp(video.frame.height)
        if (frameWidth > 0 && frameHeight > 0) {
          aspectRatioValue = frameWidth / frameHeight
        }
      } else if (originalFrame.width > 0 && originalFrame.height > 0) {
        aspectRatioValue = originalFrame.width / Math.max(originalFrame.height, 0.0001)
      }
      dragStateRef.current = {
        mode: 'resize',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        handle,
        maintainAspect,
        snapEnabled,
        originalFrames: new Map([[item.id, originalFrame]]),
        aspectRatio: aspectRatioValue
      }
      ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [getDisplayFrame, itemIsEditable, onSelectionChange, transformTarget]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state || !layout || state.pointerId !== event.pointerId) {
        return
      }
      const containerRect = containerRef.current?.getBoundingClientRect()
      if (!containerRect) {
        return
      }
      const deltaX = (event.clientX - state.startX) / containerRect.width
      const deltaY = (event.clientY - state.startY) / containerRect.height
      const transforms: LayoutCanvasTransform[] = []

      if (state.mode === 'move') {
        state.originalFrames.forEach((original, id) => {
          const nextFrame = applyGuides({
            x: clamp(original.x + deltaX),
            y: clamp(original.y + deltaY),
            width: original.width,
            height: original.height
          })
          transforms.push({ itemId: id, frame: nextFrame })
          setFloatingLabel(`${(nextFrame.width * 100).toFixed(1)} × ${(nextFrame.height * 100).toFixed(1)}%`)
          setFloatingPosition({ x: event.clientX, y: event.clientY })
        })
      } else if (state.mode === 'resize' && state.handle) {
        state.originalFrames.forEach((original, id) => {
          let nextFrame: LayoutFrame
          if (state.maintainAspect) {
            nextFrame = maintainAspectResize(original, state.handle!, deltaX, deltaY, state.aspectRatio)
          } else {
            nextFrame = resizeFrame(original, state.handle!, deltaX, deltaY)
          }
          nextFrame = applyGuides(nextFrame)
          transforms.push({ itemId: id, frame: nextFrame })
          setFloatingLabel(`${(nextFrame.width * 100).toFixed(1)} × ${(nextFrame.height * 100).toFixed(1)}%`)
          setFloatingPosition({ x: event.clientX, y: event.clientY })
        })
      }

      if (transforms.length) {
        scheduleTransform(transforms, { commit: false })
      }
    },
    [applyGuides, layout, scheduleTransform]
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state || state.pointerId !== event.pointerId) {
        return
      }
      clearDragState()
      const containerRect = containerRef.current?.getBoundingClientRect()
      if (!containerRect || !layout) {
        dragStateRef.current = null
        return
      }
      const deltaX = (event.clientX - state.startX) / containerRect.width
      const deltaY = (event.clientY - state.startY) / containerRect.height
      const transforms: LayoutCanvasTransform[] = []
      if (state.mode === 'move') {
        state.originalFrames.forEach((original, id) => {
          const frame = {
            x: clamp(original.x + deltaX),
            y: clamp(original.y + deltaY),
            width: original.width,
            height: original.height
          }
          transforms.push({ itemId: id, frame: applyGuides(frame) })
        })
      } else if (state.mode === 'resize' && state.handle) {
        state.originalFrames.forEach((original, id) => {
          let frame: LayoutFrame
          if (state.maintainAspect) {
            frame = maintainAspectResize(original, state.handle!, deltaX, deltaY, state.aspectRatio)
          } else {
            frame = resizeFrame(original, state.handle!, deltaX, deltaY)
          }
          transforms.push({ itemId: id, frame: applyGuides(frame) })
        })
      }
      dragStateRef.current = null
      if (transforms.length) {
        scheduleTransform(transforms, { commit: true })
      }
    },
    [applyGuides, clearDragState, layout, scheduleTransform]
  )

  const handles: Array<{ id: ResizeHandle; className: string; label: string }> = useMemo(
    () => [
      { id: 'nw', className: '-left-2 -top-2 cursor-nwse-resize', label: 'Resize north-west' },
      { id: 'ne', className: '-right-2 -top-2 cursor-nesw-resize', label: 'Resize north-east' },
      { id: 'sw', className: '-left-2 -bottom-2 cursor-nesw-resize', label: 'Resize south-west' },
      { id: 'se', className: '-right-2 -bottom-2 cursor-nwse-resize', label: 'Resize south-east' },
      { id: 'n', className: 'left-1/2 -top-2 -translate-x-1/2 cursor-ns-resize', label: 'Resize north' },
      { id: 's', className: 'left-1/2 -bottom-2 -translate-x-1/2 cursor-ns-resize', label: 'Resize south' },
      { id: 'e', className: '-right-2 top-1/2 -translate-y-1/2 cursor-ew-resize', label: 'Resize east' },
      { id: 'w', className: '-left-2 top-1/2 -translate-y-1/2 cursor-ew-resize', label: 'Resize west' }
    ],
    []
  )

  const activeSelection = useMemo(
    () =>
      layout
        ? layout.items.filter((item) => selectedItemIds.includes(item.id)).sort((a, b) => a.id.localeCompare(b.id))
        : [],
    [layout, selectedItemIds]
  )

  const selectionBounds = useMemo(() => {
    if (!activeSelection.length) {
      return null
    }
    const frames = activeSelection.map((item) => getDisplayFrame(item))
    const minX = Math.min(...frames.map((frame) => frame.x))
    const minY = Math.min(...frames.map((frame) => frame.y))
    const maxX = Math.max(...frames.map((frame) => frame.x + frame.width))
    const maxY = Math.max(...frames.map((frame) => frame.y + frame.height))
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }, [activeSelection, getDisplayFrame])

  const selectionLabel = useMemo(() => {
    if (!activeSelection.length) {
      return null
    }
    if (activeSelection.length === 1) {
      return getItemLabel(activeSelection[0])
    }
    return `${activeSelection.length} items`
  }, [activeSelection])

  const handleCanvasPointerDown = useCallback(() => {
    if (dragStateRef.current) {
      return
    }
    onSelectionChange([])
  }, [onSelectionChange])

  const aspectRatio = useMemo(() => {
    if (aspectRatioOverride && aspectRatioOverride > 0) {
      return aspectRatioOverride
    }
    if (layout && layout.canvas.height > 0) {
      return layout.canvas.width / layout.canvas.height
    }
    return 9 / 16
  }, [aspectRatioOverride, layout])

  const canvasClassName = useMemo(
    () =>
      [
        'relative flex max-w-full select-none items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black touch-none',
        className
      ]
        .filter(Boolean)
        .join(' '),
    [className]
  )

  const canvasStyle: CSSProperties = useMemo(() => {
    const base: CSSProperties = { ...(style ?? {}) }
    const hasExplicitWidth = base.width != null
    const hasExplicitHeight = base.height != null
    if (!hasExplicitWidth || !hasExplicitHeight) {
      base.aspectRatio = aspectRatio > 0 ? `${aspectRatio}` : '9 / 16'
    }
    return base
  }, [aspectRatio, style])

  return (
    <div
      ref={containerRef}
      className={canvasClassName}
      style={canvasStyle}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={clearDragState}
      onPointerCancel={clearDragState}
      onPointerDown={handleCanvasPointerDown}
      role="presentation"
      aria-label={ariaLabel}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="flex h-full w-full items-center justify-center text-xs text-white/60">{previewContent}</div>
      </div>
      {showGrid ? (
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-25">
          {Array.from({ length: 9 }).map((_, index) => (
            <div key={index} className="border border-white/20" />
          ))}
        </div>
      ) : null}
      {showSafeMargins ? (
        <div className="pointer-events-none absolute inset-[8%] rounded-2xl border-2 border-dashed border-white/30" />
      ) : null}
      {activeGuides.map((guide) => (
        <div
          key={`${guide.orientation}-${guide.position}`}
          className={`pointer-events-none absolute ${
            guide.orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]'
          } bg-[color:color-mix(in_srgb,var(--accent)_60%,transparent)]`}
          style={
            guide.orientation === 'horizontal'
              ? { top: fractionToPercent(guide.position) }
              : { left: fractionToPercent(guide.position) }
          }
        />
      ))}
      {sortedItems.map((item) => {
        const frame = getDisplayFrame(item)
        const left = fractionToPercent(frame.x)
        const top = fractionToPercent(frame.y)
        const width = fractionToPercent(frame.width)
        const height = fractionToPercent(frame.height)
        const isSelected = selectedItemIds.includes(item.id)
        const isPrimarySelection = activeSelection[0]?.id === item.id
        const label = getItemLabel(item)
        const classes = getItemClasses ? getItemClasses(item, isSelected) : getItemColorClasses(item)
        const shouldShowLabel = labelVisibility === 'always' || (labelVisibility === 'selected' && isSelected)
        const editable = itemIsEditable(item)
        return (
          <div
            key={item.id}
            className={`absolute rounded-xl border text-[10px] font-semibold uppercase tracking-wide text-white/80 shadow-lg transition ${
              classes
            } ${isSelected ? 'ring-2 ring-[var(--ring)]' : 'ring-0'}`}
            style={{ left, top, width, height }}
            onPointerDown={(event) => handlePointerDown(event, item)}
            role="group"
            aria-label={label}
            data-item-id={item.id}
          >
            {renderItemContent ? (
              <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                {renderItemContent(item, { isSelected })}
              </div>
            ) : null}
            {shouldShowLabel ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-center drop-shadow">
                {label}
              </div>
            ) : null}
            {isPrimarySelection && selectionBounds?.width && selectionBounds.height ? (
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-[11px] font-medium text-white">
                {selectionLabel}
              </div>
            ) : null}
            {isPrimarySelection && editable
              ? handles.map((handle) => (
                  <button
                    key={handle.id}
                    type="button"
                    aria-label={handle.label}
                    className={`absolute h-3 w-3 rounded-full border border-white/80 bg-white text-transparent transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${handle.className}`}
                    onPointerDown={(event) => handleResizePointerDown(event, item, handle.id)}
                  >
                    •
                  </button>
                ))
              : null}
          </div>
        )
      })}
      {selectionBounds ? (
        <div
          className="pointer-events-none absolute rounded-[18px] border-2 border-white/40"
          style={{
            left: fractionToPercent(selectionBounds.x),
            top: fractionToPercent(selectionBounds.y),
            width: fractionToPercent(selectionBounds.width),
            height: fractionToPercent(selectionBounds.height)
          }}
        />
      ) : null}
      {floatingLabel && floatingPosition ? (
        <div
          className="pointer-events-none absolute -translate-y-8 rounded-full bg-black/80 px-3 py-1 text-[11px] font-semibold text-white shadow-lg"
          style={{
            left: `${floatingPosition.x - (containerRef.current?.getBoundingClientRect().left ?? 0)}px`,
            top: `${floatingPosition.y - (containerRef.current?.getBoundingClientRect().top ?? 0)}px`
          }}
        >
          {floatingLabel}
        </div>
      ) : null}
      {activeSelection.length === 1 ? (
        <div className="pointer-events-none absolute -bottom-10 left-1/2 flex -translate-x-1/2 gap-2">
          <div className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[11px] text-white shadow-lg">
            <button
              type="button"
              className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              onClick={onRequestBringForward}
            >
              Bring forward
            </button>
            <span aria-hidden="true" className="text-white/40">
              ·
            </span>
            <button
              type="button"
              className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              onClick={onRequestSendBackward}
            >
              Send backward
            </button>
            <span aria-hidden="true" className="text-white/40">
              ·
            </span>
            <button
              type="button"
              className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              onClick={onRequestDuplicate}
            >
              Duplicate
            </button>
            <span aria-hidden="true" className="text-white/40">
              ·
            </span>
            <button
              type="button"
              className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              onClick={onRequestDelete}
            >
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default LayoutCanvas
