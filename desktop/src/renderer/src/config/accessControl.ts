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
    console.warn('Invalid access control API URL provided. Falling back to mock mode.', error)
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

const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (!value) {
    return fallback
  }

  const normalized = value.trim().toLowerCase()
  if (normalized.length === 0) {
    return fallback
  }

  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) {
    return false
  }

  return fallback
}

const apiUrl = parseUrl(import.meta.env.VITE_ACCESS_API_URL)
const useMock = parseBoolean(import.meta.env.VITE_ACCESS_USE_MOCK, false)

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

