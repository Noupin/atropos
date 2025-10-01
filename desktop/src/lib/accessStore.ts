import type { Shell } from 'electron'
import {
  ApiClient,
  ApiError,
  getDefaultApiClient,
  type ApiEnvironment,
  type Logger
} from './apiClient'
import { getDeviceHash } from './deviceId'

export type AccessStatus = 'loading' | 'entitled' | 'not_entitled' | 'error'

export type UiMode = 'gated_profile' | 'trial' | 'paid'

export interface AccessIdentity {
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

export interface EntitlementSnapshot {
  status: string | null
  entitled: boolean
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
  trial: TrialSnapshot | null
  fetchedAt: number
  epoch: number
  updatedAt: number | null
  email: string | null
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
  entitlement: EntitlementSnapshot | null
  license: LicenseTokenSnapshot | null
  identity: AccessIdentity | null
  lastError: string | null
  lastCheckedAt: number | null
  isRefreshing: boolean
  isEntitled: boolean
  isTrial: boolean
  isTrialExhausted: boolean
  uiMode: UiMode
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

interface EntitlementResponseBody {
  status?: string | null
  entitled?: boolean
  current_period_end?: number | null
  cancel_at_period_end?: boolean
  trial?: TrialResponseBody | null
  epoch?: number
  updated_at?: number | null
  email?: string | null
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

interface CheckoutResponseBody {
  url?: string | null
}

interface PortalResponseBody {
  url?: string | null
}

const DEFAULT_SNAPSHOT: AccessSnapshot = {
  status: 'loading',
  entitlement: null,
  license: null,
  identity: null,
  lastError: null,
  lastCheckedAt: null,
  isRefreshing: false,
  isEntitled: false,
  isTrial: false,
  isTrialExhausted: true,
  uiMode: 'gated_profile'
}

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const cloneIdentity = (identity: AccessIdentity | null): AccessIdentity | null => {
  if (!identity) {
    return null
  }
  return Object.freeze({ ...identity }) as AccessIdentity
}

const cloneTrial = (trial: TrialSnapshot | null): TrialSnapshot | null => {
  if (!trial) {
    return null
  }
  return Object.freeze({ ...trial }) as TrialSnapshot
}

const cloneEntitlement = (entitlement: EntitlementSnapshot | null): EntitlementSnapshot | null => {
  if (!entitlement) {
    return null
  }
  return Object.freeze({ ...entitlement, trial: cloneTrial(entitlement.trial) }) as EntitlementSnapshot
}

const cloneLicense = (license: LicenseTokenSnapshot | null): LicenseTokenSnapshot | null => {
  if (!license) {
    return null
  }
  return Object.freeze({ ...license }) as LicenseTokenSnapshot
}

const mapTrial = (trial: TrialResponseBody | null | undefined): TrialSnapshot | null => {
  if (!trial) {
    return null
  }

  const allowed = Math.max(0, trial.allowed ?? 0)
  const remaining = Math.max(0, trial.remaining ?? trial.total ?? allowed)
  const total = Math.max(trial.total ?? allowed, allowed)

  return {
    allowed,
    startedAt: trial.started ?? null,
    total,
    remaining,
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

const isElectronRuntime = (): boolean =>
  typeof process !== 'undefined' && Boolean(process.versions?.electron)

const getRequire = (): NodeRequire | null => {
  try {
    if (typeof require === 'function') {
      return require
    }
  } catch (error) {
    // ignore
  }
  try {
    const globalRequire = (globalThis as { require?: NodeRequire }).require
    if (typeof globalRequire === 'function') {
      return globalRequire
    }
  } catch (error) {
    // ignore
  }
  return null
}

const loadElectronShell = (): Shell | null => {
  if (!isElectronRuntime()) {
    return null
  }
  const req = getRequire()
  if (!req) {
    return null
  }
  try {
    const electron = req('electron') as typeof import('electron')
    return electron?.shell ?? null
  } catch (error) {
    return null
  }
}

const openExternalUrl = (url: string, logger: Logger): void => {
  if (!isNonEmptyString(url)) {
    logger.warn?.('Received empty checkout URL. Nothing to open.')
    return
  }

  try {
    const parsed = new URL(url)
    const sanitised = parsed.toString()
    const shell = loadElectronShell()
    if (shell) {
      void shell.openExternal(sanitised)
      return
    }
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(sanitised, '_blank', 'noopener')
    }
  } catch (error) {
    logger.error?.('Unable to open external URL: %s', url, error)
  }
}

const DEFAULT_APP_BASE_URLS: Record<ApiEnvironment, string> = {
  dev: 'https://app.atropos.dev',
  prod: 'https://app.atropos.video'
}

const resolveReturnUrl = (): string | null => {
  if (typeof window === 'undefined' || !window.location) {
    return null
  }
  try {
    const current = new URL(window.location.href)
    current.hash = ''
    current.search = ''
    return current.origin
  } catch (error) {
    return null
  }
}

const normaliseHttpOrigin = (value: string | null): string | null => {
  if (!isNonEmptyString(value)) {
    return null
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }
    return url.origin
  } catch (error) {
    return null
  }
}

const resolveAppBaseUrl = (client: ApiClient): string => {
  const runtimeOrigin = normaliseHttpOrigin(resolveReturnUrl())
  if (runtimeOrigin) {
    return runtimeOrigin
  }
  const environment = client.getEnvironment()
  return DEFAULT_APP_BASE_URLS[environment] ?? DEFAULT_APP_BASE_URLS.prod
}

const buildCheckoutRedirects = (
  client: ApiClient
): { successUrl: string; cancelUrl: string } => {
  const baseUrl = resolveAppBaseUrl(client)
  const successUrl = new URL('/profile?billing=success', baseUrl).toString()
  const cancelUrl = new URL('/profile?billing=cancel', baseUrl).toString()
  return { successUrl, cancelUrl }
}

const buildPortalReturnUrl = (client: ApiClient): string => {
  const baseUrl = resolveAppBaseUrl(client)
  return new URL('/settings', baseUrl).toString()
}

const computeIsEntitled = (entitlement: EntitlementSnapshot | null): boolean =>
  Boolean(entitlement?.entitled)

const computeIsTrial = (entitlement: EntitlementSnapshot | null): boolean => {
  if (!entitlement?.trial) {
    return false
  }
  if (entitlement.trial.remaining <= 0) {
    return false
  }
  if (!entitlement.entitled) {
    return true
  }
  const status = entitlement.status?.toLowerCase() ?? ''
  return status.includes('trial')
}

const computeIsTrialExhausted = (entitlement: EntitlementSnapshot | null): boolean => {
  if (!entitlement?.trial) {
    return true
  }
  return entitlement.trial.remaining <= 0
}

const computeUiMode = (entitlement: EntitlementSnapshot | null): UiMode => {
  const isEntitled = computeIsEntitled(entitlement)
  const isTrial = computeIsTrial(entitlement)
  const isTrialExhausted = computeIsTrialExhausted(entitlement)

  if (!isEntitled) {
    return isTrialExhausted ? 'gated_profile' : 'trial'
  }

  if (isTrial) {
    return 'trial'
  }

  return 'paid'
}

const computeStatusFromEntitlement = (entitlement: EntitlementSnapshot | null): AccessStatus =>
  computeIsEntitled(entitlement) ? 'entitled' : 'not_entitled'

export class AccessStore {
  private snapshot: AccessSnapshot

  private readonly listeners = new Set<AccessStoreListener>()

  private readonly client: ApiClient

  private identity: AccessIdentity | null

  private identityPromise: Promise<AccessIdentity | null> | null = null

  private readonly logger: Logger

  private refreshPromise: Promise<void> | null = null

  private issuePromise: Promise<string | null> | null = null

  private autoTrialPromise: Promise<void> | null = null

  private readonly now: () => number

  constructor(options?: AccessStoreOptions) {
    this.client = options?.client ?? getDefaultApiClient()
    this.logger = options?.logger ?? console
    this.now = options?.now ?? Date.now
    this.identity = cloneIdentity(options?.identity ?? null)
    this.snapshot = { ...DEFAULT_SNAPSHOT }

    if (this.identity) {
      this.snapshot = Object.freeze({
        ...DEFAULT_SNAPSHOT,
        identity: cloneIdentity(this.identity),
        status: 'loading'
      }) as AccessSnapshot
    } else {
      this.snapshot = Object.freeze({ ...DEFAULT_SNAPSHOT }) as AccessSnapshot
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', () => {
        void this.refresh()
      })
    }

    if (this.identity) {
      this.setIdentity(this.identity, { refresh: false, invalidateLicense: false })
    } else {
      void this.ensureIdentity()
    }

    if (options?.autoStart ?? true) {
      void this.refresh()
    }
  }

  getSnapshot(): AccessSnapshot {
    return this.snapshot
  }

  subscribe(listener: AccessStoreListener): () => void {
    this.listeners.add(listener)
    try {
      listener(this.snapshot)
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
      status: hasIdentity ? this.snapshot.status : 'error',
      lastError: hasIdentity ? null : 'Licensing identity is not configured.'
    })
    if (!hasIdentity && (options?.invalidateLicense ?? true)) {
      this.clearLicenseToken()
    }
    if (hasIdentity && options?.refresh !== false) {
      void this.refresh()
    }
  }

  private ensureIdentity(): Promise<AccessIdentity | null> {
    if (this.identity) {
      return Promise.resolve(cloneIdentity(this.identity))
    }
    if (this.identityPromise) {
      return this.identityPromise
    }

    const promise = (async (): Promise<AccessIdentity | null> => {
      try {
        const deviceHash = await getDeviceHash()
        if (!isNonEmptyString(deviceHash)) {
          throw new Error('Received empty device hash from identity provider.')
        }
        const identity: AccessIdentity = { deviceHash }
        this.setIdentity(identity, { refresh: false, invalidateLicense: false })
        return cloneIdentity(this.identity)
      } catch (error) {
        this.logger.error?.('Failed to resolve device identity', error)
        this.setIdentity(null, { refresh: false, invalidateLicense: true })
        return null
      } finally {
        this.identityPromise = null
      }
    })()

    this.identityPromise = promise
    return promise
  }

  async refresh(options?: { force?: boolean }): Promise<void> {
    if (this.refreshPromise) {
      return this.refreshPromise
    }
    const performRefresh = async (): Promise<void> => {
      const identity = await this.ensureIdentity()
      if (!identity) {
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
        status: 'loading',
        lastError: null,
        identity
      })

      let autoTrialCandidate: EntitlementSnapshot | null = null

      try {
        const response = await this.client.get<EntitlementResponseBody>('/billing/subscription', {
          query: {
            device_hash: identity.deviceHash,
            force: options?.force ? 'true' : undefined
          }
        })
        const entitlement = this.mapEntitlement(response)
        const status = computeStatusFromEntitlement(entitlement)
        if (this.shouldAutoStartTrial(entitlement)) {
          autoTrialCandidate = entitlement
        }
        this.updateSnapshot({
          entitlement,
          lastCheckedAt: entitlement?.fetchedAt ?? this.now(),
          status,
          lastError: null,
          isRefreshing: false
        })
        if (!this.snapshot.isEntitled) {
          this.clearLicenseToken()
          return
        }
        await this.issueLicenseToken({ reason: 'subscription_refresh' })
      } catch (error) {
        this.handleEntitlementError(error, options)
      } finally {
        this.refreshPromise = null
        this.updateSnapshot({ isRefreshing: false })
        if (autoTrialCandidate) {
          this.maybeAutoStartTrial(autoTrialCandidate)
        }
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

    const identity = await this.ensureIdentity()
    if (!identity) {
      this.logger.warn?.('Cannot issue license token without identity.')
      return null
    }

    if (!this.snapshot.isEntitled) {
      return null
    }

    const entitlementEpoch = this.snapshot.entitlement?.epoch ?? 0
    const license = this.snapshot.license
    const now = nowSeconds(this.now)

    if (license && license.epoch !== entitlementEpoch) {
      this.logger.info?.(
        'Cached license epoch %d does not match entitlement epoch %d; refreshing snapshot.',
        license.epoch,
        entitlementEpoch
      )
      this.clearLicenseToken()
      await this.refresh()
      return this.snapshot.license?.token ?? null
    }

    if (!license || license.expiresAt <= now) {
      if (license) {
        this.logger.info?.('License token expired; refreshing entitlement snapshot.')
        this.clearLicenseToken()
      }
      await this.refresh()
      return this.snapshot.license?.token ?? null
    }

    return license.token
  }

  reportUnauthorized(): void {
    if (!this.snapshot.isEntitled) {
      return
    }
    this.logger.warn?.('License token rejected by the API. Refreshing entitlement snapshot.')
    this.clearLicenseToken()
    void this.refresh()
  }

  async startTrial(): Promise<void> {
    await this.performStartTrial({ silent: false })
  }

  private async performStartTrial(options: { silent: boolean }): Promise<void> {
    const identity = await this.ensureIdentity()
    if (!identity) {
      const message = 'Licensing identity is not configured.'
      if (!options.silent) {
        this.updateSnapshot({ lastError: message })
        throw new Error(message)
      }
      this.logger.warn?.('Unable to start trial without a device identity.')
      return
    }
    try {
      await this.client.post('/trial/start', {
        device_hash: identity.deviceHash
      })
      if (this.refreshPromise) {
        try {
          await this.refreshPromise
        } catch (error) {
          this.logger.warn?.('Previous entitlement refresh failed before starting trial.', error)
        }
      }
      await this.refresh({ force: true })
    } catch (error) {
      const message = describeError(error, 'Unable to start trial. Please try again later.')
      if (options.silent) {
        this.logger.warn?.('Automatic trial activation failed: %s', message)
        return
      }
      this.logger.error?.('Failed to start trial', error)
      this.updateSnapshot({ lastError: message })
      throw error instanceof Error ? error : new Error(message)
    }
  }

  async openCheckout(): Promise<void> {
    const identity = await this.ensureIdentity()
    if (!identity) {
      const message = 'Licensing identity is not configured.'
      this.updateSnapshot({ lastError: message })
      throw new Error(message)
    }
    try {
      const { successUrl, cancelUrl } = buildCheckoutRedirects(this.client)
      const payload: Record<string, string> = {
        device_hash: identity.deviceHash,
        success_url: successUrl,
        cancel_url: cancelUrl
      }
      const email = this.snapshot.entitlement?.email
      if (isNonEmptyString(email)) {
        payload.email = email
      }
      const response = await this.client.post<CheckoutResponseBody>('/billing/checkout', payload)
      if (!isNonEmptyString(response?.url)) {
        throw new Error('Checkout session URL is missing from the response.')
      }
      openExternalUrl(response.url, this.logger)
    } catch (error) {
      const message = describeError(error, 'Unable to open checkout session.')
      this.logger.error?.('Failed to open checkout session', error)
      this.updateSnapshot({ lastError: message })
      throw error instanceof Error ? error : new Error(message)
    }
  }

  async openPortal(): Promise<void> {
    const identity = await this.ensureIdentity()
    if (!identity) {
      const message = 'Licensing identity is not configured.'
      this.updateSnapshot({ lastError: message })
      throw new Error(message)
    }
    try {
      const payload: Record<string, string> = {
        device_hash: identity.deviceHash,
        return_url: buildPortalReturnUrl(this.client)
      }
      const response = await this.client.post<PortalResponseBody>('/billing/portal', payload)
      if (!isNonEmptyString(response?.url)) {
        throw new Error('Portal session URL is missing from the response.')
      }
      openExternalUrl(response.url, this.logger)
    } catch (error) {
      const message = describeError(error, 'Unable to open subscription management portal.')
      this.logger.error?.('Failed to open billing portal', error)
      this.updateSnapshot({ lastError: message })
      throw error instanceof Error ? error : new Error(message)
    }
  }

  private updateSnapshot(partial: Partial<AccessSnapshot>): void {
    const nextEntitlement =
      partial.entitlement !== undefined
        ? cloneEntitlement(partial.entitlement)
        : cloneEntitlement(this.snapshot.entitlement)

    const base: AccessSnapshot = {
      ...this.snapshot,
      ...partial,
      entitlement: nextEntitlement,
      identity:
        partial.identity !== undefined ? cloneIdentity(partial.identity) : cloneIdentity(this.snapshot.identity),
      license: partial.license !== undefined ? cloneLicense(partial.license) : cloneLicense(this.snapshot.license),
      status: partial.status ?? this.snapshot.status,
      lastError: partial.lastError ?? this.snapshot.lastError,
      lastCheckedAt: partial.lastCheckedAt ?? this.snapshot.lastCheckedAt,
      isRefreshing: partial.isRefreshing ?? this.snapshot.isRefreshing,
      isEntitled: false,
      isTrial: false,
      isTrialExhausted: true,
      uiMode: 'gated_profile'
    }

    const isEntitled = computeIsEntitled(base.entitlement)
    const isTrial = computeIsTrial(base.entitlement)
    const isTrialExhausted = computeIsTrialExhausted(base.entitlement)
    const uiMode = computeUiMode(base.entitlement)

    const nextSnapshot: AccessSnapshot = {
      ...base,
      isEntitled,
      isTrial,
      isTrialExhausted,
      uiMode
    }

    this.snapshot = Object.freeze(nextSnapshot) as AccessSnapshot

    for (const listener of this.listeners) {
      try {
        listener(this.snapshot)
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

  private mapEntitlement(body: EntitlementResponseBody | null | undefined): EntitlementSnapshot | null {
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
      updatedAt: typeof body.updated_at === 'number' ? body.updated_at : null,
      email: body.email ?? null
    }
  }

  private async issueLicenseToken(options?: { reason?: string }): Promise<string | null> {
    if (this.issuePromise) {
      return this.issuePromise
    }
    const identity = await this.ensureIdentity()
    if (!identity) {
      this.logger.warn?.('Cannot issue license token without identity.')
      return null
    }
    if (!this.snapshot.isEntitled) {
      return null
    }

    const promise = (async (): Promise<string | null> => {
      try {
        const response = await this.client.post<LicenseIssueResponseBody>('/license/issue', {
          device_hash: identity.deviceHash
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

  private handleEntitlementError(error: unknown, options?: { force?: boolean }): void {
    if (error instanceof ApiError && error.status === 404) {
      this.logger.info?.('No active entitlement found for the current device.')
      this.clearLicenseToken()
      this.updateSnapshot({
        entitlement: null,
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
    const message = describeError(error, 'Unable to load entitlement details.')
    this.logger.error?.('Failed to refresh entitlement', error)
    this.updateSnapshot({
      lastError: message,
      status: 'error'
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

  private shouldAutoStartTrial(entitlement: EntitlementSnapshot | null): boolean {
    if (!entitlement || entitlement.entitled) {
      return false
    }
    const trial = entitlement.trial
    if (!trial) {
      return false
    }
    if (trial.remaining > 0) {
      return false
    }
    if (trial.startedAt) {
      return false
    }
    return trial.allowed > 0 || trial.total > 0
  }

  private maybeAutoStartTrial(entitlement: EntitlementSnapshot | null): void {
    if (!this.shouldAutoStartTrial(entitlement)) {
      return
    }
    if (this.autoTrialPromise) {
      return
    }
    this.autoTrialPromise = (async () => {
      try {
        await this.performStartTrial({ silent: true })
      } finally {
        this.autoTrialPromise = null
      }
    })()
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
