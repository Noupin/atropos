import type Stripe from 'stripe'

import {
  createStripeClient,
  handleStripeError,
  loadRecordForDevice,
  saveRecordForDevice,
  refreshSubscriptionFromStripe,
  findRecordForCustomer
} from '../../lib/stripe'
import { jsonResponse } from '../../lib/http'
import { isSubscriptionActive, toSubscriptionInfo } from '../../lib/access'
import type { DeviceRecord, Env } from '../../types'

const resolveDeviceContext = async (
  env: Env,
  options: { deviceHash?: string | null; customerId?: string | null }
): Promise<{ deviceHash: string; record: DeviceRecord } | null> => {
  if (options.deviceHash) {
    const record = await loadRecordForDevice(env, options.deviceHash)
    if (record) {
      return { deviceHash: options.deviceHash, record }
    }
  }

  if (options.customerId) {
    const match = await findRecordForCustomer(env, options.customerId)
    if (match) {
      return match
    }
  }

  return null
}

const invalidateTrialIfNeeded = (record: DeviceRecord): DeviceRecord => {
  if (!record.trial) {
    return record
  }
  if (record.trial.remainingRuns === 0) {
    return record
  }
  return {
    ...record,
    trial: {
      ...record.trial,
      remainingRuns: 0
    }
  }
}

const applySubscriptionDeletion = (
  record: DeviceRecord,
  details: { customerId: string; currentPeriodEnd: string | null }
): DeviceRecord => {
  const now = new Date().toISOString()
  return {
    ...record,
    subscription: {
      customerId: details.customerId,
      subscriptionId: record.subscription?.subscriptionId ?? null,
      status: 'canceled',
      currentPeriodEnd: details.currentPeriodEnd ?? record.subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: false,
      priceId: record.subscription?.priceId ?? null,
      updatedAt: now
    }
  }
}

const handleSubscriptionLifecycleEvent = async (
  env: Env,
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<void> => {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id
  const deviceHash = subscription.metadata?.device_hash ?? null
  const context = await resolveDeviceContext(env, { deviceHash, customerId })
  if (!context) {
    return
  }

  const updatedRecord = await refreshSubscriptionFromStripe(stripe, context.record, subscription.id)
  const finalRecord = isSubscriptionActive(updatedRecord.subscription)
    ? invalidateTrialIfNeeded(updatedRecord)
    : updatedRecord
  await saveRecordForDevice(env, context.deviceHash, finalRecord)
}

const handleCheckoutCompleted = async (
  env: Env,
  stripe: Stripe,
  session: Stripe.Checkout.Session
): Promise<void> => {
  const deviceHash = (session.client_reference_id ?? session.metadata?.device_hash ?? '').trim()
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? null
  if (!deviceHash && !customerId) {
    return
  }

  const context = await resolveDeviceContext(env, {
    deviceHash: deviceHash || null,
    customerId
  })
  if (!context) {
    return
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null
  if (!subscriptionId) {
    return
  }

  const updatedRecord = await refreshSubscriptionFromStripe(stripe, context.record, subscriptionId)
  const finalRecord = isSubscriptionActive(updatedRecord.subscription)
    ? invalidateTrialIfNeeded(updatedRecord)
    : updatedRecord
  await saveRecordForDevice(env, context.deviceHash, finalRecord)
}

const handleInvoiceFailed = async (
  env: Env,
  stripe: Stripe,
  invoice: Stripe.Invoice
): Promise<void> => {
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null
  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id ?? null

  const context = await resolveDeviceContext(env, {
    deviceHash: invoice.metadata?.device_hash ?? null,
    customerId
  })
  if (!context || !subscriptionId) {
    return
  }

  const updatedRecord = await refreshSubscriptionFromStripe(stripe, context.record, subscriptionId)
  const finalRecord = {
    ...updatedRecord,
    subscription: toSubscriptionInfo(updatedRecord.subscription, {
      customerId: updatedRecord.subscription?.customerId ?? customerId ?? '',
      subscriptionId,
      status: 'past_due',
      currentPeriodEnd: updatedRecord.subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: updatedRecord.subscription?.cancelAtPeriodEnd ?? false,
      priceId: updatedRecord.subscription?.priceId ?? null
    })
  }
  await saveRecordForDevice(env, context.deviceHash, finalRecord)
}

const handleSubscriptionDeleted = async (
  env: Env,
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<void> => {
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id
  const deviceHash = subscription.metadata?.device_hash ?? null
  const context = await resolveDeviceContext(env, { deviceHash, customerId })
  if (!context) {
    return
  }

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null
  const updatedRecord = applySubscriptionDeletion(context.record, {
    customerId,
    currentPeriodEnd
  })
  await saveRecordForDevice(env, context.deviceHash, updatedRecord)
}

export const handleStripeWebhook = async (request: Request, env: Env): Promise<Response> => {
  try {
    const signature = request.headers.get('stripe-signature')
    if (!signature) {
      return jsonResponse({ error: 'missing_signature' }, { status: 400 })
    }

    const secret = env.STRIPE_WEBHOOK_SECRET
    if (!secret) {
      throw new Error('stripe_webhook_secret_unconfigured')
    }

    const payload = await request.text()
    const stripe = createStripeClient(env)
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(payload, signature, secret)
    } catch (error) {
      return jsonResponse({ error: 'invalid_signature' }, { status: 400 })
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(env, stripe, event.data.object as Stripe.Checkout.Session)
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await handleSubscriptionLifecycleEvent(env, stripe, event.data.object as Stripe.Subscription)
        break
      case 'invoice.payment_failed':
        await handleInvoiceFailed(env, stripe, event.data.object as Stripe.Invoice)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(env, stripe, event.data.object as Stripe.Subscription)
        break
      default:
        break
    }

    return jsonResponse({ received: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'stripe_webhook_secret_unconfigured') {
      return jsonResponse({ error: error.message }, { status: 500 })
    }
    return handleStripeError(error)
  }
}
