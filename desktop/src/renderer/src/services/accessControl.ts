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

export type TrialTokenCacheEntry = {
  token: string
  exp: number
  userId: string
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
const TRIAL_STORAGE_KEY = 'atropos:trial-token'
const TRIAL_STATE_STORAGE_KEY = 'atropos:trial-state'
const TRIAL_CONSUME_QUEUE_KEY = 'atropos:trial-consume-queue'

export const TRIAL_UPDATE_EVENT = 'atropos:trial-token-updated'

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

type TrialUsageState = {
  started: boolean
  total: number
  remaining: number
  usedAt: number | null
  deviceHash: string | null
  locked: boolean
  lastSyncedAt: number | null
}

export type PendingTrialConsume = {
  userId: string
  token: string
  deviceHash: string
  exp: number
  queuedAt: number
}

let cachedLicense: LicenseCacheEntry | null = null
let cachedTrialToken: TrialTokenCacheEntry | null = null
let cachedTrialState: TrialUsageState | null = null
let cachedTrialQueue: PendingTrialConsume[] | null = null

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

export const getDeviceHash = (): string => getOrCreateDeviceHash()

const createDefaultTrialState = (): TrialUsageState => ({
  started: false,
  total: 3,
  remaining: 3,
  usedAt: null,
  deviceHash: null,
  locked: false,
  lastSyncedAt: null
})

const normaliseTrialState = (candidate: Partial<TrialUsageState> | null | undefined): TrialUsageState => {
  const defaults = createDefaultTrialState()
  const totalValue =
    typeof candidate?.total === 'number' && Number.isFinite(candidate.total)
      ? Math.max(0, Math.floor(candidate.total))
      : defaults.total
  const remainingValue =
    typeof candidate?.remaining === 'number' && Number.isFinite(candidate.remaining)
      ? Math.max(0, Math.floor(candidate.remaining))
      : defaults.remaining
  const deviceHashValue =
    typeof candidate?.deviceHash === 'string' && candidate.deviceHash.trim().length > 0
      ? candidate.deviceHash.trim()
      : defaults.deviceHash
  const lockedValue = candidate?.locked === true
  const lastSynced =
    typeof candidate?.lastSyncedAt === 'number' && Number.isFinite(candidate.lastSyncedAt)
      ? candidate.lastSyncedAt
      : defaults.lastSyncedAt
  const usedAtValue =
    typeof candidate?.usedAt === 'number' && Number.isFinite(candidate.usedAt)
      ? candidate.usedAt
      : defaults.usedAt

  const total = Math.max(totalValue, remainingValue)
  const remaining = Math.min(remainingValue, total)
  const startedValue = candidate?.started === true || remaining > 0

  return {
    started: startedValue,
    total,
    remaining,
    usedAt: usedAtValue,
    deviceHash: deviceHashValue,
    locked: lockedValue,
    lastSyncedAt: lastSynced
  }
}

const loadTrialState = (): TrialUsageState => {
  if (cachedTrialState) {
    return { ...cachedTrialState }
  }

  const raw = readStorageValue(TRIAL_STATE_STORAGE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<TrialUsageState>
      cachedTrialState = normaliseTrialState(parsed)
    } catch (error) {
      console.warn('Unable to parse cached trial usage state.', error)
      cachedTrialState = createDefaultTrialState()
    }
  } else {
    cachedTrialState = createDefaultTrialState()
  }

  if (!cachedTrialState.deviceHash) {
    cachedTrialState = { ...cachedTrialState, deviceHash: getOrCreateDeviceHash() }
  }

  return { ...cachedTrialState }
}

const storeTrialState = (state: TrialUsageState): void => {
  cachedTrialState = { ...state }
  writeStorageValue(TRIAL_STATE_STORAGE_KEY, JSON.stringify(cachedTrialState))
  dispatchTrialTokenEvent()
}

const normaliseQueueEntry = (candidate: Partial<PendingTrialConsume>): PendingTrialConsume | null => {
  const userId = typeof candidate.userId === 'string' ? candidate.userId.trim() : ''
  const token = typeof candidate.token === 'string' ? candidate.token.trim() : ''
  const deviceHash = typeof candidate.deviceHash === 'string' ? candidate.deviceHash.trim() : ''
  const exp =
    typeof candidate.exp === 'number' && Number.isFinite(candidate.exp) ? candidate.exp : NaN
  const queuedAt =
    typeof candidate.queuedAt === 'number' && Number.isFinite(candidate.queuedAt)
      ? candidate.queuedAt
      : Date.now()

  if (!userId || !token || !deviceHash || Number.isNaN(exp)) {
    return null
  }

  return { userId, token, deviceHash, exp, queuedAt }
}

const loadTrialQueue = (): PendingTrialConsume[] => {
  if (cachedTrialQueue) {
    return [...cachedTrialQueue]
  }

  const raw = readStorageValue(TRIAL_CONSUME_QUEUE_KEY)
  if (!raw) {
    cachedTrialQueue = []
    return []
  }

  try {
    const parsed = JSON.parse(raw) as Array<Partial<PendingTrialConsume>>
    cachedTrialQueue = parsed
      .map(normaliseQueueEntry)
      .filter((entry): entry is PendingTrialConsume => Boolean(entry))
  } catch (error) {
    console.warn('Unable to parse queued trial consumption entries.', error)
    cachedTrialQueue = []
  }

  return [...cachedTrialQueue]
}

const storeTrialQueue = (queue: PendingTrialConsume[]): void => {
  cachedTrialQueue = [...queue]
  writeStorageValue(TRIAL_CONSUME_QUEUE_KEY, JSON.stringify(cachedTrialQueue))
  dispatchTrialTokenEvent()
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

const isTrialEntryValid = (
  entry: TrialTokenCacheEntry | null
): entry is TrialTokenCacheEntry => {
  if (!entry) {
    return false
  }
  if (typeof entry.token !== 'string' || entry.token.trim().length === 0) {
    return false
  }
  if (typeof entry.userId !== 'string' || entry.userId.trim().length === 0) {
    return false
  }
  if (typeof entry.exp !== 'number' || !Number.isFinite(entry.exp)) {
    return false
  }
  return entry.exp * 1000 > Date.now() + 5000
}

const loadTrialCache = (): TrialTokenCacheEntry | null => {
  if (cachedTrialToken && isTrialEntryValid(cachedTrialToken)) {
    return cachedTrialToken
  }

  const raw = readStorageValue(TRIAL_STORAGE_KEY)
  if (!raw) {
    cachedTrialToken = null
    return null
  }

  try {
    const parsed = JSON.parse(raw) as TrialTokenCacheEntry
    if (isTrialEntryValid(parsed)) {
      cachedTrialToken = parsed
      return parsed
    }
  } catch (error) {
    console.warn('Unable to parse cached trial token.', error)
  }

  cachedTrialToken = null
  writeStorageValue(TRIAL_STORAGE_KEY, null)
  return null
}

const dispatchTrialTokenEvent = (): void => {
  if (isWindowAvailable()) {
    window.dispatchEvent(new CustomEvent(TRIAL_UPDATE_EVENT))
  }
}

if (isWindowAvailable()) {
  window.addEventListener('online', () => {
    dispatchTrialTokenEvent()
  })
}

const storeTrialCache = (entry: TrialTokenCacheEntry | null): void => {
  cachedTrialToken = entry
  if (entry) {
    writeStorageValue(TRIAL_STORAGE_KEY, JSON.stringify(entry))
  } else {
    writeStorageValue(TRIAL_STORAGE_KEY, null)
  }
  dispatchTrialTokenEvent()
}

export const getStoredTrialToken = (): TrialTokenCacheEntry | null => loadTrialCache()

export const setStoredTrialToken = (entry: TrialTokenCacheEntry | null): void => {
  if (entry) {
    storeTrialCache(entry)
  } else {
    storeTrialCache(null)
  }
}

export const getTrialUsageState = (): TrialUsageState => loadTrialState()

export const syncTrialUsageFromServer = (
  snapshot: {
    started?: boolean
    total?: number
    remaining?: number
    used_at?: number | null
    device_hash?: string | null
  },
  options?: { entitled?: boolean }
): TrialUsageState => {
  const current = loadTrialState()
  const totalValue =
    typeof snapshot.total === 'number' && Number.isFinite(snapshot.total)
      ? Math.max(0, Math.floor(snapshot.total))
      : current.total
  const remainingValue =
    typeof snapshot.remaining === 'number' && Number.isFinite(snapshot.remaining)
      ? Math.max(0, Math.floor(snapshot.remaining))
      : current.remaining
  const usedAtValue =
    snapshot.used_at === null
      ? null
      : typeof snapshot.used_at === 'number' && Number.isFinite(snapshot.used_at)
        ? snapshot.used_at
        : current.usedAt
  const deviceHashValue = snapshot.device_hash?.trim()
    ? snapshot.device_hash.trim()
    : current.deviceHash ?? getOrCreateDeviceHash()
  const startedValue = snapshot.started ?? current.started
  const lockedValue = options?.entitled ? false : current.locked

  const next = normaliseTrialState({
    started: startedValue,
    total: totalValue,
    remaining: remainingValue,
    usedAt: usedAtValue,
    deviceHash: deviceHashValue,
    locked: lockedValue,
    lastSyncedAt: Date.now()
  })

  storeTrialState(next)
  return next
}

export const updateTrialRemainingFromServer = (remaining: number): TrialUsageState => {
  const current = loadTrialState()
  const next = normaliseTrialState({
    ...current,
    remaining: Math.max(0, Math.floor(remaining)),
    started: current.started || remaining > 0,
    lastSyncedAt: Date.now()
  })
  storeTrialState(next)
  return next
}

export const consumeLocalTrialAllowance = (): TrialUsageState => {
  const current = loadTrialState()
  const next = normaliseTrialState({
    ...current,
    remaining: Math.max(0, current.remaining - 1),
    usedAt: Math.floor(Date.now() / 1000),
    lastSyncedAt: current.lastSyncedAt
  })
  storeTrialState(next)
  return next
}

export const markTrialLocked = (): TrialUsageState => {
  const current = loadTrialState()
  if (current.locked) {
    return current
  }
  const next = normaliseTrialState({ ...current, locked: true, lastSyncedAt: current.lastSyncedAt })
  storeTrialState(next)
  return next
}

export const clearTrialLock = (): TrialUsageState => {
  const current = loadTrialState()
  if (!current.locked) {
    return current
  }
  const next = normaliseTrialState({ ...current, locked: false, lastSyncedAt: current.lastSyncedAt })
  storeTrialState(next)
  return next
}

export const getPendingTrialConsumes = (): PendingTrialConsume[] => loadTrialQueue()

export const enqueuePendingTrialConsume = (
  entry: PendingTrialConsume
): PendingTrialConsume[] => {
  const normalized = normaliseQueueEntry(entry)
  if (!normalized) {
    return loadTrialQueue()
  }
  const queue = loadTrialQueue().filter((item) => item.token !== normalized.token)
  queue.push(normalized)
  storeTrialQueue(queue)
  return [...queue]
}

export const removePendingTrialConsume = (token: string): PendingTrialConsume[] => {
  const queue = loadTrialQueue().filter((item) => item.token !== token.trim())
  storeTrialQueue(queue)
  return [...queue]
}

export const clearPendingTrialConsumes = (): void => {
  storeTrialQueue([])
}

export const hasPendingTrialConsumes = (): boolean => loadTrialQueue().length > 0

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

const ensureLicenseToken = async (
  baseUrl: URL,
  clientId: string
): Promise<LicenseCacheEntry> => {
  const existing = loadLicenseCache()
  if (existing) {
    return existing
  }

  const deviceHash = getOrCreateDeviceHash()
  const licenseUrl = new URL('/license/issue', baseUrl)
  const issueResponse = await fetch(licenseUrl.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: clientId, device_hash: deviceHash })
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

  if (!token || exp === null) {
    throw new Error('License issue response was missing required fields.')
  }

  const entry: LicenseCacheEntry = { token, exp }
  storeLicenseCache(entry)
  return entry
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

  if (config.useMock) {
    await new Promise((resolve) => setTimeout(resolve, 120))
    return mockAccessResponse(payload)
  }

  if (!config.apiUrl) {
    throw new Error('Access control API URL is not configured.')
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

  const license = await ensureLicenseToken(baseUrl, config.clientId)

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

export const getLicenseTokenForRender = async (): Promise<string> => {
  const config = getAccessControlConfig()

  if (!config.apiUrl) {
    throw new Error('Access control API URL is not configured.')
  }

  const baseUrl = new URL(config.apiUrl)
  const license = await ensureLicenseToken(baseUrl, config.clientId)
  return license.token
}

