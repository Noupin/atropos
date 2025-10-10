import Stripe from 'stripe'

import { findDeviceByCustomerId, getDeviceRecord, putDeviceRecord } from './kv'
import { toSubscriptionInfo } from './access'
import { jsonResponse } from './http'
import type { DeviceRecord, Env } from '../types'

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2023-10-16'

export class StripeConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StripeConfigurationError'
  }
}

export const createStripeClient = (env: Env): Stripe => {
  if (!env.STRIPE_SECRET_KEY) {
    throw new StripeConfigurationError('Stripe secret key is not configured.')
  }
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient()
  })
}

const timestampToIso = (value: number | null | undefined): string | null => {
  if (!value) {
    return null
  }
  return new Date(value * 1000).toISOString()
}

export const ensureCustomerForDevice = async (
  stripe: Stripe,
  deviceHash: string,
  record: DeviceRecord
): Promise<{ id: string; updatedRecord: DeviceRecord; hasChanges: boolean }> => {
  const existingCustomerId = record.subscription?.customerId
  if (existingCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(existingCustomerId)
      if (!existing.deleted) {
        if ((existing.metadata?.device_hash ?? null) !== deviceHash) {
          await stripe.customers.update(existing.id, {
            metadata: {
              ...(existing.metadata ?? {}),
              device_hash: deviceHash
            }
          })
        }
        const nextRecord: DeviceRecord = {
          ...record,
          subscription: record.subscription
            ? {
                ...record.subscription,
                customerId: existing.id
              }
            : {
                customerId: existing.id,
                subscriptionId: null,
                status: 'pending',
                currentPeriodEnd: null,
                cancelAtPeriodEnd: false,
                priceId: null,
                updatedAt: new Date().toISOString()
              }
        }
        return { id: existing.id, updatedRecord: nextRecord, hasChanges: !record.subscription }
      }
    } catch (error) {
      // Continue to create a new customer.
    }
  }

  const customer = await stripe.customers.create({
    metadata: { device_hash: deviceHash }
  })

  const nextRecord: DeviceRecord = {
    ...record,
    subscription: {
      customerId: customer.id,
      subscriptionId: null,
      status: 'pending',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      priceId: record.subscription?.priceId ?? null,
      updatedAt: new Date().toISOString()
    }
  }
  return { id: customer.id, updatedRecord: nextRecord, hasChanges: true }
}

export const refreshSubscriptionFromStripe = async (
  stripe: Stripe,
  record: DeviceRecord,
  subscriptionId: string
): Promise<DeviceRecord> => {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id

  const updated: DeviceRecord = {
    ...record,
    subscription: toSubscriptionInfo(record.subscription, {
      customerId,
      subscriptionId: subscription.id,
      status: subscription.status,
      currentPeriodEnd: timestampToIso(subscription.current_period_end),
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      priceId: subscription.items.data[0]?.price?.id ?? record.subscription?.priceId ?? null
    })
  }
  return updated
}

export const handleStripeError = (error: unknown): Response => {
  if (error instanceof StripeConfigurationError) {
    return jsonResponse(
      { error: 'stripe_configuration_error', message: error.message },
      { status: 500 }
    )
  }
  if (error instanceof Stripe.errors.StripeError) {
    return jsonResponse(
      {
        error: 'stripe_error',
        message: error.message,
        code: error.code ?? 'stripe_error'
      },
      { status: 502 }
    )
  }
  return jsonResponse({ error: 'stripe_error', message: 'Unexpected Stripe error.' }, { status: 502 })
}

export const findRecordForCustomer = async (
  env: Env,
  customerId: string
): Promise<{ deviceHash: string; record: DeviceRecord } | null> => {
  return findDeviceByCustomerId(env, customerId)
}

export const loadRecordForDevice = async (
  env: Env,
  deviceHash: string
): Promise<DeviceRecord | null> => {
  const record = await getDeviceRecord(env, deviceHash)
  return record
}

export const saveRecordForDevice = async (
  env: Env,
  deviceHash: string,
  record: DeviceRecord
): Promise<void> => {
  await putDeviceRecord(env, deviceHash, record)
}

