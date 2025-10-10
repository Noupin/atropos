import type { DeviceRecord, Env, StoredDeviceRecord, SubscriptionInfo } from '../types'

const JSON_TYPE: KVNamespaceGetOptions<'json'> = { type: 'json' }

export const DEFAULT_TRIAL_RUNS = 3

const normalizeSubscription = (value?: Partial<SubscriptionInfo> | null): SubscriptionInfo => ({
  customerId: value?.customerId ?? null,
  subscriptionId: value?.subscriptionId ?? null,
  status: (value?.status as SubscriptionInfo['status']) ?? null,
  currentPeriodEnd: value?.currentPeriodEnd ?? null,
  cancelAtPeriodEnd: value?.cancelAtPeriodEnd ?? false,
  priceId: value?.priceId ?? null,
  updatedAt: value?.updatedAt ?? null
})

export const getDeviceRecord = async (
  env: Env,
  deviceHash: string
): Promise<DeviceRecord | null> => {
  const value = await env.LICENSING_KV.get(deviceHash, JSON_TYPE)
  if (!value) {
    return null
  }
  const stored = value as StoredDeviceRecord
  return {
    trial: stored.trial,
    subscription: normalizeSubscription(stored.subscription ?? null),
    transfer: stored.transfer,
    updatedAt: stored.updatedAt
  }
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
