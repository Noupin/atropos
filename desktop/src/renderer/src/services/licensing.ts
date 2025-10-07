import { getLicensingApiBaseUrl } from '../config/licensing'

export type TrialStatusPayload = {
  totalRuns: number
  remainingRuns: number
  isTrialAllowed: boolean
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

const handleResponse = async (response: Response): Promise<TrialStatusPayload> => {
  const payload = (await response.json()) as TrialStatusPayload
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
  return handleResponse(response)
}

export const startTrial = async (deviceHash: string): Promise<TrialStatusPayload> => {
  const response = await request('/trial/start', {
    method: 'POST',
    body: JSON.stringify({ device_hash: deviceHash })
  })
  if (!response.ok) {
    throw new LicensingRequestError('Unable to start trial.', response.status)
  }
  return handleResponse(response)
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

  return handleResponse(response)
}
