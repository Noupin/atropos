import type { BackendMode } from './types'

const resolveDefaultHost = (): string => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host && host !== 'localhost') {
      return host
    }
  }
  return '127.0.0.1'
}

const DEFAULT_BASE_URL = `http://${resolveDefaultHost()}:8000`

const normaliseBaseUrl = (value: string | undefined): string => {
  if (!value) {
    return DEFAULT_BASE_URL
  }

  let candidate = value.trim()
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `http://${candidate}`
  }

  try {
    const url = new URL(candidate)
    if (url.hostname === 'localhost') {
      url.hostname = '127.0.0.1'
    }
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    return DEFAULT_BASE_URL
  }
}

const rawMode = (import.meta.env.VITE_BACKEND_MODE ?? '').toLowerCase()
const mode: BackendMode = rawMode === 'mock' ? 'mock' : 'api'

export const BACKEND_MODE: BackendMode = mode

const httpBase = normaliseBaseUrl(import.meta.env.VITE_API_BASE_URL)
export const API_BASE_URL = httpBase

export const buildJobUrl = (): string => {
  const url = new URL('/api/jobs', httpBase)
  return url.toString()
}

export const buildWebSocketUrl = (jobId: string): string => {
  const url = new URL(`/ws/jobs/${jobId}`, httpBase)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}
