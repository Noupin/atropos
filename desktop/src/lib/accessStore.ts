import { ApiClient, ApiError, getDefaultApiClient, type Logger } from './apiClient'

export type AccessStatus = 'idle' | 'loading' | 'entitled' | 'not_entitled' | 'error'

export interface AccessIdentity {
  userId: string
  deviceHash: string
}

export interface TrialSnapshot {
  allowed: number
  startedAt: number | null
  total: number
  remaining: number
  usedAt: number | null
  deviceHash: string | null
  tokenId: string | null
  expiresAt: number | null
}

export interface SubscriptionSnapshot {
  status: string | null
  entitled: boolean
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  trial: TrialSnapshot | null
  fetchedAt: number
  epoch: number
  updatedAt: number | null
}

export interface LicenseTokenSnapshot {
  token: string
  issuedAt: number
  expiresAt: number
  epoch: number
  deviceHash: string
}

export interface AccessSnapshot {
  status: AccessStatus
  subscription: SubscriptionSnapshot | null
  license: LicenseTokenSnapshot | null
  identity: AccessIdentity | null
  lastError: string | null
  lastCheckedAt: number | null
  isRefreshing: boolean
}

export interface AccessStoreListener {
  (snapshot: AccessSnapshot): void
}

export interface AccessStoreOptions {
  identity?: AccessIdentity | null
  client?: ApiClient
  logger?: Logger
  autoStart?: boolean
  now?: () => number
}

interface SubscriptionResponseBody {
  status?: string | null
  entitled?: boolean
  current_period_end?: number | null
  cancel_at_period_end?: boolean
  trial?: TrialResponseBody | null
  epoch?: number
  updated_at?: number | null
}

interface TrialResponseBody {
  allowed?: number
  started?: number | null
  total?: number
  remaining?: number
  used_at?: number | null
  device_hash?: string | null
  jti?: string | null
  exp?: number | null
}

interface LicenseIssueResponseBody {
  token: string
  issued_at: number
  expires_at: number
  epoch: number
  device_hash: string
}

const DEFAULT_SNAPSHOT: AccessSnapshot = {
  status: 'idle',
  subscription: null,
  license: null,
  identity: null,
  lastError: null,
  lastCheckedAt: null,
  isRefreshing: false
}

const IDENTITY_USER_KEYS = ['ATROPOS_USER_ID', 'VITE_USER_ID', 'USER_ID']
const IDENTITY_DEVICE_KEYS = ['ATROPOS_DEVICE_HASH', 'VITE_DEVICE_HASH', 'DEVICE_HASH']

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const readImportMetaEnv = (key: string): string | undefined => {
  if (typeof import.meta === 'undefined') {
    return undefined
  }
  try {
    const meta = import.meta as unknown as { env?: Record<string, unknown> }
    const candidate = meta?.env?.[key]
    return isNonEmptyString(candidate) ? candidate : undefined
  } catch (error) {
    return undefined
  }
}

const readEnv = (key: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env && isNonEmptyString(process.env[key])) {
    return process.env[key]
  }
  return readImportMetaEnv(key)
}

const resolveIdentityFromEnvironment = (): AccessIdentity | null => {
  const userIdCandidate = IDENTITY_USER_KEYS.map(readEnv).find(isNonEmptyString)
  const deviceHashCandidate = IDENTITY_DEVICE_KEYS.map(readEnv).find(isNonEmptyString)
  if (!userIdCandidate || !deviceHashCandidate) {
    return null
  }
  return {
    userId: userIdCandidate.trim(),
    deviceHash: deviceHashCandidate.trim()
  }
}

const cloneIdentity = (identity: AccessIdentity | null): AccessIdentity | null => {
  if (!identity) {
    return null
  }
  return { ...identity }
}

const cloneTrial = (trial: TrialSnapshot | null): TrialSnapshot | null => {
  if (!trial) {
    return null
  }
  return { ...trial }
}

const cloneLicense = (license: LicenseTokenSnapshot | null): LicenseTokenSnapshot | null => {
  if (!license) {
    return null
  }
  return { ...license }
}

const mapTrial = (trial: TrialResponseBody | null | undefined): TrialSnapshot | null => {
  if (!trial) {
    return null
  }
  return {
    allowed: Math.max(0, trial.allowed ?? 0),
    startedAt: trial.started ?? null,
    total: Math.max(trial.total ?? trial.allowed ?? 0, trial.allowed ?? 0),
    remaining: Math.max(0, trial.remaining ?? trial.total ?? trial.allowed ?? 0),
    usedAt: trial.used_at ?? null,
    deviceHash: trial.device_hash ?? null,
    tokenId: trial.jti ?? null,
    expiresAt: trial.exp ?? null
  }
}

const describeError = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    const detail =
      error.body && typeof error.body === 'object' && error.body !== null
        ? (error.body as { detail?: unknown }).detail
        : undefined
    if (isNonEmptyString(detail)) {
      return detail
    }
    return `Request failed with status ${error.status}`
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return fallback
}

const nowSeconds = (now: () => number): number => Math.floor(now() / 1000)

export class AccessStore {
  private snapshot: AccessSnapshot

  private readonly listeners = new Set<AccessStoreListener>()

  private readonly client: ApiClient

  private identity: AccessIdentity | null

  private readonly logger: Logger

  private refreshPromise: Promise<void> | null = null

  private issuePromise: Promise<string | null> | null = null

  private readonly now: () => number

  constructor(options?: AccessStoreOptions) {
    this.client = options?.client ?? getDefaultApiClient()
    this.identity = cloneIdentity(options?.identity ?? resolveIdentityFromEnvironment())
    this.logger = options?.logger ?? console
    this.now = options?.now ?? Date.now
    this.snapshot = {
      ...DEFAULT_SNAPSHOT,
      identity: cloneIdentity(this.identity),
      status: this.identity ? 'idle' : 'error',
      lastError: this.identity ? null : 'Licensing identity is not configured.'
    }
    if (options?.autoStart ?? true) {
      void this.refresh()
    }
  }

  getSnapshot(): AccessSnapshot {
    return {
      ...this.snapshot,
      identity: cloneIdentity(this.snapshot.identity),
      subscription: this.snapshot.subscription ? { ...this.snapshot.subscription, trial: cloneTrial(this.snapshot.subscription.trial) } : null,
      license: cloneLicense(this.snapshot.license)
    }
  }

  subscribe(listener: AccessStoreListener): () => void {
    this.listeners.add(listener)
    try {
      listener(this.getSnapshot())
    } catch (error) {
      this.logger.error?.('Access store listener threw during initial emit', error)
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  setIdentity(identity: AccessIdentity | null, options?: { refresh?: boolean; invalidateLicense?: boolean }): void {
    this.identity = cloneIdentity(identity)
    const hasIdentity = Boolean(this.identity)
    this.updateSnapshot({
      identity: cloneIdentity(this.identity),
      status: hasIdentity ? (this.snapshot.status === 'error' ? 'idle' : this.snapshot.status) : 'error',
      lastError: hasIdentity ? null : 'Licensing identity is not configured.'
    })
    if (!hasIdentity && (options?.invalidateLicense ?? true)) {
      this.clearLicenseToken()
    }
    if (hasIdentity && options?.refresh !== false) {
      void this.refresh()
    }
  }

  async refresh(options?: { force?: boolean }): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }
    if (!this.identity) {
      this.updateSnapshot({
        status: 'error',
        lastError: 'Licensing identity is not configured.',
        isRefreshing: false,
        identity: null
      })
      return
    }
    this.updateSnapshot({
      isRefreshing: true,
      status: this.snapshot.status === 'idle' ? 'loading' : this.snapshot.status,
      lastError: null,
      identity: cloneIdentity(this.identity)
    })

    const performRefresh = async (): Promise<void> => {
      try {
        const response = await this.client.get<SubscriptionResponseBody>('/billing/subscription', {
          query: {
            user_id: this.identity?.userId ?? '',
            force: options?.force ? 'true' : undefined
          }
        })
    const subscription = this.mapSubscription(response)
    this.updateSnapshot({
      subscription,
      lastCheckedAt: subscription?.fetchedAt ?? this.now(),
      status: subscription?.entitled ? 'entitled' : 'not_entitled',
          lastError: null,
          isRefreshing: false
        })
        if (!subscription?.entitled) {
          this.clearLicenseToken()
          return
        }
        await this.issueLicenseToken({ reason: 'subscription_refresh' })
      } catch (error) {
        this.handleSubscriptionError(error, options)
      } finally {
        this.refreshPromise = null
        this.updateSnapshot({ isRefreshing: false })
      }
    }

    const promise = performRefresh()
    this.refreshPromise = promise
    return promise
  }

  async ensureLicenseToken(): Promise<string | null> {
    if (this.refreshPromise) {
      try {
        await this.refreshPromise
      } catch (error) {
        // ignore refresh errors; we'll attempt issuance regardless
      }
    }

    if (!this.identity) {
      this.logger.warn?.('Cannot issue license token without identity.')
      return null
    }

    const subscription = this.snapshot.subscription
    if (!subscription || !subscription.entitled) {
      return null
    }

    const license = this.snapshot.license
    const now = nowSeconds(this.now)
    if (license && license.epoch !== subscription.epoch) {
      this.logger.info?.(
        'Cached license epoch %d does not match subscription epoch %d; requesting a new token.',
        license.epoch,
        subscription.epoch
      )
      this.clearLicenseToken()
    } else if (license && license.expiresAt > now) {
      return license.token
    }

    if (license && license.expiresAt <= now) {
      this.logger.info?.('License token expired; requesting a new token.')
      this.clearLicenseToken()
    }

    return this.issueLicenseToken({ reason: 'ensure_token' })
  }

  reportUnauthorized(): void {
    if (!this.snapshot.subscription || !this.snapshot.subscription.entitled) {
      return
    }
    this.logger.warn?.('License token rejected by the API. Attempting to refresh.')
    this.clearLicenseToken()
    void this.issueLicenseToken({ reason: 'unauthorized' })
  }

  private updateSnapshot(partial: Partial<AccessSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...partial,
      identity: partial.identity !== undefined ? cloneIdentity(partial.identity) : cloneIdentity(this.snapshot.identity),
      subscription:
        partial.subscription !== undefined
          ? partial.subscription
            ? { ...partial.subscription, trial: cloneTrial(partial.subscription.trial) }
            : null
          : this.snapshot.subscription
          ? { ...this.snapshot.subscription, trial: cloneTrial(this.snapshot.subscription.trial) }
          : null,
      license: partial.license !== undefined ? cloneLicense(partial.license) : cloneLicense(this.snapshot.license)
    }
    for (const listener of this.listeners) {
      try {
        listener(this.getSnapshot())
      } catch (error) {
        this.logger.error?.('Access store listener threw during update', error)
      }
    }
  }

  private clearLicenseToken(): void {
    if (!this.snapshot.license) {
      return
    }
    this.updateSnapshot({ license: null })
  }

  private mapSubscription(body: SubscriptionResponseBody | null | undefined): SubscriptionSnapshot | null {
    if (!body) {
      return null
    }
    const fetchedAt = this.now()
    return {
      status: body.status ?? null,
      entitled: Boolean(body.entitled),
      currentPeriodEnd: typeof body.current_period_end === 'number' ? body.current_period_end : null,
      cancelAtPeriodEnd: Boolean(body.cancel_at_period_end),
      trial: mapTrial(body.trial),
      fetchedAt,
      epoch: typeof body.epoch === 'number' ? body.epoch : 0,
      updatedAt: typeof body.updated_at === 'number' ? body.updated_at : null
    }
  }

  private async issueLicenseToken(options?: { reason?: string }): Promise<string | null> {
    if (!this.identity) {
      this.logger.warn?.('Cannot issue license token without identity.')
      return null
    }
    if (this.issuePromise) {
      return this.issuePromise
    }
    const subscription = this.snapshot.subscription
    if (!subscription || !subscription.entitled) {
      return null
    }

    const promise = (async (): Promise<string | null> => {
      try {
        const response = await this.client.post<LicenseIssueResponseBody>('/license/issue', {
          user_id: this.identity?.userId ?? '',
          device_hash: this.identity?.deviceHash ?? ''
        })
        const license: LicenseTokenSnapshot = {
          token: response.token,
          issuedAt: response.issued_at,
          expiresAt: response.expires_at,
          epoch: response.epoch,
          deviceHash: response.device_hash
        }
        this.updateSnapshot({ license, status: 'entitled', lastError: null })
        return license.token
      } catch (error) {
        this.handleLicenseError(error, options)
        return null
      } finally {
        this.issuePromise = null
      }
    })()

    this.issuePromise = promise
    return promise
  }

  private handleSubscriptionError(error: unknown, options?: { force?: boolean }): void {
    if (error instanceof ApiError && error.status === 404) {
      this.logger.info?.('No active subscription found for the current user.')
      this.clearLicenseToken()
      this.updateSnapshot({
        subscription: null,
        status: 'not_entitled',
        lastError: null
      })
      return
    }
    if (error instanceof ApiError && error.status === 403 && options?.force) {
      const message = describeError(error, 'Force refresh is not permitted in this environment.')
      this.updateSnapshot({
        lastError: message
      })
      return
    }
    const message = describeError(error, 'Unable to load subscription details.')
    this.logger.error?.('Failed to refresh subscription', error)
    this.updateSnapshot({
      lastError: message,
      status: this.snapshot.status === 'idle' ? 'error' : this.snapshot.status
    })
  }

  private handleLicenseError(error: unknown, options?: { reason?: string }): void {
    if (error instanceof ApiError) {
      if (error.status === 403 || error.status === 404) {
        const message = describeError(error, 'Device is not entitled to receive a license token.')
        this.logger.warn?.('License issuance rejected: %s', message)
        this.clearLicenseToken()
        this.updateSnapshot({
          status: 'not_entitled',
          lastError: message
        })
        return
      }
      if (error.status === 409) {
        const message = describeError(error, 'License is already bound to another device.')
        this.logger.error?.('License issuance failed due to device conflict: %s', message)
        this.clearLicenseToken()
        this.updateSnapshot({
          status: 'error',
          lastError: message
        })
        return
      }
    }
    const message = describeError(error, 'Failed to issue license token.')
    this.logger.error?.('Unexpected error while issuing license token%s', options?.reason ? ` (${options.reason})` : '', error)
    this.clearLicenseToken()
    this.updateSnapshot({
      status: 'error',
      lastError: message
    })
  }
}

let defaultStore: AccessStore | null = null

export const getAccessStore = (): AccessStore => {
  if (!defaultStore) {
    defaultStore = new AccessStore()
  }
  return defaultStore
}

export const accessStore = getAccessStore()
