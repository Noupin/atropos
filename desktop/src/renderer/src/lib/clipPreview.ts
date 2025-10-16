import type { Clip } from '../types'

export type ClipPreviewState = {
  in: number
  out: number
  duration: number
  tClip: number
  isOutOfRange: boolean
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

export const getClipPreviewState = (
  clip: Pick<Clip, 'startSeconds' | 'endSeconds' | 'sourceDurationSeconds'>,
  globalPlayhead: number | null | undefined
): ClipPreviewState => {
  const start = sanitizeTime(clip.startSeconds, 0)
  const rawEnd = sanitizeTime(clip.endSeconds, start)
  const sourceDuration =
    typeof clip.sourceDurationSeconds === 'number' && Number.isFinite(clip.sourceDurationSeconds)
      ? Math.max(0, clip.sourceDurationSeconds)
      : null
  const sourceBound = sourceDuration !== null ? start + sourceDuration : null
  const end = sourceBound !== null ? Math.min(rawEnd, sourceBound) : rawEnd
  const duration = Math.max(0, end - start)

  const safePlayhead =
    typeof globalPlayhead === 'number' && Number.isFinite(globalPlayhead) ? globalPlayhead : start
  const clampedPlayhead = clamp(safePlayhead, start, end)
  const localTime = duration > 0 ? clampedPlayhead - start : 0
  const isOutOfRange = safePlayhead < start || safePlayhead > end

  return {
    in: start,
    out: end,
    duration,
    tClip: duration > 0 ? localTime : 0,
    isOutOfRange
  }
}

export default getClipPreviewState
