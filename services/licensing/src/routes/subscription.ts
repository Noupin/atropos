import { jsonResponse } from '../lib/http'
import { getDeviceRecord, putDeviceRecord } from '../lib/kv'
import { normalizeDeviceHash, parseJsonBody } from '../lib/request'
import { logError, logInfo } from '../lib/log'
import {
  StripeApiError,
  createBillingPortalSession,
  createCheckoutSession,
  createCustomer,
  mapStripeSubscription
} from '../lib/stripe'
import type {
  AccessSummary,
  DeviceRecord,
  Env,
  SubscriptionInfo,
  SubscriptionStatusResponse
} from '../types'

const buildAccessSummary = (record: DeviceRecord): AccessSummary => {
  const subscriptionStatus = record.subscription.status
  if (subscriptionStatus) {
    const isActive = subscriptionStatus === 'active' || subscriptionStatus === 'trialing'
    return { source: 'subscription', isActive }
  }

  if (record.trial.remainingRuns > 0) {
    return { source: 'trial', isActive: true }
  }

  return { source: 'none', isActive: false }
}

const cloneSubscription = (subscription: SubscriptionInfo): SubscriptionInfo => ({
  customerId: subscription.customerId,
  subscriptionId: subscription.subscriptionId,
  status: subscription.status,
  currentPeriodEnd: subscription.currentPeriodEnd,
  cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  priceId: subscription.priceId,
  updatedAt: subscription.updatedAt
})

export const subscribe = async (request: Request, env: Env): Promise<Response> => {
  const body = (await parseJsonBody<Record<string, unknown>>(request)) ?? {}
  const deviceHash = normalizeDeviceHash(body.device_hash)

  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_device' }, { status: 400 })
  }

  logInfo('subscription.subscribe.request', {
    route: '/subscribe',
    method: request.method,
    deviceHash
  })

  const record = await getDeviceRecord(env, deviceHash)
  if (!record) {
    logError('subscription.subscribe.device_missing', { deviceHash })
    return jsonResponse({ error: 'invalid_device' }, { status: 404 })
  }

  const priceId = env.STRIPE_PRICE_ID
  if (!priceId) {
    logError('subscription.subscribe.price_unconfigured', { deviceHash })
    return jsonResponse({ error: 'stripe_price_unconfigured' }, { status: 500 })
  }

  const successUrl = env.SUBSCRIPTION_SUCCESS_URL
  if (!successUrl) {
    logError('subscription.subscribe.success_url_unconfigured', { deviceHash })
    return jsonResponse({ error: 'stripe_success_url_unconfigured' }, { status: 500 })
  }

  const cancelUrl = env.SUBSCRIPTION_CANCEL_URL
  if (!cancelUrl) {
    logError('subscription.subscribe.cancel_url_unconfigured', { deviceHash })
    return jsonResponse({ error: 'stripe_cancel_url_unconfigured' }, { status: 500 })
  }

  try {
    let customerId = record.subscription.customerId
    if (!customerId) {
      const customer = await createCustomer(env, deviceHash)
      customerId = customer.id
    }

    const session = await createCheckoutSession(env, {
      deviceHash,
      priceId,
      successUrl,
      cancelUrl,
      customerId
    })

    const sessionSubscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id ?? record.subscription.subscriptionId

    const now = new Date().toISOString()
    const updated: DeviceRecord = {
      ...record,
      subscription: {
        ...record.subscription,
        customerId,
        subscriptionId: sessionSubscriptionId ?? record.subscription.subscriptionId,
        status: 'pending',
        priceId,
        updatedAt: now
      },
      updatedAt: now
    }

    await putDeviceRecord(env, deviceHash, updated)

    logInfo('subscription.subscribe.success', {
      deviceHash,
      customerId,
      sessionId: session.id
    })

    return jsonResponse({
      sessionId: session.id,
      checkoutUrl: session.url
    })
  } catch (error) {
    if (error instanceof StripeApiError) {
      logError('subscription.subscribe.stripe_error', {
        deviceHash,
        status: error.status,
        code: error.code,
        message: error.message
      })
      return jsonResponse({ error: 'stripe_error' }, { status: 502 })
    }

    logError('subscription.subscribe.unexpected_error', {
      deviceHash,
      message: error instanceof Error ? error.message : 'Unknown error'
    })
    return jsonResponse({ error: 'stripe_error' }, { status: 500 })
  }
}

export const createPortalSession = async (request: Request, env: Env): Promise<Response> => {
  const body = (await parseJsonBody<Record<string, unknown>>(request)) ?? {}
  const deviceHash = normalizeDeviceHash(body.device_hash)

  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_device' }, { status: 400 })
  }

  logInfo('subscription.portal.request', {
    route: '/portal',
    method: request.method,
    deviceHash
  })

  const record = await getDeviceRecord(env, deviceHash)
  if (!record || !record.subscription.customerId) {
    logError('subscription.portal.subscription_not_found', { deviceHash })
    return jsonResponse({ error: 'subscription_not_found' }, { status: 404 })
  }

  const successUrl = env.SUBSCRIPTION_SUCCESS_URL
  if (!successUrl) {
    logError('subscription.portal.success_url_unconfigured', { deviceHash })
    return jsonResponse({ error: 'stripe_success_url_unconfigured' }, { status: 500 })
  }

  try {
    const session = await createBillingPortalSession(env, {
      customerId: record.subscription.customerId,
      returnUrl: successUrl
    })

    logInfo('subscription.portal.success', {
      deviceHash,
      customerId: record.subscription.customerId
    })

    return jsonResponse({ portalUrl: session.url })
  } catch (error) {
    if (error instanceof StripeApiError) {
      logError('subscription.portal.stripe_error', {
        deviceHash,
        status: error.status,
        code: error.code,
        message: error.message
      })
      return jsonResponse({ error: 'stripe_error' }, { status: 502 })
    }

    logError('subscription.portal.unexpected_error', {
      deviceHash,
      message: error instanceof Error ? error.message : 'Unknown error'
    })
    return jsonResponse({ error: 'stripe_error' }, { status: 500 })
  }
}

export const getSubscriptionStatus = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url)
  const deviceHash = normalizeDeviceHash(url.searchParams.get('device_hash'))

  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_device' }, { status: 400 })
  }

  logInfo('subscription.status.request', {
    route: '/subscription/status',
    method: request.method,
    deviceHash
  })

  const record = await getDeviceRecord(env, deviceHash)
  if (!record) {
    logError('subscription.status.device_missing', { deviceHash })
    return jsonResponse({ error: 'invalid_device' }, { status: 404 })
  }

  const access = buildAccessSummary(record)
  const subscription = cloneSubscription(record.subscription)
  const trial = {
    totalRuns: record.trial.totalRuns,
    remainingRuns: record.trial.remainingRuns,
    startedAt: record.trial.startedAt
  }

  const response: SubscriptionStatusResponse = {
    deviceHash,
    access,
    subscription: subscription.status || subscription.customerId || subscription.subscriptionId ? subscription : null,
    trial
  }

  logInfo('subscription.status.success', {
    deviceHash,
    accessSource: access.source,
    accessActive: access.isActive,
    subscriptionStatus: subscription.status
  })

  return jsonResponse(response)
}

export const applySubscriptionUpdate = (
  record: DeviceRecord,
  updates: Partial<SubscriptionInfo>,
  options?: { invalidateTrial?: boolean }
): DeviceRecord => {
  const now = new Date().toISOString()
  const subscription: SubscriptionInfo = {
    ...record.subscription,
    ...updates,
    cancelAtPeriodEnd: updates.cancelAtPeriodEnd ?? record.subscription.cancelAtPeriodEnd,
    currentPeriodEnd: updates.currentPeriodEnd ?? record.subscription.currentPeriodEnd,
    customerId: updates.customerId ?? record.subscription.customerId,
    priceId: updates.priceId ?? record.subscription.priceId,
    status: updates.status ?? record.subscription.status,
    subscriptionId: updates.subscriptionId ?? record.subscription.subscriptionId,
    updatedAt: now
  }

  const trial = options?.invalidateTrial
    ? { ...record.trial, remainingRuns: 0 }
    : record.trial

  return {
    ...record,
    trial,
    subscription,
    updatedAt: now
  }
}

export const mapSessionSubscription = (session: unknown): Partial<SubscriptionInfo> | null => {
  if (!session) {
    return null
  }

  if (typeof session === 'string') {
    return {
      subscriptionId: session
    }
  }

  if (typeof session === 'object' && session && 'id' in session) {
    return mapStripeSubscription(session as Record<string, unknown> as any)
  }

  return null
}
