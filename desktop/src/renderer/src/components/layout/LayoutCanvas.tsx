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
  onTransform: (transforms: LayoutCanvasTransform[], options: { commit: boolean }) => void
  onRequestBringForward: () => void
  onRequestSendBackward: () => void
  onRequestDuplicate: () => void
  onRequestDelete: () => void
  showGrid: boolean
  showSafeMargins: boolean
  previewContent: ReactNode
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

const cloneFrame = (frame: LayoutFrame): LayoutFrame => ({ ...frame })

const maintainAspectResize = (
  frame: LayoutFrame,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number
): LayoutFrame => {
  const aspect = frame.width === 0 ? 1 : frame.width / frame.height
  let width = frame.width
  let height = frame.height
  let x = frame.x
  let y = frame.y
  if (handle.includes('e')) {
    width = clamp(frame.width + deltaX, 0, 1 - frame.x)
    height = width / aspect
  }
  if (handle.includes('s')) {
    height = clamp(frame.height + deltaY, 0, 1 - frame.y)
    width = height * aspect
  }
  if (handle.includes('w')) {
    const nextWidth = clamp(frame.width - deltaX, 0, frame.x + frame.width)
    width = nextWidth
    height = width / aspect
    x = frame.x + (frame.width - width)
  }
  if (handle.includes('n')) {
    const nextHeight = clamp(frame.height - deltaY, 0, frame.y + frame.height)
    height = nextHeight
    width = height * aspect
    y = frame.y + (frame.height - height)
  }
  return {
    x: clamp(x),
    y: clamp(y),
    width: clamp(width),
    height: clamp(height)
  }
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
  className,
  style,
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
        onTransform(transforms, options)
      })
    },
    [onTransform]
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, item: LayoutItem) => {
      if (!containerRef.current) {
        return
      }
      const maintainAspect = event.shiftKey
      const snapEnabled = event.altKey || event.metaKey
      const selection = event.shiftKey
        ? selectedItemIds.includes(item.id)
          ? selectedItemIds.filter((id) => id !== item.id)
          : [...selectedItemIds, item.id]
        : [item.id]
      onSelectionChange(selection)
      const originalFrames = new Map<string, LayoutFrame>()
      const targetIds = selection.length ? selection : [item.id]
      targetIds.forEach((id) => {
        const match = layout?.items.find((candidate) => candidate.id === id)
        if (match) {
          originalFrames.set(id, cloneFrame(match.frame))
        }
      })
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
    [layout?.items, onSelectionChange, selectedItemIds]
  )

  const handleResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, item: LayoutItem, handle: ResizeHandle) => {
      if (!containerRef.current) {
        return
      }
      event.stopPropagation()
      const maintainAspect = event.shiftKey || handle.length === 2
      const snapEnabled = event.altKey || event.metaKey
      onSelectionChange([item.id])
      const originalFrame = cloneFrame(item.frame)
      dragStateRef.current = {
        mode: 'resize',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        handle,
        maintainAspect,
        snapEnabled,
        originalFrames: new Map([[item.id, originalFrame]]),
        aspectRatio: originalFrame.width / Math.max(originalFrame.height, 0.0001)
      }
      ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [onSelectionChange]
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
          if (state.maintainAspect && state.aspectRatio) {
            nextFrame = maintainAspectResize(original, state.handle!, deltaX, deltaY)
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
          if (state.maintainAspect && state.aspectRatio) {
            frame = maintainAspectResize(original, state.handle!, deltaX, deltaY)
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
    const minX = Math.min(...activeSelection.map((item) => item.frame.x))
    const minY = Math.min(...activeSelection.map((item) => item.frame.y))
    const maxX = Math.max(...activeSelection.map((item) => item.frame.x + item.frame.width))
    const maxY = Math.max(...activeSelection.map((item) => item.frame.y + item.frame.height))
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }, [activeSelection])

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
    if (layout && layout.canvas.height > 0) {
      return layout.canvas.width / layout.canvas.height
    }
    return 9 / 16
  }, [layout])

  const canvasClassName = useMemo(
    () =>
      [
        'relative flex w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black',
        className
      ]
        .filter(Boolean)
        .join(' '),
    [className]
  )

  const canvasStyle: CSSProperties = useMemo(
    () => ({
      ...(style ?? {}),
      aspectRatio: aspectRatio > 0 ? `${aspectRatio}` : '9 / 16'
    }),
    [aspectRatio, style]
  )

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
      <div className="absolute inset-0 flex items-center justify-center text-xs text-white/60">
        {previewContent}
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
        const { frame } = item
        const left = fractionToPercent(frame.x)
        const top = fractionToPercent(frame.y)
        const width = fractionToPercent(frame.width)
        const height = fractionToPercent(frame.height)
        const isSelected = selectedItemIds.includes(item.id)
        const isPrimarySelection = activeSelection[0]?.id === item.id
        const label = getItemLabel(item)
        return (
          <div
            key={item.id}
            className={`absolute rounded-xl border bg-white/5 text-[10px] font-semibold uppercase tracking-wide text-white/80 shadow-lg transition ${
              getItemColorClasses(item)
            } ${isSelected ? 'ring-2 ring-[var(--ring)]' : 'ring-0'}`}
            style={{ left, top, width, height }}
            onPointerDown={(event) => handlePointerDown(event, item)}
            role="group"
            aria-label={label}
            data-item-id={item.id}
          >
            <div className="pointer-events-none flex h-full w-full items-center justify-center px-2 text-center drop-shadow">
              {label}
            </div>
            {isPrimarySelection && selectionBounds?.width && selectionBounds.height ? (
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-full bg-black/80 px-3 py-1 text-[11px] font-medium text-white">
                {selectionLabel}
              </div>
            ) : null}
            {isPrimarySelection
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
