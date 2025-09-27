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

const DEFAULT_ACCESS_DEV_BASE_URL = 'https://dev.api.atropos-video.com'
const DEFAULT_ACCESS_PROD_BASE_URL = 'https://api.atropos-video.com'

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

type AccessSnapshotMetadata = {
  entitled: boolean
  mode: 'trial' | 'subscription' | 'none'
  snapshot?: {
    status?: string | null
    cancel_at_period_end?: boolean | null
    remaining?: number | null
  }
}

export type AccessSnapshot = AccessCheckResult & AccessSnapshotMetadata

const resolveAccessApiBaseUrl = (configuredUrl: string | null): string => {
  const fallback = import.meta.env.PROD ? DEFAULT_ACCESS_PROD_BASE_URL : DEFAULT_ACCESS_DEV_BASE_URL
  if (!configuredUrl) {
    return fallback
  }

  try {
    const parsed = new URL(configuredUrl)
    const hostname = parsed.hostname.toLowerCase()
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname)) {
      return fallback
    }
    parsed.hash = ''
    return parsed.toString()
  } catch (error) {
    console.warn('Invalid access control API URL provided. Falling back to default.', error)
    return fallback
  }
}

const buildSnapshot = (overrides: Partial<AccessSnapshot>): AccessSnapshot => {
  const nowIso = new Date().toISOString()
  const base: AccessSnapshot = {
    allowed: false,
    entitled: false,
    mode: 'none',
    reason: null,
    status: 'inactive',
    checkedAt: nowIso,
    expiresAt: null,
    customerEmail: null,
    subscriptionPlan: null,
    subscriptionStatus: 'inactive',
    snapshot: undefined,
    ...overrides
  }

  return base
}

type SubscriptionContext = {
  body: SubscriptionApiResponse
  trialSnapshot: TrialStateSnapshot
  trialExpiresAt: string | null
  subscriptionStatus: SubscriptionLifecycleStatus
  cancelAtPeriodEnd: boolean | null
  currentPeriodEndSeconds: number | null
  currentPeriodEndIso: string | null
  entitled: boolean
  rawStatus: string | null
}

const createSubscriptionContext = (body: SubscriptionApiResponse): SubscriptionContext => {
  const trialSnapshot = updateTrialStateFromApi(body.trial ?? null)
  const trialToken = getCachedTrialToken()
  const trialExpiresAt =
    trialToken && isTrialTokenActive(trialToken)
      ? new Date(trialToken.exp * 1000).toISOString()
      : null
  const subscriptionStatus = normalizeStatus(body.status ?? 'inactive')
  const cancelAtPeriodEnd =
    typeof body.cancel_at_period_end === 'boolean' ? body.cancel_at_period_end : null
  const currentPeriodEndSeconds =
    typeof body.current_period_end === 'number' && Number.isFinite(body.current_period_end)
      ? body.current_period_end
      : null
  const currentPeriodEndIso =
    currentPeriodEndSeconds !== null
      ? new Date(currentPeriodEndSeconds * 1000).toISOString()
      : null
  const nowSeconds = Math.floor(Date.now() / 1000)
  const entitled =
    (subscriptionStatus === 'active' || subscriptionStatus === 'trialing') &&
    currentPeriodEndSeconds !== null &&
    currentPeriodEndSeconds > nowSeconds

  return {
    body,
    trialSnapshot,
    trialExpiresAt,
    subscriptionStatus,
    cancelAtPeriodEnd,
    currentPeriodEndSeconds,
    currentPeriodEndIso,
    entitled,
    rawStatus: body.status ?? null
  }
}

const fetchSubscriptionContext = async (
  baseUrl: string,
  clientId: string,
  force = false
): Promise<{ context: SubscriptionContext | null; error?: string }> => {
  const subscriptionUrl = new URL('/billing/subscription', baseUrl)
  subscriptionUrl.searchParams.set('user_id', clientId)
  if (force) {
    subscriptionUrl.searchParams.set('force', 'true')
  }

  let response: Response
  try {
    response = await fetch(subscriptionUrl.toString(), {
      headers: { Accept: 'application/json' }
    })
  } catch (error) {
    console.error('Failed to request subscription snapshot.', error)
    return { context: null, error: 'Unable to verify access' }
  }

  if (!response.ok) {
    console.error('Subscription snapshot request returned an error status.', response.status)
    return { context: null, error: 'Unable to verify access' }
  }

  try {
    const body = (await response.json()) as SubscriptionApiResponse
    const context = createSubscriptionContext(body)
    return { context }
  } catch (error) {
    console.error('Failed to parse subscription snapshot response.', error)
    return { context: null, error: 'Unable to verify access' }
  }
}

type IssueLicenseResult =
  | { success: true; license: LicenseCacheEntry }
  | { success: false; status: number; message?: string }

const issueLicenseToken = async (
  baseUrl: string,
  clientId: string,
  deviceHash: string
): Promise<IssueLicenseResult> => {
  const licenseUrl = new URL('/license/issue', baseUrl)
  let response: Response

  try {
    response = await fetch(licenseUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: clientId, device_hash: deviceHash })
    })
  } catch (error) {
    console.error('Failed to issue license token.', error)
    return { success: false, status: 0, message: 'Unable to verify access' }
  }

  if (!response.ok) {
    const message = await extractApiError(response)
    return { success: false, status: response.status, message }
  }

  try {
    const payload = (await response.json()) as LicenseIssueResponse
    const token = typeof payload.token === 'string' ? payload.token : null
    const exp =
      typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null

    if (!token || !exp) {
      console.error('License issue response missing token or expiration.')
      return { success: false, status: 0, message: 'Unable to verify access' }
    }

    const entry: LicenseCacheEntry = { token, exp }
    storeLicenseCache(entry)
    return { success: true, license: entry }
  } catch (error) {
    console.error('Unable to parse license issue response.', error)
    return { success: false, status: 0, message: 'Unable to verify access' }
  }
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

const buildTrialAccessSnapshot = (context: SubscriptionContext): AccessSnapshot =>
  buildSnapshot({
    allowed: true,
    entitled: false,
    mode: 'trial',
    reason: null,
    status: 'trialing',
    subscriptionStatus: 'trialing',
    subscriptionPlan: 'trial',
    expiresAt: context.trialExpiresAt,
    snapshot: {
      status: context.rawStatus ?? 'trialing',
      cancel_at_period_end: context.cancelAtPeriodEnd,
      remaining: context.trialSnapshot.remaining
    }
  })

const buildSubscriptionAllowedSnapshot = (
  context: SubscriptionContext,
  license: LicenseCacheEntry
): AccessSnapshot => {
  const licenseExpiryIso = new Date(license.exp * 1000).toISOString()
  return buildSnapshot({
    allowed: true,
    entitled: true,
    mode: 'subscription',
    reason: null,
    status: context.subscriptionStatus,
    subscriptionStatus: context.subscriptionStatus,
    expiresAt: context.currentPeriodEndIso ?? licenseExpiryIso,
    snapshot: {
      status: context.rawStatus ?? context.subscriptionStatus,
      cancel_at_period_end: context.cancelAtPeriodEnd,
      remaining: context.trialSnapshot.remaining
    }
  })
}

const buildSubscriptionRequirementSnapshot = (
  context: SubscriptionContext,
  reason: string,
  entitled: boolean
): AccessSnapshot =>
  buildSnapshot({
    allowed: false,
    entitled,
    mode: 'subscription',
    reason,
    status: context.subscriptionStatus,
    subscriptionStatus: context.subscriptionStatus,
    expiresAt: context.currentPeriodEndIso,
    snapshot: {
      status: context.rawStatus ?? context.subscriptionStatus,
      cancel_at_period_end: context.cancelAtPeriodEnd,
      remaining: context.trialSnapshot.remaining
    }
  })

const buildUnableSnapshot = (
  reason: string | undefined,
  context: SubscriptionContext | null
): AccessSnapshot =>
  buildSnapshot({
    allowed: false,
    entitled: context?.entitled ?? false,
    mode: 'none',
    reason: reason ?? 'Unable to verify access',
    status: context?.subscriptionStatus ?? 'inactive',
    subscriptionStatus: context?.subscriptionStatus ?? 'inactive',
    expiresAt: context?.currentPeriodEndIso ?? null,
    snapshot: context
      ? {
          status: context.rawStatus ?? context.subscriptionStatus,
          cancel_at_period_end: context.cancelAtPeriodEnd,
          remaining: context.trialSnapshot.remaining
        }
      : undefined
  })

export const getAccessSnapshot = async (): Promise<AccessSnapshot> => {
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
    const mock = mockAccessResponse(payload)
    return buildSnapshot({
      ...mock,
      entitled: true,
      mode: 'subscription',
      snapshot: {
        status: mock.subscriptionStatus,
        cancel_at_period_end: false,
        remaining: null
      }
    })
  }

  const baseUrl = resolveAccessApiBaseUrl(config.apiUrl)
  const initialResult = await fetchSubscriptionContext(baseUrl, config.clientId)
  if (!initialResult.context) {
    return buildUnableSnapshot(initialResult.error, null)
  }

  let context = initialResult.context

  const isTrialActive =
    context.trialSnapshot.allowed &&
    context.trialSnapshot.started &&
    context.trialSnapshot.remaining > 0
  if (isTrialActive) {
    return buildTrialAccessSnapshot(context)
  }

  if (!context.entitled) {
    storeLicenseCache(null)
    return buildSubscriptionRequirementSnapshot(context, 'Subscription required', false)
  }

  let license = loadLicenseCache()
  const deviceHash = getOrCreateDeviceHash()

  const attemptIssue = async (): Promise<IssueLicenseResult> =>
    issueLicenseToken(baseUrl, config.clientId, deviceHash)

  if (!license) {
    let issueResult = await attemptIssue()
    if (!issueResult.success) {
      if (issueResult.status === 403) {
        const forcedResult = await fetchSubscriptionContext(baseUrl, config.clientId, true)
        if (!forcedResult.context) {
          return buildUnableSnapshot(forcedResult.error, null)
        }

        context = forcedResult.context

        const forcedTrialActive =
          context.trialSnapshot.allowed &&
          context.trialSnapshot.started &&
          context.trialSnapshot.remaining > 0
        if (forcedTrialActive) {
          return buildTrialAccessSnapshot(context)
        }

        if (!context.entitled) {
          storeLicenseCache(null)
          return buildSubscriptionRequirementSnapshot(context, 'Subscription required', false)
        }

        issueResult = await attemptIssue()
        if (!issueResult.success) {
          if (issueResult.status === 403) {
            storeLicenseCache(null)
            return buildSubscriptionRequirementSnapshot(
              context,
              issueResult.message ?? 'Subscription required',
              true
            )
          }

          return buildUnableSnapshot(issueResult.message, context)
        }
      } else {
        return buildUnableSnapshot(issueResult.message, context)
      }
    }

    if (issueResult.success) {
      license = issueResult.license
    }
  }

  if (!license) {
    return buildUnableSnapshot('Unable to verify access', context)
  }

  return buildSubscriptionAllowedSnapshot(context, license)
}

export const verifyDesktopAccess = async (): Promise<AccessCheckResult> =>
  getAccessSnapshot()

