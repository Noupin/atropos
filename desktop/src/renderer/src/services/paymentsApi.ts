import {
  BACKEND_MODE,
  buildBillingPortalUrl,
  buildCheckoutSessionUrl,
  buildSubscriptionStatusUrl
} from '../config/backend'
import type {
  BillingPortalSession,
  CheckoutSession,
  SubscriptionStatus
} from '../types'
import { extractErrorMessage, requestWithFallback } from './http'

const delay = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms))

const isMockBilling = BACKEND_MODE === 'mock'

const mockSubscriptionStatus = (): SubscriptionStatus => ({
  status: 'trialing',
  planId: 'mock-pro',
  planName: 'Atropos Mock Pro',
  renewsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  cancelAt: null,
  trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  latestInvoiceUrl: 'https://stripe.test/invoice/mock'
})

const mockCheckoutSession = (): CheckoutSession => ({
  url: 'https://stripe.test/checkout'
})

const mockBillingPortalSession = (): BillingPortalSession => ({
  url: 'https://stripe.test/portal'
})

export const fetchSubscriptionStatus = async (): Promise<SubscriptionStatus> => {
  if (isMockBilling) {
    await delay(120)
    return mockSubscriptionStatus()
  }

  const response = await requestWithFallback(buildSubscriptionStatusUrl)
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }
  const body = (await response.json()) as Partial<SubscriptionStatus>
  return {
    status: body.status ?? 'inactive',
    planId: body.planId ?? null,
    planName: body.planName ?? null,
    renewsAt: body.renewsAt ?? null,
    cancelAt: body.cancelAt ?? null,
    trialEndsAt: body.trialEndsAt ?? null,
    latestInvoiceUrl: body.latestInvoiceUrl ?? null
  }
}

export const createCheckoutSession = async (): Promise<CheckoutSession> => {
  if (isMockBilling) {
    await delay(120)
    return mockCheckoutSession()
  }

  const response = await requestWithFallback(buildCheckoutSessionUrl, {
    method: 'POST'
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

export const createBillingPortalSession = async (): Promise<BillingPortalSession> => {
  if (isMockBilling) {
    await delay(120)
    return mockBillingPortalSession()
  }

  const response = await requestWithFallback(buildBillingPortalUrl, {
    method: 'POST'
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

