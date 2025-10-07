import { DEFAULT_TRIAL_RUNS, getDeviceRecord, putDeviceRecord } from '../lib/kv'
import { jsonResponse } from '../lib/http'
import type { DeviceRecord, Env, TrialStatusResponse } from '../types'

const buildStatus = (record: DeviceRecord): TrialStatusResponse => ({
  totalRuns: record.trial.totalRuns,
  remainingRuns: record.trial.remainingRuns,
  isTrialAllowed: record.trial.remainingRuns > 0
})

const normaliseDeviceHash = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

const parseJsonBody = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const body = (await request.json()) as Record<string, unknown>
    return body ?? {}
  } catch (error) {
    return {}
  }
}

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

  return jsonResponse(buildStatus(record))
}

export const startTrial = async (request: Request, env: Env): Promise<Response> => {
  const body = await parseJsonBody(request)
  const deviceHash = normaliseDeviceHash(body.device_hash)
  if (!deviceHash) {
    return jsonResponse({ error: 'invalid_device_hash' }, { status: 400 })
  }

  const existing = await getDeviceRecord(env, deviceHash)
  if (existing) {
    return jsonResponse(buildStatus(existing))
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
  return jsonResponse(buildStatus(record))
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

  if (record.trial.remainingRuns <= 0) {
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

  return jsonResponse(buildStatus(updated))
}
