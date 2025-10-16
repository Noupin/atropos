import type { Clip } from '../types'

export type ClipPlaybackWindow = {
  playbackStart: number
  playbackEnd: number
  playbackDuration: number
}

export type ClipPreviewState = ClipPlaybackWindow & {
  localTime: number
  absoluteTime: number
}

const sanitizeTime = (value: number | null | undefined, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return value
}

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min
  }
  if (value > max) {
    return max
  }
  return value
}

export const getClipPlaybackWindow = (
  clip: Pick<Clip, 'startSeconds' | 'endSeconds' | 'sourceDurationSeconds'>
): ClipPlaybackWindow => {
  const playbackStart = sanitizeTime(clip.startSeconds, 0)
  const rawEnd = sanitizeTime(clip.endSeconds, playbackStart)
  const sourceDuration =
    typeof clip.sourceDurationSeconds === 'number' && Number.isFinite(clip.sourceDurationSeconds)
      ? Math.max(0, clip.sourceDurationSeconds)
      : null
  const sourceBound = sourceDuration !== null ? playbackStart + sourceDuration : null
  const playbackEnd = sourceBound !== null ? Math.min(rawEnd, sourceBound) : rawEnd
  const playbackDuration = Math.max(0, playbackEnd - playbackStart)

  return { playbackStart, playbackEnd, playbackDuration }
}

export const getClipPreviewState = (
  clip: Pick<Clip, 'startSeconds' | 'endSeconds' | 'sourceDurationSeconds'>,
  globalPlayhead: number | null | undefined
): ClipPreviewState => {
  const playbackWindow = getClipPlaybackWindow(clip)

  const safePlayhead =
    typeof globalPlayhead === 'number' && Number.isFinite(globalPlayhead)
      ? globalPlayhead
      : playbackWindow.playbackStart
  const clampedPlayhead = clamp(
    safePlayhead,
    playbackWindow.playbackStart,
    playbackWindow.playbackEnd
  )
  const localTime =
    playbackWindow.playbackDuration > 0 ? clampedPlayhead - playbackWindow.playbackStart : 0
  const absoluteTime = playbackWindow.playbackStart + (playbackWindow.playbackDuration > 0 ? localTime : 0)
  return {
    playbackStart: playbackWindow.playbackStart,
    playbackEnd: playbackWindow.playbackEnd,
    playbackDuration: playbackWindow.playbackDuration,
    localTime: playbackWindow.playbackDuration > 0 ? localTime : 0,
    absoluteTime
  }
}

export default getClipPreviewState
