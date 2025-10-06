const DEFAULT_LICENSE_BASE_URL = 'https://dev.api.atropos-video.com'

const normaliseBaseUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  try {
    const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    const url = new URL(candidate)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    return null
  }
}

const resolvedBaseUrl =
  normaliseBaseUrl(process.env.VITE_LICENSE_API_BASE_URL) ?? DEFAULT_LICENSE_BASE_URL

export const getLicenseApiBaseUrl = (): string => resolvedBaseUrl
