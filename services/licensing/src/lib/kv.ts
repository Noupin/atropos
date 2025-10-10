import type { DeviceRecord, Env } from '../types'

const JSON_TYPE: KVNamespaceGetOptions<'json'> = { type: 'json' }

export const DEFAULT_TRIAL_RUNS = 3

const normaliseDeviceRecord = (value: unknown): DeviceRecord | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const record = value as DeviceRecord
  const normalised: DeviceRecord = {}
  if (record.transfer) {
    const { email, token, expiresAt } = record.transfer
    if (typeof email === 'string' && typeof token === 'string' && typeof expiresAt === 'string') {
      normalised.transfer = { email, token, expiresAt }
    }
  }
  if (record.trial) {
    const { totalRuns, remainingRuns, startedAt } = record.trial
    if (
      typeof totalRuns === 'number' &&
      typeof remainingRuns === 'number' &&
      typeof startedAt === 'string'
    ) {
      normalised.trial = {
        totalRuns,
        remainingRuns,
        startedAt
      }
    }
  }
  if (record.subscription) {
    const {
      customerId,
      subscriptionId,
      status,
      currentPeriodEnd,
      cancelAtPeriodEnd,
      priceId,
      updatedAt
    } = record.subscription
    if (typeof customerId === 'string' && typeof status === 'string' && typeof updatedAt === 'string') {
      normalised.subscription = {
        customerId,
        subscriptionId: subscriptionId ?? null,
        status,
        currentPeriodEnd: currentPeriodEnd ?? null,
        cancelAtPeriodEnd: Boolean(cancelAtPeriodEnd),
        priceId: priceId ?? null,
        updatedAt
      }
    }
  }
  return normalised
}

export const getDeviceRecord = async (
  env: Env,
  deviceHash: string
): Promise<DeviceRecord | null> => {
  const value = await env.LICENSING_KV.get(deviceHash, JSON_TYPE)
  if (!value) {
    return null
  }
  return normaliseDeviceRecord(value)
}

export const putDeviceRecord = async (
  env: Env,
  deviceHash: string,
  record: DeviceRecord
): Promise<void> => {
  await env.LICENSING_KV.put(deviceHash, JSON.stringify(record))
}

export const deleteDeviceRecord = async (env: Env, deviceHash: string): Promise<void> => {
  await env.LICENSING_KV.delete(deviceHash)
}

export type ListedDeviceKey = { key: string }

export const listDeviceKeys = async (
  env: Env,
  cursor?: string
): Promise<{ keys: string[]; cursor?: string; listComplete: boolean }> => {
  const result = await env.LICENSING_KV.list({ cursor })
  return {
    keys: result.keys.map((entry) => entry.name),
    cursor: result.list_complete ? undefined : result.cursor,
    listComplete: result.list_complete
  }
}

export const findDeviceByCustomerId = async (
  env: Env,
  customerId: string
): Promise<{ deviceHash: string; record: DeviceRecord } | null> => {
  let cursor: string | undefined
  do {
    const { keys, cursor: nextCursor } = await listDeviceKeys(env, cursor)
    for (const key of keys) {
      const record = await getDeviceRecord(env, key)
      if (record?.subscription?.customerId === customerId) {
        return { deviceHash: key, record }
      }
    }
    cursor = nextCursor
  } while (cursor)

  return null
}
