import { DEFAULT_TRIAL_RUNS, getDeviceRecord, putDeviceRecord } from '../lib/kv'
import { jsonResponse } from '../lib/http'
import { buildAccessResponse, isSubscriptionActive } from '../lib/access'
import { normaliseDeviceHash, parseJsonBody } from '../lib/validation'
import type { DeviceRecord, Env } from '../types'

export const getTrialStatus = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const url = new URL(request.url)
  const deviceHash = normaliseDeviceHash(url.searchParams.get('device_hash'))
  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_device_hash' }, { status: 400 })
  }

  const record = await getDeviceRecord(env, deviceHash)
  if (!record) {
    return jsonResponse({ error: 'trial_not_found' }, { status: 404 })
  }

  return jsonResponse(buildAccessResponse(record))
}

export const startTrial = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJsonBody(request)
  const deviceHash = normaliseDeviceHash(body.device_hash)
  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_device_hash' }, { status: 400 })
  }

  const existing = await getDeviceRecord(env, deviceHash)
  if (existing) {
    return jsonResponse(buildAccessResponse(existing))
  }

  const startedAt = new Date().toISOString()
  const record: DeviceRecord = {
    trial: {
      totalRuns: DEFAULT_TRIAL_RUNS,
      remainingRuns: DEFAULT_TRIAL_RUNS,
      startedAt
    }
  }
  await putDeviceRecord(env, deviceHash, record)
  return jsonResponse(buildAccessResponse(record))
}

export const consumeTrial = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJsonBody(request)
  const deviceHash = normaliseDeviceHash(body.device_hash)
  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_device_hash' }, { status: 400 })
  }

  const record = await getDeviceRecord(env, deviceHash)
  if (!record) {
    return jsonResponse({ code: 'trial_exhausted' }, { status: 400 })
  }

  if (isSubscriptionActive(record.subscription)) {
    return jsonResponse(buildAccessResponse(record))
  }

  if (!record.trial || record.trial.remainingRuns <= 0) {
    return jsonResponse({ code: 'trial_exhausted' }, { status: 400 })
  }

  const remainingRuns = Math.max(0, record.trial.remainingRuns - 1)
  const updated: DeviceRecord = {
    ...record,
    trial: {
      ...record.trial,
      remainingRuns
    }
  }
  await putDeviceRecord(env, deviceHash, updated)

  return jsonResponse(buildAccessResponse(updated))
}
