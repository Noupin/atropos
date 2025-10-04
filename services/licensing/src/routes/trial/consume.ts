import { jsonResponse, errorResponse } from '../../lib/http'
import type { LicensingEnv } from '../../lib/kv'
import { consumeTrialRun, toClientTrialPayload } from '../../lib/trial'

const parseDeviceHash = async (request: Request): Promise<string | null> => {
  try {
    const body = (await request.json()) as unknown
    if (!body || typeof body !== 'object') {
      return null
    }

    const value = (body as Record<string, unknown>)['device_hash']
    if (typeof value !== 'string') {
      return null
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch (error) {
    return null
  }
}

export const handleTrialConsume = async (request: Request, env: LicensingEnv): Promise<Response> => {
  if (request.method !== 'POST') {
    return errorResponse(405, 'Method not allowed', {
      headers: { Allow: 'POST' }
    })
  }

  const deviceHash = await parseDeviceHash(request)
  if (!deviceHash) {
    return errorResponse(400, 'device_hash is required')
  }

  const { record, consumed } = await consumeTrialRun(env, deviceHash)

  return jsonResponse({
    trial: toClientTrialPayload(record),
    access: {
      active: false
    },
    consumed
  })
}
