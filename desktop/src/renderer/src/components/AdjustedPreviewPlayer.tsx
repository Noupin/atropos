import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState
} from 'react'
import type { ForwardedRef } from 'react'
import {
  clampToWindow,
  computeAdjustedPreviewTiming,
  nearlyEqual
} from '../lib/adjustedPreviewTiming'

type SharedVolumeState = { volume: number; muted: boolean }

type AdjustedPreviewPlayerProps = {
  clipStartTime: number
  clipEndTime: number
  sourceUrl: string | null
  fallbackPreviewUrl: string
  fallbackPoster?: string
  globalPlayhead: number
  onGlobalPlayheadChange: (value: number) => void
  sharedVolume: SharedVolumeState
  onSharedVolumeChange: (state: SharedVolumeState) => void
  onBufferingChange: (buffering: boolean) => void
  isActive: boolean
  className?: string
}

type SourceVariant = 'raw' | 'fallback'

const BUFFER_TOLERANCE = 0.04

const resolveInitialVariant = (sourceUrl: string | null): SourceVariant => {
  if (!sourceUrl || sourceUrl.trim() === '') {
    return 'fallback'
  }
  return 'raw'
}

const AdjustedPreviewPlayer = (
  {
    clipStartTime,
    clipEndTime,
    sourceUrl,
    fallbackPreviewUrl,
    fallbackPoster,
    globalPlayhead,
    onGlobalPlayheadChange,
    sharedVolume,
    onSharedVolumeChange,
    onBufferingChange,
    isActive,
    className
  }: AdjustedPreviewPlayerProps,
  forwardedRef: ForwardedRef<HTMLVideoElement>
) => {
  const internalRef = useRef<HTMLVideoElement | null>(null)
  const [sourceVariant, setSourceVariant] = useState<SourceVariant>(
    resolveInitialVariant(sourceUrl)
  )
  const resumeOnActivateRef = useRef(false)
  const hasWarnedForMissingSourceRef = useRef(false)

  useImperativeHandle(forwardedRef, () => internalRef.current as HTMLVideoElement | null)

  const syncVolume = useCallback(
    (element: HTMLVideoElement | null) => {
      if (!element) {
        return
      }
      element.volume = sharedVolume.volume
      element.muted = sharedVolume.muted
    },
    [sharedVolume.muted, sharedVolume.volume]
  )

  const assignRef = useCallback(
    (element: HTMLVideoElement | null) => {
      internalRef.current = element
      syncVolume(element)
    },
    [syncVolume]
  )

  useEffect(() => {
    const variant = resolveInitialVariant(sourceUrl)
    setSourceVariant(variant)
    if (variant === 'fallback' && !hasWarnedForMissingSourceRef.current) {
      console.warn(
        'Adjusted preview: raw source unavailable, falling back to processed clip.'
      )
      hasWarnedForMissingSourceRef.current = true
    }
  }, [sourceUrl])

  const activeSource = useMemo(() => {
    return sourceVariant === 'raw' ? sourceUrl ?? '' : fallbackPreviewUrl
  }, [fallbackPreviewUrl, sourceUrl, sourceVariant])

  const usingFallback = sourceVariant === 'fallback'

  useEffect(() => {
    syncVolume(internalRef.current)
  }, [syncVolume])

  const updatePlayhead = useCallback(
    (value: number) => {
      const clamped = clampToWindow(value, clipStartTime, clipEndTime)
      if (!nearlyEqual(clamped, value)) {
        onGlobalPlayheadChange(clamped)
        return
      }
      onGlobalPlayheadChange(value)
    },
    [clipEndTime, clipStartTime, onGlobalPlayheadChange]
  )

  const syncCurrentTime = useCallback(
    (element: HTMLVideoElement | null, reason: string) => {
      if (!element) {
        return
      }
      const timing = computeAdjustedPreviewTiming(clipStartTime, clipEndTime, globalPlayhead)
      const desiredTime = usingFallback
        ? timing.playheadOffset
        : timing.currentTime
      if (!Number.isFinite(desiredTime)) {
        return
      }

      const tolerance = 0.04
      if (!nearlyEqual(element.currentTime, desiredTime, tolerance)) {
        try {
          element.currentTime = desiredTime
        } catch (error) {
          console.warn('Adjusted preview: unable to seek video element', reason, error)
        }
      }
      if (!nearlyEqual(globalPlayhead, timing.currentTime)) {
        updatePlayhead(timing.currentTime)
      }
    },
    [clipEndTime, clipStartTime, globalPlayhead, updatePlayhead, usingFallback]
  )

  useEffect(() => {
    syncCurrentTime(internalRef.current, 'initial-sync')
  }, [syncCurrentTime])

  useEffect(() => {
    const element = internalRef.current
    if (!element) {
      return
    }
    if (!isActive) {
      if (!element.paused && !element.ended) {
        resumeOnActivateRef.current = true
        element.pause()
      } else {
        resumeOnActivateRef.current = false
      }
      return
    }
    syncCurrentTime(element, 'mode-activation')
    if (resumeOnActivateRef.current) {
      const playback = element.play()
      if (playback && typeof playback.catch === 'function') {
        playback.catch(() => undefined)
      }
    }
  }, [isActive, syncCurrentTime])

  const handleLoadStart = useCallback(() => {
    onBufferingChange(true)
  }, [onBufferingChange])

  const handleCanPlay = useCallback(() => {
    onBufferingChange(false)
    const element = internalRef.current
    if (!element) {
      return
    }
    syncCurrentTime(element, 'canplay')
    if (resumeOnActivateRef.current && isActive) {
      const playback = element.play()
      if (playback && typeof playback.catch === 'function') {
        playback.catch(() => undefined)
      }
    }
  }, [isActive, onBufferingChange, syncCurrentTime])

  const handlePlaying = useCallback(() => {
    onBufferingChange(false)
  }, [onBufferingChange])

  const handleWaiting = useCallback(() => {
    onBufferingChange(true)
  }, [onBufferingChange])

  const handleError = useCallback(() => {
    const element = internalRef.current
    if (!element) {
      return
    }
    if (sourceVariant === 'raw') {
      console.warn(
        'Adjusted preview: failed to load raw source, falling back to processed clip.'
      )
      setSourceVariant('fallback')
      resumeOnActivateRef.current = !element.paused && !element.ended
      element.pause()
      onBufferingChange(false)
      return
    }
    onBufferingChange(false)
  }, [onBufferingChange, setSourceVariant, sourceVariant])

  const handleVolumeChange = useCallback(() => {
    const element = internalRef.current
    if (!element) {
      return
    }
    onSharedVolumeChange({ volume: element.volume, muted: element.muted })
  }, [onSharedVolumeChange])

  const handlePlay = useCallback(() => {
    resumeOnActivateRef.current = true
    syncCurrentTime(internalRef.current, 'play-event')
  }, [syncCurrentTime])

  const handlePause = useCallback(() => {
    resumeOnActivateRef.current = false
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const element = internalRef.current
    if (!element) {
      return
    }
    const timing = computeAdjustedPreviewTiming(clipStartTime, clipEndTime, globalPlayhead)
    const absoluteTime = usingFallback
      ? clipStartTime + element.currentTime
      : element.currentTime
    const clamped = clampToWindow(absoluteTime, timing.adjustedStart, timing.adjustedEnd)
    if (!nearlyEqual(clamped, globalPlayhead)) {
      onGlobalPlayheadChange(clamped)
    }
    const reachedEnd = clamped >= timing.adjustedEnd - BUFFER_TOLERANCE
    if (reachedEnd && !element.paused && !element.ended) {
      element.pause()
      const endPosition = usingFallback
        ? Math.max(0, timing.adjustedEnd - clipStartTime)
        : timing.adjustedEnd
      if (!nearlyEqual(element.currentTime, endPosition)) {
        try {
          element.currentTime = endPosition
        } catch (error) {
          console.warn('Adjusted preview: unable to clamp at end of window', error)
        }
      }
    }
  }, [
    clipEndTime,
    clipStartTime,
    globalPlayhead,
    onGlobalPlayheadChange,
    usingFallback
  ])

  const videoClassName = useMemo(() => {
    const base = className
      ? `${className}`
      : 'h-full w-auto max-h-full max-w-full bg-black object-contain'
    if (isActive) {
      return `${base}`
    }
    return `${base} pointer-events-none opacity-0 absolute inset-0`
  }, [className, isActive])

  const poster = useMemo(() => {
    if (sourceVariant === 'raw') {
      return undefined
    }
    return fallbackPoster
  }, [fallbackPoster, sourceVariant])

  return (
    <video
      ref={assignRef}
      src={activeSource}
      poster={poster}
      controls={isActive}
      playsInline
      preload="metadata"
      onLoadStart={handleLoadStart}
      onCanPlay={handleCanPlay}
      onPlaying={handlePlaying}
      onWaiting={handleWaiting}
      onError={handleError}
      onTimeUpdate={handleTimeUpdate}
      onPlay={handlePlay}
      onPause={handlePause}
      onVolumeChange={handleVolumeChange}
      className={videoClassName}
      aria-hidden={!isActive}
      data-adjusted-source={sourceVariant}
    >
      Your browser does not support the video tag.
    </video>
  )
}

export default forwardRef<HTMLVideoElement, AdjustedPreviewPlayerProps>(AdjustedPreviewPlayer)

