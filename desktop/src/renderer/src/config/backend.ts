import type { BackendMode } from './types'

const DEFAULT_BASE_URL = 'http://localhost:8000'

const normaliseBaseUrl = (value: string | undefined): string => {
  if (!value) {
    return DEFAULT_BASE_URL
  }

  try {
    const url = new URL(value)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch (error) {
    return value.replace(/\/$/, '') || DEFAULT_BASE_URL
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
