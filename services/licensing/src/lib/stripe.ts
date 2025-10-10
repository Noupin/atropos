import type { Env, SubscriptionInfo, SubscriptionStatus } from '../types'

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

export class StripeApiError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'StripeApiError'
    this.status = status
    this.code = code
  }
}

type StripeRequestOptions = {
  method: 'GET' | 'POST'
  path: string
  body?: URLSearchParams
}

const requireStripeSecret = (env: Env): string => {
  if (!env.STRIPE_SECRET_KEY) {
    throw new StripeApiError('Stripe secret key is not configured.', 500)
  }
  return env.STRIPE_SECRET_KEY
}

const callStripe = async <T>(env: Env, options: StripeRequestOptions): Promise<T> => {
  const secretKey = requireStripeSecret(env)
  const response = await fetch(`${STRIPE_API_BASE}${options.path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: options.method === 'POST' ? options.body : undefined
  })

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as T & { error?: { message?: string; code?: string } }) : ({} as T)

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { message?: string } }).error?.message ?? 'Stripe request failed.'
      : 'Stripe request failed.'
    const code = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { code?: string } }).error?.code
      : undefined
    throw new StripeApiError(message, response.status, code)
  }

  return payload as T
}

export type StripeCustomer = {
  id: string
  metadata?: Record<string, string>
}

export type StripeCheckoutSession = {
  id: string
  url: string | null
  subscription?: string | StripeSubscription | null
  customer?: string | StripeCustomer | null
  metadata?: Record<string, string>
  client_reference_id?: string | null
}

export type StripeSubscription = {
  id: string
  status: string
  current_period_end: number | null
  cancel_at_period_end: boolean
  customer: string
  metadata?: Record<string, string>
  items?: {
    data: Array<{
      price?: {
        id?: string | null
      } | null
    }>
  }
}

export type StripePortalSession = {
  url: string
}

const toTimestampIso = (epochSeconds: number | null | undefined): string | null => {
  if (!epochSeconds) {
    return null
  }
  const millis = epochSeconds * 1000
  if (!Number.isFinite(millis)) {
    return null
  }
  return new Date(millis).toISOString()
}

export const createCustomer = async (env: Env, deviceHash: string): Promise<StripeCustomer> => {
  const params = new URLSearchParams()
  params.set('metadata[device_hash]', deviceHash)
  return callStripe<StripeCustomer>(env, { method: 'POST', path: '/customers', body: params })
}

export const createCheckoutSession = async (
  env: Env,
  options: {
    deviceHash: string
    priceId: string
    successUrl: string
    cancelUrl: string
    customerId?: string | null
  }
): Promise<StripeCheckoutSession> => {
  const params = new URLSearchParams()
  params.set('mode', 'subscription')
  params.set('success_url', options.successUrl)
  params.set('cancel_url', options.cancelUrl)
  params.set('line_items[0][price]', options.priceId)
  params.set('line_items[0][quantity]', '1')
  params.set('client_reference_id', options.deviceHash)
  params.set('metadata[device_hash]', options.deviceHash)
  params.set('subscription_data[metadata][device_hash]', options.deviceHash)
  if (options.customerId) {
    params.set('customer', options.customerId)
  }
  return callStripe<StripeCheckoutSession>(env, { method: 'POST', path: '/checkout/sessions', body: params })
}

export const createBillingPortalSession = async (
  env: Env,
  options: { customerId: string; returnUrl: string }
): Promise<StripePortalSession> => {
  const params = new URLSearchParams()
  params.set('customer', options.customerId)
  params.set('return_url', options.returnUrl)
  return callStripe<StripePortalSession>(env, {
    method: 'POST',
    path: '/billing_portal/sessions',
    body: params
  })
}

export const retrieveSubscription = async (
  env: Env,
  subscriptionId: string
): Promise<StripeSubscription> => {
  return callStripe<StripeSubscription>(env, {
    method: 'GET',
    path: `/subscriptions/${subscriptionId}`
  })
}

export const mapStripeSubscription = (subscription: StripeSubscription): Partial<SubscriptionInfo> => {
  const status = (subscription.status as SubscriptionStatus) ?? null
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null
  return {
    subscriptionId: subscription.id,
    status,
    currentPeriodEnd: toTimestampIso(subscription.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
    priceId,
    customerId: subscription.customer ?? null,
    updatedAt: new Date().toISOString()
  }
}
