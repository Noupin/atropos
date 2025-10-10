import { createStripeClient, ensureCustomerForDevice, handleStripeError, saveRecordForDevice } from '../lib/stripe'
import { buildAccessResponse } from '../lib/access'
import { jsonResponse } from '../lib/http'
import { loadRecordForDevice } from '../lib/stripe'
import { normaliseDeviceHash, parseJsonBody } from '../lib/validation'
import type { DeviceRecord, Env } from '../types'

const ensureConfigValue = (value: string | undefined, code: string): string => {
  if (!value || value.trim().length === 0) {
    throw new Error(code)
  }
  return value.trim()
}

const attachPendingSubscription = (
  record: DeviceRecord,
  updates: Partial<DeviceRecord['subscription']>
): DeviceRecord => {
  const customerId = updates.customerId ?? record.subscription?.customerId ?? null
  if (!customerId) {
    throw new Error('stripe_customer_missing')
  }
  const now = new Date().toISOString()
  return {
    ...record,
    subscription: {
      customerId,
      subscriptionId: record.subscription?.subscriptionId ?? null,
      status: record.subscription?.status ?? 'pending',
      currentPeriodEnd: record.subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: record.subscription?.cancelAtPeriodEnd ?? false,
      priceId: updates.priceId ?? record.subscription?.priceId ?? null,
      updatedAt: now
    }
  }
}

export const createSubscriptionCheckout = async (
  request: Request,
  env: Env
): Promise<Response> => {
  try {
    const body = await parseJsonBody(request)
    const deviceHash = normaliseDeviceHash(body.device_hash)
    if (!deviceHash) {
      return jsonResponse({ error: 'invalid_device' }, { status: 400 })
    }

    const record = await loadRecordForDevice(env, deviceHash)
    if (!record) {
      return jsonResponse({ error: 'invalid_device' }, { status: 404 })
    }

    const priceId = ensureConfigValue(env.STRIPE_PRICE_ID, 'stripe_price_unconfigured')
    const successUrl = ensureConfigValue(env.SUBSCRIPTION_SUCCESS_URL, 'stripe_success_url_unconfigured')
    const cancelUrl = ensureConfigValue(env.SUBSCRIPTION_CANCEL_URL, 'stripe_cancel_url_unconfigured')

    const stripe = createStripeClient(env)
    const { id: customerId, updatedRecord, hasChanges } = await ensureCustomerForDevice(
      stripe,
      deviceHash,
      record
    )
    if (hasChanges) {
      await saveRecordForDevice(env, deviceHash, updatedRecord)
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: deviceHash,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        device_hash: deviceHash
      },
      subscription_data: {
        metadata: {
          device_hash: deviceHash
        }
      },
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ]
    })

    const nextRecord = attachPendingSubscription(updatedRecord, {
      customerId,
      priceId
    })
    await saveRecordForDevice(env, deviceHash, nextRecord)

    return jsonResponse({ sessionId: session.id, checkoutUrl: session.url })
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('_unconfigured')) {
      return jsonResponse({ error: error.message }, { status: 500 })
    }
    if (error instanceof Error && error.message === 'stripe_customer_missing') {
      return jsonResponse({ error: 'stripe_customer_missing' }, { status: 500 })
    }
    return handleStripeError(error)
  }
}

export const createCustomerPortalSession = async (
  request: Request,
  env: Env
): Promise<Response> => {
  try {
    const body = await parseJsonBody(request)
    const deviceHash = normaliseDeviceHash(body.device_hash)
    if (!deviceHash) {
      return jsonResponse({ error: 'invalid_device' }, { status: 400 })
    }

    const record = await loadRecordForDevice(env, deviceHash)
    if (!record || !record.subscription?.customerId) {
      return jsonResponse({ error: 'subscription_not_found' }, { status: 404 })
    }

    const returnUrl = ensureConfigValue(
      env.SUBSCRIPTION_PORTAL_RETURN_URL,
      'stripe_portal_return_url_unconfigured'
    )
    const stripe = createStripeClient(env)
    const session = await stripe.billingPortal.sessions.create({
      customer: record.subscription.customerId,
      return_url: returnUrl
    })

    return jsonResponse({ portalUrl: session.url })
  } catch (error) {
    if (error instanceof Error && error.message.endsWith('_unconfigured')) {
      return jsonResponse({ error: error.message }, { status: 500 })
    }
    return handleStripeError(error)
  }
}

export const getSubscriptionStatus = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const url = new URL(request.url)
  const deviceHash = normaliseDeviceHash(url.searchParams.get('device_hash'))
  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_device' }, { status: 400 })
  }

  const record = await loadRecordForDevice(env, deviceHash)
  if (!record) {
    return jsonResponse({ error: 'subscription_not_found' }, { status: 404 })
  }

  return jsonResponse(buildAccessResponse(record))
}
