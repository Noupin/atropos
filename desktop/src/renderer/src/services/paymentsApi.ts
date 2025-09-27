import {
  BACKEND_MODE,
  buildBillingPortalUrl,
  buildCheckoutSessionUrl,
  buildSubscriptionStatusUrl
} from '../config/backend'
import type {
  BillingPortalSession,
  CheckoutSession,
  SubscriptionStatus,
  SubscriptionTrialState
} from '../types'
import { updateTrialStateFromApi, TrialStateSnapshot } from './accessControl'
import { extractErrorMessage, requestWithFallback } from './http'

const delay = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

const USE_BILLING_API_MOCKS = false

const isMockBilling = USE_BILLING_API_MOCKS || BACKEND_MODE === 'mock'

const mockSubscriptionStatus = (): SubscriptionStatus => ({
  status: 'trialing',
  planId: 'mock-pro',
  planName: 'Atropos Mock Pro',
  renewsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  cancelAt: null,
  trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  latestInvoiceUrl: 'https://stripe.test/invoice/mock',
  trial: {
    allowed: true,
    started: true,
    total: 3,
    remaining: 3,
    usedAt: null,
    deviceHash: null
  }
})

const toSubscriptionTrialState = (
  snapshot: TrialStateSnapshot | null
): SubscriptionTrialState | null => {
  if (!snapshot) {
    return null
  }
  return {
    allowed: snapshot.allowed,
    started: snapshot.started,
    total: snapshot.total,
    remaining: snapshot.remaining,
    usedAt: snapshot.usedAt ? new Date(snapshot.usedAt).toISOString() : null,
    deviceHash: snapshot.deviceHash ?? null
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
  const body = (await response.json()) as Partial<SubscriptionStatus>
  const trialSnapshot = updateTrialStateFromApi((body as { trial?: unknown })?.trial ?? null)
  return {
    status: body.status ?? 'inactive',
    planId: body.planId ?? null,
    planName: body.planName ?? null,
    renewsAt: body.renewsAt ?? null,
    cancelAt: body.cancelAt ?? null,
    trialEndsAt: body.trialEndsAt ?? null,
    latestInvoiceUrl: body.latestInvoiceUrl ?? null,
    trial: toSubscriptionTrialState(trialSnapshot)
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

