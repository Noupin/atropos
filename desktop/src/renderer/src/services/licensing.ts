import { getLicensingApiBaseUrl } from '../config/licensing'

export type TrialStatusPayload = {
  totalRuns: number
  remainingRuns: number
  isTrialAllowed: boolean
  startedAt?: string | null
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

export type SubscriptionInfoPayload = {
  customerId: string | null
  subscriptionId: string | null
  status: SubscriptionStatus
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  priceId: string | null
  updatedAt: string | null
}

export type AccessSource = 'subscription' | 'trial' | 'none'

export type AccessSummaryPayload = {
  source: AccessSource
  isActive: boolean
}

export type AccessStatusPayload = {
  deviceHash: string
  access: AccessSummaryPayload
  subscription: SubscriptionInfoPayload | null
  trial: TrialStatusPayload | null
}

export class LicensingOfflineError extends Error {
  constructor(message = 'Licensing service is unreachable.') {
    super(message)
    this.name = 'LicensingOfflineError'
  }
}

export class LicensingRequestError extends Error {
  readonly code: string | undefined
  readonly status: number

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'LicensingRequestError'
    this.status = status
    this.code = code
  }
}

const parseJson = async <T>(response: Response): Promise<T> => {
  const payload = (await response.json()) as T
  return payload
}

const request = async (path: string, init?: RequestInit): Promise<Response> => {
  const base = getLicensingApiBaseUrl()
  if (!base) {
    throw new LicensingOfflineError('Licensing API base URL is not configured.')
  }

  const url = new URL(path, base).toString()
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers ?? {})
      }
    })
    return response
  } catch (error) {
    throw new LicensingOfflineError()
  }
}

export const fetchTrialStatus = async (deviceHash: string): Promise<TrialStatusPayload | null> => {
  const response = await request(`/trial/status?device_hash=${encodeURIComponent(deviceHash)}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    throw new LicensingRequestError('Unable to fetch trial status.', response.status)
  }
  return parseJson<TrialStatusPayload>(response)
}

export const startTrial = async (deviceHash: string): Promise<TrialStatusPayload> => {
  const response = await request('/trial/start', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })
  if (!response.ok) {
    throw new LicensingRequestError('Unable to start trial.', response.status)
  }
  return parseJson<TrialStatusPayload>(response)
}

export class TrialExhaustedError extends LicensingRequestError {
  constructor() {
    super('Trial has been exhausted.', 400, 'trial_exhausted')
    this.name = 'TrialExhaustedError'
  }
}

export const consumeTrial = async (deviceHash: string): Promise<TrialStatusPayload> => {
  const response = await request('/trial/consume', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })

  if (response.status === 400) {
    try {
      const body = (await response.json()) as { code?: string; error?: string }
      if (body?.code === 'trial_exhausted') {
        throw new TrialExhaustedError()
      }
      const message = body?.error || 'Unable to consume trial.'
      throw new LicensingRequestError(message, response.status, body?.code)
    } catch (error) {
      if (error instanceof LicensingRequestError || error instanceof TrialExhaustedError) {
        throw error
      }
      throw new LicensingRequestError('Unable to consume trial.', response.status)
    }
  }

  if (!response.ok) {
    throw new LicensingRequestError('Unable to consume trial.', response.status)
  }

  return parseJson<TrialStatusPayload>(response)
}

export const fetchAccessStatus = async (deviceHash: string): Promise<AccessStatusPayload | null> => {
  const response = await request(`/subscription/status?device_hash=${encodeURIComponent(deviceHash)}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new LicensingRequestError('Unable to fetch access status.', response.status, body?.error)
  }
  return parseJson<AccessStatusPayload>(response)
}

export type CheckoutSessionPayload = {
  sessionId: string
  checkoutUrl: string | null
}

export const createSubscriptionCheckout = async (
  deviceHash: string
): Promise<CheckoutSessionPayload> => {
  const response = await request('/subscribe', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new LicensingRequestError('Unable to start subscription checkout.', response.status, body?.error)
  }
  return parseJson<CheckoutSessionPayload>(response)
}

export type PortalSessionPayload = {
  portalUrl: string
}

export const createBillingPortalSession = async (
  deviceHash: string
): Promise<PortalSessionPayload> => {
  const response = await request('/portal', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new LicensingRequestError('Unable to open billing portal.', response.status, body?.error)
  }
  return parseJson<PortalSessionPayload>(response)
}
