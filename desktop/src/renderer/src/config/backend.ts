import type { BackendMode } from './types'

const DEFAULT_PORT = 8000

const resolveWindowHost = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }
  const { hostname } = window.location
  return hostname && hostname.length > 0 ? hostname : null
}

const normaliseBaseUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return null
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`

  try {
    const url = new URL(withProtocol)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    return null
  }
}

const buildHostUrl = (host: string): string => `http://${host}:${DEFAULT_PORT}`

const buildDefaultBaseUrls = (): string[] => {
  const hosts = new Set<string>()
  hosts.add('127.0.0.1')
  hosts.add('localhost')
  hosts.add('[::1]')
  const windowHost = resolveWindowHost()
  if (windowHost) {
    hosts.add(windowHost)
  }

  const urls: string[] = []
  const seen = new Set<string>()
  hosts.forEach((host) => {
    const normalised = normaliseBaseUrl(buildHostUrl(host))
    if (normalised && !seen.has(normalised)) {
      urls.push(normalised)
      seen.add(normalised)
    }
  })

  if (urls.length === 0) {
    urls.push(`http://127.0.0.1:${DEFAULT_PORT}`)
  }

  return urls
}

const explicitBase = normaliseBaseUrl(import.meta.env.VITE_API_BASE_URL)
const apiBaseCandidates = explicitBase ? [explicitBase] : buildDefaultBaseUrls()

let candidateIndex = 0
let currentBaseUrl = apiBaseCandidates[candidateIndex]

export const getApiBaseUrl = (): string => currentBaseUrl

export const advanceApiBaseUrl = (): string | null => {
  if (candidateIndex + 1 < apiBaseCandidates.length) {
    candidateIndex += 1
    currentBaseUrl = apiBaseCandidates[candidateIndex]
    return currentBaseUrl
  }
  return null
}

const rawMode = (import.meta.env.VITE_BACKEND_MODE ?? '').toLowerCase()
const mode: BackendMode = rawMode === 'mock' ? 'mock' : 'api'

export const BACKEND_MODE: BackendMode = mode

export const buildJobUrl = (): string => {
  const url = new URL('/api/jobs', getApiBaseUrl())
  return url.toString()
}

export const buildWebSocketUrl = (jobId: string): string => {
  const url = new URL(`/ws/jobs/${jobId}`, getApiBaseUrl())
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
