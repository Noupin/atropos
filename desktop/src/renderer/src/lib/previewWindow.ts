export const clampToRange = (value: number, minimum: number, maximum: number): number => {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) {
    return value
  }
  const lower = Math.min(minimum, maximum)
  const upper = Math.max(minimum, maximum)
  if (!Number.isFinite(value)) {
    return lower
  }
  return Math.min(Math.max(value, lower), upper)
}

export const resolvePlaybackTarget = (
  clipStart: number,
  clipEnd: number,
  playhead: number
): number => {
  const safeStart = Number.isFinite(clipStart) && clipStart >= 0 ? clipStart : 0
  const boundedEnd = Number.isFinite(clipEnd) ? clipEnd : safeStart
  const safeEnd = Math.max(boundedEnd, safeStart)
  const duration = Math.max(0, safeEnd - safeStart)
  if (duration === 0) {
    return safeStart
  }
  const offset = clampToRange(playhead - safeStart, 0, duration)
  return safeStart + offset
}

export const isBeyondPlaybackWindow = (
  currentTime: number,
  clipEnd: number,
  tolerance = 0.005
): boolean => {
  if (!Number.isFinite(currentTime) || !Number.isFinite(clipEnd)) {
    return false
  }
  if (clipEnd <= 0) {
    return false
  }
  return currentTime >= clipEnd - tolerance
}
