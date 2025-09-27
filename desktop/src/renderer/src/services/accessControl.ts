import { getAccessControlConfig } from '../config/accessControl'
import { getBillingApiBaseUrl } from '../config/backend'
import type {
  AccessCheckResult,
  AccessControlConfig,
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
  trial?: {
    allowed?: boolean
    started?: boolean
    total?: number
    remaining?: number
    used_at?: number | null
    device_hash?: string | null
  } | null
}

type LicenseIssueResponse = {
  token?: string
  exp?: number
}

export type AccessBadgeMode = 'subscription' | 'trial' | 'none'

export interface AccessBadgeModel {
  allowed: boolean
  mode: AccessBadgeMode
  entitled?: boolean
  reason?: string | null
  remaining?: number | null
  expiresAt?: string | null
  snapshot?: {
    status?: SubscriptionLifecycleStatus
    cancel_at_period_end?: boolean | null
  }
  plan?: string | null
  customerEmail?: string | null
}

const DEVICE_HASH_STORAGE_KEY = 'atropos:device-hash'
const LICENSE_STORAGE_KEY = 'atropos:license-token'
const TRIAL_TOKEN_STORAGE_KEY = 'atropos:trial-token'
const TRIAL_STATE_STORAGE_KEY = 'atropos:trial-state'

export type TrialTokenCacheEntry = {
  token: string
  exp: number
}

export type TrialStateSnapshot = {
  allowed: boolean
  started: boolean
  total: number
  remaining: number
  usedAt: number | null
  deviceHash: string | null
}

type TrialStateCacheEntry = TrialStateSnapshot & {
  updatedAt: number
}

const TRIAL_DEFAULT_TOTAL = 3

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
let cachedTrialToken: TrialTokenCacheEntry | null = null
let cachedTrialState: TrialStateCacheEntry | null = null

const textEncoder = new TextEncoder()

const LOCAL_ACCESS_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '0.0.0.0'])

const resolveAccessServiceBaseUrl = (apiUrl: string | null): string => {
  if (apiUrl) {
    try {
      const url = new URL(apiUrl)
      const hostname = url.hostname.toLowerCase()
      if (import.meta.env.PROD && LOCAL_ACCESS_HOSTS.has(hostname)) {
        return getBillingApiBaseUrl()
      }
      return url.toString()
    } catch (error) {
      console.warn('Invalid access service URL. Falling back to default billing base.', error)
    }
  }
  return getBillingApiBaseUrl()
}

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

const isTrialTokenEntryValid = (
  entry: TrialTokenCacheEntry | null
): entry is TrialTokenCacheEntry => {
  if (!entry) {
    return false
  }
  return entry.exp * 1000 > Date.now() + 5000
}

const loadTrialTokenCache = (): TrialTokenCacheEntry | null => {
  if (cachedTrialToken && isTrialTokenEntryValid(cachedTrialToken)) {
    return cachedTrialToken
  }

  const raw = readStorageValue(TRIAL_TOKEN_STORAGE_KEY)
  if (!raw) {
    cachedTrialToken = null
    return null
  }

  try {
    const parsed = JSON.parse(raw) as TrialTokenCacheEntry
    if (isTrialTokenEntryValid(parsed)) {
      cachedTrialToken = parsed
      return parsed
    }
  } catch (error) {
    console.warn('Unable to parse cached trial token.', error)
  }

  cachedTrialToken = null
  writeStorageValue(TRIAL_TOKEN_STORAGE_KEY, null)
  return null
}

const storeTrialTokenCache = (entry: TrialTokenCacheEntry | null): void => {
  cachedTrialToken = entry
  if (entry) {
    writeStorageValue(TRIAL_TOKEN_STORAGE_KEY, JSON.stringify(entry))
  } else {
    writeStorageValue(TRIAL_TOKEN_STORAGE_KEY, null)
  }
}

const normalizeTrialSnapshot = (input: unknown): TrialStateSnapshot => {
  const snapshot: TrialStateSnapshot = {
    allowed: true,
    started: false,
    total: TRIAL_DEFAULT_TOTAL,
    remaining: TRIAL_DEFAULT_TOTAL,
    usedAt: null,
    deviceHash: null
  }

  if (!input || typeof input !== 'object') {
    return snapshot
  }

  const record = input as Record<string, unknown>

  if (typeof record.allowed === 'boolean') {
    snapshot.allowed = record.allowed
  }

  if (typeof record.started === 'boolean') {
    snapshot.started = record.started
  }

  const rawTotal = record.total
  if (typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal > 0) {
    snapshot.total = Math.max(1, Math.floor(rawTotal))
  }

  const rawRemaining = record.remaining
  if (typeof rawRemaining === 'number' && Number.isFinite(rawRemaining)) {
    snapshot.remaining = Math.max(0, Math.floor(rawRemaining))
  } else {
    snapshot.remaining = snapshot.total
  }

  if (!snapshot.started) {
    snapshot.remaining = snapshot.total
  } else {
    snapshot.remaining = Math.max(0, Math.min(snapshot.total, snapshot.remaining))
  }

  const rawUsedAt = (record.used_at ?? record.usedAt) as unknown
  if (typeof rawUsedAt === 'number' && Number.isFinite(rawUsedAt)) {
    snapshot.usedAt = rawUsedAt
  } else if (rawUsedAt === null) {
    snapshot.usedAt = null
  }

  const rawDevice = record.device_hash ?? record.deviceHash
  if (typeof rawDevice === 'string' && rawDevice.trim().length > 0) {
    snapshot.deviceHash = rawDevice.trim()
  }

  if (!snapshot.allowed) {
    snapshot.started = false
    snapshot.remaining = 0
  }

  return snapshot
}

const loadTrialStateCache = (): TrialStateCacheEntry | null => {
  if (cachedTrialState) {
    return cachedTrialState
  }

  const raw = readStorageValue(TRIAL_STATE_STORAGE_KEY)
  if (!raw) {
    cachedTrialState = null
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<TrialStateCacheEntry>
    const normalizedSnapshot = normalizeTrialSnapshot(parsed)
    const updatedAt =
      typeof parsed.updatedAt === 'number' && Number.isFinite(parsed.updatedAt)
        ? parsed.updatedAt
        : Date.now()
    const normalized: TrialStateCacheEntry = { ...normalizedSnapshot, updatedAt }
    cachedTrialState = normalized
    return normalized
  } catch (error) {
    console.warn('Unable to parse cached trial state.', error)
  }

  cachedTrialState = null
  writeStorageValue(TRIAL_STATE_STORAGE_KEY, null)
  return null
}

const storeTrialStateCache = (entry: TrialStateCacheEntry | null): void => {
  cachedTrialState = entry
  if (entry) {
    writeStorageValue(TRIAL_STATE_STORAGE_KEY, JSON.stringify(entry))
  } else {
    writeStorageValue(TRIAL_STATE_STORAGE_KEY, null)
  }
}

export const getDeviceHash = (): string => getOrCreateDeviceHash()

const trialStateFromCache = (entry: TrialStateCacheEntry | null): TrialStateSnapshot | null => {
  if (!entry) {
    return null
  }
  return {
    allowed: entry.allowed,
    started: entry.started,
    total: entry.total,
    remaining: entry.remaining,
    usedAt: entry.usedAt,
    deviceHash: entry.deviceHash
  }
}

const writeTrialStateSnapshot = (
  snapshot: TrialStateSnapshot | null
): TrialStateSnapshot | null => {
  if (!snapshot) {
    storeTrialStateCache(null)
    return null
  }
  const normalized = normalizeTrialSnapshot(snapshot)
  const previous = loadTrialStateCache()
  let resolved: TrialStateSnapshot = normalized

  if (previous && previous.started && normalized.started) {
    const synchronizedRemaining = Math.min(previous.remaining, normalized.remaining)
    if (synchronizedRemaining !== normalized.remaining) {
      resolved = { ...normalized, remaining: synchronizedRemaining }
    }
  }

  const entry: TrialStateCacheEntry = { ...resolved, updatedAt: Date.now() }
  storeTrialStateCache(entry)
  return resolved
}

export const normalizeTrialFromResponse = (trial: unknown): TrialStateSnapshot =>
  normalizeTrialSnapshot(trial)

export const updateTrialStateFromApi = (trial: unknown): TrialStateSnapshot => {
  const normalized = normalizeTrialSnapshot(trial)
  return writeTrialStateSnapshot(normalized) ?? normalized
}

export const getCachedTrialState = (): TrialStateSnapshot | null =>
  trialStateFromCache(loadTrialStateCache())

export const storeTrialState = (snapshot: TrialStateSnapshot | null): TrialStateSnapshot | null =>
  writeTrialStateSnapshot(snapshot)

export const getCachedTrialToken = (): TrialTokenCacheEntry | null => {
  const entry = loadTrialTokenCache()
  if (!isTrialTokenEntryValid(entry)) {
    storeTrialTokenCache(null)
    return null
  }
  return entry
}

export const storeTrialToken = (entry: TrialTokenCacheEntry | null): void => {
  if (entry) {
    storeTrialTokenCache({ token: entry.token, exp: entry.exp })
  } else {
    storeTrialTokenCache(null)
  }
}

export const clearTrialToken = (): void => {
  storeTrialTokenCache(null)
}

export const isTrialTokenActive = (
  entry: TrialTokenCacheEntry | null
): entry is TrialTokenCacheEntry => isTrialTokenEntryValid(entry)

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

const buildMockBadgeModel = (config: AccessControlConfig): AccessBadgeModel => {
  const expiresAt = new Date(Date.now() + config.tokenTtlSeconds * 1000).toISOString()
  return {
    allowed: true,
    mode: 'subscription',
    entitled: true,
    reason: null,
    remaining: null,
    expiresAt,
    snapshot: { status: 'active', cancel_at_period_end: false },
    plan: 'mock-pro',
    customerEmail: 'demo-user@example.com'
  }
}

const trialAccessFromCache = (): AccessBadgeModel | null => {
  const trialToken = getCachedTrialToken()
  const trialState = getCachedTrialState()
  if (trialState && trialState.allowed && trialState.started && trialState.remaining > 0) {
    const expiresAtIso =
      trialToken && isTrialTokenActive(trialToken)
        ? new Date(trialToken.exp * 1000).toISOString()
        : null
    return {
      allowed: true,
      mode: 'trial',
      entitled: false,
      reason: null,
      remaining: trialState.remaining,
      expiresAt: expiresAtIso,
      snapshot: { status: 'trialing', cancel_at_period_end: null },
      plan: 'trial',
      customerEmail: null
    }
  }
  return null
}

export const getAccessBadgeModel = async (): Promise<AccessBadgeModel> => {
  const config = getAccessControlConfig()

  if (config.useMock) {
    await new Promise((resolve) => setTimeout(resolve, 120))
    return buildMockBadgeModel(config)
  }

  const baseUrl = resolveAccessServiceBaseUrl(config.apiUrl)
  const subscriptionUrl = new URL('/billing/subscription', baseUrl)
  subscriptionUrl.searchParams.set('user_id', config.clientId)

  let subscriptionResponse: Response
  try {
    subscriptionResponse = await fetch(subscriptionUrl.toString(), {
      headers: { Accept: 'application/json' }
    })
  } catch (error) {
    const cachedTrial = trialAccessFromCache()
    if (cachedTrial) {
      return cachedTrial
    }
    const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
    throw new Error(`Unable to verify subscription status${detail}.`)
  }

  if (!subscriptionResponse.ok) {
    throw new Error(await extractApiError(subscriptionResponse))
  }

  const subscriptionBody = (await subscriptionResponse.json()) as SubscriptionApiResponse
  const trialSnapshot = updateTrialStateFromApi(subscriptionBody.trial ?? null)
  const trialToken = getCachedTrialToken()
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
  const cancelAtPeriodEnd =
    typeof subscriptionBody.cancel_at_period_end === 'boolean'
      ? subscriptionBody.cancel_at_period_end
      : null

  if (!entitled) {
    storeLicenseCache(null)

    if (trialSnapshot.started && trialSnapshot.remaining > 0) {
      const expiresAtIso =
        trialToken && isTrialTokenActive(trialToken)
          ? new Date(trialToken.exp * 1000).toISOString()
          : null
      return {
        allowed: true,
        mode: 'trial',
        entitled: false,
        reason: null,
        remaining: trialSnapshot.remaining,
        expiresAt: expiresAtIso,
        snapshot: { status: 'trialing', cancel_at_period_end: cancelAtPeriodEnd },
        plan: 'trial',
        customerEmail: null
      }
    }

    const reason = trialSnapshot.started
      ? `Trial remaining: ${trialSnapshot.remaining} of ${trialSnapshot.total}. Subscribe to continue using Atropos.`
      : 'Active subscription required to continue using Atropos.'

    const denialMode: AccessBadgeMode = trialSnapshot.started ? 'trial' : 'subscription'

    return {
      allowed: false,
      mode: denialMode,
      entitled: false,
      reason,
      remaining: trialSnapshot.remaining,
      expiresAt: currentPeriodEndIso,
      snapshot: { status: subscriptionStatus, cancel_at_period_end: cancelAtPeriodEnd },
      plan: null,
      customerEmail: null
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
    mode: 'subscription',
    entitled: true,
    reason: null,
    remaining: null,
    expiresAt: currentPeriodEndIso ?? licenseExpiryIso,
    snapshot: { status: subscriptionStatus, cancel_at_period_end: cancelAtPeriodEnd },
    plan: null,
    customerEmail: null
  }
}

export type DesktopAccessStatus = AccessCheckResult & AccessBadgeModel

export const verifyDesktopAccess = async (): Promise<DesktopAccessStatus> => {
  const badgeModel = await getAccessBadgeModel()
  const status = normalizeStatus(badgeModel.snapshot?.status ?? 'inactive')
  const checkedAt = new Date().toISOString()

  let subscriptionPlan: string | null
  if (badgeModel.mode === 'trial') {
    subscriptionPlan = badgeModel.plan ?? 'trial'
  } else if (badgeModel.mode === 'subscription') {
    subscriptionPlan = badgeModel.plan ?? (badgeModel.entitled ? null : null)
  } else {
    subscriptionPlan = badgeModel.plan ?? null
  }

  return {
    allowed: badgeModel.allowed,
    status,
    reason: badgeModel.reason ?? null,
    checkedAt,
    expiresAt: badgeModel.expiresAt ?? null,
    customerEmail: badgeModel.customerEmail ?? null,
    subscriptionPlan,
    subscriptionStatus: status,
    ...badgeModel
  }
}

