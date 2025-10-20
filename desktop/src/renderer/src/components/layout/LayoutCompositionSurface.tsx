import type { FC, MutableRefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import type {
  LayoutDefinition,
  LayoutItem,
  LayoutShapeItem,
  LayoutTextItem,
  LayoutVideoItem
} from '../../../../types/layouts'

type LayoutCompositionSurfaceProps = {
  layout: LayoutDefinition | null
  videoRef: MutableRefObject<HTMLVideoElement | null>
  source: string
  isPlaying: boolean
  currentTime: number
  onLoadedMetadata: () => void
  onPlay: () => void
  onPause: () => void
  onTimeUpdate: () => void
  onSeeked: () => void
  className?: string
  ariaLabel?: string
}

type NormalisedCrop = {
  x: number
  y: number
  width: number
  height: number
}

const clamp = (value: number, min = 0, max = 1): number => Math.min(Math.max(value, min), max)

const normaliseCrop = (item: LayoutVideoItem): NormalisedCrop => {
  const crop = item.crop ?? { x: 0, y: 0, width: 1, height: 1 }
  if (crop.units === 'pixels') {
    return {
      x: crop.x,
      y: crop.y,
      width: Math.max(1, crop.width),
      height: Math.max(1, crop.height)
    }
  }
  return {
    x: clamp(crop.x),
    y: clamp(crop.y),
    width: clamp(crop.width),
    height: clamp(crop.height)
  }
}

const sortItemsByZ = (items: LayoutItem[]): LayoutItem[] => {
  return [...items].sort((a, b) => {
    const aIndex = 'zIndex' in a && typeof a.zIndex === 'number' ? a.zIndex : 0
    const bIndex = 'zIndex' in b && typeof b.zIndex === 'number' ? b.zIndex : 0
    if (aIndex !== bIndex) {
      return aIndex - bIndex
    }
    return a.id.localeCompare(b.id)
  })
}

const drawBackground = (
  ctx: CanvasRenderingContext2D,
  layout: LayoutDefinition,
  video: HTMLVideoElement,
  width: number,
  height: number
) => {
  const background = layout.canvas.background
  if (background.kind === 'color') {
    const color = background.color ?? '#000000'
    const opacity = background.opacity ?? 1
    ctx.save()
    ctx.globalAlpha = clamp(opacity, 0, 1)
    ctx.fillStyle = color
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
    return
  }

  if (background.kind === 'image') {
    ctx.save()
    ctx.fillStyle = background.tint ?? '#0f172a'
    ctx.fillRect(0, 0, width, height)
    ctx.restore()
    return
  }

  const radius = background.radius ?? 45
  const opacity = background.opacity ?? 0.6
  const saturation = background.saturation ?? 1
  const brightness = background.brightness ?? 1

  const videoWidth = video.videoWidth || width
  const videoHeight = video.videoHeight || height
  if (videoWidth === 0 || videoHeight === 0) {
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)
    return
  }

  const videoAspect = videoWidth / videoHeight
  const canvasAspect = width / height
  let sx = 0
  let sy = 0
  let sWidth = videoWidth
  let sHeight = videoHeight
  if (videoAspect > canvasAspect) {
    const desiredWidth = videoHeight * canvasAspect
    sx = (videoWidth - desiredWidth) / 2
    sWidth = desiredWidth
  } else {
    const desiredHeight = videoWidth / canvasAspect
    sy = (videoHeight - desiredHeight) / 2
    sHeight = desiredHeight
  }

  ctx.save()
  ctx.filter = `blur(${Math.max(0, radius)}px) saturate(${Math.max(0, saturation)}) brightness(${Math.max(
    0,
    brightness
  )})`
  ctx.globalAlpha = clamp(opacity, 0, 1)
  ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, width, height)
  ctx.restore()
}

const drawVideoItem = (
  ctx: CanvasRenderingContext2D,
  item: LayoutVideoItem,
  video: HTMLVideoElement,
  width: number,
  height: number
) => {
  const crop = normaliseCrop(item)
  const destX = clamp(item.frame.x) * width
  const destY = clamp(item.frame.y) * height
  const destWidth = clamp(item.frame.width) * width
  const destHeight = clamp(item.frame.height) * height

  const videoWidth = video.videoWidth || width
  const videoHeight = video.videoHeight || height
  if (videoWidth === 0 || videoHeight === 0 || destWidth === 0 || destHeight === 0) {
    return
  }

  const units = item.crop?.units ?? 'fraction'
  const sourceWidth = units === 'pixels' ? crop.width : clamp(crop.width) * videoWidth
  const sourceHeight = units === 'pixels' ? crop.height : clamp(crop.height) * videoHeight
  const sourceX = units === 'pixels' ? crop.x : clamp(crop.x) * videoWidth
  const sourceY = units === 'pixels' ? crop.y : clamp(crop.y) * videoHeight

  ctx.save()
  if (item.opacity != null) {
    ctx.globalAlpha = clamp(item.opacity, 0, 1)
  }
  ctx.translate(destX + destWidth / 2, destY + destHeight / 2)
  const rotation = item.rotation ?? 0
  if (rotation !== 0) {
    ctx.rotate((rotation * Math.PI) / 180)
  }
  if (item.mirror) {
    ctx.scale(-1, 1)
  }
  ctx.drawImage(
    video,
    sourceX,
    sourceY,
    Math.max(1, sourceWidth),
    Math.max(1, sourceHeight),
    -destWidth / 2,
    -destHeight / 2,
    destWidth,
    destHeight
  )
  ctx.restore()
}

const drawShapeItem = (
  ctx: CanvasRenderingContext2D,
  item: LayoutShapeItem,
  width: number,
  height: number
) => {
  const frame = item.frame
  const destX = clamp(frame.x) * width
  const destY = clamp(frame.y) * height
  const destWidth = clamp(frame.width) * width
  const destHeight = clamp(frame.height) * height

  ctx.save()
  ctx.globalAlpha = clamp(item.opacity ?? 1, 0, 1)
  ctx.fillStyle = item.color ?? '#000000'
  const radius = Math.max(0, item.borderRadius ?? 0)
  if (radius > 0) {
    const r = Math.min(radius, destWidth / 2, destHeight / 2)
    ctx.beginPath()
    ctx.moveTo(destX + r, destY)
    ctx.lineTo(destX + destWidth - r, destY)
    ctx.quadraticCurveTo(destX + destWidth, destY, destX + destWidth, destY + r)
    ctx.lineTo(destX + destWidth, destY + destHeight - r)
    ctx.quadraticCurveTo(destX + destWidth, destY + destHeight, destX + destWidth - r, destY + destHeight)
    ctx.lineTo(destX + r, destY + destHeight)
    ctx.quadraticCurveTo(destX, destY + destHeight, destX, destY + destHeight - r)
    ctx.lineTo(destX, destY + r)
    ctx.quadraticCurveTo(destX, destY, destX + r, destY)
    ctx.closePath()
    ctx.fill()
  } else {
    ctx.fillRect(destX, destY, destWidth, destHeight)
  }
  ctx.restore()
}

const drawTextItem = (
  ctx: CanvasRenderingContext2D,
  item: LayoutTextItem,
  width: number,
  height: number
) => {
  const frame = item.frame
  const destX = clamp(frame.x) * width
  const destY = clamp(frame.y) * height
  const destWidth = clamp(frame.width) * width
  const destHeight = clamp(frame.height) * height

  const content = item.content ?? ''
  if (!content.trim()) {
    return
  }

  const fontSize = Math.max(12, item.fontSize ?? Math.round(destHeight * 0.18))
  const lineHeight = (item.lineHeight ?? 1.2) * fontSize
  const fontFamily = item.fontFamily ?? 'Inter'
  const fontWeight = item.fontWeight === 'bold' ? 'bold' : 'normal'
  const align = item.align ?? 'center'

  ctx.save()
  ctx.globalAlpha = clamp(item.opacity ?? 1, 0, 1)
  ctx.fillStyle = item.color ?? '#ffffff'
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.textAlign = align
  ctx.textBaseline = 'top'

  const words = content.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const test = current.length === 0 ? word : `${current} ${word}`
    const metrics = ctx.measureText(test)
    if (metrics.width > destWidth && current.length > 0) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current.length > 0) {
    lines.push(current)
  }

  const totalHeight = lines.length * lineHeight
  let startY = destY
  if (totalHeight < destHeight) {
    startY += (destHeight - totalHeight) / 2
  }

  const anchorX = align === 'left' ? destX : align === 'right' ? destX + destWidth : destX + destWidth / 2

  lines.slice(0, Math.max(1, Math.floor(destHeight / lineHeight))).forEach((line, index) => {
    ctx.fillText(line, anchorX, startY + index * lineHeight, destWidth)
  })

  ctx.restore()
}

const LayoutCompositionSurface: FC<LayoutCompositionSurfaceProps> = ({
  layout,
  videoRef,
  source,
  isPlaying,
  currentTime,
  onLoadedMetadata,
  onPlay,
  onPause,
  onTimeUpdate,
  onSeeked,
  className,
  ariaLabel
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameRequestRef = useRef<number | null>(null)

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current
    const layoutDefinition = layout
    const video = videoRef.current
    if (!canvas || !layoutDefinition || !video || video.readyState < 2) {
      return
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }
    const dpr = window.devicePixelRatio || 1
    const baseWidth = Math.max(1, layoutDefinition.canvas.width || video.videoWidth || 1080)
    const baseHeight = Math.max(1, layoutDefinition.canvas.height || video.videoHeight || 1920)
    if (canvas.width !== baseWidth * dpr || canvas.height !== baseHeight * dpr) {
      canvas.width = baseWidth * dpr
      canvas.height = baseHeight * dpr
      canvas.style.width = '100%'
      canvas.style.height = '100%'
    }
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, baseWidth, baseHeight)

    drawBackground(ctx, layoutDefinition, video, baseWidth, baseHeight)

    const orderedItems = sortItemsByZ(layoutDefinition.items)
    orderedItems.forEach((item) => {
      if ((item as LayoutVideoItem).kind === 'video') {
        drawVideoItem(ctx, item as LayoutVideoItem, video, baseWidth, baseHeight)
        return
      }
      if ((item as LayoutTextItem).kind === 'text') {
        drawTextItem(ctx, item as LayoutTextItem, baseWidth, baseHeight)
        return
      }
      drawShapeItem(ctx, item as LayoutShapeItem, baseWidth, baseHeight)
    })

    ctx.restore()
  }, [layout, videoRef])

  useEffect(() => {
    drawFrame()
  }, [drawFrame, layout, currentTime])

  useEffect(() => {
    if (!isPlaying) {
      return
    }
    const tick = () => {
      drawFrame()
      frameRequestRef.current = requestAnimationFrame(tick)
    }
    frameRequestRef.current = requestAnimationFrame(tick)
    return () => {
      if (frameRequestRef.current != null) {
        cancelAnimationFrame(frameRequestRef.current)
        frameRequestRef.current = null
      }
    }
  }, [drawFrame, isPlaying])

  useEffect(() => {
    return () => {
      if (frameRequestRef.current != null) {
        cancelAnimationFrame(frameRequestRef.current)
      }
    }
  }, [])

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <canvas ref={canvasRef} className="h-full w-full" aria-hidden />
      <video
        ref={videoRef}
        src={source}
        className="pointer-events-none absolute left-0 top-0 h-0 w-0"
        playsInline
        muted
        preload="metadata"
        aria-label={ariaLabel ?? 'Layout preview video'}
        onLoadedMetadata={(event) => {
          onLoadedMetadata()
          if (event.currentTarget.readyState >= 2) {
            drawFrame()
          }
        }}
        onPlay={(event) => {
          onPlay()
          if (event.currentTarget.readyState >= 2) {
            drawFrame()
          }
        }}
        onPause={(event) => {
          onPause()
          if (event.currentTarget.readyState >= 2) {
            drawFrame()
          }
        }}
        onTimeUpdate={(event) => {
          onTimeUpdate()
          if (event.currentTarget.readyState >= 2) {
            drawFrame()
          }
        }}
        onSeeked={(event) => {
          onSeeked()
          if (event.currentTarget.readyState >= 2) {
            drawFrame()
          }
        }}
      />
    </div>
  )
}

export default LayoutCompositionSurface
