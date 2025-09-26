import { getAccessControlConfig } from '../config/accessControl'
import type {
  AccessCheckResult,
  AccessJwtPayload,
  SubscriptionLifecycleStatus
} from '../types'

type LicenseCacheEntry = {
  token: string
  exp: number
}

type SubscriptionApiResponse = {
  status?: string | null
  entitled?: boolean
  current_period_end?: number | null
  cancel_at_period_end?: boolean | null
}

type LicenseIssueResponse = {
  token?: string
  exp?: number
}

const DEVICE_HASH_STORAGE_KEY = 'atropos:device-hash'
const LICENSE_STORAGE_KEY = 'atropos:license-token'

const allowedStatuses: SubscriptionLifecycleStatus[] = [
  'inactive',
  'active',
  'trialing',
  'grace_period',
  'past_due',
  'canceled',
  'incomplete',
  'incomplete_expired',
  'unpaid',
  'paused'
]

let cachedLicense: LicenseCacheEntry | null = null

const textEncoder = new TextEncoder()

const isWindowAvailable = (): boolean => typeof window !== 'undefined'

const readStorageValue = (key: string): string | null => {
  if (!isWindowAvailable()) {
    return null
  }
  try {
    return window.localStorage.getItem(key)
  } catch (error) {
    console.warn('Failed to read from localStorage.', error)
    return null
  }
}

const writeStorageValue = (key: string, value: string | null): void => {
  if (!isWindowAvailable()) {
    return
  }
  try {
    if (value === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, value)
    }
  } catch (error) {
    console.warn('Failed to write to localStorage.', error)
  }
}

const generateDeviceHash = (): string => {
  if (typeof crypto !== 'undefined') {
    if (typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/gu, '')
    }
    if (typeof crypto.getRandomValues === 'function') {
      const buffer = new Uint8Array(16)
      crypto.getRandomValues(buffer)
      return Array.from(buffer)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    }
  }
  return Math.random().toString(36).slice(2, 18)
}

let deviceHashCache: string | null = null

const getOrCreateDeviceHash = (): string => {
  if (deviceHashCache) {
    return deviceHashCache
  }

  const stored = readStorageValue(DEVICE_HASH_STORAGE_KEY)
  if (stored && stored.trim().length > 0) {
    deviceHashCache = stored.trim()
    return deviceHashCache
  }

  const generated = generateDeviceHash()
  deviceHashCache = generated
  writeStorageValue(DEVICE_HASH_STORAGE_KEY, generated)
  return generated
}

const isLicenseEntryValid = (entry: LicenseCacheEntry | null): entry is LicenseCacheEntry => {
  if (!entry) {
    return false
  }
  return entry.exp * 1000 > Date.now() + 5000
}

const loadLicenseCache = (): LicenseCacheEntry | null => {
  if (cachedLicense && isLicenseEntryValid(cachedLicense)) {
    return cachedLicense
  }

  const raw = readStorageValue(LICENSE_STORAGE_KEY)
  if (!raw) {
    cachedLicense = null
    return null
  }

  try {
    const parsed = JSON.parse(raw) as LicenseCacheEntry
    if (isLicenseEntryValid(parsed)) {
      cachedLicense = parsed
      return parsed
    }
  } catch (error) {
    console.warn('Unable to parse cached license token.', error)
  }

  cachedLicense = null
  writeStorageValue(LICENSE_STORAGE_KEY, null)
  return null
}

const storeLicenseCache = (entry: LicenseCacheEntry | null): void => {
  cachedLicense = entry
  if (entry) {
    writeStorageValue(LICENSE_STORAGE_KEY, JSON.stringify(entry))
  } else {
    writeStorageValue(LICENSE_STORAGE_KEY, null)
  }
}

const normalizeStatus = (value: string | null | undefined): SubscriptionLifecycleStatus => {
  if (!value) {
    return 'inactive'
  }
  const lower = value.toLowerCase() as SubscriptionLifecycleStatus
  return allowedStatuses.includes(lower) ? lower : 'inactive'
}

const toBase64Url = (input: Uint8Array | ArrayBuffer): string => {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/u, '')
  }
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '')
}

const encodeSegment = (value: unknown): string => {
  const json = JSON.stringify(value)
  return toBase64Url(textEncoder.encode(json))
}

const extractApiError = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as { detail?: string }
    if (payload && typeof payload.detail === 'string' && payload.detail.trim().length > 0) {
      return payload.detail
    }
  } catch (error) {
    // Ignore parse errors and fall back to status text
  }
  return response.statusText || `Request failed with status ${response.status}`
}

const getSubtleCrypto = (): SubtleCrypto => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto API is unavailable. Unable to sign access token.')
  }
  return subtle
}

const signWithHmacSha256 = async (message: string, secret: string): Promise<string> => {
  if (!secret || secret.trim().length === 0) {
    throw new Error('Access control secret is not configured.')
  }
  const subtle = getSubtleCrypto()
  const key = await subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await subtle.sign('HMAC', key, textEncoder.encode(message))
  return toBase64Url(signature)
}

export const createAccessJwt = async (
  payload: AccessJwtPayload,
  secret: string
): Promise<string> => {
  const header = { alg: 'HS256', typ: 'JWT' }
  const encodedHeader = encodeSegment(header)
  const encodedPayload = encodeSegment(payload)
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await signWithHmacSha256(signingInput, secret)
  return `${signingInput}.${signature}`
}

const mockAccessResponse = (payload: AccessJwtPayload): AccessCheckResult => {
  const expiresAt = new Date(payload.exp * 1000).toISOString()
  return {
    allowed: true,
    status: 'active',
    reason: null,
    checkedAt: new Date().toISOString(),
    expiresAt,
    customerEmail: 'demo-user@example.com',
    subscriptionPlan: 'mock-pro',
    subscriptionStatus: 'active'
  }
}

export const verifyDesktopAccess = async (): Promise<AccessCheckResult> => {
  const config = getAccessControlConfig()
  const nowSeconds = Math.floor(Date.now() / 1000)
  const payload: AccessJwtPayload = {
    sub: config.clientId,
    aud: config.audience,
    iss: 'atropos-desktop',
    scope: ['app:use'],
    iat: nowSeconds,
    exp: nowSeconds + config.tokenTtlSeconds
  }

  if (config.useMock || !config.apiUrl) {
    await new Promise((resolve) => setTimeout(resolve, 120))
    return mockAccessResponse(payload)
  }

  const baseUrl = new URL(config.apiUrl)

  const subscriptionUrl = new URL('/billing/subscription', baseUrl)
  subscriptionUrl.searchParams.set('user_id', config.clientId)

  const subscriptionResponse = await fetch(subscriptionUrl.toString(), {
    headers: { Accept: 'application/json' }
  })

  if (!subscriptionResponse.ok) {
    throw new Error(await extractApiError(subscriptionResponse))
  }

  const subscriptionBody = (await subscriptionResponse.json()) as SubscriptionApiResponse
  const subscriptionStatus = normalizeStatus(subscriptionBody.status ?? 'inactive')
  const entitled = Boolean(subscriptionBody.entitled)
  const currentPeriodEndSeconds =
    typeof subscriptionBody.current_period_end === 'number'
      ? subscriptionBody.current_period_end
      : null
  const currentPeriodEndIso =
    currentPeriodEndSeconds && Number.isFinite(currentPeriodEndSeconds)
      ? new Date(currentPeriodEndSeconds * 1000).toISOString()
      : null

  if (!entitled) {
    storeLicenseCache(null)
    return {
      allowed: false,
      status: subscriptionStatus,
      reason: 'Active subscription required to continue using Atropos.',
      checkedAt: new Date().toISOString(),
      expiresAt: currentPeriodEndIso,
      customerEmail: null,
      subscriptionPlan: null,
      subscriptionStatus
    }
  }

  let license = loadLicenseCache()

  if (!license) {
    const deviceHash = getOrCreateDeviceHash()
    const licenseUrl = new URL('/license/issue', baseUrl)
    const issueResponse = await fetch(licenseUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: config.clientId, device_hash: deviceHash })
    })

    if (!issueResponse.ok) {
      throw new Error(await extractApiError(issueResponse))
    }

    const licenseBody = (await issueResponse.json()) as LicenseIssueResponse
    const token = typeof licenseBody.token === 'string' ? licenseBody.token : null
    const exp =
      typeof licenseBody.exp === 'number' && Number.isFinite(licenseBody.exp)
        ? licenseBody.exp
        : null

    if (!token || !exp) {
      throw new Error('License issue response was missing required fields.')
    }

    license = { token, exp }
    storeLicenseCache(license)
  }

  const licenseExpiryIso = new Date(license.exp * 1000).toISOString()

  return {
    allowed: true,
    status: subscriptionStatus,
    reason: null,
    checkedAt: new Date().toISOString(),
    expiresAt: currentPeriodEndIso ?? licenseExpiryIso,
    customerEmail: null,
    subscriptionPlan: null,
    subscriptionStatus
  }
}

