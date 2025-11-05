import type {
  FC,
  PointerEvent as ReactPointerEvent,
  MutableRefObject,
  ReactNode,
  CSSProperties,
  MouseEvent as ReactMouseEvent
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LayoutCrop,
  LayoutDefinition,
  LayoutFrame,
  LayoutItem,
  LayoutTextItem,
  LayoutVideoItem
} from '../../../../types/layouts'
import LayoutItemToolbar, {
  type LayoutItemToolbarAction,
  BringForwardIcon,
  DuplicateIcon,
  AspectResetIcon,
  RemoveIcon,
  SendBackwardIcon,
  CropModeIcon,
  CropConfirmIcon,
  LockIcon,
  UnlockIcon
} from './LayoutItemToolbar'
import { useLayoutSelection } from './layoutSelectionStore'

export type { LayoutCanvasSelection } from './layoutSelectionStore'

type ColorScheme = 'dark' | 'light'

type CSSWithVars = CSSProperties & Partial<Record<'--ring', string>>

type LayoutCanvasTransform = {
  itemId: string
  frame: LayoutFrame
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type InteractionMode = 'move' | 'resize'

const cursorForHandle = (handle: ResizeHandle, aspectLocked = false): string => {
  if (aspectLocked) {
    switch (handle) {
      case 'ne':
      case 'sw':
        return 'nesw-resize'
      case 'nw':
      case 'se':
      case 'n':
      case 's':
        return 'nwse-resize'
      case 'e':
      case 'w':
        return 'nesw-resize'
      default:
        return 'nwse-resize'
    }
  }
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

type ActiveInteraction = {
  mode: InteractionMode
  pointerId: number
  itemId: string
  handle?: ResizeHandle
  startClientX: number
  startClientY: number
  startX: number
  startY: number
  originFrame: LayoutFrame
  aspectLocked: boolean
  aspectRatio?: number
  target: 'frame' | 'crop'
  snapEnabled: boolean
  frameBounds?: LayoutFrame
  sourceBounds?: LayoutCrop
}

type HoverTarget = {
  itemId: string | null
  handle: ResizeHandle | null
}

type SelectionCycle = {
  x: number
  y: number
  stack: string[]
  index: number
}

type LayoutCanvasProps = {
  layout: LayoutDefinition | null
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
  onRequestResetAspect?: (target: 'frame' | 'crop', context: 'source' | 'layout') => void
  onRequestChangeTransformTarget?: (target: 'frame' | 'crop') => void
  onRequestToggleAspectLock?: (target: 'frame' | 'crop', context: 'source' | 'layout') => void
  getAspectRatioForItem?: (item: LayoutItem, target: 'frame' | 'crop') => number | null
  cropContext?: 'source' | 'layout'
  enableScaleModeMenu?: boolean
  onRequestChangeScaleMode?: (itemId: string, mode: LayoutVideoItem['scaleMode']) => void
  getPendingCrop?: (itemId: string, context: 'source' | 'layout') => LayoutFrame | null
  onRequestFinishCrop?: () => void
}

type Guide = {
  orientation: 'horizontal' | 'vertical'
  position: number
}

type SnappedEdges = Partial<Record<'left' | 'right' | 'top' | 'bottom', boolean>>

type ContextMenuState = { x: number; y: number; itemId: string } | null

const clamp = (value: number, min = 0, max = 1): number => Math.min(Math.max(value, min), max)

const clampCropFrame = (frame: LayoutFrame): LayoutCrop => ({
  x: clamp(frame.x),
  y: clamp(frame.y),
  width: clamp(frame.width),
  height: clamp(frame.height),
  units: 'fraction'
})

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

const HIT_CYCLE_TOLERANCE = 0.01

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
      observer.observe(root, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'style']
      })
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
  const surfaceBlend =
    mode === 'dark' ? mixHexColors(base, '#1f2937', 0.4) : mixHexColors(base, '#f8fafc', 0.6)
  const accentMix =
    mode === 'dark'
      ? mixHexColors(surfaceBlend, '#bfdbfe', 0.55)
      : mixHexColors(surfaceBlend, '#1e293b', 0.45)
  const background = toTranslucent(surfaceBlend, mode === 'dark' ? 0.35 : 0.24)
  const border = accentMix
  const handleBackground = toTranslucent(
    mixHexColors(surfaceBlend, '#ffffff', 0.7),
    mode === 'dark' ? 0.92 : 0.82
  )
  const handleBorder = mixHexColors(
    accentMix,
    mode === 'dark' ? '#e2e8f0' : '#1e293b',
    mode === 'dark' ? 0.35 : 0.4
  )
  const labelColor = getContrastingTextColor(
    mixHexColors(surfaceBlend, mode === 'dark' ? '#0f172a' : '#f8fafc', 0.2)
  )
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

const normaliseVideoCropBounds = (crop: LayoutCrop | null | undefined): LayoutCrop => ({
  x: clamp(crop?.x ?? 0),
  y: clamp(crop?.y ?? 0),
  width: clamp(crop?.width ?? 1),
  height: clamp(crop?.height ?? 1),
  units: 'fraction'
})

const clampCropToBounds = (crop: LayoutCrop, bounds: LayoutCrop): LayoutCrop => {
  const base = normaliseVideoCropBounds(bounds)
  const next = normaliseVideoCropBounds(crop)
  const maxX = clamp(base.x + base.width)
  const maxY = clamp(base.y + base.height)
  let width = clamp(Math.min(next.width, maxX - base.x))
  let height = clamp(Math.min(next.height, maxY - base.y))
  let x = clamp(next.x)
  let y = clamp(next.y)
  if (x < base.x) {
    x = base.x
  }
  if (y < base.y) {
    y = base.y
  }
  if (x + width > maxX) {
    x = clamp(maxX - width)
  }
  if (y + height > maxY) {
    y = clamp(maxY - height)
  }
  width = clamp(Math.min(width, maxX - x))
  height = clamp(Math.min(height, maxY - y))
  return { x, y, width, height, units: 'fraction' }
}

const getVideoSourceBounds = (video: LayoutVideoItem): LayoutCrop => {
  return normaliseVideoCropBounds(video.sourceCrop ?? video.crop ?? defaultCrop)
}

const clampFrameToBounds = (frame: LayoutFrame, bounds: LayoutFrame): LayoutFrame => {
  const bounded = { ...bounds }
  const boundRight = clamp(bounded.x + bounded.width)
  const boundBottom = clamp(bounded.y + bounded.height)
  const width = clamp(frame.width, 0, bounded.width)
  const height = clamp(frame.height, 0, bounded.height)
  const maxX = Math.max(bounded.x, boundRight - width)
  const maxY = Math.max(bounded.y, boundBottom - height)
  const x = clamp(Math.min(Math.max(frame.x, bounded.x), maxX))
  const y = clamp(Math.min(Math.max(frame.y, bounded.y), maxY))
  return { x, y, width, height }
}

const cropToOverlayFrame = (
  frameBounds: LayoutFrame,
  sourceBounds: LayoutCrop,
  crop: LayoutCrop
): LayoutFrame => {
  const frame = { ...frameBounds }
  const base = normaliseVideoCropBounds(sourceBounds)
  const target = clampCropToBounds(crop, base)
  const baseWidth = Math.max(base.width, 0.0001)
  const baseHeight = Math.max(base.height, 0.0001)
  const left = clamp((target.x - base.x) / baseWidth)
  const top = clamp((target.y - base.y) / baseHeight)
  const width = clamp(target.width / baseWidth)
  const height = clamp(target.height / baseHeight)
  return {
    x: frame.x + frame.width * left,
    y: frame.y + frame.height * top,
    width: frame.width * width,
    height: frame.height * height
  }
}

const overlayFrameToCrop = (
  frameBounds: LayoutFrame,
  overlay: LayoutFrame,
  sourceBounds: LayoutCrop
): LayoutCrop => {
  const frame = { ...frameBounds }
  const boundedOverlay = clampFrameToBounds(overlay, frame)
  const base = normaliseVideoCropBounds(sourceBounds)
  const frameWidth = Math.max(frame.width, 0.0001)
  const frameHeight = Math.max(frame.height, 0.0001)
  const baseWidth = Math.max(base.width, 0.0001)
  const baseHeight = Math.max(base.height, 0.0001)
  const offsetX = clamp((boundedOverlay.x - frame.x) / frameWidth)
  const offsetY = clamp((boundedOverlay.y - frame.y) / frameHeight)
  const width = clamp(boundedOverlay.width / frameWidth)
  const height = clamp(boundedOverlay.height / frameHeight)
  return {
    x: clamp(base.x + baseWidth * offsetX),
    y: clamp(base.y + baseHeight * offsetY),
    width: clamp(baseWidth * width),
    height: clamp(baseHeight * height),
    units: 'fraction'
  }
}

type CropOverlayRect = { left: number; top: number; width: number; height: number }

const getCropOverlayRect = (
  video: LayoutVideoItem,
  context: 'source' | 'layout',
  pending?: LayoutCrop | null
): CropOverlayRect | null => {
  if (context === 'source') {
    return null
  }

  const base = getVideoSourceBounds(video)
  const override = pending ? clampCropToBounds(pending, base) : null
  const target = override
    ? override
    : clampCropToBounds(normaliseVideoCropBounds(video.crop ?? video.sourceCrop ?? defaultCrop), base)

  const baseWidth = clamp(base.width)
  const baseHeight = clamp(base.height)
  if (baseWidth <= 0 || baseHeight <= 0) {
    return null
  }

  const left = clamp((target.x - base.x) / Math.max(baseWidth, 0.0001))
  const top = clamp((target.y - base.y) / Math.max(baseHeight, 0.0001))
  const width = clamp(target.width / Math.max(baseWidth, 0.0001))
  const height = clamp(target.height / Math.max(baseHeight, 0.0001))

  if (width <= 0 || height <= 0) {
    return null
  }

  const epsilon = 0.001
  const isFullWidth = Math.abs(left) < epsilon && Math.abs(width - 1) < epsilon
  const isFullHeight = Math.abs(top) < epsilon && Math.abs(height - 1) < epsilon

  if (isFullWidth && isFullHeight) {
    return null
  }

  return {
    left,
    top,
    width: width > 1 ? 1 : width,
    height: height > 1 ? 1 : height
  }
}

const normaliseCropFrame = (item: LayoutItem, context: 'source' | 'layout'): LayoutFrame => {
  if ((item as LayoutVideoItem).kind !== 'video') {
    return cloneFrame(item.frame)
  }
  const video = item as LayoutVideoItem
  const cropSource = context === 'source' ? video.sourceCrop ?? video.crop : video.crop ?? video.sourceCrop
  const crop = cropSource ?? defaultCrop
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

const enforceAspectRatio = (
  frame: LayoutFrame,
  aspectRatio: number,
  handle?: ResizeHandle,
  edges: SnappedEdges = {}
): LayoutFrame => {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return frame
  }
  let { x, y, width, height } = frame
  if (width <= 0 || height <= 0) {
    return frame
  }

  const widthFromHeight = height * aspectRatio
  const heightFromWidth = width / aspectRatio

  const horizontalPreference = Boolean(
    edges.left || edges.right || (handle ? handle.includes('e') || handle.includes('w') : false)
  )
  const verticalPreference = Boolean(
    edges.top || edges.bottom || (handle ? handle.includes('n') || handle.includes('s') : false)
  )

  if (horizontalPreference && !verticalPreference) {
    height = heightFromWidth
  } else if (verticalPreference && !horizontalPreference) {
    width = widthFromHeight
  } else {
    if (Math.abs(heightFromWidth - height) < Math.abs(widthFromHeight - width)) {
      height = heightFromWidth
    } else {
      width = widthFromHeight
    }
  }

  width = clamp(width)
  height = clamp(height)

  const horizontalAnchor = edges.left && !edges.right
    ? 'left'
    : edges.right && !edges.left
      ? 'right'
      : handle
        ? handle.includes('w')
          ? 'right'
          : handle.includes('e')
            ? 'left'
            : 'center'
        : 'center'

  const verticalAnchor = edges.top && !edges.bottom
    ? 'top'
    : edges.bottom && !edges.top
      ? 'bottom'
      : handle
        ? handle.includes('n')
          ? 'bottom'
          : handle.includes('s')
            ? 'top'
            : 'center'
        : 'center'

  if (horizontalAnchor === 'right') {
    const right = clamp(frame.x + frame.width)
    x = clamp(right - width, 0, 1 - width)
  } else if (horizontalAnchor === 'center') {
    const centerX = clamp(frame.x + frame.width / 2)
    x = clamp(centerX - width / 2, 0, 1 - width)
  } else {
    x = clamp(frame.x, 0, 1 - width)
  }

  if (verticalAnchor === 'bottom') {
    const bottom = clamp(frame.y + frame.height)
    y = clamp(bottom - height, 0, 1 - height)
  } else if (verticalAnchor === 'center') {
    const centerY = clamp(frame.y + frame.height / 2)
    y = clamp(centerY - height / 2, 0, 1 - height)
  } else {
    y = clamp(frame.y, 0, 1 - height)
  }

  return { x, y, width, height }
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

const useGuideFade = (
  guidesRef: MutableRefObject<Guide[]>,
  setGuides: (guides: Guide[]) => void
) => {
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

type ClearInteractionOptions = {
  preserveAnimation?: boolean
}

const LayoutCanvas: FC<LayoutCanvasProps> = ({
  layout,
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
  onRequestResetAspect,
  onRequestChangeTransformTarget,
  onRequestToggleAspectLock,
  getAspectRatioForItem,
  cropContext = 'layout',
  enableScaleModeMenu = false,
  onRequestChangeScaleMode,
  getPendingCrop,
  onRequestFinishCrop
}) => {
  const colorScheme = useColorScheme()
  const [selectedItemId, setSelectedItemId] = useLayoutSelection()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const interactionRef = useRef<ActiveInteraction | null>(null)
  const cycleRef = useRef<SelectionCycle | null>(null)
  const rafRef = useRef<number | null>(null)
  const guidesRef = useRef<Guide[]>([])
  // Used to suppress parent click handlers after pure click-to-select
  const justSelectedRef = useRef(false)
  // Suppress the synthetic click that fires after a drag/resize to avoid parent deselection
  const suppressNextClickRef = useRef(false)
  const dragEndedRef = useRef(false)
  const persistSelectionIdRef = useRef<string | null>(null)
  const persistSelectionTimerRef = useRef<number | null>(null)
  const lastPointerDownSelectionRef = useRef<string | null>(null)
  const [activeGuides, setActiveGuides] = useState<Guide[]>([])
  const [floatingLabel, setFloatingLabel] = useState<string | null>(null)
  const [floatingPosition, setFloatingPosition] = useState<{ x: number; y: number } | null>(null)
  const [toolbarAnchorId, setToolbarAnchorId] = useState<string | null>(null)
  const [hoverTarget, setHoverTarget] = useState<HoverTarget>({ itemId: null, handle: null })
  const [cursor, setCursor] = useState<string>('default')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)

  useGuideFade(guidesRef, setActiveGuides)

  const getDisplayFrame = useCallback(
    (item: LayoutItem): LayoutFrame => {
      if (transformTarget === 'crop') {
        if (cropContext === 'layout' && (item as LayoutVideoItem).kind === 'video') {
          return cloneFrame(item.frame)
        }
        if ((item as LayoutVideoItem).kind === 'video') {
          const pendingCrop = getPendingCrop?.(item.id, cropContext)
          if (pendingCrop) {
            return {
              x: clamp(pendingCrop.x),
              y: clamp(pendingCrop.y),
              width: clamp(pendingCrop.width),
              height: clamp(pendingCrop.height)
            }
          }
        }
        return normaliseCropFrame(item, cropContext)
      }
      return cloneFrame(item.frame)
    },
    [cropContext, getPendingCrop, transformTarget]
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

  const clearInteraction = useCallback((options: ClearInteractionOptions = {}) => {
    const active = interactionRef.current
    if (active) {
      try {
        containerRef.current?.releasePointerCapture(active.pointerId)
      } catch {
        // Ignore pointer capture release errors triggered after unmount
      }
    }
    if (rafRef.current && !options.preserveAnimation) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    interactionRef.current = null
    setFloatingLabel(null)
    setFloatingPosition(null)
    setActiveGuides([])
    guidesRef.current = []
    setCursor((current) => (options.preserveAnimation ? current : 'default'))
  }, [])

  const applyGuides = useCallback(
    (
      frame: LayoutFrame,
      options: {
        snapEnabled: boolean
        aspectLocked?: boolean
        aspectRatio?: number
        handle?: ResizeHandle
      }
    ): LayoutFrame => {
      const { snapEnabled, aspectLocked = false, aspectRatio, handle } = options
      if (!layout || !snapEnabled) {
        if (!snapEnabled) {
          guidesRef.current = []
          setActiveGuides([])
        }
        return frame
      }
      const updated: LayoutFrame = { ...frame }
      const guides: Guide[] = []
      const edges: SnappedEdges = {}

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
        edges.left = true
      }
      const snappedY = snap(frame.y)
      if (snappedY !== frame.y) {
        updated.y = snappedY
        guides.push({ orientation: 'horizontal', position: snappedY })
        edges.top = true
      }
      const snappedRight = snap(frame.x + frame.width)
      if (snappedRight !== frame.x + frame.width) {
        updated.width = clamp(snappedRight - updated.x)
        guides.push({ orientation: 'vertical', position: snappedRight })
        edges.right = true
      }
      const snappedBottom = snap(frame.y + frame.height)
      if (snappedBottom !== frame.y + frame.height) {
        updated.height = clamp(snappedBottom - updated.y)
        guides.push({ orientation: 'horizontal', position: snappedBottom })
        edges.bottom = true
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

      if (aspectLocked && aspectRatio && Number.isFinite(aspectRatio) && aspectRatio > 0) {
        const adjusted = enforceAspectRatio(updated, aspectRatio, handle, edges)
        updated.x = adjusted.x
        updated.y = adjusted.y
        updated.width = adjusted.width
        updated.height = adjusted.height
      }

      guidesRef.current = guides
      setActiveGuides(guides)
      return updated
    },
    [layout]
  )

  const scheduleTransform = useCallback(
    (transforms: LayoutCanvasTransform[], options: { commit: boolean }) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      rafRef.current = requestAnimationFrame(() => {
        onTransform(transforms, options, transformTarget)
        rafRef.current = null
      })
    },
    [onTransform, transformTarget]
  )

  const getPointerPosition = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null
    }
    const x = clamp((event.clientX - rect.left) / rect.width)
    const y = clamp((event.clientY - rect.top) / rect.height)
    return { x, y }
  }, [])

  const hitTestAtPoint = useCallback(
    (x: number, y: number): string[] => {
      if (!layout) {
        return []
      }
      const hits: string[] = []
      const epsilon = 0.0005
      for (const item of sortedItems) {
        const frame = getDisplayFrame(item)
        if (!pointWithinFrame(frame, x, y)) {
          continue
        }
        if (
          transformTarget === 'crop' &&
          cropContext === 'source' &&
          (item as LayoutVideoItem).kind === 'video'
        ) {
          const video = item as LayoutVideoItem
          const isFullWidth = Math.abs(frame.x) < epsilon && Math.abs(frame.width - 1) < epsilon
          const isFullHeight = Math.abs(frame.y) < epsilon && Math.abs(frame.height - 1) < epsilon
          if (isFullWidth && isFullHeight) {
            const baseFrame = cloneFrame(video.frame)
            if (!pointWithinFrame(baseFrame, x, y)) {
              continue
            }
          }
        }
        hits.push(item.id)
      }
      return hits
    },
    [cropContext, getDisplayFrame, layout, sortedItems, transformTarget]
  )

  const resolveSelectionFromStack = useCallback(
    (stack: string[], point: { x: number; y: number }): string | null => {
      if (!stack.length) {
        cycleRef.current = null
        return null
      }
      const last = cycleRef.current
      if (
        last &&
        Math.hypot(last.x - point.x, last.y - point.y) <= HIT_CYCLE_TOLERANCE &&
        isSameCandidateOrder(last.stack, stack)
      ) {
        const nextIndex = (last.index + 1) % stack.length
        cycleRef.current = { x: point.x, y: point.y, stack, index: nextIndex }
        return stack[nextIndex]
      }
      const index = stack.length - 1
      cycleRef.current = { x: point.x, y: point.y, stack, index }
      return stack[index]
    },
    []
  )

  const commitHover = useCallback((next: HoverTarget, cursorStyle: string) => {
    setHoverTarget((current) => {
      if (current.itemId === next.itemId && current.handle === next.handle) {
        return current
      }
      return next
    })
    setCursor(cursorStyle)
  }, [])

  const clearHover = useCallback(() => {
    setHoverTarget((current) =>
      current.itemId || current.handle ? { itemId: null, handle: null } : current
    )
    setCursor('default')
  }, [])

  const updateHoverFromEvent = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (interactionRef.current) {
        return
      }
      const dataset = (event.target as HTMLElement | null)?.dataset ?? {}
      const datasetHandle = dataset.handle as ResizeHandle | undefined
      const datasetItemId = dataset.itemId as string | undefined
      if (datasetHandle && datasetItemId) {
        commitHover(
          { itemId: datasetItemId, handle: datasetHandle },
          cursorForHandle(datasetHandle)
        )
        return
      }
      const pointer = getPointerPosition(event)
      if (!pointer) {
        clearHover()
        return
      }
      const stack = hitTestAtPoint(pointer.x, pointer.y)
      const hoveredId = stack.length ? stack[stack.length - 1] : null
      if (hoveredId) {
        commitHover({ itemId: hoveredId, handle: null }, 'grab')
      } else {
        clearHover()
      }
    },
    [clearHover, commitHover, getPointerPosition, hitTestAtPoint]
  )

  const handlePointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const targetElement = event.target as HTMLElement | null
      const inContextMenu = targetElement?.closest('[data-layout-context-menu="true"]')
      if (contextMenu) {
        const inToolbar = targetElement?.closest('[data-layout-item-toolbar="true"]')
        if (!inContextMenu && !inToolbar) {
          setContextMenu(null)
        }
      }
      if (inContextMenu) {
        return
      }
      if (!layout) {
        return
      }

      if (targetElement?.closest('[data-layout-item-toolbar="true"]')) {
        justSelectedRef.current = false
        suppressNextClickRef.current = false
        dragEndedRef.current = false
        lastPointerDownSelectionRef.current = null
        return
      }
      // Only handle primary button
      if (event.button !== 0) {
        justSelectedRef.current = false
        suppressNextClickRef.current = false
        dragEndedRef.current = false
        updateHoverFromEvent(event)
        return
      }

      justSelectedRef.current = false
      suppressNextClickRef.current = false
      dragEndedRef.current = false
      lastPointerDownSelectionRef.current = null

      const dataset = (event.target as HTMLElement | null)?.dataset ?? {}
      const handle = dataset.handle as ResizeHandle | undefined
      const datasetItemId = dataset.itemId as string | undefined
      const pointer = getPointerPosition(event)
      const stack = pointer ? hitTestAtPoint(pointer.x, pointer.y) : []

      let nextSelection: string | null = null

      if (handle && datasetItemId) {
        // Clicking a resize handle always selects the owning item
        nextSelection = datasetItemId
        if (pointer) {
          const index = stack.indexOf(datasetItemId)
          const updatedStack = index >= 0 ? stack : [...stack, datasetItemId]
          cycleRef.current = {
            x: pointer.x,
            y: pointer.y,
            stack: updatedStack,
            index: index >= 0 ? index : updatedStack.length - 1
          }
        }
      } else if (pointer) {
        // Click inside the canvas – resolve topmost hit (with cycling on repeated clicks)
        nextSelection = resolveSelectionFromStack(stack, pointer)
      }

      if (!nextSelection) {
        // Clicked empty canvas – clear selection and interaction
        if (selectedItemId) {
          setSelectedItemId(null)
          setToolbarAnchorId(null)
        }
        if (persistSelectionTimerRef.current) {
          window.clearTimeout(persistSelectionTimerRef.current)
          persistSelectionTimerRef.current = null
        }
        persistSelectionIdRef.current = null
        cycleRef.current = null
        clearInteraction()
        clearHover()
        suppressNextClickRef.current = false
        dragEndedRef.current = false
        return
      }

      lastPointerDownSelectionRef.current = nextSelection
      if (persistSelectionTimerRef.current) {
        window.clearTimeout(persistSelectionTimerRef.current)
        persistSelectionTimerRef.current = null
      }
      persistSelectionIdRef.current = nextSelection

      // Resolve the item for the selection so we can derive lock state before updating hover
      const item = layout.items.find((candidate) => candidate.id === nextSelection)
      let pointerAspectLocked = false
      let presetAspectRatio: number | undefined

      if ((item as LayoutVideoItem | undefined)?.kind === 'video') {
        const video = item as LayoutVideoItem
        if (transformTarget === 'crop') {
          pointerAspectLocked = Boolean(video.lockCropAspectRatio)
          if (pointerAspectLocked) {
            const ratio = video.cropAspectRatio
            if (ratio && Number.isFinite(ratio) && ratio > 0) {
              presetAspectRatio = ratio
            }
          }
        } else {
          pointerAspectLocked = Boolean(video.lockAspectRatio)
          if (pointerAspectLocked) {
            const ratio = video.frameAspectRatio
            if (ratio && Number.isFinite(ratio) && ratio > 0) {
              presetAspectRatio = ratio
            }
          }
        }
      }

      // Select the item and show its toolbar/hover state
      if (selectedItemId !== nextSelection) {
        setSelectedItemId(nextSelection)
      }
      setToolbarAnchorId(nextSelection)
      commitHover(
        { itemId: nextSelection, handle: handle ?? null },
        handle ? cursorForHandle(handle, pointerAspectLocked) : 'grab'
      )

      if (!pointer) {
        return
      }

      // Only start an active interaction when we are resizing or we intend to drag the selected item.
      // A simple click-to-select should NOT set interactionRef; selection must persist after pointerup.
      if (!item || !itemIsEditable(item)) {
        clearInteraction()
        return
      }

      let originFrame = getDisplayFrame(item)
      let frameBounds: LayoutFrame | undefined
      let sourceBounds: LayoutCrop | undefined
      if (
        transformTarget === 'crop' &&
        cropContext === 'layout' &&
        (item as LayoutVideoItem).kind === 'video'
      ) {
        const video = item as LayoutVideoItem
        frameBounds = clampFrameToCanvas(cloneFrame(video.frame))
        sourceBounds = getVideoSourceBounds(video)
        const pendingCrop = getPendingCrop?.(video.id, cropContext)
        const currentCrop = pendingCrop
          ? clampCropToBounds(clampCropFrame(pendingCrop), sourceBounds)
          : normaliseVideoCropBounds(video.crop ?? sourceBounds)
        originFrame = cropToOverlayFrame(frameBounds, sourceBounds, currentCrop)
      }
      const snapEnabled = event.altKey || event.metaKey
      const aspectLocked = pointerAspectLocked
      let aspectRatioValue: number | undefined = presetAspectRatio
      if (typeof getAspectRatioForItem === 'function') {
        const ratio = getAspectRatioForItem(item, transformTarget)
        if (ratio && Number.isFinite(ratio) && ratio > 0) {
          aspectRatioValue = ratio
        }
      }
      if (!aspectRatioValue && originFrame.width > 0 && originFrame.height > 0) {
        aspectRatioValue = originFrame.width / Math.max(originFrame.height, 0.0001)
      }

      // Start interaction ONLY if we are on a handle or starting a drag (even if not selected yet).
      const startingDrag = !!handle || pointWithinFrame(originFrame, pointer.x, pointer.y)

      justSelectedRef.current = false
      if (startingDrag) {
        interactionRef.current = {
          mode: handle ? 'resize' : 'move',
          pointerId: event.pointerId,
          itemId: item.id,
          handle,
          startClientX: event.clientX,
          startClientY: event.clientY,
          startX: pointer.x,
          startY: pointer.y,
          originFrame,
          aspectLocked,
          aspectRatio: aspectRatioValue,
          target: transformTarget,
          snapEnabled,
          frameBounds,
          sourceBounds
        }
        // We are starting a drag; do not treat this as a pure click
        justSelectedRef.current = false
        containerRef.current?.setPointerCapture(event.pointerId)
        setCursor(handle ? cursorForHandle(handle, aspectLocked) : 'grabbing')
        event.preventDefault()
      } else {
        // Pure select – no interaction started
        justSelectedRef.current = true
        suppressNextClickRef.current = true
        event.preventDefault()
        setCursor('grab')
      }
    },
    [
      clearHover,
      clearInteraction,
      commitHover,
      contextMenu,
      getAspectRatioForItem,
      getDisplayFrame,
      getPointerPosition,
      hitTestAtPoint,
      itemIsEditable,
      layout,
      resolveSelectionFromStack,
      selectedItemId,
      setSelectedItemId,
      setToolbarAnchorId,
      transformTarget,
      updateHoverFromEvent
    ]
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = interactionRef.current
      if (!state || state.pointerId !== event.pointerId) {
        updateHoverFromEvent(event)
        return
      }

      const pointer = getPointerPosition(event)
      if (!pointer) {
        return
      }

      const deltaX = pointer.x - state.startX
      const deltaY = pointer.y - state.startY
      let nextFrame: LayoutFrame | null = null

      if (state.mode === 'move') {
        nextFrame = clampFrameToCanvas({
          x: state.originFrame.x + deltaX,
          y: state.originFrame.y + deltaY,
          width: state.originFrame.width,
          height: state.originFrame.height
        })
        setCursor('grabbing')
      } else if (state.handle) {
        if (state.target === 'crop' && state.frameBounds && state.sourceBounds) {
          let resized = resizeFrame(state.originFrame, state.handle, deltaX, deltaY)
          resized = clampFrameToBounds(resized, state.frameBounds)
          const crop = overlayFrameToCrop(state.frameBounds, resized, state.sourceBounds)
          const bounded = clampCropToBounds(crop, state.sourceBounds)
          const cropFrame: LayoutFrame = {
            x: bounded.x,
            y: bounded.y,
            width: bounded.width,
            height: bounded.height
          }
          scheduleTransform([{ itemId: state.itemId, frame: cropFrame }], { commit: false })
          setFloatingLabel(`${(bounded.width * 100).toFixed(1)} × ${(bounded.height * 100).toFixed(1)}%`)
          setFloatingPosition({ x: event.clientX, y: event.clientY })
          setCursor(cursorForHandle(state.handle, false))
          return
        }
        if (state.aspectLocked) {
          nextFrame = maintainAspectResize(
            state.originFrame,
            state.handle,
            deltaX,
            deltaY,
            state.aspectRatio
          )
        } else {
          nextFrame = resizeFrame(state.originFrame, state.handle, deltaX, deltaY)
        }
        nextFrame = clampFrameToCanvas(nextFrame)
        setCursor(cursorForHandle(state.handle, state.aspectLocked))
      }

      if (!nextFrame) {
        return
      }

      const snapped = applyGuides(nextFrame, {
        snapEnabled: state.target === 'frame' && state.snapEnabled,
        aspectLocked: state.aspectLocked,
        aspectRatio: state.aspectRatio,
        handle: state.handle
      })
      scheduleTransform([{ itemId: state.itemId, frame: snapped }], { commit: false })
      setFloatingLabel(
        `${(snapped.width * 100).toFixed(1)} × ${(snapped.height * 100).toFixed(1)}%`
      )
      setFloatingPosition({ x: event.clientX, y: event.clientY })
    },
    [applyGuides, getPointerPosition, scheduleTransform, updateHoverFromEvent]
  )

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (justSelectedRef.current) {
        // We only clicked to select; keep selection, suppress parent onClick handlers
        justSelectedRef.current = false
        suppressNextClickRef.current = true
        event.preventDefault()
        event.stopPropagation()
        const persistedId = selectedItemId ?? lastPointerDownSelectionRef.current
        if (persistedId) {
          persistSelectionIdRef.current = persistedId
          if (persistSelectionTimerRef.current) {
            window.clearTimeout(persistSelectionTimerRef.current)
          }
          persistSelectionTimerRef.current = window.setTimeout(() => {
            if (persistSelectionIdRef.current === persistedId) {
              persistSelectionIdRef.current = null
            }
            persistSelectionTimerRef.current = null
          }, 200)
        }
        commitHover({ itemId: persistedId ?? null, handle: null }, 'grab')
        return
      }

      const state = interactionRef.current

      // If there was no active interaction (simple click-to-select), keep selection and do nothing.
      if (!state || state.pointerId !== event.pointerId) {
        // Do not clear selection or hover; just return.
        return
      }

      const pointer = getPointerPosition(event)
      let frame: LayoutFrame | null = null

      if (layout && pointer) {
        const deltaX = pointer.x - state.startX
        const deltaY = pointer.y - state.startY
        const moved = Math.abs(deltaX) > 0.001 || Math.abs(deltaY) > 0.001

        if (state.mode === 'move') {
          if (moved) {
            frame = clampFrameToCanvas({
              x: state.originFrame.x + deltaX,
              y: state.originFrame.y + deltaY,
              width: state.originFrame.width,
              height: state.originFrame.height
            })
          }
        } else if (state.handle) {
          // Resize always commits if any change happened
          if (state.target === 'crop' && state.frameBounds && state.sourceBounds) {
            const resized = resizeFrame(state.originFrame, state.handle, deltaX, deltaY)
            frame = clampFrameToBounds(resized, state.frameBounds)
          } else {
            frame = state.aspectLocked
              ? maintainAspectResize(
                  state.originFrame,
                  state.handle,
                  deltaX,
                  deltaY,
                  state.aspectRatio
                )
              : resizeFrame(state.originFrame, state.handle, deltaX, deltaY)
            frame = clampFrameToCanvas(frame)
          }
        }
      }

      // Immediately lock in the current selection so toolbar/handles never flicker.
      setSelectedItemId(state.itemId)
      setToolbarAnchorId(state.itemId)

      if (frame) {
        if (state.target === 'crop' && state.frameBounds && state.sourceBounds) {
          const crop = overlayFrameToCrop(state.frameBounds, frame, state.sourceBounds)
          const bounded = clampCropToBounds(crop, state.sourceBounds)
          const cropFrame: LayoutFrame = {
            x: bounded.x,
            y: bounded.y,
            width: bounded.width,
            height: bounded.height
          }
          scheduleTransform([{ itemId: state.itemId, frame: cropFrame }], { commit: false })
        } else {
          const snapped = applyGuides(frame, {
            snapEnabled: state.target === 'frame' && state.snapEnabled,
            aspectLocked: state.aspectLocked,
            aspectRatio: state.aspectRatio,
            handle: state.handle
          })
          scheduleTransform([{ itemId: state.itemId, frame: snapped }], { commit: true })
        }
      }

      // Ensure the post-pointerup synthetic 'click' doesn't bubble and clear selection
      suppressNextClickRef.current = true
      dragEndedRef.current = true
      persistSelectionIdRef.current = state.itemId
      if (persistSelectionTimerRef.current) {
        window.clearTimeout(persistSelectionTimerRef.current)
      }
      persistSelectionTimerRef.current = window.setTimeout(() => {
        if (persistSelectionIdRef.current === state.itemId) {
          persistSelectionIdRef.current = null
        }
        persistSelectionTimerRef.current = null
      }, 200)

      // Prevent the pointerup from bubbling to any parent click handlers
      // Do NOT set justSelectedRef.current here, so that selection persists after drag/move/resize
      event.preventDefault()
      event.stopPropagation()

      // Always end interaction but KEEP selection active.
      clearInteraction({ preserveAnimation: true })
      commitHover({ itemId: state.itemId, handle: null }, 'grab')
    },
    [
      applyGuides,
      clearInteraction,
      commitHover,
      getPointerPosition,
      layout,
      scheduleTransform,
      selectedItemId
    ]
  )

  const handlePointerLeave = useCallback(() => {
    if (interactionRef.current) {
      return
    }
    clearHover()
  }, [clearHover])

  const handlePointerCancel = useCallback(
    (_event: ReactPointerEvent<HTMLDivElement>) => {
      clearInteraction()
      clearHover()
    },
    [clearHover, clearInteraction]
  )

  const handleItemContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, item: LayoutItem) => {
      if (!enableScaleModeMenu || !onRequestChangeScaleMode) {
        return
      }
      if ((item as LayoutVideoItem).kind !== 'video') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const video = item as LayoutVideoItem
      if (selectedItemId !== video.id) {
        setSelectedItemId(video.id)
      }
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0
      const menuWidth = 220
      const menuHeight = 120
      const safeX = viewportWidth ? Math.min(event.clientX, Math.max(0, viewportWidth - menuWidth)) : event.clientX
      const safeY = viewportHeight
        ? Math.min(event.clientY, Math.max(0, viewportHeight - menuHeight))
        : event.clientY
      setContextMenu({ x: safeX, y: safeY, itemId: video.id })
    },
    [enableScaleModeMenu, onRequestChangeScaleMode, selectedItemId, setSelectedItemId]
  )

  const handles: Array<{ id: ResizeHandle; positionClass: string; label: string }> = useMemo(
    () => [
      { id: 'nw', positionClass: '-left-2 -top-2', label: 'Resize north-west' },
      { id: 'ne', positionClass: '-right-2 -top-2', label: 'Resize north-east' },
      { id: 'sw', positionClass: '-left-2 -bottom-2', label: 'Resize south-west' },
      { id: 'se', positionClass: '-right-2 -bottom-2', label: 'Resize south-east' },
      {
        id: 'n',
        positionClass: 'left-1/2 -top-2 -translate-x-1/2',
        label: 'Resize north'
      },
      {
        id: 's',
        positionClass: 'left-1/2 -bottom-2 -translate-x-1/2',
        label: 'Resize south'
      },
      {
        id: 'e',
        positionClass: '-right-2 top-1/2 -translate-y-1/2',
        label: 'Resize east'
      },
      {
        id: 'w',
        positionClass: '-left-2 top-1/2 -translate-y-1/2',
        label: 'Resize west'
      }
    ],
    []
  )

  const cropHandlePlacements: Record<ResizeHandle, { left: string; top: string; transform: string }> = useMemo(
    () => ({
      nw: { left: '0%', top: '0%', transform: 'translate(-50%, -50%)' },
      ne: { left: '100%', top: '0%', transform: 'translate(-50%, -50%)' },
      sw: { left: '0%', top: '100%', transform: 'translate(-50%, -50%)' },
      se: { left: '100%', top: '100%', transform: 'translate(-50%, -50%)' },
      n: { left: '50%', top: '0%', transform: 'translate(-50%, -50%)' },
      s: { left: '50%', top: '100%', transform: 'translate(-50%, -50%)' },
      e: { left: '100%', top: '50%', transform: 'translate(-50%, -50%)' },
      w: { left: '0%', top: '50%', transform: 'translate(-50%, -50%)' }
    }),
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

  useEffect(() => {
    if (!contextMenu) {
      return
    }
    if (!selectedItemId || contextMenu.itemId !== selectedItemId) {
      setContextMenu(null)
    }
  }, [contextMenu, selectedItemId])

  useEffect(() => {
    if (!selectedItemId) {
      cycleRef.current = null
    }
  }, [selectedItemId])

  useEffect(() => {
    cycleRef.current = null
  }, [layout])

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      const active = interactionRef.current
      if (active) {
        try {
          containerRef.current?.releasePointerCapture(active.pointerId)
        } catch {
          // Ignore release errors triggered by teardown
        }
      }
      interactionRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) {
      return
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu(null)
      }
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-layout-context-menu="true"]')) {
        return
      }
      setContextMenu(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [contextMenu])

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

  const primaryIsVideo = Boolean(
    activeSelection && (activeSelection as LayoutVideoItem).kind === 'video'
  )
  const primaryVideo = primaryIsVideo ? (activeSelection as LayoutVideoItem) : null
  const showToolbar = Boolean(activeSelection && toolbarAnchorId === activeSelection.id)

  const toolbarActions = useMemo<LayoutItemToolbarAction[]>(() => {
    const actions: LayoutItemToolbarAction[] = []

    if (primaryIsVideo && onRequestChangeTransformTarget) {
      if (transformTarget === 'crop') {
        actions.push({
          key: 'finish-crop',
          label: 'Finish crop',
          icon: <CropConfirmIcon />,
          onSelect: () => {
            onRequestFinishCrop?.()
          }
        })
      } else {
        actions.push({
          key: 'toggle-crop',
          label: 'Crop video',
          icon: <CropModeIcon />,
          onSelect: () => onRequestChangeTransformTarget('crop')
        })
      }
    }

    if (primaryVideo && onRequestToggleAspectLock) {
      const isCropTarget = transformTarget === 'crop'
      const locked = isCropTarget
        ? Boolean(primaryVideo.lockCropAspectRatio)
        : Boolean(primaryVideo.lockAspectRatio)
      const label = isCropTarget
        ? locked
          ? 'Unlock crop aspect (freeform)'
          : 'Lock crop aspect (preserve ratio)'
        : locked
          ? 'Unlock frame aspect (freeform)'
          : 'Lock frame aspect (preserve ratio)'
      const context = cropContext ?? 'layout'
      actions.push({
        key: `toggle-${isCropTarget ? 'crop' : 'frame'}-aspect-lock`,
        label,
        icon: locked ? <LockIcon /> : <UnlockIcon />,
        onSelect: () => onRequestToggleAspectLock(isCropTarget ? 'crop' : 'frame', context)
      })
    }

    actions.push({
      key: 'reset-aspect',
      label: cropContext === 'source' ? 'Reset to video aspect' : 'Match source frame aspect',
      icon: <AspectResetIcon />,
      onSelect:
        primaryIsVideo && onRequestResetAspect
          ? () => onRequestResetAspect(transformTarget, cropContext)
          : undefined,
      disabled: !primaryIsVideo || !onRequestResetAspect
    })

    actions.push(
      {
        key: 'bring-forward',
        label: 'Bring forward',
        icon: <BringForwardIcon />,
        onSelect: onRequestBringForward
      },
      {
        key: 'send-backward',
        label: 'Send backward',
        icon: <SendBackwardIcon />,
        onSelect: onRequestSendBackward
      },
      {
        key: 'duplicate',
        label: 'Duplicate',
        icon: <DuplicateIcon />,
        onSelect: onRequestDuplicate
      },
      {
        key: 'remove',
        label: 'Remove',
        icon: <RemoveIcon />,
        onSelect: onRequestDelete
      }
    )

    return actions
  }, [
    cropContext,
    onRequestBringForward,
    onRequestChangeTransformTarget,
    onRequestDelete,
    onRequestDuplicate,
    onRequestResetAspect,
    onRequestSendBackward,
    onRequestToggleAspectLock,
    primaryIsVideo,
    primaryVideo,
    transformTarget
  ])

  const stopPointerPropagation = useCallback((event: ReactPointerEvent<HTMLElement>) => {
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
        'relative max-w-full overflow-visible rounded-none border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_68%,transparent)] p-3',
        className
      ]
        .filter(Boolean)
        .join(' '),
    [className]
  )

  const interactionClassName =
    'relative h-full w-full select-none text-[var(--fg)] touch-none'

  const outerStyle: CSSProperties = useMemo(() => {
    const base: CSSProperties = { ...(style ?? {}) }
    const hasExplicitWidth = base.width != null
    const hasExplicitHeight = base.height != null
    if (!hasExplicitWidth || !hasExplicitHeight) {
      base.aspectRatio = aspectRatio > 0 ? `${aspectRatio}` : '9 / 16'
    }
    return base
  }, [aspectRatio, style])

  const interactionStyle = useMemo<CSSProperties>(() => ({ cursor }), [cursor])

  const handleSuppressedClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressNextClickRef.current || justSelectedRef.current) {
      event.preventDefault()
      event.stopPropagation()
      justSelectedRef.current = false
      suppressNextClickRef.current = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (persistSelectionTimerRef.current) {
        window.clearTimeout(persistSelectionTimerRef.current)
        persistSelectionTimerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    const targetId = persistSelectionIdRef.current
    if (!targetId) {
      return
    }
    const isValid = Boolean(layout?.items.some((item) => item.id === targetId))
    if (!isValid) {
      persistSelectionIdRef.current = null
      return
    }
    if (selectedItemId !== targetId) {
      setSelectedItemId(targetId)
      setToolbarAnchorId(targetId)
    }
  }, [layout, selectedItemId, setSelectedItemId, setToolbarAnchorId])

  const handleClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const targetElement = event.target as HTMLElement | null
      if (targetElement?.closest('[data-layout-item-toolbar="true"]')) {
        justSelectedRef.current = false
        suppressNextClickRef.current = false
        dragEndedRef.current = false
        return
      }
      if (dragEndedRef.current) {
        event.preventDefault()
        event.stopPropagation()
        dragEndedRef.current = false
        justSelectedRef.current = false
        suppressNextClickRef.current = false
        return
      }
      handleSuppressedClick(event)
    },
    [handleSuppressedClick]
  )

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const targetElement = event.target as HTMLElement | null
      if (targetElement?.closest('[data-layout-item-toolbar="true"]')) {
        justSelectedRef.current = false
        suppressNextClickRef.current = false
        dragEndedRef.current = false
        return
      }
      handleSuppressedClick(event)
    },
    [handleSuppressedClick]
  )

  return (
    <div className={canvasClassName} style={outerStyle}>
      <div
        ref={containerRef}
        className={interactionClassName}
        style={interactionStyle}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        onClickCapture={handleClickCapture}
        onClick={handleClick}
        onContextMenu={(event) => event.preventDefault()}
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
          <div className="pointer-events-none absolute inset-[8%] rounded-none border-2 border-dashed border-[color:color-mix(in_srgb,var(--accent)_55%,transparent)]" />
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
        const isHovered = hoverTarget.itemId === item.id
        const showHandles = isSelected || isHovered
        const label = getItemLabel(item)
        const palette = getItemAppearance(item, colorScheme)
        const videoItem = (item as LayoutVideoItem).kind === 'video' ? (item as LayoutVideoItem) : null
        const itemAspectLocked = videoItem
          ? transformTarget === 'crop'
            ? Boolean(videoItem.lockCropAspectRatio)
            : Boolean(videoItem.lockAspectRatio)
          : false
        const interactiveFrame =
          transformTarget === 'crop' && cropContext === 'source' && videoItem
            ? cloneFrame(videoItem.frame)
            : frame
        const interactiveCenterX = clamp(
          interactiveFrame.x + interactiveFrame.width / 2
        )
        const interactiveCenterY = clamp(
          interactiveFrame.y + interactiveFrame.height / 2
        )
        const classes = getItemClasses ? getItemClasses(item, isSelected) : ''
        const shouldShowLabel =
          labelVisibility === 'always' || (labelVisibility === 'selected' && isSelected)
        const editable = itemIsEditable(item)
        const pendingCrop = videoItem ? getPendingCrop?.(videoItem.id, cropContext) : null
        const cropOverlayRect =
          isPrimarySelection && transformTarget === 'crop' && videoItem
            ? getCropOverlayRect(
                videoItem,
                cropContext,
                pendingCrop ? clampCropFrame(pendingCrop) : null
              )
            : null
        const overlayLeftPercent = cropOverlayRect ? fractionToPercent(Math.max(0, cropOverlayRect.left)) : null
        const overlayTopPercent = cropOverlayRect ? fractionToPercent(Math.max(0, cropOverlayRect.top)) : null
        const overlayWidthPercent = cropOverlayRect
          ? fractionToPercent(Math.max(0, Math.min(1, cropOverlayRect.width)))
          : null
        const overlayHeightPercent = cropOverlayRect
          ? fractionToPercent(Math.max(0, Math.min(1, cropOverlayRect.height)))
          : null
        const overlayRightPercent = cropOverlayRect
          ? fractionToPercent(
              Math.max(0, 1 - Math.max(0, cropOverlayRect.left) - Math.max(0, cropOverlayRect.width))
            )
          : null
        const overlayBottomPercent = cropOverlayRect
          ? fractionToPercent(
              Math.max(0, 1 - Math.max(0, cropOverlayRect.top) - Math.max(0, cropOverlayRect.height))
            )
          : null
        const overlayRightStartPercent = cropOverlayRect
          ? fractionToPercent(Math.max(0, Math.min(1, cropOverlayRect.left + cropOverlayRect.width)))
          : null
        const overlayBottomStartPercent = cropOverlayRect
          ? fractionToPercent(Math.max(0, Math.min(1, cropOverlayRect.top + cropOverlayRect.height)))
          : null
        const overlayShadeColor = 'rgba(15,23,42,0.45)'
        const borderColor = isSelected
          ? palette.borderColor
          : isHovered
            ? mixHexColors(
                palette.borderColor,
                colorScheme === 'dark' ? '#ffffff' : '#000000',
                0.35
              )
            : 'transparent'
        const handleIsActive = hoverTarget.itemId === item.id && Boolean(hoverTarget.handle)
        const handleOpacityClass = isSelected
          ? 'opacity-100'
          : handleIsActive
            ? 'opacity-70'
            : isHovered
              ? 'opacity-30'
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
                borderWidth: isSelected ? '3px' : '1px',
                borderStyle: isPrimarySelection && transformTarget === 'crop' ? 'dashed' : 'solid',
                opacity: isSelected || isHovered ? 1 : 0.9,
                '--ring': ringColor
              } as CSSWithVars
            }
            role="group"
            aria-label={label}
            data-item-id={item.id}
            data-interactive-center-x={interactiveCenterX}
            data-interactive-center-y={interactiveCenterY}
            data-interactive-width={clamp(interactiveFrame.width)}
            data-interactive-height={clamp(interactiveFrame.height)}
            onPointerDown={stopPointerPropagation}
            onContextMenu={(event) => handleItemContextMenu(event, item)}
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
            {isPrimarySelection ? (
              <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-[color:color-mix(in_srgb,var(--panel)_85%,transparent)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--fg)] shadow-[0_2px_8px_rgba(15,23,42,0.25)]">
                {transformTarget === 'crop' ? 'Crop' : 'Frame'}
              </div>
            ) : null}
            {cropOverlayRect ? (
              <div className="pointer-events-none absolute inset-0">
                <div className="pointer-events-none absolute inset-0">
                  <div
                    className="absolute left-0 top-0 w-full"
                    style={{ height: overlayTopPercent ?? '0%', backgroundColor: overlayShadeColor }}
                  />
                  <div
                    className="absolute"
                    style={{
                      top: overlayTopPercent ?? '0%',
                      left: '0%',
                      width: overlayLeftPercent ?? '0%',
                      height: overlayHeightPercent ?? '100%',
                      backgroundColor: overlayShadeColor
                    }}
                  />
                  <div
                    className="absolute"
                    style={{
                      top: overlayTopPercent ?? '0%',
                      left: overlayRightStartPercent ?? '100%',
                      width: overlayRightPercent ?? '0%',
                      height: overlayHeightPercent ?? '100%',
                      backgroundColor: overlayShadeColor
                    }}
                  />
                  <div
                    className="absolute left-0 w-full"
                    style={{
                      top: overlayBottomStartPercent ?? '100%',
                      height: overlayBottomPercent ?? '0%',
                      backgroundColor: overlayShadeColor
                    }}
                  />
                </div>
                <div
                  className="absolute"
                  style={{
                    left: overlayLeftPercent ?? '0%',
                    top: overlayTopPercent ?? '0%',
                    width: overlayWidthPercent ?? '100%',
                    height: overlayHeightPercent ?? '100%'
                  }}
                >
                  <div className="pointer-events-none absolute inset-0 rounded-none border-2 border-dashed border-[color:color-mix(in_srgb,var(--ring)_80%,transparent)]" />
                  {editable
                    ? handles.map((handle) => {
                        const placement = cropHandlePlacements[handle.id]
                        if (!placement) {
                          return null
                        }
                        const cursorName = cursorForHandle(handle.id, itemAspectLocked)
                        const cursorClass = cursorName === 'default' ? 'cursor-default' : `cursor-${cursorName}`
                        return (
                          <button
                            key={`crop-${handle.id}`}
                            type="button"
                            tabIndex={-1}
                            aria-label={handle.label}
                            data-handle={handle.id}
                            data-item-id={item.id}
                            className={`absolute h-3 w-3 rounded-none border-2 border-dashed text-transparent transition pointer-events-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${cursorClass}`}
                            style={
                              {
                                left: placement.left,
                                top: placement.top,
                                transform: placement.transform,
                                backgroundColor: palette.handleBackgroundColor,
                                borderColor: palette.handleBorderColor,
                                '--ring': ringColor
                              } as CSSWithVars
                            }
                            onPointerDown={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                            }}
                          >
                            •
                          </button>
                        )
                      })
                    : null}
                </div>
              </div>
            ) : null}
            {editable && !cropOverlayRect
              ? handles.map((handle) => {
                  const cursorName = cursorForHandle(handle.id, itemAspectLocked)
                  const cursorClass =
                    cursorName === 'default' ? 'cursor-default' : `cursor-${cursorName}`
                  const sizeClass = transformTarget === 'crop' ? 'h-3 w-3 rotate-45' : 'h-4 w-4'
                  const borderStyleClass = transformTarget === 'crop' ? 'border-dashed' : 'border-solid'
                  return (
                    <button
                      key={handle.id}
                      type="button"
                      tabIndex={-1}
                      aria-label={handle.label}
                      data-handle={handle.id}
                      data-item-id={item.id}
                      className={`absolute ${sizeClass} rounded-none border-2 ${borderStyleClass} text-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] hover:bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] ${handle.positionClass} ${cursorClass} ${handleOpacityClass} ${handlePointerClass}`}
                      onPointerDown={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
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
                  )
                })
              : null}
            {isPrimarySelection && showToolbar ? (
              <LayoutItemToolbar actions={toolbarActions} ringColor={ringColor} />
            ) : null}
          </div>
        )
      })}
      {contextMenu && enableScaleModeMenu && activeSelection && (activeSelection as LayoutVideoItem).kind === 'video' ? (
        <div
          data-layout-context-menu="true"
          className="fixed z-[1000] min-w-[220px] rounded-lg border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_94%,transparent)] p-1 shadow-[0_12px_28px_rgba(15,23,42,0.4)]"
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
        >
          <div className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
            Display mode
          </div>
          {(
            [
              { mode: 'cover' as LayoutVideoItem['scaleMode'], label: 'Auto crop to fill', description: 'Crop video to match the frame' },
              { mode: 'fill' as LayoutVideoItem['scaleMode'], label: 'Stretch to frame', description: 'Stretch without cropping' }
            ] as const
          ).map((option) => {
            const video = activeSelection as LayoutVideoItem
            const currentMode = video.scaleMode ?? 'cover'
            const isActive = currentMode === option.mode || (option.mode === 'cover' && currentMode == null)
            return (
              <button
                key={option.mode}
                type="button"
                className={`flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                  isActive
                    ? 'bg-[color:color-mix(in_srgb,var(--accent-soft)_85%,transparent)] text-[var(--fg)]'
                    : 'text-[color:color-mix(in_srgb,var(--muted)_90%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--panel)_88%,transparent)]'
                }`}
                onClick={() => {
                  onRequestChangeScaleMode?.(video.id, option.mode)
                  setContextMenu(null)
                }}
              >
                <span className="flex w-full items-center justify-between">
                  <span>{option.label}</span>
                  {isActive ? (
                    <span className="text-xs font-medium text-[color:var(--ring)]">Active</span>
                  ) : null}
                </span>
                <span className="text-[11px] text-[color:color-mix(in_srgb,var(--muted)_80%,transparent)]">
                  {option.description}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
      {selectionBounds ? (
        <div
          className="pointer-events-none absolute z-30 rounded-none border-[4px]"
          data-testid="selection-outline"
          style={{
            left: fractionToPercent(selectionBounds.x),
            top: fractionToPercent(selectionBounds.y),
            width: fractionToPercent(selectionBounds.width),
            height: fractionToPercent(selectionBounds.height),
            borderColor: selectionOutlineColor,
            borderStyle: transformTarget === 'crop' ? 'dashed' : 'solid'
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
      </div>
    </div>
  )
}

export default LayoutCanvas
