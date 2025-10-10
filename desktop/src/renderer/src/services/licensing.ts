import { getLicensingApiBaseUrl } from '../config/licensing'

export type AccessSource = 'subscription' | 'trial' | 'none'

export type SubscriptionStatusPayload = {
  customerId: string | null
  subscriptionId: string | null
  status:
    | 'incomplete'
    | 'incomplete_expired'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | 'pending'
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  priceId: string | null
}

export type TrialStatusPayload = {
  totalRuns: number
  remainingRuns: number
  startedAt?: string
}

export type AccessStatusPayload = {
  subscription: SubscriptionStatusPayload | null
  trial: TrialStatusPayload | null
  accessGranted: boolean
  accessSource: AccessSource
}

export type SubscriptionCheckoutSession = {
  sessionId: string
  checkoutUrl: string | null
}

export type SubscriptionPortalSession = {
  portalUrl: string | null
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

export class TrialExhaustedError extends LicensingRequestError {
  constructor() {
    super('Trial has been exhausted.', 400, 'trial_exhausted')
    this.name = 'TrialExhaustedError'
  }
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

const parseJson = async <T>(response: Response): Promise<T> => {
  try {
    const payload = (await response.json()) as T
    return payload
  } catch (error) {
    throw new LicensingRequestError('Invalid response from licensing service.', response.status)
  }
}

const parseErrorPayload = async (
  response: Response
): Promise<{ error?: string; code?: string; message?: string }> => {
  try {
    const payload = (await response.json()) as { error?: string; code?: string; message?: string }
    return payload ?? {}
  } catch (error) {
    return {}
  }
}

const resolveErrorMessage = (
  payload: { error?: string; message?: string },
  fallback: string
): string => {
  if (payload.message && payload.message.trim().length > 0) {
    return payload.message
  }
  if (payload.error && payload.error.trim().length > 0) {
    return payload.error
  }
  return fallback
}

export const fetchAccessStatus = async (
  deviceHash: string
): Promise<AccessStatusPayload | null> => {
  const response = await request(`/subscription/status?device_hash=${encodeURIComponent(deviceHash)}`)
  if (response.status === 404) {
    return null
  }
  if (!response.ok) {
    const payload = await parseErrorPayload(response)
    const message = resolveErrorMessage(payload, 'Unable to fetch subscription status.')
    throw new LicensingRequestError(message, response.status, payload.code)
  }
  return parseJson<AccessStatusPayload>(response)
}

export const startTrial = async (deviceHash: string): Promise<AccessStatusPayload> => {
  const response = await request('/trial/start', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })
  if (!response.ok) {
    const payload = await parseErrorPayload(response)
    const message = resolveErrorMessage(payload, 'Unable to start trial.')
    throw new LicensingRequestError(message, response.status, payload.code)
  }
  return parseJson<AccessStatusPayload>(response)
}

export const consumeTrial = async (deviceHash: string): Promise<AccessStatusPayload> => {
  const response = await request('/trial/consume', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })

  if (response.status === 400) {
    const payload = await parseErrorPayload(response)
    if (payload.code === 'trial_exhausted') {
      throw new TrialExhaustedError()
    }
    const message = resolveErrorMessage(payload, 'Unable to consume trial.')
    throw new LicensingRequestError(message, response.status, payload.code)
  }

  if (!response.ok) {
    const payload = await parseErrorPayload(response)
    const message = resolveErrorMessage(payload, 'Unable to consume trial.')
    throw new LicensingRequestError(message, response.status, payload.code)
  }

  return parseJson<AccessStatusPayload>(response)
}

export const createSubscriptionCheckoutSession = async (
  deviceHash: string
): Promise<SubscriptionCheckoutSession> => {
  const response = await request('/subscribe', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })

  if (!response.ok) {
    const payload = await parseErrorPayload(response)
    const message = resolveErrorMessage(payload, 'Unable to start subscription checkout.')
    throw new LicensingRequestError(message, response.status, payload.code)
  }

  return parseJson<SubscriptionCheckoutSession>(response)
}

export const createSubscriptionPortalSession = async (
  deviceHash: string
): Promise<SubscriptionPortalSession> => {
  const response = await request('/portal', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })

  if (!response.ok) {
    const payload = await parseErrorPayload(response)
    const message = resolveErrorMessage(payload, 'Unable to open subscription portal.')
    throw new LicensingRequestError(message, response.status, payload.code)
  }

  return parseJson<SubscriptionPortalSession>(response)
}
