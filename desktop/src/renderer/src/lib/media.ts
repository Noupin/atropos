import { getApiBaseUrl } from '../config/backend'

export type PlayableSourceResolution =
  | { status: 'ok'; src: string }
  | { status: 'empty'; src: null }
  | { status: 'remote-blocked'; src: null; hostname: string | null }
  | { status: 'invalid'; src: null }

const HTTP_PROTOCOL_PATTERN = /^https?:\/\//i
const FILE_PROTOCOL_PATTERN = /^file:\/\//i
const BLOB_PROTOCOL_PATTERN = /^blob:/i
const WINDOWS_DRIVE_PATTERN = /^[a-zA-Z]:[\\/]/

const buildAllowedHosts = (): Set<string> => {
  const allowed = new Set<string>(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0'])

  try {
    const baseUrl = getApiBaseUrl()
    if (baseUrl) {
      const apiUrl = new URL(baseUrl)
      if (apiUrl.hostname) {
        allowed.add(apiUrl.hostname.toLowerCase())
      }
      if (apiUrl.origin) {
        allowed.add(apiUrl.origin.toLowerCase())
      }
    }
  } catch (error) {
    // Ignore errors resolving the API base URL; we fall back to localhost candidates.
  }

  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location
    if (hostname) {
      allowed.add(hostname.toLowerCase())
    }
    if (origin) {
      allowed.add(origin.toLowerCase())
    }
  }

  return allowed
}

const isAllowedRemoteUrl = (url: URL, allowedHosts: Set<string>): boolean => {
  const hostname = url.hostname.toLowerCase()
  const origin = url.origin.toLowerCase()
  if (allowedHosts.has(hostname) || allowedHosts.has(origin)) {
    return true
  }
  return false
}

const normaliseLocalPath = (value: string): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const normalised = trimmed.replace(/\\/g, '/')
  const isWindowsDrive = WINDOWS_DRIVE_PATTERN.test(normalised)
  const isUnixAbsolute = normalised.startsWith('/')
  const isUncPath = normalised.startsWith('//')

  if (!isWindowsDrive && !isUnixAbsolute && !isUncPath) {
    return null
  }

  try {
    const url = new URL(`file://${encodeURI(normalised)}`)
    return url.toString()
  } catch (error) {
    return null
  }
}

export const resolvePlayableSourceUrl = (
  raw: string | null | undefined
): PlayableSourceResolution => {
  if (typeof raw !== 'string') {
    return { status: 'empty', src: null }
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return { status: 'empty', src: null }
  }

  if (BLOB_PROTOCOL_PATTERN.test(trimmed) || FILE_PROTOCOL_PATTERN.test(trimmed)) {
    return { status: 'ok', src: trimmed }
  }

  if (HTTP_PROTOCOL_PATTERN.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const allowedHosts = buildAllowedHosts()
      if (isAllowedRemoteUrl(url, allowedHosts)) {
        return { status: 'ok', src: url.toString() }
      }
      return { status: 'remote-blocked', src: null, hostname: url.hostname }
    } catch (error) {
      return { status: 'invalid', src: null }
    }
  }

  const localCandidate = normaliseLocalPath(trimmed)
  if (localCandidate) {
    return { status: 'ok', src: localCandidate }
  }

  return { status: 'invalid', src: null }
}

