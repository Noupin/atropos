import type { AccessControlConfig } from '../types'

const parseUrl = (value: string | undefined): string | null => {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed.toLowerCase() === 'mock') {
    return null
  }

  try {
    const url = new URL(trimmed)
    url.hash = ''
    url.search = ''
    return url.toString()
  } catch (error) {
    console.warn('Invalid access control API URL provided. Ignoring configuration.', error)
    return null
  }
}

const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// Flip this flag to true when you need to exercise the access-control mock service during
// development. It is intentionally code-driven so production builds cannot opt into mock
// behaviour via environment variables.
const FORCE_ACCESS_MOCK = false

const configuredApiUrl = parseUrl(import.meta.env.VITE_ACCESS_API_URL)
const apiUrl = FORCE_ACCESS_MOCK ? null : configuredApiUrl
const useMock = FORCE_ACCESS_MOCK

if (!apiUrl && !useMock) {
  console.warn(
    'Access control API URL is not configured; desktop access verification requests will fail.'
  )
}

const config: AccessControlConfig = {
  apiUrl,
  audience: import.meta.env.VITE_ACCESS_AUDIENCE?.trim() || 'atropos-access-service',
  clientId: import.meta.env.VITE_ACCESS_CLIENT_ID?.trim() || 'atropos-desktop-dev',
  clientVersion: import.meta.env.VITE_APP_VERSION?.trim() || '0.0.0-dev',
  sharedSecret: import.meta.env.VITE_ACCESS_JWT_SECRET?.trim() || 'development-secret',
  tokenTtlSeconds: parseNumber(import.meta.env.VITE_ACCESS_JWT_TTL_SECONDS, 300),
  useMock
}

export const getAccessControlConfig = (): AccessControlConfig => ({ ...config })

