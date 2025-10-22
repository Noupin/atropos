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

export type LayoutCanvasSelection = string | null

type ColorScheme = 'dark' | 'light'

type CSSWithVars = CSSProperties & Partial<Record<'--ring', string>>

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

const cursorForHandle = (handle: ResizeHandle): string => {
  switch (handle) {
    case 'n':
    case 's':
      return 'ns-resize'
    case 'e':
    case 'w':
      return 'ew-resize'
    case 'ne':
    case 'sw':
      return 'nesw-resize'
    case 'nw':
    case 'se':
      return 'nwse-resize'
    default:
      return 'default'
  }
}

type DragState = {
  mode: DragMode
  pointerId: number
  itemId: string
  handle?: ResizeHandle
  startX: number
  startY: number
  startNormalizedX: number
  startNormalizedY: number
  maintainAspect: boolean
  snapEnabled: boolean
  originalFrames: Map<string, LayoutFrame>
  aspectRatio?: number
  target: 'frame' | 'crop'
}

type LayoutCanvasProps = {
  layout: LayoutDefinition | null
  selectedItemId: LayoutCanvasSelection
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

const clampFrameToCanvas = (frame: LayoutFrame): LayoutFrame => {
  const width = clamp(frame.width, 0, 1)
  const height = clamp(frame.height, 0, 1)
  const maxX = 1 - width
  const maxY = 1 - height
  const x = clamp(frame.x, 0, maxX)
  const y = clamp(frame.y, 0, maxY)
  return { x, y, width, height }
}

const pointWithinFrame = (frame: LayoutFrame, x: number, y: number): boolean => {
  return x >= frame.x && x <= frame.x + frame.width && y >= frame.y && y <= frame.y + frame.height
}

const isSameCandidateOrder = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) {
    return false
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }
  return true
}

const fractionToPercent = (value: number): string => `${(value * 100).toFixed(2)}%`

const SNAP_POINTS = [0, 0.25, 0.5, 0.75, 1]
const SNAP_THRESHOLD = 0.02

const GUIDE_FADE_DELAY = 200

const detectColorScheme = (): ColorScheme => {
  if (typeof document === 'undefined') {
    return 'dark'
  }
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

const useColorScheme = (): ColorScheme => {
  const [scheme, setScheme] = useState<ColorScheme>(() => detectColorScheme())

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const root = document.documentElement
    const updateScheme = () => {
      const next = detectColorScheme()
      setScheme((current) => (current === next ? current : next))
    }

    updateScheme()

    let observer: MutationObserver | null = null
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(updateScheme)
      observer.observe(root, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
    }

    let media: MediaQueryList | null = null
    const handleMediaChange = () => updateScheme()
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      media = window.matchMedia('(prefers-color-scheme: dark)')
      if (typeof media.addEventListener === 'function') {
        media.addEventListener('change', handleMediaChange)
      } else if (typeof media.addListener === 'function') {
        media.addListener(handleMediaChange)
      }
    }

    return () => {
      observer?.disconnect()
      if (media) {
        if (typeof media.removeEventListener === 'function') {
          media.removeEventListener('change', handleMediaChange)
        } else if (typeof media.removeListener === 'function') {
          media.removeListener(handleMediaChange)
        }
      }
    }
  }, [])

  return scheme
}

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

const toTranslucent = (hexColor: string, alpha: number): string => {
  const rgb = hexToRgb(hexColor)
  const clamped = Math.min(Math.max(alpha, 0), 1)
  if (!rgb) {
    const fallback = Math.round(clamped * 100) / 100
    return `rgba(59,113,202,${fallback})`
  }
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`
}

const createAppearance = (base: string, mode: ColorScheme): ItemAppearance => {
  const surfaceBlend = mode === 'dark' ? mixHexColors(base, '#1f2937', 0.4) : mixHexColors(base, '#f8fafc', 0.6)
  const accentMix = mode === 'dark' ? mixHexColors(surfaceBlend, '#bfdbfe', 0.55) : mixHexColors(surfaceBlend, '#1e293b', 0.45)
  const background = toTranslucent(surfaceBlend, mode === 'dark' ? 0.35 : 0.24)
  const border = accentMix
  const handleBackground = toTranslucent(mixHexColors(surfaceBlend, '#ffffff', 0.7), mode === 'dark' ? 0.92 : 0.82)
  const handleBorder = mixHexColors(accentMix, mode === 'dark' ? '#e2e8f0' : '#1e293b', mode === 'dark' ? 0.35 : 0.4)
  const labelColor = getContrastingTextColor(mixHexColors(surfaceBlend, mode === 'dark' ? '#0f172a' : '#f8fafc', 0.2))
  return {
    backgroundColor: background,
    borderColor: border,
    labelColor,
    handleBackgroundColor: handleBackground,
    handleBorderColor: handleBorder
  }
}

const getItemAppearance = (item: LayoutItem, scheme: ColorScheme): ItemAppearance => {
  if ((item as LayoutVideoItem).kind === 'video') {
    return createAppearance('#38bdf8', scheme)
  }
  if ((item as LayoutTextItem).kind === 'text') {
    return createAppearance('#ec4899', scheme)
  }
  return createAppearance('#fbbf24', scheme)
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
  selectedItemId,
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
  const colorScheme = useColorScheme()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const rafRef = useRef<number | null>(null)
  const guidesRef = useRef<Guide[]>([])
  const lastPointerHitRef = useRef<{ x: number; y: number; candidates: string[] } | null>(null)
  const [activeGuides, setActiveGuides] = useState<Guide[]>([])
  const [floatingLabel, setFloatingLabel] = useState<string | null>(null)
  const [floatingPosition, setFloatingPosition] = useState<{ x: number; y: number } | null>(null)
  const [toolbarAnchorId, setToolbarAnchorId] = useState<string | null>(null)
  const [hoverState, setHoverState] = useState<{ itemId: string | null; handle: ResizeHandle | null }>(
    () => ({ itemId: null, handle: null })
  )
  const [cursor, setCursor] = useState<string>('default')

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
    setCursor('default')
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

  const getPointerPosition = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) {
        return null
      }
      const x = clamp((event.clientX - rect.left) / rect.width)
      const y = clamp((event.clientY - rect.top) / rect.height)
      return { x, y, rect }
    },
    []
  )

  const getCandidatesAtPoint = useCallback(
    (x: number, y: number): string[] => {
      if (!layout) {
        return []
      }
      const hits: string[] = []
      for (const item of sortedItems) {
        const frame = getDisplayFrame(item)
        if (pointWithinFrame(frame, x, y)) {
          hits.push(item.id)
        }
      }
      return hits
    },
    [getDisplayFrame, layout, sortedItems]
  )

  const updateHoverFromEvent = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (dragStateRef.current) {
        return
      }
      const dataset = (event.target as HTMLElement | null)?.dataset
      if (dataset?.handle && dataset?.itemId) {
        const handle = dataset.handle as ResizeHandle
        const itemId = dataset.itemId
        setHoverState((current) => {
          if (current.itemId === itemId && current.handle === handle) {
            return current
          }
          return { itemId, handle }
        })
        setCursor(cursorForHandle(handle))
        return
      }
      const pointer = getPointerPosition(event)
      if (!pointer) {
        setHoverState((current) => (current.itemId || current.handle ? { itemId: null, handle: null } : current))
        setCursor('default')
        return
      }
      const candidates = getCandidatesAtPoint(pointer.x, pointer.y)
      const hoveredId = candidates.length ? candidates[candidates.length - 1] : null
      setHoverState((current) => {
        if (current.itemId === hoveredId && current.handle === null) {
          return current
        }
        return { itemId: hoveredId, handle: null }
      })
      setCursor(hoveredId ? 'grab' : 'default')
    },
    [getCandidatesAtPoint, getPointerPosition]
  )

  const handlePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!layout) {
        return
      }
      if (event.button !== 0) {
        updateHoverFromEvent(event)
        return
      }

      const pointer = getPointerPosition(event)
      if (!pointer) {
        onSelectionChange(null)
        setToolbarAnchorId(null)
        clearDragState()
        return
      }

      const dataset = (event.target as HTMLElement | null)?.dataset ?? {}
      const handle = (dataset.handle as ResizeHandle | undefined) ?? undefined
      const targetItemId = (dataset.itemId as string | undefined) ?? null

      const candidates = getCandidatesAtPoint(pointer.x, pointer.y)
      let nextSelection: string | null = null

      if (handle && targetItemId) {
        nextSelection = targetItemId
      } else if (candidates.length) {
        const lastHit = lastPointerHitRef.current
        const sameSpot =
          lastHit &&
          Math.hypot(lastHit.x - pointer.x, lastHit.y - pointer.y) <= 0.01 &&
          isSameCandidateOrder(lastHit.candidates, candidates)
        if (sameSpot && selectedItemId && candidates.includes(selectedItemId)) {
          const currentIndex = candidates.indexOf(selectedItemId)
          const nextIndex = (currentIndex + 1) % candidates.length
          nextSelection = candidates[nextIndex]
        } else {
          nextSelection = candidates[candidates.length - 1]
        }
        lastPointerHitRef.current = { x: pointer.x, y: pointer.y, candidates }
      } else {
        lastPointerHitRef.current = null
      }

      if (!nextSelection) {
        if (selectedItemId !== null) {
          onSelectionChange(null)
          setToolbarAnchorId(null)
        }
        clearDragState()
        setHoverState((current) => (current.itemId || current.handle ? { itemId: null, handle: null } : current))
        setCursor('default')
        return
      }

      if (nextSelection !== selectedItemId) {
        onSelectionChange(nextSelection)
      }
      setToolbarAnchorId(nextSelection)
      setHoverState({ itemId: nextSelection, handle: handle ?? null })

      const item = layout.items.find((candidate) => candidate.id === nextSelection)
      if (!item || !itemIsEditable(item)) {
        clearDragState()
        return
      }

      const originalFrame = getDisplayFrame(item)
      const snapEnabled = event.altKey || event.metaKey
      const maintainAspect = handle ? itemHasAspectLock(item, transformTarget) || event.shiftKey : false
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
        mode: handle ? 'resize' : 'move',
        pointerId: event.pointerId,
        itemId: item.id,
        handle,
        startX: event.clientX,
        startY: event.clientY,
        startNormalizedX: pointer.x,
        startNormalizedY: pointer.y,
        maintainAspect,
        snapEnabled,
        originalFrames: new Map([[item.id, originalFrame]]),
        aspectRatio: aspectRatioValue,
        target: transformTarget
      }

      setCursor(handle ? cursorForHandle(handle) : 'grabbing')
      containerRef.current?.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    [
      clearDragState,
      getAspectRatioForItem,
      getCandidatesAtPoint,
      getDisplayFrame,
      getPointerPosition,
      itemIsEditable,
      layout,
      onSelectionChange,
      selectedItemId,
      setToolbarAnchorId,
      transformTarget,
      updateHoverFromEvent
    ]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state || !layout || state.pointerId !== event.pointerId) {
        updateHoverFromEvent(event)
        return
      }

      const pointer = getPointerPosition(event)
      if (!pointer) {
        return
      }

      const deltaX = pointer.x - state.startNormalizedX
      const deltaY = pointer.y - state.startNormalizedY
      const transforms: LayoutCanvasTransform[] = []

      if (state.mode === 'move') {
        state.originalFrames.forEach((original, id) => {
          const nextFrame = clampFrameToCanvas({
            x: original.x + deltaX,
            y: original.y + deltaY,
            width: original.width,
            height: original.height
          })
          const snapped = applyGuides(nextFrame)
          transforms.push({ itemId: id, frame: snapped })
          setFloatingLabel(`${(snapped.width * 100).toFixed(1)} × ${(snapped.height * 100).toFixed(1)}%`)
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
          nextFrame = clampFrameToCanvas(nextFrame)
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
    [applyGuides, getPointerPosition, layout, scheduleTransform, updateHoverFromEvent]
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = dragStateRef.current
      if (!state || state.pointerId !== event.pointerId) {
        return
      }
      const pointer = getPointerPosition(event)
      const original = state.originalFrames.get(state.itemId)
      clearDragState()
      containerRef.current?.releasePointerCapture(event.pointerId)
      if (!layout || !pointer || !original) {
        return
      }
      const deltaX = pointer.x - state.startNormalizedX
      const deltaY = pointer.y - state.startNormalizedY
      const transforms: LayoutCanvasTransform[] = []

      if (state.mode === 'move') {
        const frame = clampFrameToCanvas({
          x: original.x + deltaX,
          y: original.y + deltaY,
          width: original.width,
          height: original.height
        })
        transforms.push({ itemId: state.itemId, frame: applyGuides(frame) })
      } else if (state.mode === 'resize' && state.handle) {
        let frame: LayoutFrame
        if (state.maintainAspect) {
          frame = maintainAspectResize(original, state.handle, deltaX, deltaY, state.aspectRatio)
        } else {
          frame = resizeFrame(original, state.handle, deltaX, deltaY)
        }
        frame = clampFrameToCanvas(frame)
        transforms.push({ itemId: state.itemId, frame: applyGuides(frame) })
      }

      if (transforms.length) {
        scheduleTransform(transforms, { commit: true })
      }
      if (state.itemId) {
        onSelectionChange(state.itemId)
        setToolbarAnchorId(state.itemId)
      }
      updateHoverFromEvent(event)
    },
    [
      applyGuides,
      clearDragState,
      getPointerPosition,
      layout,
      onSelectionChange,
      scheduleTransform,
      setToolbarAnchorId,
      updateHoverFromEvent
    ]
  )

  const handlePointerLeave = useCallback(() => {
    if (dragStateRef.current) {
      return
    }
    setHoverState((current) => (current.itemId || current.handle ? { itemId: null, handle: null } : current))
    setCursor('default')
  }, [])

  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      containerRef.current?.releasePointerCapture(event.pointerId)
      clearDragState()
    },
    [clearDragState]
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

  const activeSelection = useMemo(() => {
    if (!layout || !selectedItemId) {
      return null
    }
    return layout.items.find((item) => item.id === selectedItemId) ?? null
  }, [layout, selectedItemId])

  useEffect(() => {
    if (!selectedItemId) {
      setToolbarAnchorId(null)
      return
    }
    setToolbarAnchorId((current) => (current === selectedItemId ? current : selectedItemId))
  }, [selectedItemId])

  const selectionBounds = useMemo(() => {
    if (!activeSelection) {
      return null
    }
    const frame = getDisplayFrame(activeSelection)
    return { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
  }, [activeSelection, getDisplayFrame])

  const selectionLabel = useMemo(() => {
    if (!activeSelection) {
      return null
    }
    return getItemLabel(activeSelection)
  }, [activeSelection])

  const ringColor = useMemo(
    () => (colorScheme === 'dark' ? 'rgba(125, 211, 252, 0.68)' : 'rgba(37, 99, 235, 0.6)'),
    [colorScheme]
  )

  const selectionOutlineColor = useMemo(
    () => (colorScheme === 'dark' ? 'rgba(226, 232, 240, 0.55)' : 'rgba(30, 41, 59, 0.45)'),
    [colorScheme]
  )

  const toolbarStyle = useMemo<CSSWithVars | undefined>(() => {
    if (!selectionBounds) {
      return undefined
    }
    const centerX = selectionBounds.x + selectionBounds.width / 2
    const top = Math.max(selectionBounds.y, 0)
    return {
      left: fractionToPercent(centerX),
      top: fractionToPercent(top),
      transform: 'translate(-50%, -100%) translateY(-18px)',
      '--ring': ringColor
    }
  }, [ringColor, selectionBounds])

  const primaryIsVideo = Boolean(activeSelection && (activeSelection as LayoutVideoItem).kind === 'video')
  const primaryAspectLocked = Boolean(
    activeSelection && primaryIsVideo && itemHasAspectLock(activeSelection, transformTarget)
  )

  const showToolbar = Boolean(activeSelection && toolbarAnchorId === activeSelection.id)

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
        'relative flex max-w-full select-none items-center justify-center overflow-hidden rounded-2xl border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_68%,transparent)] text-[var(--fg)] touch-none',
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
    base.cursor = cursor
    return base
  }, [aspectRatio, cursor, style])

  return (
    <div
      ref={containerRef}
      className={canvasClassName}
      style={canvasStyle}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      role="presentation"
      aria-label={ariaLabel}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">
          {previewContent}
        </div>
      </div>
      {showGrid ? (
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-40">
          {Array.from({ length: 9 }).map((_, index) => (
            <div
              key={index}
              className="border border-[color:color-mix(in_srgb,var(--edge-soft)_70%,transparent)]"
            />
          ))}
        </div>
      ) : null}
      {showSafeMargins ? (
        <div className="pointer-events-none absolute inset-[8%] rounded-2xl border-2 border-dashed border-[color:color-mix(in_srgb,var(--accent)_55%,transparent)]" />
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
        const isSelected = selectedItemId === item.id
        const isPrimarySelection = activeSelection?.id === item.id
        const isHovered = hoverState.itemId === item.id
        const showHandles = isSelected || isHovered
        const label = getItemLabel(item)
        const palette = getItemAppearance(item, colorScheme)
        const classes = getItemClasses ? getItemClasses(item, isSelected) : ''
        const shouldShowLabel = labelVisibility === 'always' || (labelVisibility === 'selected' && isSelected)
        const editable = itemIsEditable(item)
        const borderColor = isSelected
          ? palette.borderColor
          : isHovered
            ? mixHexColors(palette.borderColor, colorScheme === 'dark' ? '#ffffff' : '#000000', 0.35)
            : 'transparent'
        const handleIsActive = hoverState.itemId === item.id && Boolean(hoverState.handle)
        const handleOpacityClass = isSelected
          ? 'opacity-100'
          : handleIsActive
            ? 'opacity-70'
            : isHovered
              ? 'opacity-45'
              : 'opacity-0'
        const handlePointerClass = showHandles ? 'pointer-events-auto' : 'pointer-events-none'
        return (
          <div
            key={item.id}
            className={`absolute rounded-none border text-[10px] font-semibold uppercase tracking-wide transition ${classes} ${
              isSelected
                ? 'ring-2 ring-[var(--ring)] shadow-lg'
                : 'ring-0 shadow-[0_4px_12px_rgba(15,23,42,0.18)]'
            }`}
            style={
              {
                left,
                top,
                width,
                height,
                backgroundColor: palette.backgroundColor,
                borderColor,
                borderWidth: isSelected ? '2px' : '1px',
                opacity: isSelected || isHovered ? 1 : 0.9,
                '--ring': ringColor
              } as CSSWithVars
            }
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
              <div className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 rounded-full border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_92%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--fg)] shadow-[0_8px_20px_rgba(15,23,42,0.35)]">
                {selectionLabel}
              </div>
            ) : null}
            {editable
              ? handles.map((handle) => (
                  <button
                    key={handle.id}
                    type="button"
                    tabIndex={-1}
                    aria-label={handle.label}
                    data-handle={handle.id}
                    data-item-id={item.id}
                    className={`absolute h-3 w-3 border-2 text-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${handle.className} ${handleOpacityClass} ${handlePointerClass}`}
                    onPointerDown={(event) => {
                      event.preventDefault()
                    }}
                    style={
                      {
                        backgroundColor: palette.handleBackgroundColor,
                        borderColor: palette.handleBorderColor,
                        '--ring': ringColor
                      } as CSSWithVars
                    }
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
          className="pointer-events-none absolute border-[3px]"
          style={{
            left: fractionToPercent(selectionBounds.x),
            top: fractionToPercent(selectionBounds.y),
            width: fractionToPercent(selectionBounds.width),
            height: fractionToPercent(selectionBounds.height),
            borderColor: selectionOutlineColor
          }}
        />
      ) : null}
      {floatingLabel && floatingPosition ? (
        <div
          className="pointer-events-none absolute -translate-y-8 rounded-full border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_90%,transparent)] px-3 py-1 text-[11px] font-semibold text-[var(--fg)] shadow-[0_10px_24px_rgba(15,23,42,0.35)]"
          style={{
            left: `${floatingPosition.x - (containerRef.current?.getBoundingClientRect().left ?? 0)}px`,
            top: `${floatingPosition.y - (containerRef.current?.getBoundingClientRect().top ?? 0)}px`
          }}
        >
          {floatingLabel}
        </div>
      ) : null}
      {showToolbar && toolbarStyle
        ? (() => {
            const buttons: Array<{ key: string; node: ReactNode }> = []
            const toolbarButtonClass =
              'rounded-full px-2 py-1 text-xs text-[var(--fg)] transition hover:bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]'
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
                    className={toolbarButtonClass}
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
                    className={toolbarButtonClass}
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
                    className={toolbarButtonClass}
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
                    className={toolbarButtonClass}
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
                    className={toolbarButtonClass}
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
                    className={toolbarButtonClass}
                    onPointerDown={stopToolbarPointerPropagation}
                    onClick={onRequestDelete}
                  >
                    Remove
                  </button>
                )
              }
            )
            return (
              <div className="pointer-events-none absolute z-20" style={toolbarStyle}>
                <div
                  className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_92%,transparent)] px-3 py-1 text-[11px] text-[var(--fg)] shadow-[0_12px_28px_rgba(15,23,42,0.4)]"
                  onPointerDown={stopToolbarPointerPropagation}
                >
                  {buttons.map((entry, index) => (
                    <Fragment key={entry.key}>
                      {entry.node}
                      {index < buttons.length - 1 ? (
                        <span
                          aria-hidden="true"
                          className="text-[color:color-mix(in_srgb,var(--fg)_45%,transparent)]"
                        >
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
