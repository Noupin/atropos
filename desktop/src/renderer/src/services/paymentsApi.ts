import {
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

export const fetchSubscriptionStatus = async (): Promise<SubscriptionStatus> => {
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

