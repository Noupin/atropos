export type AdjustedPreviewTiming = {
  adjustedStart: number
  adjustedEnd: number
  duration: number
  playheadOffset: number
  currentTime: number
}

const clamp = (value: number, minimum: number, maximum: number): number => {
  if (Number.isNaN(value)) {
    return minimum
  }
  if (value < minimum) {
    return minimum
  }
  if (value > maximum) {
    return maximum
  }
  return value
}

export const clampToWindow = (
  value: number,
  start: number,
  end: number
): number => {
  const windowStart = Number.isFinite(start) ? start : 0
  const windowEnd = Number.isFinite(end) ? Math.max(windowStart, end) : windowStart
  if (windowEnd <= windowStart) {
    return windowStart
  }
  return clamp(value, windowStart, windowEnd)
}

export const computeAdjustedPreviewTiming = (
  clipStartTime: number,
  clipEndTime: number,
  globalPlayhead: number
): AdjustedPreviewTiming => {
  const adjustedStart = Number.isFinite(clipStartTime) ? Math.max(0, clipStartTime) : 0
  const rawEnd = Number.isFinite(clipEndTime) ? clipEndTime : adjustedStart
  const adjustedEnd = rawEnd > adjustedStart ? rawEnd : adjustedStart
  const duration = Math.max(0, adjustedEnd - adjustedStart)
  const playheadOffset = clamp(globalPlayhead - adjustedStart, 0, duration)
  const currentTime = adjustedStart + playheadOffset

  return {
    adjustedStart,
    adjustedEnd,
    duration,
    playheadOffset,
    currentTime
  }
}

export const nearlyEqual = (a: number, b: number, tolerance = 0.0005): boolean => {
  if (!Number.isFinite(a) && !Number.isFinite(b)) {
    return true
  }
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false
  }
  return Math.abs(a - b) <= tolerance
}

