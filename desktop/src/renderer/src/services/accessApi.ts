import { buildTrialConsumeUrl, buildTrialStatusUrl } from '../config/licensing'

export type TrialRecord = {
  allowed: boolean
  remaining_runs: number
  started_at: string | null
}

export type AccessEnvelope = {
  trial: TrialRecord
  access: {
    active: boolean
  }
  consumed?: boolean
}

const request = async (url: string, deviceHash: string): Promise<AccessEnvelope> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ device_hash: deviceHash })
  })

  if (!response.ok) {
    const detail = await extractError(response)
    throw new Error(detail)
  }

  const payload = (await response.json()) as unknown
  if (!isAccessEnvelope(payload)) {
    throw new Error('Received an invalid response from the licensing service.')
  }

  return payload
}

const extractError = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { error?: string }
    if (body && typeof body.error === 'string' && body.error.trim().length > 0) {
      return body.error
    }
  } catch (error) {
    // fall through
  }

  return response.statusText || `Licensing request failed with status ${response.status}`
}

const isTrialRecord = (value: unknown): value is TrialRecord => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const record = value as Partial<TrialRecord>
  return (
    typeof record.allowed === 'boolean' &&
    typeof record.remaining_runs === 'number' &&
    Number.isFinite(record.remaining_runs) &&
    (record.started_at === null || typeof record.started_at === 'string')
  )
}

const isAccessEnvelope = (value: unknown): value is AccessEnvelope => {
  if (!value || typeof value !== 'object') {
    return false
  }

  const envelope = value as Partial<AccessEnvelope>
  if (!envelope.trial || typeof envelope.access !== 'object' || envelope.access === null) {
    return false
  }

  const active = (envelope.access as { active?: unknown }).active
  if (typeof active !== 'boolean') {
    return false
  }

  return isTrialRecord(envelope.trial)
}

export const fetchAccessStatus = async (deviceHash: string): Promise<AccessEnvelope> =>
  request(buildTrialStatusUrl(), deviceHash)

export const consumeTrialCredit = async (deviceHash: string): Promise<AccessEnvelope> =>
  request(buildTrialConsumeUrl(), deviceHash)
