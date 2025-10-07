const normaliseBaseUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  try {
    const url = new URL(candidate)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    return null
  }
}

const baseUrl = normaliseBaseUrl(import.meta.env.VITE_LICENSE_API_BASE_URL)

export const getLicensingApiBaseUrl = (): string | null => baseUrl

export const buildLicensingUrl = (path: string): string => {
  const base = getLicensingApiBaseUrl()
  if (!base) {
    throw new Error('Licensing API base URL is not configured.')
  }
  const url = new URL(path, base)
  return url.toString()
}
