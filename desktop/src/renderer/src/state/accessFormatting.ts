export const formatOfflineCountdown = (remainingMs: number | null): string | null => {
  if (remainingMs === null || remainingMs <= 0) {
    return null
  }

  const totalSeconds = Math.ceil(remainingMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    const parts = [`${hours}h`]
    if (minutes > 0) {
      parts.push(`${minutes}m`)
    }
    return parts.join(' ')
  }

  if (minutes > 0) {
    if (seconds > 0) {
      return `${minutes}m ${seconds}s`
    }
    return `${minutes}m`
  }

  return `${seconds}s`
}
