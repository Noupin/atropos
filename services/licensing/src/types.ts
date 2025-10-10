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

export type SubscriptionStatus =
  | 'pending'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'trialing'
  | 'unpaid'
  | null

export interface SubscriptionInfo {
  customerId: string | null
  subscriptionId: string | null
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  priceId: string | null
  updatedAt: string | null
}

export interface DeviceRecord {
  trial: TrialInfo
  subscription: SubscriptionInfo
  transfer?: TransferInfo
  updatedAt?: string
}

export interface StoredDeviceRecord {
  trial: TrialInfo
  subscription?: Partial<SubscriptionInfo> | null
  transfer?: TransferInfo
  updatedAt?: string
}

export interface Env {
  LICENSING_KV: KVNamespace
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  STRIPE_PRICE_ID?: string
  SUBSCRIPTION_SUCCESS_URL?: string
  SUBSCRIPTION_CANCEL_URL?: string
  TIER?: string
  CORS_ALLOW_ORIGINS?: string
}

export interface TrialStatusResponse {
  totalRuns: number
  remainingRuns: number
  isTrialAllowed: boolean
}

export type AccessSource = 'subscription' | 'trial' | 'none'

export interface AccessSummary {
  source: AccessSource
  isActive: boolean
}

export interface SubscriptionStatusResponse {
  deviceHash: string
  access: AccessSummary
  subscription: SubscriptionInfo | null
  trial: TrialInfo | null
}
