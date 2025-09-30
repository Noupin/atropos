import {
  findDeviceByStripeCustomerId,
  getDeviceRecord,
  linkLegacyUserId,
  mergeUserRecord,
  putDeviceRecord,
  resolveRecordByLegacyUserId,
  type KVNamespace,
  type UserRecord,
} from "../kv";

export interface UserRecordMutationContext {
  current: UserRecord;
  now: number;
  eventTimestamp?: number;
}

export type UserRecordMutation = (
  context: UserRecordMutationContext,
) => Partial<UserRecord> | null | undefined | Promise<Partial<UserRecord> | null | undefined>;

const createDefaultUserRecord = (timestamp: number): UserRecord => {
  return {
    email: null,
    stripe_customer_id: null,
    status: null,
    current_period_end: null,
    cancel_at_period_end: false,
    plan_price_id: null,
    device_hash: null,
    epoch: 0,
    updated_at: timestamp,
    trial: null,
    transfer: null,
  };
};

const hasMeaningfulChanges = (before: UserRecord, after: UserRecord): boolean => {
  return (
    before.email !== after.email ||
    before.stripe_customer_id !== after.stripe_customer_id ||
    before.status !== after.status ||
    before.current_period_end !== after.current_period_end ||
    before.cancel_at_period_end !== after.cancel_at_period_end ||
    before.plan_price_id !== after.plan_price_id ||
    before.device_hash !== after.device_hash ||
    before.epoch !== after.epoch ||
    before.updated_at !== after.updated_at ||
    JSON.stringify(before.trial) !== JSON.stringify(after.trial) ||
    JSON.stringify(before.transfer) !== JSON.stringify(after.transfer)
  );
};

const resolveUpdatedAt = (
  existing: UserRecord,
  updates: Partial<UserRecord>,
  now: number,
  eventTimestamp?: number,
): number => {
  const candidates: number[] = [now];

  if (typeof existing.updated_at === "number") {
    candidates.push(existing.updated_at);
  }

  if (typeof updates.updated_at === "number") {
    candidates.push(updates.updated_at);
  }

  if (typeof eventTimestamp === "number") {
    candidates.push(eventTimestamp);
  }

  return Math.max(...candidates);
};

const normalizeEpoch = (existing: UserRecord, updates: Partial<UserRecord>): number => {
  if (typeof updates.epoch === "number") {
    return Math.max(updates.epoch, existing.epoch ?? 0);
  }

  return existing.epoch ?? 0;
};

export const mutateDeviceRecord = async (
  kv: KVNamespace,
  deviceHash: string,
  mutation: UserRecordMutation,
  options: { eventTimestamp?: number; legacyUserId?: string } = {},
): Promise<UserRecord> => {
  const now = Math.floor(Date.now() / 1000);
  const eventTimestamp = options.eventTimestamp;

  let existing = await getDeviceRecord(kv, deviceHash);

  if (!existing && options.legacyUserId) {
    const legacy = await resolveRecordByLegacyUserId(kv, options.legacyUserId);
    if (legacy.record) {
      existing = {
        ...legacy.record,
        device_hash: legacy.record.device_hash ?? deviceHash,
      };
    }
  }

  if (!existing) {
    existing = { ...createDefaultUserRecord(now), device_hash: deviceHash };
  } else if (!existing.device_hash) {
    existing = { ...existing, device_hash: deviceHash };
  }

  const updates = await mutation({ current: existing, now, eventTimestamp });

  if (!updates) {
    if (options.legacyUserId) {
      await linkLegacyUserId(kv, options.legacyUserId, deviceHash);
    }
    return existing;
  }

  const normalizedUpdates: Partial<UserRecord> = {
    ...updates,
    device_hash: deviceHash,
    epoch: normalizeEpoch(existing, updates),
    updated_at: resolveUpdatedAt(existing, updates, now, eventTimestamp),
  };

  const merged = mergeUserRecord(existing, normalizedUpdates);

  if (!hasMeaningfulChanges(existing, merged)) {
    if (options.legacyUserId) {
      await linkLegacyUserId(kv, options.legacyUserId, deviceHash);
    }
    return existing;
  }

  await putDeviceRecord(kv, deviceHash, merged);
  if (options.legacyUserId) {
    await linkLegacyUserId(kv, options.legacyUserId, deviceHash);
  }

  return merged;
};

export const findDeviceHashByStripeCustomerId = findDeviceByStripeCustomerId;
