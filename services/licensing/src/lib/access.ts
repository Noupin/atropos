import type {
  AccessSource,
  AccessStatusResponse,
  DeviceRecord,
  SubscriptionInfo,
  SubscriptionLifecycleStatus,
  SubscriptionStatusResponse
} from '../types'

const ACTIVE_STATUSES: SubscriptionLifecycleStatus[] = ['active', 'trialing']

export const isSubscriptionActive = (subscription: SubscriptionInfo | null | undefined): boolean => {
  if (!subscription) {
    return false
  }
  return ACTIVE_STATUSES.includes(subscription.status)
}

const normaliseStripeStatus = (status: string): SubscriptionLifecycleStatus => {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'incomplete':
    case 'incomplete_expired':
    case 'unpaid':
    case 'paused':
      return status
    default:
      return 'pending'
  }
}

export const toSubscriptionInfo = (
  existing: SubscriptionInfo | undefined,
  next: {
    customerId: string
    subscriptionId: string | null
    status: string
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean | null | undefined
    priceId: string | null
  }
): SubscriptionInfo => {
  const normalisedStatus = normaliseStripeStatus(next.status)
  const updatedAt = new Date().toISOString()
  return {
    customerId: next.customerId,
    subscriptionId: next.subscriptionId ?? existing?.subscriptionId ?? null,
    status: normalisedStatus,
    currentPeriodEnd: next.currentPeriodEnd ?? existing?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd:
      typeof next.cancelAtPeriodEnd === 'boolean'
        ? next.cancelAtPeriodEnd
        : existing?.cancelAtPeriodEnd ?? false,
    priceId: next.priceId ?? existing?.priceId ?? null,
    updatedAt
  }
}

const buildSubscriptionStatus = (subscription: SubscriptionInfo | undefined): SubscriptionStatusResponse | null => {
  if (!subscription) {
    return null
  }
  return {
    customerId: subscription.customerId ?? null,
    subscriptionId: subscription.subscriptionId ?? null,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
    priceId: subscription.priceId ?? null
  }
}

export const buildAccessResponse = (record: DeviceRecord): AccessStatusResponse => {
  const subscription = buildSubscriptionStatus(record.subscription)
  const trial = record.trial ?? null
  const subscriptionActive = isSubscriptionActive(record.subscription)
  const trialAvailable = Boolean(trial && trial.remainingRuns > 0)

  let accessGranted = false
  let accessSource: AccessSource = 'none'

  if (subscriptionActive) {
    accessGranted = true
    accessSource = 'subscription'
  } else if (trialAvailable) {
    accessGranted = true
    accessSource = 'trial'
  }

  return {
    subscription,
    trial,
    accessGranted,
    accessSource
  }
}
