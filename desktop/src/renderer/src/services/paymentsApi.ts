import {
  BACKEND_MODE,
  buildBillingPortalUrl,
  buildCheckoutSessionUrl,
  buildLicenseIssueUrl,
  buildSubscriptionStatusUrl
} from '../config/backend'
import type {
  BillingPortalSession,
  CheckoutSession,
  SubscriptionLifecycleStatus,
  SubscriptionStatus
} from '../types'
import { extractErrorMessage, requestWithFallback } from './http'

const delay = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

const isMockBilling = BACKEND_MODE === 'mock'

const lifecycleStatuses = new Set<SubscriptionLifecycleStatus>([
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
])

const normalizeLifecycleStatus = (
  value: unknown
): SubscriptionLifecycleStatus => {
  if (typeof value === 'string') {
    const lower = value.toLowerCase() as SubscriptionLifecycleStatus
    if (lifecycleStatuses.has(lower)) {
      return lower
    }
  }
  return 'inactive'
}

const toNullableString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const toNullableNumber = (value: unknown): number | null => {
  if (typeof value !== 'number') {
    return null
  }
  return Number.isFinite(value) ? value : null
}

const mockSubscriptionStatus = (): SubscriptionStatus => {
  const now = Date.now()
  const renewalMs = now + 14 * 24 * 60 * 60 * 1000
  const trialMs = now + 7 * 24 * 60 * 60 * 1000
  const currentPeriodEnd = Math.floor(renewalMs / 1000)

  return {
    status: 'trialing',
    planId: 'mock-pro',
    planName: 'Atropos Mock Pro',
    renewsAt: new Date(renewalMs).toISOString(),
    cancelAt: null,
    trialEndsAt: new Date(trialMs).toISOString(),
    latestInvoiceUrl: 'https://stripe.test/invoice/mock',
    entitled: true,
    currentPeriodEnd,
    cancelAtPeriodEnd: false,
    epoch: 0
  }
}

const mockCheckoutSession = (): CheckoutSession => ({
  url: 'https://stripe.test/checkout'
})

const mockBillingPortalSession = (): BillingPortalSession => ({
  url: 'https://stripe.test/portal'
})

export const fetchSubscriptionStatus = async (userId: string): Promise<SubscriptionStatus> => {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) {
    throw new Error('A billing user ID is required to load subscription details.')
  }

  if (isMockBilling) {
    await delay(120)
    return mockSubscriptionStatus()
  }

  const response = await requestWithFallback(() => buildSubscriptionStatusUrl(normalizedUserId))
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  const body = (await response.json()) as Record<string, unknown>
  const status = normalizeLifecycleStatus(body.status)
  const planId =
    toNullableString(body.planId) ??
    toNullableString((body as { planPriceId?: unknown }).planPriceId) ??
    toNullableString((body as { plan_price_id?: unknown }).plan_price_id)
  const planName = toNullableString(body.planName)
  const currentPeriodEnd = toNullableNumber(body.current_period_end)
  const currentPeriodEndIso = toNullableString(
    (body as { currentPeriodEndIso?: unknown }).currentPeriodEndIso
  )
  const renewsAt = toNullableString(body.renewsAt) ?? currentPeriodEndIso
  const cancelAtPeriodEnd = Boolean(body.cancel_at_period_end)
  const cancelAt =
    toNullableString(body.cancelAt) ??
    toNullableString((body as { cancelAtIso?: unknown }).cancelAtIso) ??
    (cancelAtPeriodEnd && currentPeriodEndIso ? currentPeriodEndIso : null)
  const trialEndsAt =
    toNullableString(body.trialEndsAt) ??
    toNullableString((body as { trialEndsAtIso?: unknown }).trialEndsAtIso)
  const latestInvoiceUrl = toNullableString(body.latestInvoiceUrl)
  const entitled = Boolean(body.entitled)
  const epoch = toNullableNumber(body.epoch) ?? 0

  return {
    status,
    planId,
    planName,
    renewsAt,
    cancelAt,
    trialEndsAt,
    latestInvoiceUrl,
    entitled,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    epoch
  }
}

type CheckoutSessionPayload = {
  userId: string
  email: string
  priceId?: string | null
  successUrl?: string | null
  cancelUrl?: string | null
}

export const createCheckoutSession = async (
  payload: CheckoutSessionPayload
): Promise<CheckoutSession> => {
  const normalizedUserId = payload.userId.trim()
  if (!normalizedUserId) {
    throw new Error('A billing user ID is required to start checkout.')
  }

  const normalizedEmail = payload.email.trim()
  if (!normalizedEmail) {
    throw new Error('A billing email is required to start checkout.')
  }

  if (isMockBilling) {
    await delay(120)
    return mockCheckoutSession()
  }

  const requestBody: Record<string, unknown> = {
    user_id: normalizedUserId,
    email: normalizedEmail
  }

  if (payload.priceId && payload.priceId.trim().length > 0) {
    requestBody.price_id = payload.priceId.trim()
  }

  if (payload.successUrl && payload.successUrl.trim().length > 0) {
    requestBody.success_url = payload.successUrl.trim()
  }

  if (payload.cancelUrl && payload.cancelUrl.trim().length > 0) {
    requestBody.cancel_url = payload.cancelUrl.trim()
  }

  const response = await requestWithFallback(buildCheckoutSessionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  const body = (await response.json()) as CheckoutSession
  if (!body.url) {
    throw new Error('The checkout session did not include a redirect URL.')
  }
  return body
}

type BillingPortalPayload = {
  userId: string
  returnUrl?: string | null
}

export const createBillingPortalSession = async (
  payload: BillingPortalPayload
): Promise<BillingPortalSession> => {
  const normalizedUserId = payload.userId.trim()
  if (!normalizedUserId) {
    throw new Error('A billing user ID is required to open the portal.')
  }

  if (isMockBilling) {
    await delay(120)
    return mockBillingPortalSession()
  }

  const requestBody: Record<string, unknown> = {
    user_id: normalizedUserId
  }

  if (payload.returnUrl && payload.returnUrl.trim().length > 0) {
    requestBody.return_url = payload.returnUrl.trim()
  }

  const response = await requestWithFallback(buildBillingPortalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  const body = (await response.json()) as BillingPortalSession
  if (!body.url) {
    throw new Error('The billing portal session did not include a redirect URL.')
  }
  return body
}

export type LicenseToken = {
  token: string
  exp: number
  kid?: string
}

type LicenseIssuePayload = {
  userId: string
  deviceHash: string
}

export const issueLicenseToken = async (
  payload: LicenseIssuePayload
): Promise<LicenseToken> => {
  const normalizedUserId = payload.userId.trim()
  if (!normalizedUserId) {
    throw new Error('A billing user ID is required to issue a license.')
  }

  const normalizedDeviceHash = payload.deviceHash.trim()
  if (!normalizedDeviceHash) {
    throw new Error('A device fingerprint is required to issue a license.')
  }

  if (isMockBilling) {
    await delay(60)
    return {
      token: 'mock-license-token',
      exp: Math.floor(Date.now() / 1000) + 600,
      kid: 'mock'
    }
  }

  const response = await requestWithFallback(buildLicenseIssueUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: normalizedUserId,
      device_hash: normalizedDeviceHash
    })
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const body = (await response.json()) as Partial<LicenseToken>
  const token = toNullableString(body.token)
  const exp = toNullableNumber(body.exp)
  if (!token) {
    throw new Error('The licensing service did not return a token.')
  }
  if (exp === null) {
    throw new Error('The licensing service did not include a token expiry.')
  }

  const kid = toNullableString(body.kid ?? null) ?? undefined

  return { token, exp, kid }
}

