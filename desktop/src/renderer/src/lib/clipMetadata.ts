export interface ClipTimestampMetadata {
  timestampUrl: string | null
  timestampSeconds: number | null
}

const FULL_VIDEO_PATTERN = /^full video:\s*(https?:\/\/\S+)/i

const TIME_COMPONENT_PATTERN = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)(?:s)?)?$/

const extractSecondsFromComponent = (value: string | null): number | null => {
  if (!value) {
    return null
  }

  const normalised = value.trim().toLowerCase()
  if (normalised.length === 0) {
    return null
  }

  if (/^\d+$/.test(normalised)) {
    return Number.parseInt(normalised, 10)
  }

  if (TIME_COMPONENT_PATTERN.test(normalised)) {
    const [, hoursPart, minutesPart, secondsPart] = normalised.match(TIME_COMPONENT_PATTERN) ?? []
    const hours = hoursPart ? Number.parseInt(hoursPart, 10) : 0
    const minutes = minutesPart ? Number.parseInt(minutesPart, 10) : 0
    const seconds = secondsPart ? Number.parseInt(secondsPart, 10) : 0
    return hours * 3600 + minutes * 60 + seconds
  }

  const digits = normalised.match(/\d+/)
  return digits ? Number.parseInt(digits[0], 10) : null
}

const parseTimestampFromUrl = (rawUrl: string): number | null => {
  try {
    const url = new URL(rawUrl)
    const searchValue = url.searchParams.get('t') ?? url.searchParams.get('start')
    const hashMatch = url.hash.match(/t=([^&]+)/)
    const candidate = searchValue ?? (hashMatch ? hashMatch[1] : null)
    return extractSecondsFromComponent(candidate)
  } catch (error) {
    return null
  }
}

export const parseClipTimestamp = (description: string | null | undefined): ClipTimestampMetadata => {
  if (!description) {
    return { timestampUrl: null, timestampSeconds: null }
  }

  const lines = description.split(/\r?\n/)
  for (const line of lines) {
    const match = line.match(FULL_VIDEO_PATTERN)
    if (match) {
      const url = match[1].trim()
      if (url.length === 0) {
        break
      }
      return {
        timestampUrl: url,
        timestampSeconds: parseTimestampFromUrl(url)
      }
    }
  }

  return { timestampUrl: null, timestampSeconds: null }
}
