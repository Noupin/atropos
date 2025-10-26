import type { ChangeEvent, FC, FormEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LayoutCollection } from '../../../../types/api'
import type {
  LayoutBackground,
  LayoutCategory,
  LayoutCrop,
  LayoutDefinition,
  LayoutFrame,
  LayoutItem,
  LayoutShapeItem,
  LayoutTextItem,
  LayoutVideoItem
} from '../../../../types/layouts'
import type { Clip } from '../../types'
import LayoutCanvas from './LayoutCanvas'
import LayoutCompositionSurface from './LayoutCompositionSurface'
import { useLayoutSelection } from './layoutSelectionStore'
import { resolveOriginalSource } from '../../services/preview/adjustedPreview'

type PipelineStepStatus = 'pending' | 'running' | 'completed' | 'failed'

type PipelineStepState = {
  id: string
  label: string
  description: string
  status: PipelineStepStatus
}

type LayoutReference = {
  id: string
  category: LayoutCategory | null
}

type LayoutEditorPanelProps = {
  tabNavigation: ReactNode
  clip: Clip | null
  layoutCollection: LayoutCollection | null
  isCollectionLoading: boolean
  selectedLayout: LayoutDefinition | null
  selectedLayoutReference: LayoutReference | null
  isLayoutLoading: boolean
  appliedLayoutId: string | null
  isSavingLayout: boolean
  isApplyingLayout: boolean
  statusMessage: string | null
  errorMessage: string | null
  onSelectLayout: (id: string, category: LayoutCategory) => void
  onCreateBlankLayout: () => void
  onLayoutChange: (layout: LayoutDefinition) => void
  onSaveLayout: (
    layout: LayoutDefinition,
    options?: { originalId?: string | null; originalCategory?: LayoutCategory | null }
  ) => Promise<LayoutDefinition>
  onImportLayout: () => Promise<void>
  onExportLayout: (id: string, category: LayoutCategory) => Promise<void>
  onApplyLayout: (layout: LayoutDefinition) => Promise<void>
  onRenderLayout: (layout: LayoutDefinition) => Promise<void>
  renderSteps: PipelineStepState[]
  isRenderingLayout: boolean
  renderStatusMessage: string | null
  renderErrorMessage: string | null
}

type UpdateOptions = {
  transient?: boolean
  emitChange?: boolean
  trackHistory?: boolean
}

type PreviewKind = 'source' | 'layout'

type SourceMediaState = {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error'
  url: string | null
  message: string | null
}

type PreviewSize = {
  width: number
  height: number
}

const usePreviewSize = (
  element: HTMLElement | null,
  aspectRatio: number,
  targetHeight: number
): PreviewSize => {
  const [size, setSize] = useState<PreviewSize>({ width: 0, height: 0 })

  const recompute = useCallback(() => {
    if (!element || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
      setSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
      return
    }

    const rect = element.getBoundingClientRect()
    const containerWidth = rect.width || element.clientWidth || 0
    const containerHeight = rect.height || element.clientHeight || 0
    const maxHeight = targetHeight > 0 ? targetHeight : containerHeight
    const limitedHeight = containerHeight > 0 ? Math.min(containerHeight, Math.max(maxHeight, 0)) : Math.max(maxHeight, 0)

    let height = limitedHeight > 0 ? limitedHeight : targetHeight
    if (!Number.isFinite(height) || height <= 0) {
      height = targetHeight
    }

    if (!Number.isFinite(height) || height <= 0) {
      setSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
      return
    }

    let width = height * aspectRatio
    const widthLimit = containerWidth > 0 ? containerWidth : width

    if (width > widthLimit && widthLimit > 0) {
      width = widthLimit
      height = width / aspectRatio
    }

    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      setSize((prev) => (prev.width === 0 && prev.height === 0 ? prev : { width: 0, height: 0 }))
      return
    }

    setSize((prev) => {
      if (Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5) {
        return prev
      }
      return { width, height }
    })
  }, [aspectRatio, element, targetHeight])

  useEffect(() => {
    recompute()
  }, [recompute])

  useEffect(() => {
    if (!element) {
      return
    }
    if (typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => {
      recompute()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [element, recompute])

  return size
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(Math.max(value, min), max)

const createDefaultCrop = (): LayoutCrop => ({ x: 0, y: 0, width: 1, height: 1, units: 'fraction' })

const normaliseVideoCrop = (crop: LayoutCrop | null | undefined): LayoutCrop => ({
  x: clamp(crop?.x ?? 0),
  y: clamp(crop?.y ?? 0),
  width: clamp(crop?.width ?? 1),
  height: clamp(crop?.height ?? 1),
  units: 'fraction'
})

const clampCropToBounds = (crop: LayoutCrop, bounds: LayoutCrop): LayoutCrop => {
  const base = normaliseVideoCrop(bounds)
  const maxX = clamp(base.x + base.width)
  const maxY = clamp(base.y + base.height)
  let width = clamp(crop.width)
  let height = clamp(crop.height)
  const maxWidth = clamp(maxX - base.x)
  const maxHeight = clamp(maxY - base.y)
  width = clamp(Math.min(width, maxWidth))
  height = clamp(Math.min(height, maxHeight))
  let x = clamp(crop.x)
  let y = clamp(crop.y)
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
  return { x, y, width, height, units: 'fraction' }
}

const normaliseSourceCrop = (video: LayoutVideoItem): LayoutCrop => {
  const base = video.sourceCrop ?? createDefaultCrop()
  return normaliseVideoCrop(base)
}

const alignCropToFrame = (video: LayoutVideoItem): LayoutCrop => {
  const crop = normaliseVideoCrop(video.crop)
  const frameWidth = clamp(video.frame.width)
  const frameHeight = clamp(video.frame.height)
  if (frameWidth <= 0 || frameHeight <= 0) {
    return crop
  }
  const targetAspect = frameWidth / frameHeight
  if (!Number.isFinite(targetAspect) || targetAspect <= 0) {
    return crop
  }

  let width = clamp(crop.width)
  let height = clamp(crop.height)
  if (width <= 0 || height <= 0) {
    return { x: clamp(crop.x), y: clamp(crop.y), width: clamp(width), height: clamp(height), units: 'fraction' }
  }

  const currentAspect = width / height
  if (Math.abs(currentAspect - targetAspect) < 0.0001) {
    return { x: clamp(crop.x), y: clamp(crop.y), width, height, units: 'fraction' }
  }

  if (currentAspect > targetAspect) {
    width = height * targetAspect
  } else {
    height = width / targetAspect
  }

  const scale = Math.min(1, width > 0 ? 1 / width : 1, height > 0 ? 1 / height : 1)
  width *= scale
  height *= scale

  const centerX = clamp(crop.x + crop.width / 2)
  const centerY = clamp(crop.y + crop.height / 2)
  let x = centerX - width / 2
  let y = centerY - height / 2

  if (x < 0) {
    x = 0
  }
  if (y < 0) {
    y = 0
  }
  if (x + width > 1) {
    x = 1 - width
  }
  if (y + height > 1) {
    y = 1 - height
  }

  return { x: clamp(x), y: clamp(y), width: clamp(width), height: clamp(height), units: 'fraction' }
}

const snapFrameToAspect = (frame: LayoutFrame, aspect: number): LayoutFrame => {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return clampFrame(frame)
  }
  const width = clamp(frame.width)
  const height = clamp(frame.height)
  if (width <= 0 || height <= 0) {
    return clampFrame(frame)
  }
  const currentAspect = width / Math.max(height, 0.0001)
  if (Math.abs(currentAspect - aspect) < 0.0001) {
    return clampFrame(frame)
  }
  let nextWidth = width
  let nextHeight = height
  if (currentAspect > aspect) {
    nextWidth = Math.min(width, height * aspect)
    nextHeight = nextWidth / aspect
  } else {
    nextHeight = Math.min(height, width / aspect)
    nextWidth = nextHeight * aspect
  }
  nextWidth = clamp(nextWidth)
  nextHeight = clamp(nextHeight)
  const centerX = clamp(frame.x + width / 2)
  const centerY = clamp(frame.y + height / 2)
  let nextX = clamp(centerX - nextWidth / 2)
  let nextY = clamp(centerY - nextHeight / 2)
  if (nextX + nextWidth > 1) {
    nextX = clamp(1 - nextWidth)
  }
  if (nextY + nextHeight > 1) {
    nextY = clamp(1 - nextHeight)
  }
  return {
    x: clamp(nextX),
    y: clamp(nextY),
    width: clamp(nextWidth),
    height: clamp(nextHeight)
  }
}

const snapCropToAspect = (crop: LayoutCrop, aspect: number): LayoutCrop => {
  if (!Number.isFinite(aspect) || aspect <= 0) {
    return clampCropFrame(crop)
  }
  const normalised = clampCropFrame(crop)
  const width = normalised.width
  const height = normalised.height
  if (width <= 0 || height <= 0) {
    return normalised
  }
  const currentAspect = width / Math.max(height, 0.0001)
  if (Math.abs(currentAspect - aspect) < 0.0001) {
    return normalised
  }
  let nextWidth = width
  let nextHeight = height
  if (currentAspect > aspect) {
    nextWidth = Math.min(width, height * aspect)
    nextHeight = nextWidth / aspect
  } else {
    nextHeight = Math.min(height, width / aspect)
    nextWidth = nextHeight * aspect
  }
  nextWidth = clamp(nextWidth)
  nextHeight = clamp(nextHeight)
  const centerX = clamp(normalised.x + width / 2)
  const centerY = clamp(normalised.y + height / 2)
  let nextX = clamp(centerX - nextWidth / 2)
  let nextY = clamp(centerY - nextHeight / 2)
  if (nextX + nextWidth > 1) {
    nextX = clamp(1 - nextWidth)
  }
  if (nextY + nextHeight > 1) {
    nextY = clamp(1 - nextHeight)
  }
  return {
    x: clamp(nextX),
    y: clamp(nextY),
    width: clamp(nextWidth),
    height: clamp(nextHeight),
    units: 'fraction'
  }
}

const getFrameAspectRatio = (frame: LayoutFrame): number | null => {
  const width = clamp(frame.width)
  const height = clamp(frame.height)
  if (width <= 0 || height <= 0) {
    return null
  }
  return width / Math.max(height, 0.0001)
}

const getCropAspectRatio = (crop: LayoutCrop): number | null => {
  const width = clamp(crop.width)
  const height = clamp(crop.height)
  if (width <= 0 || height <= 0) {
    return null
  }
  return width / Math.max(height, 0.0001)
}

const cloneLayoutItem = (item: LayoutItem): LayoutItem => {
  if ((item as LayoutVideoItem).kind === 'video') {
    const video = item as LayoutVideoItem
    const sourceCrop = normaliseSourceCrop(video)
    const normalisedCrop = clampCropToBounds(normaliseVideoCrop(video.crop), sourceCrop)
    const lockAspectRatio = video.lockAspectRatio ?? true
    const lockCropAspectRatio = video.lockCropAspectRatio ?? true
    const frameWidth = clamp(video.frame.width)
    const frameHeight = clamp(video.frame.height)
    const derivedFrameAspect =
      frameWidth > 0 && frameHeight > 0 ? frameWidth / Math.max(frameHeight, 0.0001) : null
    const cropWidth = clamp(normalisedCrop.width)
    const cropHeight = clamp(normalisedCrop.height)
    const derivedCropAspect =
      cropWidth > 0 && cropHeight > 0 ? cropWidth / Math.max(cropHeight, 0.0001) : null
    const base: LayoutVideoItem = {
      ...video,
      frame: { ...video.frame },
      crop: normalisedCrop,
      sourceCrop,
      lockAspectRatio,
      lockCropAspectRatio,
      frameAspectRatio:
        video.frameAspectRatio != null && Number.isFinite(video.frameAspectRatio)
          ? video.frameAspectRatio
          : lockAspectRatio
            ? derivedFrameAspect
            : null,
      cropAspectRatio:
        video.cropAspectRatio != null && Number.isFinite(video.cropAspectRatio)
          ? video.cropAspectRatio
          : lockCropAspectRatio
            ? derivedCropAspect ?? 1
            : null
    }
    if (lockAspectRatio || lockCropAspectRatio) {
      const alignedCrop = alignCropToFrame({ ...base, crop: normalisedCrop })
      const alignedAspect =
        alignedCrop.width > 0 && alignedCrop.height > 0
          ? alignedCrop.width / Math.max(alignedCrop.height, 0.0001)
          : null
      return {
        ...base,
        crop: alignedCrop,
        cropAspectRatio:
          base.lockCropAspectRatio === false
            ? base.cropAspectRatio ?? null
            : alignedAspect ?? base.cropAspectRatio ?? (derivedCropAspect ?? 1)
      }
    }
    return base
  }
  if ((item as LayoutTextItem).kind === 'text') {
    const text = item as LayoutTextItem
    return {
      ...text,
      frame: { ...text.frame }
    }
  }
  const shape = item as LayoutShapeItem
  return {
    ...shape,
    frame: { ...shape.frame }
  }
}

const cloneLayout = (layout: LayoutDefinition): LayoutDefinition => ({
  ...layout,
  canvas: {
    ...layout.canvas,
    background: { ...layout.canvas.background }
  },
  captionArea: layout.captionArea ? { ...layout.captionArea } : null,
  items: layout.items.map((item) => cloneLayoutItem(item))
})

const createItemId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.round(Math.random() * 999)}`

const createDefaultLayout = (): LayoutDefinition => ({
  id: 'untitled-layout',
  name: 'Untitled layout',
  version: 1,
  description: null,
  author: null,
  tags: [],
  category: 'custom',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  canvas: {
    width: 1080,
    height: 1920,
    background: { kind: 'blur', radius: 45, opacity: 0.6, brightness: 0.55 }
  },
  captionArea: null,
  items: []
})

const getBackgroundDefaults = (kind: LayoutBackground['kind']): LayoutBackground => {
  if (kind === 'color') {
    return { kind: 'color', color: '#000000', opacity: 1 }
  }
  if (kind === 'image') {
    return { kind: 'image', source: '', mode: 'cover', tint: null }
  }
  return { kind: 'blur', radius: 45, opacity: 0.6, brightness: 0.55 }
}

const isInputTarget = (element: EventTarget | null): boolean => {
  if (!(element instanceof HTMLElement)) {
    return false
  }
  const tagName = element.tagName.toLowerCase()
  return ['input', 'textarea', 'select', 'button'].includes(tagName) || element.isContentEditable
}

const clampFrame = (frame: LayoutFrame): LayoutFrame => ({
  x: clamp(frame.x),
  y: clamp(frame.y),
  width: clamp(frame.width),
  height: clamp(frame.height)
})

const clampCropFrame = (frame: LayoutFrame): LayoutCrop => ({
  x: clamp(frame.x),
  y: clamp(frame.y),
  width: clamp(frame.width),
  height: clamp(frame.height),
  units: 'fraction'
})

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`

const formatTimecode = (value: number): string => {
  if (!Number.isFinite(value)) {
    return '0:00'
  }
  const total = Math.max(0, value)
  const minutes = Math.floor(total / 60)
  const seconds = Math.floor(total % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const CollapseToggleIcon: FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg
    viewBox="0 0 20 20"
    aria-hidden="true"
    className="h-4 w-4 text-[var(--fg)]"
    focusable="false"
  >
    <path d="M6 3v14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    {collapsed ? (
      <path d="M9 10 13.5 6.5v7L9 10Z" fill="currentColor" />
    ) : (
      <path d="M11 6.5 6.5 10 11 13.5v-7Z" fill="currentColor" />
    )}
  </svg>
)

const LayoutEditorPanel: FC<LayoutEditorPanelProps> = ({
  tabNavigation,
  clip,
  layoutCollection,
  isCollectionLoading,
  selectedLayout,
  selectedLayoutReference,
  isLayoutLoading,
  appliedLayoutId,
  isSavingLayout,
  isApplyingLayout,
  statusMessage,
  errorMessage,
  onSelectLayout,
  onCreateBlankLayout,
  onLayoutChange,
  onSaveLayout,
  onImportLayout,
  onExportLayout,
  onApplyLayout,
  onRenderLayout,
  renderSteps,
  isRenderingLayout,
  renderStatusMessage,
  renderErrorMessage
}) => {
  const [draftLayout, setDraftLayout] = useState<LayoutDefinition | null>(null)
  const [selectedItemId, setSelectedItemId] = useLayoutSelection()
  const [history, setHistory] = useState<LayoutDefinition[]>([])
  const [future, setFuture] = useState<LayoutDefinition[]>([])
  const [clipboard, setClipboard] = useState<LayoutItem[] | null>(null)
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [layoutTransformTarget, setLayoutTransformTarget] = useState<'frame' | 'crop'>('frame')
  const [showSafeMargins, setShowSafeMargins] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<LayoutCategory, boolean>>({
    builtin: false,
    custom: false
  })
  const sourceVideoRef = useRef<HTMLVideoElement | null>(null)
  const layoutVideoRef = useRef<HTMLVideoElement | null>(null)
  const playbackSyncRef = useRef(false)
  const skipSelectionResetRef = useRef(false)
  const lastLoadedLayoutIdRef = useRef<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [sourceMedia, setSourceMedia] = useState<SourceMediaState>({
    status: 'idle',
    url: null,
    message: null
  })
  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window !== 'undefined' && Number.isFinite(window.innerHeight) ? window.innerHeight : 900
  )
  const [sourceContainer, setSourceContainer] = useState<HTMLDivElement | null>(null)
  const [layoutContainer, setLayoutContainer] = useState<HTMLDivElement | null>(null)
  const [sourceVideoDimensions, setSourceVideoDimensions] = useState<{ width: number; height: number } | null>(null)

  const layoutAspectRatio = useMemo(() => {
    if (draftLayout && draftLayout.canvas.height > 0) {
      const ratio = draftLayout.canvas.width / draftLayout.canvas.height
      if (Number.isFinite(ratio) && ratio > 0) {
        return ratio
      }
    }
    return 9 / 16
  }, [draftLayout])

  const sourceAspectRatio = useMemo(() => {
    if (sourceVideoDimensions && sourceVideoDimensions.width > 0 && sourceVideoDimensions.height > 0) {
      return sourceVideoDimensions.width / sourceVideoDimensions.height
    }
    return 16 / 9
  }, [sourceVideoDimensions])

  const handleSourceContainerRef = useCallback((node: HTMLDivElement | null) => {
    setSourceContainer(node)
  }, [])

  const handleLayoutContainerRef = useCallback((node: HTMLDivElement | null) => {
    setLayoutContainer(node)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const handleResize = () => {
      if (Number.isFinite(window.innerHeight)) {
        setViewportHeight(window.innerHeight)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    if (!selectedLayout) {
      setDraftLayout(null)
      setSelectedItemId(null)
      setHistory([])
      setFuture([])
      lastLoadedLayoutIdRef.current = null
      skipSelectionResetRef.current = false
      return
    }

    const layoutId = selectedLayout.id
    const previousId = lastLoadedLayoutIdRef.current
    const isDifferentLayout = layoutId !== previousId

    setDraftLayout(cloneLayout(selectedLayout))

    if (!skipSelectionResetRef.current) {
      setSelectedItemId(null)
      setHistory([])
      setFuture([])
    } else if (isDifferentLayout) {
      setSelectedItemId(null)
      setHistory([])
      setFuture([])
    }

    skipSelectionResetRef.current = false
    lastLoadedLayoutIdRef.current = layoutId
  }, [selectedLayout, setSelectedItemId])

  useEffect(() => {
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    playbackSyncRef.current = false
    setSourceVideoDimensions(null)
    if (sourceVideoRef.current) {
      sourceVideoRef.current.pause()
      sourceVideoRef.current.currentTime = 0
    }
    if (layoutVideoRef.current) {
      layoutVideoRef.current.pause()
      layoutVideoRef.current.currentTime = 0
    }
  }, [clip?.id])

  useEffect(() => {
    if (!clip) {
      setSourceMedia({ status: 'idle', url: null, message: null })
      return
    }

    let cancelled = false
    setSourceMedia({ status: 'loading', url: null, message: null })
    setSourceVideoDimensions(null)

    ;(async () => {
      try {
        const result = await resolveOriginalSource({
          clipId: clip.id,
          projectId: clip.videoId ?? null,
          accountId: clip.accountId ?? null,
          playbackUrl: clip.playbackUrl,
          previewUrl: clip.previewUrl
        })
        if (cancelled) {
          return
        }
        if (result.kind === 'ready') {
          setSourceMedia({ status: 'ready', url: result.mediaUrl, message: null })
        } else if (result.kind === 'missing') {
          const message = result.projectDir
            ? `Original video missing from ${result.projectDir}.`
            : 'Original video file could not be located.'
          setSourceMedia({ status: 'missing', url: null, message })
        } else {
          setSourceMedia({ status: 'error', url: null, message: result.message })
        }
      } catch (error) {
        console.error('[layout-editor] failed to resolve original source', error)
        if (!cancelled) {
          setSourceMedia({
            status: 'error',
            url: null,
            message: 'Unable to load the original video.'
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [clip?.accountId, clip?.id, clip?.playbackUrl, clip?.previewUrl, clip?.videoId])

  useEffect(() => {
    if (!draftLayout) {
      setSelectedItemId(null)
      return
    }
    const validIds = new Set(draftLayout.items.map((item) => item.id))
    setSelectedItemId((current) => (current && validIds.has(current) ? current : null))
  }, [draftLayout, setSelectedItemId])

  const updateLayout = useCallback(
    (updater: (layout: LayoutDefinition) => LayoutDefinition, options?: UpdateOptions) => {
      setDraftLayout((previous) => {
        if (!previous) {
          return previous
        }
        const transient = options?.transient ?? false
        const emitChange = options?.emitChange ?? !transient
        const trackHistory = options?.trackHistory ?? !transient
        const snapshot = cloneLayout(previous)
        const next = updater(snapshot)
        if (trackHistory) {
          setHistory((current) => [...current.slice(-19), cloneLayout(previous)])
          setFuture([])
        }
        if (emitChange) {
          skipSelectionResetRef.current = true
          try {
            onLayoutChange(next)
          } catch (error) {
            skipSelectionResetRef.current = false
            throw error
          }
        }
        return next
      })
    },
    [onLayoutChange]
  )

  const handleTransform = useCallback(
    (
      transforms: { itemId: string; frame: LayoutFrame }[],
      options: { commit: boolean },
      target: 'frame' | 'crop',
      origin: PreviewKind
    ) => {
      const baseAspect = sourceAspectRatio > 0 ? sourceAspectRatio : layoutAspectRatio
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            const match = transforms.find((transform) => transform.itemId === item.id)
            if (!match) {
              return item
            }
            if (target === 'crop' && item.kind === 'video') {
              const video = item as LayoutVideoItem
              const nextCrop = clampCropFrame(match.frame)
              const baseCrop = normaliseSourceCrop(video)
              if (origin === 'source') {
                const unlocked = video.lockCropAspectRatio === false
                const storedAspect =
                  !unlocked &&
                  video.cropAspectRatio &&
                  Number.isFinite(video.cropAspectRatio) &&
                  video.cropAspectRatio > 0
                    ? video.cropAspectRatio
                    : null
                const sourceRatio = (() => {
                  const sourceWidth = clamp(baseCrop.width)
                  const sourceHeight = clamp(baseCrop.height)
                  if (sourceWidth > 0 && sourceHeight > 0) {
                    return sourceWidth / Math.max(sourceHeight, 0.0001)
                  }
                  return null
                })()
                const desiredAspect = (() => {
                  if (unlocked) {
                    return null
                  }
                  if (
                    storedAspect &&
                    Number.isFinite(baseAspect) &&
                    baseAspect > 0 &&
                    Math.abs(storedAspect - baseAspect) < 0.0001 &&
                    sourceRatio
                  ) {
                    return sourceRatio
                  }
                  return storedAspect ?? sourceRatio
                })()
                const targetCrop =
                  desiredAspect && Number.isFinite(desiredAspect) && desiredAspect > 0
                    ? clampCropToBounds(snapCropToAspect(nextCrop, desiredAspect), createDefaultCrop())
                    : clampCropToBounds(nextCrop, createDefaultCrop())
                const boundedLayoutCrop = clampCropToBounds(video.crop ?? targetCrop, targetCrop)
                const resolvedAspect =
                  desiredAspect && Number.isFinite(desiredAspect) && desiredAspect > 0
                    ? desiredAspect
                    : targetCrop.width > 0 && targetCrop.height > 0
                      ? targetCrop.width / Math.max(targetCrop.height, 0.0001)
                      : video.cropAspectRatio ?? null
                return {
                  ...video,
                  sourceCrop: targetCrop,
                  crop: unlocked ? targetCrop : boundedLayoutCrop,
                  cropAspectRatio: unlocked ? video.cropAspectRatio ?? null : resolvedAspect
                }
              }
              const unlocked = video.lockCropAspectRatio === false
              const bounded = clampCropToBounds(nextCrop, baseCrop)
              if (unlocked) {
                return {
                  ...video,
                  crop: bounded
                }
              }
              const desiredAspect =
                video.cropAspectRatio && Number.isFinite(video.cropAspectRatio) && video.cropAspectRatio > 0
                  ? video.cropAspectRatio
                  : (() => {
                      const frameWidth = clamp(video.frame.width)
                      const frameHeight = clamp(video.frame.height)
                      if (frameWidth > 0 && frameHeight > 0) {
                        return frameWidth / Math.max(frameHeight, 0.0001)
                      }
                      return 1
                    })()
              const snappedCrop =
                desiredAspect && Number.isFinite(desiredAspect) && desiredAspect > 0
                  ? clampCropToBounds(snapCropToAspect(bounded, desiredAspect), baseCrop)
                  : bounded
              const resolvedAspect =
                desiredAspect && Number.isFinite(desiredAspect) && desiredAspect > 0
                  ? desiredAspect
                  : snappedCrop.width > 0 && snappedCrop.height > 0
                    ? snappedCrop.width / Math.max(snappedCrop.height, 0.0001)
                    : video.cropAspectRatio ?? null
              return {
                ...video,
                crop: snappedCrop,
                cropAspectRatio: resolvedAspect
              }
            }
            if (item.kind === 'video') {
              const updated: LayoutVideoItem = {
                ...item,
                frame: clampFrame(match.frame)
              }
              if (updated.lockAspectRatio !== false) {
                const crop = normaliseVideoCrop(updated.crop)
                const cropWidth = clamp(crop.width)
                const cropHeight = clamp(crop.height)
                const desiredAspect =
                  updated.frameAspectRatio && Number.isFinite(updated.frameAspectRatio) && updated.frameAspectRatio > 0
                    ? updated.frameAspectRatio
                    : cropWidth > 0 && cropHeight > 0
                      ? (baseAspect * cropWidth) / Math.max(cropHeight, 0.0001)
                      : baseAspect
                const snappedFrame =
                  desiredAspect && Number.isFinite(desiredAspect) && desiredAspect > 0
                    ? snapFrameToAspect(updated.frame, desiredAspect)
                    : clampFrame(updated.frame)
                const alignedCrop =
                  updated.lockCropAspectRatio === false
                    ? crop
                    : alignCropToFrame({ ...updated, frame: snappedFrame, crop })
                return {
                  ...updated,
                  frame: snappedFrame,
                  crop: alignedCrop,
                  frameAspectRatio:
                    desiredAspect && Number.isFinite(desiredAspect) && desiredAspect > 0
                      ? desiredAspect
                      : updated.frameAspectRatio ?? null,
                  cropAspectRatio:
                    updated.lockCropAspectRatio === false
                      ? updated.cropAspectRatio ?? null
                      : alignedCrop.width > 0 && alignedCrop.height > 0
                        ? alignedCrop.width / Math.max(alignedCrop.height, 0.0001)
                        : updated.cropAspectRatio ?? null
                }
              }
              return updated
            }
            return {
              ...item,
              frame: clampFrame(match.frame)
            }
          })
        }),
        { transient: !options.commit, trackHistory: options.commit }
      )
    },
    [layoutAspectRatio, sourceAspectRatio, updateLayout]
  )

  const handleSourceTransform = useCallback(
    (
      transforms: { itemId: string; frame: LayoutFrame }[],
      options: { commit: boolean },
      target: 'frame' | 'crop'
    ) => handleTransform(transforms, options, target, 'source'),
    [handleTransform]
  )

  const handleLayoutTransform = useCallback(
    (
      transforms: { itemId: string; frame: LayoutFrame }[],
      options: { commit: boolean },
      target: 'frame' | 'crop'
    ) => handleTransform(transforms, options, target, 'layout'),
    [handleTransform]
  )

  const handleTransformTargetChange = useCallback((target: 'frame' | 'crop') => {
    setLayoutTransformTarget((current) => (current === target ? current : target))
  }, [])

  const handleToggleAspectLock = useCallback(
    (target: 'frame' | 'crop') => {
      if (!selectedItemId) {
        return
      }
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            if (item.kind !== 'video' || item.id !== selectedItemId) {
              return item
            }
            if (target === 'crop') {
              const currentlyLocked = item.lockCropAspectRatio !== false
              const nextLocked = !currentlyLocked
              if (!nextLocked) {
                return {
                  ...item,
                  lockCropAspectRatio: false,
                  cropAspectRatio: null,
                  crop: clampCropToBounds(normaliseVideoCrop(item.crop), normaliseSourceCrop(item))
                }
              }
              const normalised = normaliseVideoCrop(item.crop)
              const baseSource = normaliseSourceCrop(item)
              const alignedCrop = alignCropToFrame({ ...item, crop: normalised })
              const alignedSource = alignCropToFrame({ ...item, crop: baseSource })
              const cropWidth = clamp(alignedCrop.width)
              const cropHeight = clamp(alignedCrop.height)
              const aspect =
                cropWidth > 0 && cropHeight > 0
                  ? cropWidth / Math.max(cropHeight, 0.0001)
                  : 1
              return {
                ...item,
                crop: clampCropToBounds(alignedCrop, alignedSource),
                sourceCrop: alignedSource,
                lockCropAspectRatio: true,
                cropAspectRatio: aspect
              }
            }
            const currentlyLocked = item.lockAspectRatio !== false
            const nextLocked = !currentlyLocked
            if (!nextLocked) {
              return {
                ...item,
                lockAspectRatio: false,
                frameAspectRatio: null
              }
            }
            const frame = clampFrame(item.frame)
            const frameAspect =
              frame.width > 0 && frame.height > 0
                ? frame.width / Math.max(frame.height, 0.0001)
                : (() => {
                    const crop = normaliseVideoCrop(item.crop)
                    const cropWidth = clamp(crop.width)
                    const cropHeight = clamp(crop.height)
                    const baseAspect = sourceAspectRatio > 0 ? sourceAspectRatio : layoutAspectRatio
                    if (cropWidth > 0 && cropHeight > 0) {
                      return (baseAspect * cropWidth) / Math.max(cropHeight, 0.0001)
                    }
                    return baseAspect
                  })()
            const updated: LayoutVideoItem = {
              ...item,
              frame,
              lockAspectRatio: true,
              frameAspectRatio: frameAspect
            }
            const crop = normaliseVideoCrop(updated.crop)
            const alignedCrop =
              updated.lockCropAspectRatio === false
                ? crop
                : alignCropToFrame({ ...updated, crop })
            const alignedAspect =
              alignedCrop.width > 0 && alignedCrop.height > 0
                ? alignedCrop.width / Math.max(alignedCrop.height, 0.0001)
                : updated.cropAspectRatio ?? null
            return {
              ...updated,
              crop: alignedCrop,
              cropAspectRatio:
                updated.lockCropAspectRatio === false
                  ? updated.cropAspectRatio ?? null
                  : alignedAspect
            }
          })
        }),
        { trackHistory: true }
      )
    },
    [layoutAspectRatio, selectedItemId, sourceAspectRatio, updateLayout]
  )

  const handleResetToSourceAspect = useCallback(
    (_target: 'frame' | 'crop', context: 'source' | 'layout') => {
      if (!selectedItemId) {
        return
      }
      const nativeAspect = sourceAspectRatio > 0 ? sourceAspectRatio : layoutAspectRatio
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            if (item.kind !== 'video' || item.id !== selectedItemId) {
              return item
            }

            const currentFrame = clampFrame(item.frame)

            if (context === 'source') {
              const desiredFrameAspect =
                Number.isFinite(nativeAspect) && nativeAspect > 0
                  ? nativeAspect
                  : getFrameAspectRatio(currentFrame)
              const snappedFrame =
                desiredFrameAspect && Number.isFinite(desiredFrameAspect) && desiredFrameAspect > 0
                  ? snapFrameToAspect(currentFrame, desiredFrameAspect)
                  : currentFrame
              const defaultCrop = createDefaultCrop()
              const cropAspect = getCropAspectRatio(defaultCrop)

              const nextVideo: LayoutVideoItem = {
                ...item,
                frame: clampFrame(snappedFrame),
                sourceCrop: defaultCrop,
                crop: defaultCrop,
                cropAspectRatio:
                  item.lockCropAspectRatio === false ? item.cropAspectRatio ?? null : cropAspect ?? null
              }

              if (item.lockAspectRatio !== false) {
                nextVideo.frameAspectRatio =
                  desiredFrameAspect && Number.isFinite(desiredFrameAspect) && desiredFrameAspect > 0
                    ? desiredFrameAspect
                    : getFrameAspectRatio(nextVideo.frame)
              }

              return nextVideo
            }

            const sourceBounds = normaliseSourceCrop(item)
            const boundedSource = clampCropToBounds(sourceBounds, sourceBounds)
            const sourceWidth = clamp(boundedSource.width)
            const sourceHeight = clamp(boundedSource.height)
            const sourceFrameAspect =
              sourceWidth > 0 && sourceHeight > 0 && Number.isFinite(nativeAspect) && nativeAspect > 0
                ? (nativeAspect * sourceWidth) / Math.max(sourceHeight, 0.0001)
                : getFrameAspectRatio(currentFrame) ?? nativeAspect
            const snappedFrame =
              sourceFrameAspect && Number.isFinite(sourceFrameAspect) && sourceFrameAspect > 0
                ? snapFrameToAspect(currentFrame, sourceFrameAspect)
                : currentFrame
            const cropCopy = normaliseVideoCrop(boundedSource)
            const cropAspect = getCropAspectRatio(cropCopy)

            const nextVideo: LayoutVideoItem = {
              ...item,
              frame: clampFrame(snappedFrame),
              crop: cropCopy,
              cropAspectRatio:
                item.lockCropAspectRatio === false ? item.cropAspectRatio ?? null : cropAspect ?? null
            }

            if (item.lockAspectRatio !== false) {
              nextVideo.frameAspectRatio =
                sourceFrameAspect && Number.isFinite(sourceFrameAspect) && sourceFrameAspect > 0
                  ? sourceFrameAspect
                  : getFrameAspectRatio(nextVideo.frame)
            }

            return nextVideo
          })
        }),
        { trackHistory: true }
      )
    },
    [layoutAspectRatio, selectedItemId, sourceAspectRatio, updateLayout]
  )

  const handleAddItem = useCallback(
    (kind: LayoutItem['kind']) => {
      if (!draftLayout) {
        return
      }
      let newItem: LayoutItem
      if (kind === 'video') {
        const initialFrame: LayoutFrame = { x: 0.1, y: 0.1, width: 0.8, height: 0.6 }
        newItem = {
          id: createItemId('video'),
          kind: 'video',
          source: 'primary',
          name: 'Primary video',
          frame: initialFrame,
          crop: createDefaultCrop(),
          scaleMode: 'cover',
          rotation: null,
          opacity: 1,
          mirror: false,
          lockAspectRatio: true,
          lockCropAspectRatio: true,
          frameAspectRatio: initialFrame.width / Math.max(initialFrame.height, 0.0001),
          cropAspectRatio: 1,
          zIndex: draftLayout.items.length
        }
      } else if (kind === 'text') {
        newItem = {
          id: createItemId('text'),
          kind: 'text',
          content: 'Add your headline',
          frame: { x: 0.12, y: 0.72, width: 0.76, height: 0.2 },
          align: 'center',
          color: '#ffffff',
          fontFamily: null,
          fontSize: 48,
          fontWeight: 'bold',
          letterSpacing: null,
          lineHeight: 1.2,
          uppercase: false,
          opacity: 1,
          zIndex: draftLayout.items.length
        }
      } else {
        newItem = {
          id: createItemId('shape'),
          kind: 'shape',
          frame: { x: 0, y: 0, width: 1, height: 1 },
          color: '#000000',
          opacity: 0.4,
          borderRadius: 32,
          zIndex: 0
        }
      }
      updateLayout(
        (layout) => ({
          ...layout,
          items: [...layout.items, newItem]
        }),
        { trackHistory: true }
      )
      setSelectedItemId(newItem.id)
      setIsAddMenuOpen(false)
    },
    [draftLayout, setSelectedItemId, updateLayout]
  )

  const handleRemoveSelected = useCallback(() => {
    if (!draftLayout || !selectedItemId) {
      return
    }
    updateLayout(
      (layout) => ({
        ...layout,
        items: layout.items.filter((item) => item.id !== selectedItemId)
      }),
      { trackHistory: true }
    )
    setSelectedItemId(null)
  }, [draftLayout, selectedItemId, setSelectedItemId, updateLayout])

  const handleChangeItemFrameValue = useCallback(
    (itemId: string, field: keyof LayoutFrame, value: number) => {
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            if (item.id !== itemId) {
              return item
            }
            if (item.kind === 'video') {
              const nextFrame = {
                ...item.frame,
                [field]: clamp(value)
              }
              const updated: LayoutVideoItem = {
                ...item,
                frame: nextFrame
              }
              if (updated.lockAspectRatio !== false) {
                return {
                  ...updated,
                  crop: alignCropToFrame(updated)
                }
              }
              return updated
            }
            return {
              ...item,
              frame: {
                ...item.frame,
                [field]: clamp(value)
              }
            }
          })
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleChangeVideoField = useCallback(
    (itemId: string, field: keyof LayoutVideoItem, value: LayoutVideoItem[keyof LayoutVideoItem]) => {
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            if (item.id !== itemId || item.kind !== 'video') {
              return item
            }
            if (field === 'lockAspectRatio') {
              const shouldLock = Boolean(value)
              const updated: LayoutVideoItem = {
                ...item,
                lockAspectRatio: shouldLock
              }
              if (shouldLock) {
                return {
                  ...updated,
                  crop: alignCropToFrame(updated)
                }
              }
              return updated
            }
            return {
              ...item,
              [field]: value
            }
          })
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleChangeTextField = useCallback(
    (
      itemId: string,
      field: keyof LayoutTextItem,
      value: LayoutTextItem[keyof LayoutTextItem]
    ) => {
      updateLayout(
        (layout) => ({
          ...layout,
          items: layout.items.map((item) => {
            if (item.id !== itemId || item.kind !== 'text') {
              return item
            }
            return {
              ...item,
              [field]: value
            }
          })
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleCanvasDimensionChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const { name, value } = event.target
      const numeric = Number.parseInt(value, 10)
      if (!Number.isFinite(numeric) || numeric <= 0) {
        return
      }
      updateLayout(
        (layout) => ({
          ...layout,
          canvas: {
            ...layout.canvas,
            [name]: numeric
          }
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleBackgroundKindChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const kind = event.target.value as LayoutBackground['kind']
      updateLayout(
        (layout) => ({
          ...layout,
          canvas: {
            ...layout.canvas,
            background: getBackgroundDefaults(kind)
          }
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleBackgroundFieldChange = useCallback(
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const { name, value } = event.target
      updateLayout(
        (layout) => ({
          ...layout,
          canvas: {
            ...layout.canvas,
            background: {
              ...layout.canvas.background,
              [name]: name === 'radius' || name === 'opacity' || name === 'brightness'
                ? Number.parseFloat(value)
                : value
            }
          }
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const bringSelectionForward = useCallback(() => {
    if (!draftLayout || !selectedItemId) {
      return
    }
    updateLayout(
      (layout) => {
        const updatedItems = layout.items.map((item) => {
          if (item.id !== selectedItemId) {
            return item
          }
          const z = 'zIndex' in item && typeof item.zIndex === 'number' ? item.zIndex : 0
          return { ...item, zIndex: z + 1 }
        })
        return {
          ...layout,
          items: updatedItems
        }
      },
      { trackHistory: true }
    )
  }, [draftLayout, selectedItemId, updateLayout])

  const sendSelectionBackward = useCallback(() => {
    if (!draftLayout || !selectedItemId) {
      return
    }
    updateLayout(
      (layout) => {
        const updatedItems = layout.items.map((item) => {
          if (item.id !== selectedItemId) {
            return item
          }
          const z = 'zIndex' in item && typeof item.zIndex === 'number' ? item.zIndex : 0
          return { ...item, zIndex: Math.max(0, z - 1) }
        })
        return {
          ...layout,
          items: updatedItems
        }
      },
      { trackHistory: true }
    )
  }, [draftLayout, selectedItemId, updateLayout])

  const duplicateSelection = useCallback(() => {
    if (!draftLayout || !selectedItemId) {
      return
    }
    const original = draftLayout.items.find((item) => item.id === selectedItemId)
    if (!original) {
      return
    }
    const cloned = cloneLayoutItem(original)
    const shiftedFrame = clampFrame({
      x: clamp(cloned.frame.x + 0.03),
      y: clamp(cloned.frame.y + 0.03),
      width: cloned.frame.width,
      height: cloned.frame.height
    })
    const duplicate: LayoutItem = {
      ...cloned,
      id: createItemId(original.kind),
      frame: shiftedFrame,
      ...(cloned.kind === 'video'
        ? { crop: clampCropFrame((cloned as LayoutVideoItem).crop ?? createDefaultCrop()) }
        : {}),
      zIndex: draftLayout.items.length + 1
    }
    updateLayout(
      (layout) => ({
        ...layout,
        items: [...layout.items, duplicate]
      }),
      { trackHistory: true }
    )
    setSelectedItemId(duplicate.id)
  }, [draftLayout, selectedItemId, setSelectedItemId, updateLayout])

  const handleCopySelection = useCallback(() => {
    if (!draftLayout || !selectedItemId) {
      return
    }
    const item = draftLayout.items.find((candidate) => candidate.id === selectedItemId)
    if (!item) {
      return
    }
    setClipboard([cloneLayoutItem(item)])
  }, [draftLayout, selectedItemId])

  const handlePaste = useCallback(() => {
    if (!clipboard || !draftLayout) {
      return
    }
    const clones = clipboard.map((item) => {
      const cloned = cloneLayoutItem(item)
      const shiftedFrame = clampFrame({
        x: clamp(cloned.frame.x + 0.05),
        y: clamp(cloned.frame.y + 0.05),
        width: cloned.frame.width,
        height: cloned.frame.height
      })
      return {
        ...cloned,
        id: createItemId(item.kind),
        frame: shiftedFrame,
        ...(cloned.kind === 'video'
          ? { crop: clampCropFrame((cloned as LayoutVideoItem).crop ?? createDefaultCrop()) }
          : {}),
        zIndex: draftLayout.items.length + 1
      }
    })
      updateLayout(
        (layout) => ({
          ...layout,
          items: [...layout.items, ...clones]
        }),
        { trackHistory: true }
      )
    const lastClone = clones[clones.length - 1]
    setSelectedItemId(lastClone ? lastClone.id : null)
  }, [clipboard, draftLayout, setSelectedItemId, updateLayout])

  const undo = useCallback(() => {
    setHistory((current) => {
      if (current.length === 0 || !draftLayout) {
        return current
      }
      const previous = current[current.length - 1]
      setDraftLayout(cloneLayout(previous))
      setFuture((futureStack) => [cloneLayout(draftLayout), ...futureStack])
      onLayoutChange(previous)
      return current.slice(0, -1)
    })
  }, [draftLayout, onLayoutChange])

  const redo = useCallback(() => {
    setFuture((current) => {
      if (current.length === 0 || !draftLayout) {
        return current
      }
      const next = current[0]
      setDraftLayout(cloneLayout(next))
      setHistory((historyStack) => [...historyStack, cloneLayout(draftLayout)])
      onLayoutChange(next)
      return current.slice(1)
    })
  }, [draftLayout, onLayoutChange])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!draftLayout || isInputTarget(event.target)) {
        return
      }
      const isMac = navigator.platform.toLowerCase().includes('mac')
      const primaryMod = isMac ? event.metaKey : event.ctrlKey
      if (event.key === 'Escape') {
        setSelectedItemId(null)
        return
      }
      if (primaryMod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }
      if (primaryMod && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        handleCopySelection()
        return
      }
      if (primaryMod && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        handlePaste()
        return
      }
      if (primaryMod && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelection()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        handleRemoveSelected()
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        if (!selectedItemId) {
          return
        }
        const delta = event.shiftKey ? 0.02 : 0.005
        const dx = event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0
        const dy = event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0
        if (dx === 0 && dy === 0) {
          return
        }
        updateLayout(
          (layout) => ({
            ...layout,
            items: layout.items.map((item) =>
              item.id === selectedItemId
                ? {
                    ...item,
                    frame: clampFrame({
                      x: item.frame.x + dx,
                      y: item.frame.y + dy,
                      width: item.frame.width,
                      height: item.frame.height
                    })
                  }
                : item
            )
          }),
          { trackHistory: true }
        )
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    draftLayout,
    duplicateSelection,
    handleCopySelection,
    handlePaste,
    handleRemoveSelected,
    redo,
    selectedItemId,
    setSelectedItemId,
    undo,
    updateLayout
  ])

  const handleSave = useCallback(
    async (event?: FormEvent) => {
      if (event) {
        event.preventDefault()
      }
      if (!draftLayout) {
        return
      }
      await onSaveLayout(draftLayout, {
        originalId: selectedLayoutReference?.id ?? null,
        originalCategory: selectedLayoutReference?.category ?? null
      })
    },
    [draftLayout, onSaveLayout, selectedLayoutReference]
  )

  const handleApply = useCallback(async () => {
    if (!draftLayout) {
      return
    }
    await onApplyLayout(draftLayout)
  }, [draftLayout, onApplyLayout])

  const handleExport = useCallback(async () => {
    if (!selectedLayoutReference) {
      return
    }
    const category = selectedLayoutReference.category ?? 'custom'
    await onExportLayout(selectedLayoutReference.id, category)
  }, [onExportLayout, selectedLayoutReference])

  const handleImport = useCallback(async () => {
    await onImportLayout()
  }, [onImportLayout])

  const handleRender = useCallback(async () => {
    if (!draftLayout) {
      return
    }
    await onRenderLayout(draftLayout)
  }, [draftLayout, onRenderLayout])

  const bringSelectionIntoView = useCallback(() => {
    if (!draftLayout || !selectedItemId) {
      return
    }
    updateLayout(
      (layout) => ({
        ...layout,
        items: layout.items.map((item) => {
          if (item.id !== selectedItemId) {
            return item
          }
          if (item.kind === 'video') {
            return {
              ...item,
              frame: clampFrame(item.frame),
              crop: clampCropFrame(normaliseVideoCrop((item as LayoutVideoItem).crop))
            }
          }
          return {
            ...item,
            frame: clampFrame(item.frame)
          }
        })
      }),
      { trackHistory: true }
    )
  }, [draftLayout, selectedItemId, updateLayout])

  const selectedItem = useMemo(() => {
    if (!draftLayout || !selectedItemId) {
      return null
    }
    return draftLayout.items.find((item) => item.id === selectedItemId) ?? null
  }, [draftLayout, selectedItemId])

  useEffect(() => {
    if (!selectedItem || selectedItem.kind !== 'video') {
      setLayoutTransformTarget('frame')
    }
  }, [selectedItem])

  const selectionOffCanvas = useMemo(() => {
    if (!selectedItem) {
      return false
    }
    const frame = selectedItem.frame
    if (frame.x < 0 || frame.y < 0 || frame.x + frame.width > 1 || frame.y + frame.height > 1) {
      return true
    }
    if (selectedItem.kind === 'video') {
      const crop = normaliseVideoCrop((selectedItem as LayoutVideoItem).crop)
      if (crop.x < 0 || crop.y < 0 || crop.x + crop.width > 1 || crop.y + crop.height > 1) {
        return true
      }
    }
    return false
  }, [selectedItem])

  const selectionLabel = useMemo(() => {
    if (!selectedItem) {
      return 'Canvas settings'
    }
    if (selectedItem.kind === 'video') {
      return 'Video window'
    }
    if (selectedItem.kind === 'text') {
      return 'Text overlay'
    }
    return 'Background layer'
  }, [selectedItem])

  const layoutSections = useMemo(() => {
    if (!layoutCollection) {
      return []
    }
    const sections: Array<{ title: string; category: LayoutCategory; items: LayoutCollection['builtin'] }> = []
    if (layoutCollection.builtin.length > 0) {
      sections.push({ title: 'Built-in', category: 'builtin', items: layoutCollection.builtin })
    }
    if (layoutCollection.custom.length > 0) {
      sections.push({ title: 'Custom', category: 'custom', items: layoutCollection.custom })
    }
    return sections
  }, [layoutCollection])

  const toggleSection = useCallback((category: LayoutCategory) => {
    setCollapsedSections((current) => ({
      ...current,
      [category]: !current[category]
    }))
  }, [])

  const getAspectRatioForItem = useCallback(
    (item: LayoutItem, target: 'frame' | 'crop'): number | null => {
      if ((item as LayoutVideoItem).kind !== 'video') {
        return null
      }
      const video = item as LayoutVideoItem
      if (target === 'crop') {
        if (video.lockCropAspectRatio === false) {
          return null
        }
        if (video.cropAspectRatio && Number.isFinite(video.cropAspectRatio) && video.cropAspectRatio > 0) {
          return video.cropAspectRatio
        }
        const crop = normaliseVideoCrop(video.sourceCrop ?? video.crop)
        const cropWidth = clamp(crop.width)
        const cropHeight = clamp(crop.height)
        if (cropWidth > 0 && cropHeight > 0) {
          return cropWidth / Math.max(cropHeight, 0.0001)
        }
        return 1
      }
      if (video.lockAspectRatio === false) {
        return null
      }
      if (video.frameAspectRatio && Number.isFinite(video.frameAspectRatio) && video.frameAspectRatio > 0) {
        return video.frameAspectRatio
      }
      const frame = clampFrame(video.frame)
      if (frame.width > 0 && frame.height > 0) {
        return frame.width / Math.max(frame.height, 0.0001)
      }
      const baseAspect = sourceAspectRatio > 0 ? sourceAspectRatio : layoutAspectRatio
      const crop = normaliseVideoCrop(video.crop)
      const cropWidth = clamp(crop.width)
      const cropHeight = clamp(crop.height)
      if (cropWidth > 0 && cropHeight > 0) {
        return (baseAspect * cropWidth) / Math.max(cropHeight, 0.0001)
      }
      return baseAspect
    },
    [layoutAspectRatio, sourceAspectRatio]
  )

  const sourceVideoSource = sourceMedia.status === 'ready' ? sourceMedia.url : null
  const layoutPreviewSource = sourceVideoSource

  const sourcePreviewMessage = useMemo(() => {
    if (!clip) {
      return 'Load a clip to preview the source video.'
    }
    if (sourceMedia.status === 'loading') {
      return 'Loading original video…'
    }
    if (sourceMedia.status === 'missing' || sourceMedia.status === 'error') {
      return sourceMedia.message ?? 'Unable to load the original video.'
    }
    return null
  }, [clip, sourceMedia])

  const releasePlaybackSync = useCallback(() => {
    window.setTimeout(() => {
      playbackSyncRef.current = false
    }, 0)
  }, [])

  const getVideoPair = useCallback(
    (origin: PreviewKind): { source: HTMLVideoElement | null; peer: HTMLVideoElement | null } => {
      if (origin === 'source') {
        return { source: sourceVideoRef.current, peer: layoutVideoRef.current }
      }
      return { source: layoutVideoRef.current, peer: sourceVideoRef.current }
    },
    []
  )

  const handleVideoLoadedMetadata = useCallback(
    (origin: PreviewKind) => {
      const { source } = getVideoPair(origin)
      if (!source || Number.isNaN(source.duration) || !Number.isFinite(source.duration)) {
        return
      }
      setDuration((current) => (current > 0 ? Math.max(current, source.duration) : source.duration))
      if (origin === 'source' && source.videoWidth > 0 && source.videoHeight > 0) {
        setSourceVideoDimensions({ width: source.videoWidth, height: source.videoHeight })
      }
    },
    [getVideoPair]
  )

  const handleVideoPlay = useCallback(
    (origin: PreviewKind) => {
      const { source, peer } = getVideoPair(origin)
      if (!source) {
        return
      }
      setIsPlaying(true)
      if (!peer || playbackSyncRef.current) {
        return
      }
      playbackSyncRef.current = true
      peer.currentTime = source.currentTime
      const result = peer.play()
      if (result && typeof (result as Promise<void>).then === 'function') {
        ;(result as Promise<void>).catch(() => undefined).finally(releasePlaybackSync)
      } else {
        releasePlaybackSync()
      }
    },
    [getVideoPair, releasePlaybackSync]
  )

  const handleVideoPause = useCallback(
    (origin: PreviewKind) => {
      if (playbackSyncRef.current) {
        return
      }
      const { source, peer } = getVideoPair(origin)
      if (!source) {
        return
      }
      setIsPlaying(false)
      if (!peer) {
        return
      }
      playbackSyncRef.current = true
      peer.pause()
      peer.currentTime = source.currentTime
      releasePlaybackSync()
    },
    [getVideoPair, releasePlaybackSync]
  )

  const handleVideoTimeUpdate = useCallback(
    (origin: PreviewKind) => {
      const { source, peer } = getVideoPair(origin)
      if (!source) {
        return
      }
      setCurrentTime(source.currentTime)
      if (!peer || playbackSyncRef.current) {
        return
      }
      const difference = Math.abs(peer.currentTime - source.currentTime)
      if (difference > 0.05) {
        playbackSyncRef.current = true
        peer.currentTime = source.currentTime
        releasePlaybackSync()
      }
    },
    [getVideoPair, releasePlaybackSync]
  )

  const handleVideoSeeked = useCallback(
    (origin: PreviewKind) => {
      const { source, peer } = getVideoPair(origin)
      if (!source) {
        return
      }
      setCurrentTime(source.currentTime)
      if (!peer) {
        return
      }
      playbackSyncRef.current = true
      peer.currentTime = source.currentTime
      releasePlaybackSync()
    },
    [getVideoPair, releasePlaybackSync]
  )

  const handleTogglePlayback = useCallback(() => {
    const active =
      (sourceVideoRef.current && !sourceVideoRef.current.paused ? sourceVideoRef.current : null) ??
      (layoutVideoRef.current && !layoutVideoRef.current.paused ? layoutVideoRef.current : null)
    const target = active ?? layoutVideoRef.current ?? sourceVideoRef.current
    if (!target) {
      return
    }
    if (target.paused) {
      target.play().catch(() => undefined)
    } else {
      target.pause()
    }
  }, [])

  const effectiveDuration = useMemo(() => {
    if (duration > 0 && Number.isFinite(duration)) {
      return duration
    }
    if (clip?.sourceDurationSeconds && clip.sourceDurationSeconds > 0) {
      return clip.sourceDurationSeconds
    }
    if (clip?.durationSec && clip.durationSec > 0) {
      return clip.durationSec
    }
    return 0
  }, [clip?.durationSec, clip?.sourceDurationSeconds, duration])

  const handleSeek = useCallback(
    (value: number) => {
      const bounded = effectiveDuration > 0 ? Math.min(Math.max(0, value), effectiveDuration) : Math.max(0, value)
      setCurrentTime(bounded)
      playbackSyncRef.current = true
      if (sourceVideoRef.current) {
        sourceVideoRef.current.currentTime = bounded
      }
      if (layoutVideoRef.current) {
        layoutVideoRef.current.currentTime = bounded
      }
      releasePlaybackSync()
    },
    [effectiveDuration, releasePlaybackSync]
  )

  const formattedTimeLabel = useMemo(() => {
    if (effectiveDuration <= 0) {
      return formatTimecode(currentTime)
    }
    return `${formatTimecode(currentTime)} / ${formatTimecode(effectiveDuration)}`
  }, [currentTime, effectiveDuration])

  const hasPreview = Boolean(sourceVideoSource || layoutPreviewSource)

  const sliderMax = useMemo(() => {
    if (effectiveDuration > 0) {
      return effectiveDuration
    }
    return Math.max(1, currentTime || 0)
  }, [currentTime, effectiveDuration])

  const shouldShowRenderSteps = useMemo(
    () =>
      renderSteps.some((step) => step.status !== 'pending') ||
      Boolean(renderStatusMessage) ||
      Boolean(renderErrorMessage),
    [renderErrorMessage, renderStatusMessage, renderSteps]
  )

  const basePreviewHeight = useMemo(() => {
    const viewport = Number.isFinite(viewportHeight) ? viewportHeight : 900
    const scaled = viewport * 0.6
    const clamped = Math.max(280, Math.min(640, Number.isFinite(scaled) ? scaled : 480))
    return clamped > 0 ? clamped : 480
  }, [viewportHeight])

  const sourcePreviewSize = usePreviewSize(sourceContainer, sourceAspectRatio, basePreviewHeight)
  const layoutPreviewSize = usePreviewSize(layoutContainer, layoutAspectRatio, basePreviewHeight)

  const sourceFallbackWidth = Math.max(0, sourceAspectRatio * basePreviewHeight)
  const layoutFallbackWidth = Math.max(0, layoutAspectRatio * basePreviewHeight)

  const sourceCanvasStyle = useMemo(() => {
    const width = Math.max(0, sourcePreviewSize.width || sourceFallbackWidth)
    const height = Math.max(0, sourcePreviewSize.height || basePreviewHeight)
    return { width, height, maxWidth: '100%' as const }
  }, [basePreviewHeight, sourceFallbackWidth, sourcePreviewSize.height, sourcePreviewSize.width])

  const layoutCanvasStyle = useMemo(() => {
    const width = Math.max(0, layoutPreviewSize.width || layoutFallbackWidth)
    const height = Math.max(0, layoutPreviewSize.height || basePreviewHeight)
    return { width, height, maxWidth: '100%' as const }
  }, [basePreviewHeight, layoutFallbackWidth, layoutPreviewSize.height, layoutPreviewSize.width])

  const clipDuration = clip?.durationSec ?? 0
  const transportRangeLabel =
    clip && clipDuration > 0
      ? `${formatPercent(clip.startSeconds / clipDuration)} – ${formatPercent(clip.endSeconds / clipDuration)}`
      : clip
      ? `${clip.startSeconds.toFixed(1)}s – ${clip.endSeconds.toFixed(1)}s`
      : 'No clip loaded'

  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      updateLayout(
        (layout) => ({
          ...layout,
          name: value
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  const handleDescriptionChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      updateLayout(
        (layout) => ({
          ...layout,
          description: value.length > 0 ? value : null
        }),
        { trackHistory: true }
      )
    },
    [updateLayout]
  )

  return (
    <section className="flex w-full flex-1 flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        {tabNavigation}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="marble-button marble-button--ghost px-3 py-2 text-sm"
            onClick={() => {
              const fresh = createDefaultLayout()
              setDraftLayout(fresh)
              setSelectedItemId(null)
              onCreateBlankLayout()
              onLayoutChange(fresh)
            }}
          >
            New layout
          </button>
          <div className="relative">
            <button
              type="button"
              className="marble-button marble-button--ghost px-3 py-2 text-sm"
              onClick={() => setIsAddMenuOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={isAddMenuOpen}
            >
              Add item ▾
            </button>
            {isAddMenuOpen ? (
              <div
                role="menu"
                className="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_75%,transparent)] shadow-[0_16px_32px_rgba(0,0,0,0.35)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleAddItem('video')}
                  className="block w-full px-4 py-2 text-left text-sm text-[var(--fg)] hover:bg-white/10"
                >
                  Video window
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleAddItem('text')}
                  className="block w-full px-4 py-2 text-left text-sm text-[var(--fg)] hover:bg-white/10"
                >
                  Text overlay
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => handleAddItem('shape')}
                  className="block w-full px-4 py-2 text-left text-sm text-[var(--fg)] hover:bg-white/10"
                >
                  Background layer
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="marble-button marble-button--ghost px-3 py-2 text-sm"
            onClick={handleRemoveSelected}
            disabled={!selectedItemId}
          >
            Remove selected
          </button>
          <button
            type="button"
            className="marble-button marble-button--ghost px-3 py-2 text-sm"
            onClick={handleImport}
          >
            Import JSON
          </button>
          <button
            type="button"
            className="marble-button marble-button--ghost px-3 py-2 text-sm"
            onClick={handleExport}
            disabled={!selectedLayoutReference}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="marble-button marble-button--solid px-3 py-2 text-sm"
            onClick={handleSave}
            disabled={!draftLayout || isSavingLayout}
          >
            {isSavingLayout ? 'Saving…' : 'Save layout'}
          </button>
          <button
            type="button"
            className="marble-button marble-button--outline px-3 py-2 text-sm"
            onClick={handleApply}
            disabled={!draftLayout || isApplyingLayout}
          >
            {isApplyingLayout ? 'Applying…' : clip ? 'Apply to clip' : 'Set as default'}
          </button>
        </div>
      </div>
      {layoutSections.length > 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] p-4">
          <div className="flex w-full gap-6 overflow-x-auto pb-1">
            {layoutSections.map((section) => {
              const collapsed = collapsedSections[section.category]
              return (
                <section key={section.category} className="flex min-w-[320px] flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-[var(--fg)]">{section.title}</h3>
                    <span className="text-xs text-[var(--muted)]">{section.items.length} layouts</span>
                    <button
                      type="button"
                      className="ml-auto inline-flex items-center justify-center rounded-full border border-white/15 bg-white/10 p-1.5 text-[var(--fg)] transition hover:border-white/30 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                      onClick={() => toggleSection(section.category)}
                      aria-expanded={!collapsed}
                      aria-controls={`layout-section-${section.category}`}
                    >
                      <span className="sr-only">{collapsed ? `Expand ${section.title}` : `Collapse ${section.title}`}</span>
                      <CollapseToggleIcon collapsed={collapsed} />
                    </button>
                  </div>
                  {collapsed ? (
                    <div
                      id={`layout-section-${section.category}`}
                      className="flex min-h-[72px] items-center justify-center rounded-xl border border-dashed border-white/25 bg-white/10 px-3 py-3 text-xs text-white"
                    >
                      <span>{section.title} layouts hidden</span>
                    </div>
                  ) : (
                    <div id={`layout-section-${section.category}`} className="flex gap-3">
                      {section.items.map((layout) => {
                        const isSelected = selectedLayoutReference?.id === layout.id
                        return (
                          <button
                            key={layout.id}
                            type="button"
                            onClick={() => onSelectLayout(layout.id, section.category)}
                            className={`flex w-48 flex-col gap-1 rounded-2xl border px-3 py-3 text-left transition ${
                              isSelected
                                ? 'border-[color:color-mix(in_srgb,var(--accent)_70%,transparent)] bg-[color:color-mix(in_srgb,var(--accent-soft)_85%,transparent)] text-[var(--fg)] shadow-[0_8px_20px_rgba(0,0,0,0.35)]'
                                : 'border-white/12 bg-[color:color-mix(in_srgb,var(--card)_85%,transparent)] text-[var(--muted)] hover:border-white/24'
                            }`}
                          >
                            <span className="truncate text-sm font-semibold text-[var(--fg)]">{layout.name}</span>
                            <span className="line-clamp-2 text-xs text-[var(--muted)]">
                              {layout.description ? layout.description : 'No description'}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      ) : isCollectionLoading ? (
        <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-3 text-sm text-[var(--muted)]">
          Loading layouts…
        </div>
      ) : null}
      {statusMessage ? (
        <div
          role="status"
          className="rounded-xl border border-[color:var(--edge-soft)] bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-3 text-sm text-[var(--fg)]"
        >
          {statusMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div
          role="alert"
          className="rounded-xl border border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:color-mix(in_srgb,var(--error-soft)_80%,transparent)] px-4 py-3 text-sm text-[color:var(--error-contrast)]"
        >
          {errorMessage}
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg)]">Source preview</h3>
            <span className="text-xs text-[var(--muted)]">Original footage</span>
          </div>
          <div
            ref={handleSourceContainerRef}
            className="flex w-full items-center justify-center"
            style={{ minHeight: basePreviewHeight }}
          >
            <LayoutCanvas
              layout={draftLayout}
              onTransform={handleSourceTransform}
              onRequestBringForward={bringSelectionForward}
              onRequestSendBackward={sendSelectionBackward}
              onRequestDuplicate={duplicateSelection}
              onRequestDelete={handleRemoveSelected}
              showGrid={showGrid}
              showSafeMargins={showSafeMargins}
              previewContent={
                sourceVideoSource ? (
                  <video
                    ref={sourceVideoRef}
                    src={sourceVideoSource}
                    className="pointer-events-none h-full w-full object-contain"
                    playsInline
                    muted
                    preload="metadata"
                    onLoadedMetadata={() => handleVideoLoadedMetadata('source')}
                    onPlay={() => handleVideoPlay('source')}
                    onPause={() => handleVideoPause('source')}
                    onTimeUpdate={() => handleVideoTimeUpdate('source')}
                    onSeeked={() => handleVideoSeeked('source')}
                    aria-label="Source video preview"
                  />
                ) : (
                  <span className="text-xs text-white/70">{sourcePreviewMessage}</span>
                )
              }
              transformTarget="crop"
              aspectRatioOverride={sourceAspectRatio}
              onRequestToggleAspectLock={handleToggleAspectLock}
              onRequestResetAspect={handleResetToSourceAspect}
              getAspectRatioForItem={getAspectRatioForItem}
              cropContext="source"
              style={sourceCanvasStyle}
              ariaLabel="Source preview canvas"
            />
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--fg)]">Layout preview</h3>
            {appliedLayoutId ? (
              <span className="text-xs text-[var(--muted)]">Applied: {appliedLayoutId}</span>
            ) : null}
          </div>
          <div
            ref={handleLayoutContainerRef}
            className="flex w-full items-center justify-center"
            style={{ minHeight: basePreviewHeight }}
          >
            <LayoutCanvas
              layout={draftLayout}
              onTransform={handleLayoutTransform}
              onRequestBringForward={bringSelectionForward}
              onRequestSendBackward={sendSelectionBackward}
              onRequestDuplicate={duplicateSelection}
              onRequestDelete={handleRemoveSelected}
              showGrid={showGrid}
              showSafeMargins={showSafeMargins}
              previewContent={
                layoutPreviewSource ? (
                  <LayoutCompositionSurface
                    layout={draftLayout}
                    videoRef={layoutVideoRef}
                    source={layoutPreviewSource}
                    isPlaying={isPlaying}
                    currentTime={currentTime}
                    onLoadedMetadata={() => handleVideoLoadedMetadata('layout')}
                    onPlay={() => handleVideoPlay('layout')}
                    onPause={() => handleVideoPause('layout')}
                    onTimeUpdate={() => handleVideoTimeUpdate('layout')}
                    onSeeked={() => handleVideoSeeked('layout')}
                    className="pointer-events-none"
                    ariaLabel="Layout preview video"
                  />
                ) : (
                  <span className="text-xs text-white/60">No preview source available.</span>
                )
              }
              transformTarget={layoutTransformTarget}
              labelVisibility="selected"
              aspectRatioOverride={layoutAspectRatio}
              onRequestToggleAspectLock={handleToggleAspectLock}
              onRequestResetAspect={handleResetToSourceAspect}
              onRequestChangeTransformTarget={handleTransformTargetChange}
              getAspectRatioForItem={getAspectRatioForItem}
              cropContext="layout"
              style={layoutCanvasStyle}
              ariaLabel="Layout preview canvas"
            />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] px-4 py-3 text-xs text-[var(--muted)]">
        <button
          type="button"
          className="marble-button marble-button--ghost px-3 py-1 text-xs"
          onClick={handleTogglePlayback}
          disabled={!hasPreview}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <input
          type="range"
          min={0}
          max={sliderMax}
          step={0.05}
          value={Math.min(currentTime, sliderMax)}
          onChange={(event) => handleSeek(Number.parseFloat(event.target.value))}
          disabled={!hasPreview || effectiveDuration <= 0}
          className="h-1 flex-1 cursor-pointer accent-[var(--ring)]"
          aria-label="Scrub preview"
        />
        <span className="font-semibold text-[var(--fg)]">{formattedTimeLabel}</span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <span>{transportRangeLabel}</span>
        <span aria-hidden="true" className="hidden sm:inline">·</span>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />
          Grid
        </label>
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            checked={showSafeMargins}
            onChange={(event) => setShowSafeMargins(event.target.checked)}
          />
          Safe margins
        </label>
      </div>
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--fg)]">{selectionLabel}</h3>
          {selectionOffCanvas ? (
            <div className="flex items-center gap-3 rounded-full border border-[color:color-mix(in_srgb,var(--warning-strong)_60%,var(--edge))] bg-[color:var(--warning-soft)] px-3 py-1 text-xs text-[color:var(--warning-contrast)]">
              <span>Part of this selection sits outside the canvas.</span>
              <button
                type="button"
                className="rounded-full bg-[color:color-mix(in_srgb,var(--warning-contrast)_15%,transparent)] px-2 py-1 text-xs font-semibold"
                onClick={bringSelectionIntoView}
              >
                Bring into view
              </button>
            </div>
          ) : null}
        </div>
        {selectedItem ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Position & size
              </legend>
              <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                {(Object.keys(selectedItem.frame) as Array<keyof LayoutFrame>).map((key) => (
                  <label key={key} className="flex flex-col gap-1">
                    {key.toUpperCase()}
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      value={selectedItem.frame[key].toFixed(2)}
                      onChange={(event) => handleChangeItemFrameValue(selectedItem.id, key, Number.parseFloat(event.target.value))}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            {selectedItem.kind === 'video' ? (
              <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  Video settings
                </legend>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Name
                  <input
                    type="text"
                    value={(selectedItem as LayoutVideoItem).name ?? ''}
                    onChange={(event) => handleChangeVideoField(selectedItem.id, 'name', event.target.value)}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Scale mode
                  <select
                    value={(selectedItem as LayoutVideoItem).scaleMode ?? 'cover'}
                    onChange={(event) => handleChangeVideoField(selectedItem.id, 'scaleMode', event.target.value as LayoutVideoItem['scaleMode'])}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  >
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                    <option value="fill">Fill</option>
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                  <label className="flex flex-col gap-1">
                    Rotation (°)
                    <input
                      type="number"
                      value={(selectedItem as LayoutVideoItem).rotation ?? 0}
                      onChange={(event) => handleChangeVideoField(selectedItem.id, 'rotation', Number.parseFloat(event.target.value))}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(selectedItem as LayoutVideoItem).mirror ?? false}
                      onChange={(event) => handleChangeVideoField(selectedItem.id, 'mirror', event.target.checked)}
                    />
                    Mirror horizontally
                  </label>
                </div>
              </fieldset>
            ) : null}
            {selectedItem.kind === 'text' ? (
              <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
                <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                  Text settings
                </legend>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Content
                  <textarea
                    value={(selectedItem as LayoutTextItem).content}
                    onChange={(event) => handleChangeTextField(selectedItem.id, 'content', event.target.value)}
                    rows={3}
                    className="resize-none rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                  Colour
                  <input
                    type="text"
                    value={(selectedItem as LayoutTextItem).color ?? '#ffffff'}
                    onChange={(event) => handleChangeTextField(selectedItem.id, 'color', event.target.value)}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <div className="grid grid-cols-3 gap-3 text-xs text-[var(--muted)]">
                  <label className="flex flex-col gap-1">
                    Size
                    <input
                      type="number"
                      value={(selectedItem as LayoutTextItem).fontSize ?? 48}
                      onChange={(event) => handleChangeTextField(selectedItem.id, 'fontSize', Number.parseFloat(event.target.value))}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Weight
                    <select
                      value={(selectedItem as LayoutTextItem).fontWeight ?? 'bold'}
                      onChange={(event) => handleChangeTextField(selectedItem.id, 'fontWeight', event.target.value as LayoutTextItem['fontWeight'])}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    Align
                    <select
                      value={(selectedItem as LayoutTextItem).align ?? 'center'}
                      onChange={(event) => handleChangeTextField(selectedItem.id, 'align', event.target.value as LayoutTextItem['align'])}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </label>
                </div>
              </fieldset>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Layout details
              </legend>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                Name
                <input
                  type="text"
                  value={draftLayout?.name ?? ''}
                  onChange={handleNameChange}
                  placeholder="Layout name"
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                Description
                <textarea
                  value={draftLayout?.description ?? ''}
                  onChange={handleDescriptionChange}
                  rows={3}
                  placeholder="Describe how this layout should be used"
                  className="resize-none rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                />
              </label>
              <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                <label className="flex flex-col gap-1">
                  Canvas width (px)
                  <input
                    type="number"
                    min={100}
                    name="width"
                    value={draftLayout?.canvas.width ?? 1080}
                    onChange={handleCanvasDimensionChange}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  Canvas height (px)
                  <input
                    type="number"
                    min={100}
                    name="height"
                    value={draftLayout?.canvas.height ?? 1920}
                    onChange={handleCanvasDimensionChange}
                    className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                  />
                </label>
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-3 rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_70%,transparent)] p-4">
              <legend className="text-xs font-semibold uppercase tracking-wide text-[color:color-mix(in_srgb,var(--muted)_70%,transparent)]">
                Background
              </legend>
              <label className="flex flex-col gap-1 text-xs text-[var(--muted)]">
                Background type
                <select
                  value={draftLayout?.canvas.background.kind ?? 'blur'}
                  onChange={handleBackgroundKindChange}
                  className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-2 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <option value="blur">Blurred video</option>
                  <option value="color">Solid colour</option>
                  <option value="image">Image</option>
                </select>
              </label>
              {draftLayout?.canvas.background.kind === 'blur' ? (
                <div className="grid grid-cols-3 gap-3 text-xs text-[var(--muted)]">
                  <label className="flex flex-col gap-1">
                    Radius
                    <input
                      type="number"
                      name="radius"
                      value={draftLayout.canvas.background.radius ?? 45}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Opacity
                    <input
                      type="number"
                      name="opacity"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draftLayout.canvas.background.opacity ?? 0.6}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Brightness
                    <input
                      type="number"
                      name="brightness"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draftLayout.canvas.background.brightness ?? 0.55}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                </div>
              ) : null}
              {draftLayout?.canvas.background.kind === 'color' ? (
                <div className="grid grid-cols-2 gap-3 text-xs text-[var(--muted)]">
                  <label className="flex flex-col gap-1">
                    Colour
                    <input
                      type="text"
                      name="color"
                      value={draftLayout.canvas.background.color ?? '#000000'}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Opacity
                    <input
                      type="number"
                      name="opacity"
                      min={0}
                      max={1}
                      step={0.05}
                      value={draftLayout.canvas.background.opacity ?? 1}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                </div>
              ) : null}
              {draftLayout?.canvas.background.kind === 'image' ? (
                <div className="grid grid-cols-1 gap-3 text-xs text-[var(--muted)]">
                  <label className="flex flex-col gap-1">
                    Image path
                    <input
                      type="text"
                      name="source"
                      value={draftLayout.canvas.background.source ?? ''}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Fit mode
                    <select
                      name="mode"
                      value={draftLayout.canvas.background.mode ?? 'cover'}
                      onChange={handleBackgroundFieldChange}
                      className="rounded-lg border border-white/10 bg-[var(--card)] px-3 py-1.5 text-sm text-[var(--fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    >
                      <option value="cover">Cover</option>
                      <option value="contain">Contain</option>
                    </select>
                  </label>
                </div>
              ) : null}
            </fieldset>
          </div>
        )}
      </form>
      <div className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-[color:color-mix(in_srgb,var(--panel)_65%,transparent)] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="marble-button marble-button--solid px-3 py-2 text-sm"
            onClick={handleRender}
            disabled={!draftLayout || isRenderingLayout}
          >
            {isRenderingLayout ? 'Rendering…' : 'Render with this layout'}
          </button>
          <p className="text-xs text-[var(--muted)]">
            Rebuild the clip using your latest layout adjustments.
          </p>
        </div>
        {shouldShowRenderSteps ? (
          <div className="rounded-xl border border-white/10 bg-[color:color-mix(in_srgb,var(--card)_55%,transparent)] p-4 text-sm text-[var(--muted)]">
            <h3 className="text-sm font-semibold text-[var(--fg)]">Rendering progress</h3>
            <ol className="mt-3 space-y-3">
              {renderSteps.map((step) => {
                const isCompleted = step.status === 'completed'
                const isRunning = step.status === 'running'
                const isFailed = step.status === 'failed'
                const indicatorClasses = isCompleted
                  ? 'border-[color:color-mix(in_srgb,var(--success-strong)_45%,var(--edge))] bg-[color:var(--success-soft)] text-[color:color-mix(in_srgb,var(--success-strong)_85%,var(--accent-contrast))]'
                  : isFailed
                    ? 'border-[color:color-mix(in_srgb,var(--error-strong)_45%,var(--edge))] bg-[color:var(--error-soft)] text-[color:color-mix(in_srgb,var(--error-strong)_85%,var(--accent-contrast))]'
                    : isRunning
                      ? 'border-[var(--ring)] text-[var(--ring)]'
                      : 'border-white/15 text-[var(--muted)]'
                return (
                  <li key={step.id} className="flex items-start gap-3">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${indicatorClasses}`}
                      aria-hidden
                    >
                      {isRunning ? (
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : isCompleted ? (
                        '✓'
                      ) : isFailed ? (
                        '!'
                      ) : (
                        '•'
                      )}
                    </span>
                    <div>
                      <p className="font-medium text-[var(--fg)]">{step.label}</p>
                      <p className="text-xs">{step.description}</p>
                    </div>
                  </li>
                )
              })}
            </ol>
            {renderStatusMessage ? (
              <p className="mt-3 text-xs text-[var(--fg)]">{renderStatusMessage}</p>
            ) : null}
            {renderErrorMessage ? (
              <p className="mt-3 text-xs text-[color:color-mix(in_srgb,var(--error-strong)_80%,var(--accent-contrast))]">
                {renderErrorMessage}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default LayoutEditorPanel
