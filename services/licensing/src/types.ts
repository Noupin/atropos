export interface TrialInfo {
  totalRuns: number
  remainingRuns: number
  startedAt: string
}

export interface TransferInfo {
  email: string
  token: string
  expiresAt: string
}

export type SubscriptionLifecycleStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused'
  | 'pending'

export interface SubscriptionInfo {
  customerId: string
  subscriptionId: string | null
  status: SubscriptionLifecycleStatus
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  priceId: string | null
  updatedAt: string
}

export interface DeviceRecord {
  trial?: TrialInfo
  transfer?: TransferInfo
  subscription?: SubscriptionInfo
}

export interface Env {
  LICENSING_KV: KVNamespace
  STRIPE_SECRET_KEY?: string
  STRIPE_PRICE_ID?: string
  STRIPE_WEBHOOK_SECRET?: string
  SUBSCRIPTION_SUCCESS_URL?: string
  SUBSCRIPTION_CANCEL_URL?: string
  SUBSCRIPTION_PORTAL_RETURN_URL?: string
}

export type AccessSource = 'subscription' | 'trial' | 'none'

export interface SubscriptionStatusResponse {
  customerId: string | null
  subscriptionId: string | null
  status: SubscriptionLifecycleStatus
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  priceId: string | null
}

export interface AccessStatusResponse {
  subscription: SubscriptionStatusResponse | null
  trial: TrialInfo | null
  accessGranted: boolean
  accessSource: AccessSource
}
