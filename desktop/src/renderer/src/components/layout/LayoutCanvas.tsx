import type {
  FC,
  PointerEvent as ReactPointerEvent,
  MutableRefObject,
  ReactNode,
  CSSProperties
} from 'react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  target: 'frame' | 'crop'
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
  onRequestToggleAspectLock?: (target: 'frame' | 'crop') => void
  onRequestSnapAspectRatio?: (target: 'frame' | 'crop') => void
  getAspectRatioForItem?: (item: LayoutItem, target: 'frame' | 'crop') => number | null
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

type ItemAppearance = {
  backgroundColor: string
  borderColor: string
  labelColor: string
  handleBackgroundColor: string
  handleBorderColor: string
}

const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const normalised = hex.replace('#', '')
  if (![3, 6].includes(normalised.length)) {
    return null
  }
  const expanded =
    normalised.length === 3
      ? normalised
          .split('')
          .map((char) => char + char)
          .join('')
      : normalised
  const value = Number.parseInt(expanded, 16)
  if (Number.isNaN(value)) {
    return null
  }
  return {
    r: (value >> 16) & 0xff,
    g: (value >> 8) & 0xff,
    b: value & 0xff
  }
}

const mixHexColors = (base: string, target: string, ratio: number): string => {
  const clampRatio = Math.min(Math.max(ratio, 0), 1)
  const from = hexToRgb(base)
  const to = hexToRgb(target)
  if (!from || !to) {
    return base
  }
  const mix = (channelFrom: number, channelTo: number): number =>
    Math.round(channelFrom + (channelTo - channelFrom) * clampRatio)
  const r = mix(from.r, to.r)
  const g = mix(from.g, to.g)
  const b = mix(from.b, to.b)
  const toHex = (channel: number): string => channel.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const getRelativeLuminance = (hexColor: string): number => {
  const rgb = hexToRgb(hexColor)
  if (!rgb) {
    return 0.5
  }
  const normalise = (value: number): number => {
    const channel = value / 255
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)
  }
  const r = normalise(rgb.r)
  const g = normalise(rgb.g)
  const b = normalise(rgb.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const getContrastingTextColor = (hexColor: string): string => {
  const luminance = getRelativeLuminance(hexColor)
  return luminance > 0.55 ? '#0f172a' : '#f8fafc'
}

const createAppearance = (base: string, mode: 'dark' | 'light'): ItemAppearance => {
  const background =
    mode === 'dark' ? mixHexColors(base, '#0f172a', 0.65) : mixHexColors(base, '#ffffff', 0.82)
  const border = mode === 'dark' ? mixHexColors(base, '#ffffff', 0.35) : mixHexColors(base, '#0f172a', 0.35)
  const handleBackground = mode === 'dark' ? mixHexColors(base, '#ffffff', 0.85) : mixHexColors(base, '#ffffff', 0.65)
  const handleBorder = mode === 'dark' ? mixHexColors(base, '#ffffff', 0.55) : mixHexColors(base, '#0f172a', 0.45)
  const labelColor = getContrastingTextColor(background)
  return {
    backgroundColor: background,
    borderColor: border,
    labelColor,
    handleBackgroundColor: handleBackground,
    handleBorderColor: handleBorder
  }
}

const getItemAppearance = (item: LayoutItem): ItemAppearance => {
  if ((item as LayoutVideoItem).kind === 'video') {
    return createAppearance('#2563eb', 'dark')
  }
  if ((item as LayoutTextItem).kind === 'text') {
    return createAppearance('#10b981', 'light')
  }
  return createAppearance('#f59e0b', 'light')
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

const itemHasAspectLock = (item: LayoutItem, target: 'frame' | 'crop'): boolean => {
  if ((item as LayoutVideoItem).kind !== 'video') {
    return false
  }
  const video = item as LayoutVideoItem
  if (target === 'crop') {
    return video.lockCropAspectRatio !== false
  }
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
  ariaLabel,
  onRequestToggleAspectLock,
  onRequestSnapAspectRatio,
  getAspectRatioForItem
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
        originalFrames,
        target: transformTarget
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
      const maintainAspect = itemHasAspectLock(item, transformTarget) || event.shiftKey
      const snapEnabled = event.altKey || event.metaKey
      onSelectionChange([item.id])
      const originalFrame = getDisplayFrame(item)
      let aspectRatioValue: number | undefined
      if (typeof getAspectRatioForItem === 'function') {
        const ratio = getAspectRatioForItem(item, transformTarget)
        if (ratio && Number.isFinite(ratio) && ratio > 0) {
          aspectRatioValue = ratio
        }
      }
      if (!aspectRatioValue && originalFrame.width > 0 && originalFrame.height > 0) {
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
        aspectRatio: aspectRatioValue,
        target: transformTarget
      }
      ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [getAspectRatioForItem, getDisplayFrame, itemIsEditable, onSelectionChange, transformTarget]
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

  const primarySelection = activeSelection.length === 1 ? activeSelection[0] : null
  const primaryIsVideo = Boolean(primarySelection && (primarySelection as LayoutVideoItem).kind === 'video')
  const primaryAspectLocked = Boolean(
    primarySelection && primaryIsVideo && itemHasAspectLock(primarySelection, transformTarget)
  )

  const handleCanvasPointerDown = useCallback(() => {
    if (dragStateRef.current) {
      return
    }
    onSelectionChange([])
  }, [onSelectionChange])

  const stopToolbarPointerPropagation = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.stopPropagation()
  }, [])

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
        const palette = getItemAppearance(item)
        const classes = getItemClasses ? getItemClasses(item, isSelected) : ''
        const shouldShowLabel = labelVisibility === 'always' || (labelVisibility === 'selected' && isSelected)
        const editable = itemIsEditable(item)
        return (
          <div
            key={item.id}
            className={`absolute rounded-xl border text-[10px] font-semibold uppercase tracking-wide shadow-lg transition ${classes} ${
              isSelected ? 'ring-2 ring-[var(--ring)]' : 'ring-0'
            }`}
            style={{
              left,
              top,
              width,
              height,
              backgroundColor: palette.backgroundColor,
              borderColor: palette.borderColor
            }}
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
              <div
                className="pointer-events-none absolute inset-0 flex items-center justify-center px-2 text-center font-semibold drop-shadow-[0_1px_2px_rgba(15,23,42,0.45)]"
                style={{ color: palette.labelColor }}
              >
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
                    className={`absolute h-3 w-3 rounded-full border text-transparent transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${handle.className}`}
                    onPointerDown={(event) => handleResizePointerDown(event, item, handle.id)}
                    style={{
                      backgroundColor: palette.handleBackgroundColor,
                      borderColor: palette.handleBorderColor
                    }}
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
      {activeSelection.length === 1
        ? (() => {
            const buttons: Array<{ key: string; node: ReactNode }> = []
            if (primaryIsVideo && onRequestToggleAspectLock) {
              const aspectContext = transformTarget === 'crop' ? 'crop' : 'frame'
              const lockLabel = primaryAspectLocked
                ? `Unlock ${aspectContext} aspect`
                : `Lock ${aspectContext} aspect`
              buttons.push({
                key: 'toggle-aspect',
                node: (
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onPointerDown={stopToolbarPointerPropagation}
                    onClick={() => onRequestToggleAspectLock(transformTarget)}
                  >
                    {lockLabel}
                  </button>
                )
              })
            }
            if (primaryIsVideo && onRequestSnapAspectRatio) {
              const snapLabel =
                transformTarget === 'crop' ? 'Snap crop to frame' : 'Snap frame to video'
              buttons.push({
                key: 'snap-aspect',
                node: (
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onPointerDown={stopToolbarPointerPropagation}
                    onClick={() => onRequestSnapAspectRatio(transformTarget)}
                  >
                    {snapLabel}
                  </button>
                )
              })
            }
            buttons.push(
              {
                key: 'bring-forward',
                node: (
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onPointerDown={stopToolbarPointerPropagation}
                    onClick={onRequestBringForward}
                  >
                    Bring forward
                  </button>
                )
              },
              {
                key: 'send-backward',
                node: (
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onPointerDown={stopToolbarPointerPropagation}
                    onClick={onRequestSendBackward}
                  >
                    Send backward
                  </button>
                )
              },
              {
                key: 'duplicate',
                node: (
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onPointerDown={stopToolbarPointerPropagation}
                    onClick={onRequestDuplicate}
                  >
                    Duplicate
                  </button>
                )
              },
              {
                key: 'remove',
                node: (
                  <button
                    type="button"
                    className="rounded-full px-2 py-1 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    onPointerDown={stopToolbarPointerPropagation}
                    onClick={onRequestDelete}
                  >
                    Remove
                  </button>
                )
              }
            )
            return (
              <div className="pointer-events-none absolute -bottom-10 left-1/2 flex -translate-x-1/2 gap-2">
                <div
                  className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/70 px-3 py-1 text-[11px] text-white shadow-lg"
                  onPointerDown={stopToolbarPointerPropagation}
                >
                  {buttons.map((entry, index) => (
                    <Fragment key={entry.key}>
                      {entry.node}
                      {index < buttons.length - 1 ? (
                        <span aria-hidden="true" className="text-white/40">
                          ·
                        </span>
                      ) : null}
                    </Fragment>
                  ))}
                </div>
              </div>
            )
          })()
        : null}
    </div>
  )
}

export default LayoutCanvas
