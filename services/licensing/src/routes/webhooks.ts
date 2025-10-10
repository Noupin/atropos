import { jsonResponse } from '../lib/http'
import { getDeviceRecord, listDeviceKeys, putDeviceRecord } from '../lib/kv'
import { logError, logInfo } from '../lib/log'
import {
  StripeApiError,
  mapStripeSubscription,
  retrieveSubscription,
  type StripeCheckoutSession,
  type StripeSubscription
} from '../lib/stripe'
import type { DeviceRecord, Env, SubscriptionInfo } from '../types'
import { applySubscriptionUpdate, mapSessionSubscription } from './subscription'

interface StripeEvent<T = unknown> {
  id: string
  type: string
  data: {
    object: T
  }
}

const textEncoder = new TextEncoder()

const parseStripeSignatureHeader = (
  header: string | null
): { timestamp: string; signatures: string[] } | null => {
  if (!header) {
    return null
  }
  const parts = header.split(',')
  const timestampPart = parts.find((part) => part.startsWith('t='))
  if (!timestampPart) {
    return null
  }
  const timestamp = timestampPart.split('=')[1]
  const signatures = parts
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.split('=')[1])
    .filter((value): value is string => Boolean(value))
  if (!timestamp || signatures.length === 0) {
    return null
  }
  return { timestamp, signatures }
}

const computeStripeSignature = async (secret: string, payload: string, timestamp: string): Promise<string> => {
  const signedPayload = `${timestamp}.${payload}`
  const key = await crypto.subtle.importKey('raw', textEncoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign'
  ])
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, textEncoder.encode(signedPayload))
  const bytes = new Uint8Array(signatureBuffer)
  let signature = ''
  for (const byte of bytes) {
    signature += byte.toString(16).padStart(2, '0')
  }
  return signature
}

const timingSafeEqual = (a: string, b: string): boolean => {
  const aBytes = textEncoder.encode(a)
  const bBytes = textEncoder.encode(b)
  if (aBytes.length !== bBytes.length) {
    return false
  }
  let result = 0
  for (let index = 0; index < aBytes.length; index += 1) {
    result |= aBytes[index] ^ bBytes[index]
  }
  return result === 0
}

const verifyStripeSignature = async (request: Request, env: Env, payload: string): Promise<boolean> => {
  const secret = env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    logError('webhook.stripe.secret_missing', {})
    return false
  }

  const parsed = parseStripeSignatureHeader(request.headers.get('stripe-signature'))
  if (!parsed) {
    return false
  }

  try {
    const computed = await computeStripeSignature(secret, payload, parsed.timestamp)
    return parsed.signatures.some((candidate) => timingSafeEqual(candidate, computed))
  } catch (error) {
    logError('webhook.stripe.signature_verification_failed', {
      message: error instanceof Error ? error.message : 'Unknown error'
    })
    return false
  }
}

const findDeviceByCustomerId = async (
  env: Env,
  customerId: string
): Promise<{ deviceHash: string; record: DeviceRecord } | null> => {
  let cursor: string | undefined
  do {
    const { keys, cursor: nextCursor } = await listDeviceKeys(env, cursor)
    for (const key of keys) {
      const record = await getDeviceRecord(env, key)
      if (record?.subscription.customerId === customerId) {
        return { deviceHash: key, record }
      }
    }
    cursor = nextCursor
  } while (cursor)
  return null
}

const resolveDeviceRecord = async (
  env: Env,
  options: { deviceHash?: string | null; customerId?: string | null }
): Promise<{ deviceHash: string; record: DeviceRecord } | null> => {
  if (options.deviceHash) {
    const record = await getDeviceRecord(env, options.deviceHash)
    if (record) {
      return { deviceHash: options.deviceHash, record }
    }
  }
  if (options.customerId) {
    const match = await findDeviceByCustomerId(env, options.customerId)
    if (match) {
      return match
    }
  }
  return null
}

const toIso = (epochSeconds: number | null | undefined): string | null => {
  if (!epochSeconds) {
    return null
  }
  return new Date(epochSeconds * 1000).toISOString()
}

const handleCheckoutSessionCompleted = async (
  env: Env,
  session: StripeCheckoutSession
): Promise<void> => {
  const deviceHash = session.metadata?.device_hash ?? session.client_reference_id ?? null
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id ?? null

  const resolved = await resolveDeviceRecord(env, { deviceHash, customerId })
  if (!resolved) {
    logError('webhook.checkout_session_completed.device_not_found', {
      deviceHash,
      customerId
    })
    return
  }

  const { record } = resolved

  let subscriptionDetails: Partial<SubscriptionInfo> | null = mapSessionSubscription(session.subscription)
  if (subscriptionDetails?.subscriptionId && (!subscriptionDetails.status || !subscriptionDetails.currentPeriodEnd)) {
    try {
      const retrieved = await retrieveSubscription(env, subscriptionDetails.subscriptionId)
      subscriptionDetails = { ...subscriptionDetails, ...mapStripeSubscription(retrieved) }
    } catch (error) {
      if (error instanceof StripeApiError) {
        logError('webhook.checkout_session_completed.subscription_lookup_failed', {
          subscriptionId: subscriptionDetails.subscriptionId,
          status: error.status,
          code: error.code,
          message: error.message
        })
      } else {
        logError('webhook.checkout_session_completed.subscription_lookup_unexpected', {
          message: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
  }

  const updatedRecord = applySubscriptionUpdate(
    record,
    {
      customerId: subscriptionDetails?.customerId ?? customerId ?? record.subscription.customerId,
      subscriptionId: subscriptionDetails?.subscriptionId ?? record.subscription.subscriptionId,
      status: subscriptionDetails?.status ?? 'active',
      currentPeriodEnd: subscriptionDetails?.currentPeriodEnd ?? record.subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptionDetails?.cancelAtPeriodEnd ?? record.subscription.cancelAtPeriodEnd,
      priceId: subscriptionDetails?.priceId ?? record.subscription.priceId
    },
    { invalidateTrial: true }
  )

  await putDeviceRecord(env, resolved.deviceHash, updatedRecord)

  logInfo('webhook.checkout_session_completed.updated', {
    deviceHash: resolved.deviceHash,
    customerId: updatedRecord.subscription.customerId,
    subscriptionId: updatedRecord.subscription.subscriptionId
  })
}

const applySubscriptionPayload = async (
  env: Env,
  subscription: StripeSubscription,
  eventType: string
): Promise<void> => {
  const deviceHash = subscription.metadata?.device_hash ?? null
  const customerId = subscription.customer ?? null
  const resolved = await resolveDeviceRecord(env, { deviceHash, customerId })

  if (!resolved) {
    logError('webhook.subscription.device_not_found', {
      eventType,
      deviceHash,
      customerId,
      subscriptionId: subscription.id
    })
    return
  }

  const mapped = mapStripeSubscription(subscription)
  const isActive = mapped.status === 'active' || mapped.status === 'trialing'
  const updatedRecord = applySubscriptionUpdate(
    resolved.record,
    mapped,
    { invalidateTrial: isActive }
  )

  await putDeviceRecord(env, resolved.deviceHash, updatedRecord)

  logInfo('webhook.subscription.updated', {
    eventType,
    deviceHash: resolved.deviceHash,
    subscriptionId: subscription.id,
    status: mapped.status
  })
}

const handleInvoicePaymentFailed = async (env: Env, invoice: { customer?: string | null }): Promise<void> => {
  const customerId = typeof invoice.customer === 'string' ? invoice.customer : null
  if (!customerId) {
    logError('webhook.invoice_payment_failed.missing_customer', {})
    return
  }

  const resolved = await findDeviceByCustomerId(env, customerId)
  if (!resolved) {
    logError('webhook.invoice_payment_failed.device_not_found', { customerId })
    return
  }

  const updatedRecord = applySubscriptionUpdate(resolved.record, {
    customerId,
    status: 'past_due'
  })

  await putDeviceRecord(env, resolved.deviceHash, updatedRecord)

  logInfo('webhook.invoice_payment_failed.updated', {
    deviceHash: resolved.deviceHash,
    customerId
  })
}

const handleSubscriptionDeleted = async (env: Env, subscription: StripeSubscription): Promise<void> => {
  const deviceHash = subscription.metadata?.device_hash ?? null
  const customerId = subscription.customer ?? null
  const resolved = await resolveDeviceRecord(env, { deviceHash, customerId })

  if (!resolved) {
    logError('webhook.subscription_deleted.device_not_found', {
      subscriptionId: subscription.id,
      deviceHash,
      customerId
    })
    return
  }

  const updatedRecord = applySubscriptionUpdate(
    resolved.record,
    {
      subscriptionId: subscription.id,
      status: 'canceled',
      currentPeriodEnd: toIso(subscription.current_period_end),
      cancelAtPeriodEnd: false,
      customerId,
      priceId: subscription.items?.data?.[0]?.price?.id ?? resolved.record.subscription.priceId
    },
    { invalidateTrial: true }
  )

  await putDeviceRecord(env, resolved.deviceHash, updatedRecord)

  logInfo('webhook.subscription_deleted.updated', {
    deviceHash: resolved.deviceHash,
    subscriptionId: subscription.id
  })
}

export const handleStripeWebhook = async (request: Request, env: Env): Promise<Response> => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    logError('webhook.stripe.secret_missing', {})
    return jsonResponse({ error: 'stripe_error' }, { status: 500 })
  }

  const payload = await request.text()
  if (!payload) {
    return jsonResponse({ error: 'stripe_signature_missing' }, { status: 400 })
  }

  const isValid = await verifyStripeSignature(request, env, payload)
  if (!isValid) {
    return jsonResponse({ error: 'stripe_signature_missing' }, { status: 400 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(payload) as StripeEvent
  } catch (error) {
    logError('webhook.stripe.invalid_json', {
      message: error instanceof Error ? error.message : 'Unknown error'
    })
    return jsonResponse({ error: 'stripe_error' }, { status: 400 })
  }

  logInfo('webhook.stripe.received', {
    eventType: event.type,
    eventId: event.id
  })

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(env, event.data.object as StripeCheckoutSession)
        break
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await applySubscriptionPayload(env, event.data.object as StripeSubscription, event.type)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(env, event.data.object as StripeSubscription)
        break
      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(env, event.data.object as { customer?: string | null })
        break
      default:
        logInfo('webhook.stripe.unhandled_event', { eventType: event.type })
        break
    }
  } catch (error) {
    if (error instanceof StripeApiError) {
      logError('webhook.stripe.stripe_error', {
        eventType: event.type,
        status: error.status,
        code: error.code,
        message: error.message
      })
      return jsonResponse({ error: 'stripe_error' }, { status: 502 })
    }

    logError('webhook.stripe.unexpected_error', {
      eventType: event.type,
      message: error instanceof Error ? error.message : 'Unknown error'
    })
    return jsonResponse({ error: 'stripe_error' }, { status: 500 })
  }

  return jsonResponse({ received: true })
}

export const diagnostics = async (): Promise<Response> => {
  return jsonResponse({ ok: true, paths: ['/webhooks/stripe'] })
}
