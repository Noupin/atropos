import {
  BACKEND_MODE,
  buildBillingPortalUrl,
  buildCheckoutSessionUrl,
  buildSubscriptionStatusUrl,
  buildTrialClaimUrl,
  buildTrialConsumeUrl,
  buildTrialStartUrl
} from '../config/backend'
import type {
  BillingPortalSession,
  CheckoutSession,
  SubscriptionStatus,
  TrialStatus
} from '../types'
import { extractErrorMessage, requestWithFallback } from './http'
import {
  syncTrialUsageFromServer,
  updateTrialRemainingFromServer
} from './accessControl'

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
  entitled: true,
  trial: {
    allowed: true,
    started: true,
    total: 3,
    remaining: 3,
    usedAt: null,
    deviceHash: null,
    exp: Math.floor(Date.now() / 1000) + 15 * 60
  }
})

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
  const body = (await response.json()) as {
    status?: SubscriptionStatus['status']
    planId?: string | null
    planName?: string | null
    renewsAt?: string | null
    cancelAt?: string | null
    trialEndsAt?: string | null
    latestInvoiceUrl?: string | null
    entitled?: boolean
    trial?: Partial<{
      allowed: boolean
      started: boolean
      total: number
      remaining: number
      used_at: number | null
      device_hash: string | null
      exp: number | null
    }>
  }
  const trialPayload = body.trial ?? {}
  const started = trialPayload?.started === true
  const total =
    typeof trialPayload?.total === 'number' && Number.isFinite(trialPayload.total)
      ? Math.max(0, Math.floor(trialPayload.total))
      : started
        ? 3
        : 0
  const remaining =
    typeof trialPayload?.remaining === 'number' && Number.isFinite(trialPayload.remaining)
      ? Math.max(0, Math.floor(trialPayload.remaining))
      : 0
  const usedAt =
    typeof trialPayload?.used_at === 'number' && Number.isFinite(trialPayload.used_at)
      ? trialPayload.used_at
      : null
  const deviceHash =
    typeof trialPayload?.device_hash === 'string' && trialPayload.device_hash.trim().length > 0
      ? trialPayload.device_hash.trim()
      : null
  const trial: TrialStatus = {
    allowed: trialPayload?.allowed === true,
    started,
    total: Math.max(total, remaining),
    remaining,
    usedAt,
    deviceHash,
    exp:
      typeof trialPayload?.exp === 'number' && Number.isFinite(trialPayload.exp)
        ? trialPayload.exp
        : null
  }

  const usedAtForSync =
    trialPayload?.used_at === null
      ? null
      : typeof trialPayload?.used_at === 'number' && Number.isFinite(trialPayload.used_at)
        ? trialPayload.used_at
        : undefined

  syncTrialUsageFromServer(
    {
      started,
      total: trial.total,
      remaining: trial.remaining,
      used_at: usedAtForSync,
      device_hash: deviceHash
    },
    { entitled: body.entitled === true }
  )
  return {
    status: body.status ?? 'inactive',
    planId: body.planId ?? null,
    planName: body.planName ?? null,
    renewsAt: body.renewsAt ?? null,
    cancelAt: body.cancelAt ?? null,
    trialEndsAt: body.trialEndsAt ?? null,
    latestInvoiceUrl: body.latestInvoiceUrl ?? null,
    entitled: body.entitled === true,
    trial
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

type TrialClaimResponse = {
  token: string
  exp: number
  remaining: number
}

type TrialStartResponse = {
  started: boolean
  total: number
  remaining: number
}

export const startTrial = async (
  userId: string,
  deviceHash: string
): Promise<TrialStartResponse> => {
  const normalizedUserId = userId.trim()
  const normalizedDeviceHash = deviceHash.trim()

  if (!normalizedUserId) {
    throw new Error('A billing user ID is required to start the trial.')
  }

  if (!normalizedDeviceHash) {
    throw new Error('A device fingerprint is required to start the trial.')
  }

  const response = await requestWithFallback(buildTrialStartUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: normalizedUserId, device_hash: normalizedDeviceHash })
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const body = (await response.json()) as Partial<TrialStartResponse>
  const started = body.started === true
  const total =
    typeof body.total === 'number' && Number.isFinite(body.total)
      ? Math.max(0, Math.floor(body.total))
      : 0
  const remaining =
    typeof body.remaining === 'number' && Number.isFinite(body.remaining)
      ? Math.max(0, Math.floor(body.remaining))
      : 0

  syncTrialUsageFromServer(
    {
      started,
      total,
      remaining,
      device_hash: normalizedDeviceHash
    },
    { entitled: false }
  )

  return { started, total, remaining }
}

export const claimTrialRender = async (
  userId: string,
  deviceHash: string
): Promise<TrialClaimResponse> => {
  const normalizedUserId = userId.trim()
  const normalizedDeviceHash = deviceHash.trim()
  if (!normalizedUserId) {
    throw new Error('A billing user ID is required to claim the trial render.')
  }

  if (!normalizedDeviceHash) {
    throw new Error('A device fingerprint is required to claim the trial render.')
  }

  const response = await requestWithFallback(buildTrialClaimUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: normalizedUserId, device_hash: normalizedDeviceHash })
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const body = (await response.json()) as Partial<TrialClaimResponse>
  const token = typeof body.token === 'string' && body.token.trim().length > 0 ? body.token : null
  const exp = typeof body.exp === 'number' && Number.isFinite(body.exp) ? body.exp : null
  const remaining =
    typeof body.remaining === 'number' && Number.isFinite(body.remaining)
      ? Math.max(0, Math.floor(body.remaining))
      : null

  if (!token || exp === null || remaining === null) {
    throw new Error('Trial claim response was missing required fields.')
  }

  updateTrialRemainingFromServer(remaining)

  return { token, exp, remaining }
}

export const consumeTrialRender = async (
  userId: string,
  token: string,
  deviceHash: string
): Promise<number> => {
  const normalizedUserId = userId.trim()
  const normalizedToken = token.trim()
  const normalizedDeviceHash = deviceHash.trim()

  if (!normalizedUserId || !normalizedToken) {
    throw new Error('A trial token and billing user ID are required to consume the trial.')
  }

  if (!normalizedDeviceHash) {
    throw new Error('A device fingerprint is required to consume the trial.')
  }

  const response = await requestWithFallback(buildTrialConsumeUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: normalizedUserId,
      token: normalizedToken,
      device_hash: normalizedDeviceHash
    })
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  const body = (await response.json()) as Partial<{ success: boolean; remaining: number }>
  const remaining =
    typeof body.remaining === 'number' && Number.isFinite(body.remaining)
      ? Math.max(0, Math.floor(body.remaining))
      : null

  if (remaining === null) {
    throw new Error('Trial consume response was missing the remaining allowance.')
  }

  updateTrialRemainingFromServer(remaining)

  return remaining
}

