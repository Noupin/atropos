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

const DEFAULT_BILLING_DEV_BASE_URL = 'https://dev.api.atropos-video.com'
const DEFAULT_BILLING_PROD_BASE_URL = 'https://api.atropos-video.com'

const resolveBillingBaseUrl = (): string => {
  const explicitBillingBase = normaliseBaseUrl(import.meta.env.VITE_BILLING_API_BASE_URL)
  if (explicitBillingBase) {
    return explicitBillingBase
  }

  const defaultBillingBase = import.meta.env.PROD
    ? DEFAULT_BILLING_PROD_BASE_URL
    : DEFAULT_BILLING_DEV_BASE_URL
  return defaultBillingBase
}

const billingBaseUrl = resolveBillingBaseUrl()

let candidateIndex = 0
let currentBaseUrl = apiBaseCandidates[candidateIndex]

export const getApiBaseUrl = (): string => currentBaseUrl

export const getBillingApiBaseUrl = (): string => billingBaseUrl

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

export const buildJobClipsUrl = (jobId: string): string => {
  const url = new URL(`/api/jobs/${encodeURIComponent(jobId)}/clips`, getApiBaseUrl())
  return url.toString()
}

export const buildJobClipVideoUrl = (jobId: string, clipId: string): string => {
  const url = new URL(
    `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/video`,
    getApiBaseUrl()
  )
  return url.toString()
}

export const buildJobClipUploadUrl = (jobId: string, clipId: string): string => {
  const url = new URL(
    `/api/jobs/${encodeURIComponent(jobId)}/clips/${encodeURIComponent(clipId)}/upload`,
    getApiBaseUrl()
  )
  return url.toString()
}

export const buildAccountsUrl = (): string => {
  const url = new URL('/api/accounts', getApiBaseUrl())
  return url.toString()
}

export const buildAccountUrl = (accountId: string): string => {
  const url = new URL(`/api/accounts/${encodeURIComponent(accountId)}`, getApiBaseUrl())
  return url.toString()
}

export const buildAccountClipsUrl = (accountId: string): string => {
  const url = new URL(`/api/accounts/${encodeURIComponent(accountId)}/clips`, getApiBaseUrl())
  return url.toString()
}

export const buildAccountPlatformUrl = (accountId: string): string => {
  const url = new URL(`/api/accounts/${encodeURIComponent(accountId)}/platforms`, getApiBaseUrl())
  return url.toString()
}

export const buildAccountPlatformDetailUrl = (accountId: string, platform: string): string => {
  const url = new URL(
    `/api/accounts/${encodeURIComponent(accountId)}/platforms/${encodeURIComponent(platform)}`,
    getApiBaseUrl()
  )
  return url.toString()
}

export const buildAuthPingUrl = (): string => {
  const url = new URL('/api/auth/ping', getApiBaseUrl())
  return url.toString()
}

export const buildSubscriptionStatusUrl = (userId: string): string => {
  const url = new URL('/billing/subscription', getBillingApiBaseUrl())
  url.searchParams.set('user_id', userId)
  return url.toString()
}

export const buildTrialClaimUrl = (): string => {
  const url = new URL('/trial/claim', getBillingApiBaseUrl())
  return url.toString()
}

export const buildTrialConsumeUrl = (): string => {
  const url = new URL('/trial/consume', getBillingApiBaseUrl())
  return url.toString()
}

export const buildCheckoutSessionUrl = (): string => {
  const url = new URL('/billing/checkout', getBillingApiBaseUrl())
  return url.toString()
}

export const buildBillingPortalUrl = (): string => {
  const url = new URL('/billing/portal', getBillingApiBaseUrl())
  return url.toString()
}

export const buildConfigUrl = (): string => {
  const url = new URL('/api/config', getApiBaseUrl())
  return url.toString()
}
