/*
 * Workers KV is eventually consistent across global points of presence (POPs).
 * Avoid issuing read-after-write operations that expect fresh data immediately
 * after a mutation, especially if the follow-up request may land in a different
 * POP. Prefer idempotent retries or delaying dependent reads when possible.
 */

// KV key formats:
//   - device:<device_hash> (new canonical shape)
//   - user:<legacy_user_id> (legacy compatibility)
//   - legacy:<legacy_user_id> -> device hash mapping
const USER_KEY_PREFIX = "user:";
const DEVICE_KEY_PREFIX = "device:";
const LEGACY_MAPPING_PREFIX = "legacy:";

export const userKey = (userId: string): string => `${USER_KEY_PREFIX}${userId}`;
export const deviceKey = (deviceHash: string): string => `${DEVICE_KEY_PREFIX}${deviceHash}`;
export const legacyMappingKey = (userId: string): string => `${LEGACY_MAPPING_PREFIX}${userId}`;

export interface TrialState {
  allowed: number;
  started: number | null;
  total: number;
  remaining: number;
  used_at: number | null;
  device_hash: string | null;
  jti: string | null;
  exp: number | null;
}

export interface TransferState {
  pending: boolean;
  jti: string | null;
  exp: number | null;
  email: string | null;
  initiated_at: number | null;
}

export interface UserRecord {
  email: string | null;
  stripe_customer_id: string | null;
  status: string | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  plan_price_id: string | null;
  device_hash: string | null;
  epoch: number;
  updated_at: number;
  trial: TrialState | null;
  transfer: TransferState | null;
}

export interface KVKeyMetadata<T = unknown> {
  name: string;
  expiration?: number;
  metadata?: T;
}

export interface KVListResult<T = unknown> {
  keys: Array<KVKeyMetadata<T>>;
  list_complete: boolean;
  cursor?: string;
}

export interface KVNamespace {
  get<T = unknown>(key: string, options?: { type: "text" | "json" | "arrayBuffer" }): Promise<T | null>;
  put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
  list<T = unknown>(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult<T>>;
}

export const isEntitled = (
  status: string | null | undefined,
  currentPeriodEnd: number | null | undefined,
): boolean => {
  if (!status) {
    return false;
  }

  const normalizedStatus = status.toLowerCase();
  if (normalizedStatus !== "active" && normalizedStatus !== "trialing") {
    return false;
  }

  if (typeof currentPeriodEnd !== "number") {
    return false;
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  return currentPeriodEnd > nowInSeconds;
};

export const normalizeTrialState = (trial: Partial<TrialState> | null | undefined): TrialState | null => {
  if (!trial) {
    return null;
  }

  const allowed = Math.max(0, trial.allowed ?? 0);
  const total = Math.max(allowed, trial.total ?? allowed);
  const remainingCandidate = trial.remaining ?? trial.total ?? trial.allowed ?? allowed;
  const remaining = Math.max(0, Math.min(total, remainingCandidate));

  return {
    allowed,
    started: trial.started ?? null,
    total,
    remaining,
    used_at: trial.used_at ?? null,
    device_hash: trial.device_hash ?? null,
    jti: trial.jti ?? null,
    exp: trial.exp ?? null,
  };
};

const mergeTrialState = (
  existing: TrialState | null,
  updates: Partial<TrialState> | null | undefined,
  hasSubscriptionHistory: boolean,
): TrialState | null => {
  const current = normalizeTrialState(existing);
  const incoming = normalizeTrialState(updates ?? null);

  if (!current) {
    return hasSubscriptionHistory ? null : incoming;
  }

  if (!incoming) {
    return current;
  }

  const trialExhausted = hasSubscriptionHistory || current.remaining <= 0 || current.used_at !== null;

  const allowed = trialExhausted
    ? Math.min(current.allowed, incoming.allowed)
    : incoming.allowed;
  const total = Math.max(current.total, incoming.total, allowed);
  const remaining = trialExhausted
    ? Math.min(current.remaining, incoming.remaining)
    : Math.min(total, incoming.remaining);

  return {
    allowed,
    total,
    remaining: Math.max(0, remaining),
    started: current.started ?? incoming.started ?? null,
    used_at: current.used_at ?? incoming.used_at ?? null,
    device_hash: current.device_hash ?? incoming.device_hash ?? null,
    jti: incoming.jti ?? current.jti ?? null,
    exp: incoming.exp ?? current.exp ?? null,
  };
};

const mergeTransferState = (
  existing: TransferState | null,
  updates: Partial<TransferState> | null | undefined,
): TransferState | null => {
  if (!existing && !updates) {
    return null;
  }

  return {
    pending: updates?.pending ?? existing?.pending ?? false,
    jti: updates?.jti ?? existing?.jti ?? null,
    exp: updates?.exp ?? existing?.exp ?? null,
    email: updates?.email ?? existing?.email ?? null,
    initiated_at: updates?.initiated_at ?? existing?.initiated_at ?? null,
  };
};

export const mergeUserRecord = (existing: UserRecord, updates: Partial<UserRecord>): UserRecord => {
  const hasSubscriptionHistory = Boolean(
    existing.stripe_customer_id ||
      existing.status ||
      updates.stripe_customer_id ||
      updates.status,
  );
  const next: UserRecord = {
    ...existing,
    ...updates,
    epoch: updates.epoch ?? existing.epoch,
    updated_at: updates.updated_at ?? existing.updated_at,
    trial: mergeTrialState(existing.trial, updates.trial, hasSubscriptionHistory),
    transfer: mergeTransferState(existing.transfer, updates.transfer),
  };

  if (existing.stripe_customer_id && !updates.stripe_customer_id) {
    next.stripe_customer_id = existing.stripe_customer_id;
  }

  if (existing.status && !updates.status) {
    next.status = existing.status;
  }

  return next;
};

const normaliseRecord = (record: UserRecord): UserRecord => ({
  ...record,
  trial: normalizeTrialState(record.trial),
  transfer: record.transfer ?? null,
});

const readRecord = async (
  kv: KVNamespace,
  key: string,
): Promise<UserRecord | null> => {
  const record = await kv.get<UserRecord>(key, { type: "json" });
  if (!record) {
    return null;
  }
  return normaliseRecord(record);
};

const writeRecord = async (
  kv: KVNamespace,
  key: string,
  record: UserRecord,
): Promise<void> => {
  const payload = normaliseRecord(record);
  await kv.put(key, JSON.stringify(payload), {
    metadata: {
      stripe_customer_id: payload.stripe_customer_id ?? null,
    },
  });
};

const getLegacyMapping = async (kv: KVNamespace, userId: string): Promise<string | null> => {
  const value = await kv.get<string>(legacyMappingKey(userId), { type: "text" });
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const setLegacyMapping = async (
  kv: KVNamespace,
  userId: string,
  deviceHash: string | null,
): Promise<void> => {
  if (!deviceHash) {
    await kv.delete(legacyMappingKey(userId));
    return;
  }
  await kv.put(legacyMappingKey(userId), deviceHash.trim());
};

export const getDeviceRecord = async (
  kv: KVNamespace,
  deviceHash: string,
): Promise<UserRecord | null> => {
  if (!deviceHash) {
    return null;
  }
  return readRecord(kv, deviceKey(deviceHash));
};

export const putDeviceRecord = async (
  kv: KVNamespace,
  deviceHash: string,
  record: UserRecord,
): Promise<void> => {
  await writeRecord(kv, deviceKey(deviceHash), record);
};

const migrateLegacyRecord = async (
  kv: KVNamespace,
  userId: string,
  record: UserRecord,
): Promise<UserRecord> => {
  if (record.device_hash) {
    await putDeviceRecord(kv, record.device_hash, record);
    await setLegacyMapping(kv, userId, record.device_hash);
  }
  return record;
};

export const getLegacyUserRecord = async (
  kv: KVNamespace,
  userId: string,
): Promise<UserRecord | null> => {
  const record = await readRecord(kv, userKey(userId));
  if (!record) {
    return null;
  }
  await migrateLegacyRecord(kv, userId, record);
  return record;
};

export const resolveRecordByLegacyUserId = async (
  kv: KVNamespace,
  userId: string,
): Promise<{ deviceHash: string | null; record: UserRecord | null }> => {
  const mapped = await getLegacyMapping(kv, userId);
  if (mapped) {
    const deviceRecord = await getDeviceRecord(kv, mapped);
    if (deviceRecord) {
      return { deviceHash: mapped, record: deviceRecord };
    }
  }

  const legacyRecord = await getLegacyUserRecord(kv, userId);
  if (!legacyRecord) {
    return { deviceHash: null, record: null };
  }

  const deviceHash = legacyRecord.device_hash ?? mapped ?? null;
  return { deviceHash, record: legacyRecord };
};

export const getUserRecord = async (
  kv: KVNamespace,
  userId: string,
): Promise<UserRecord | null> => {
  const { record } = await resolveRecordByLegacyUserId(kv, userId);
  return record;
};

export const putUserRecord = async (
  kv: KVNamespace,
  userId: string,
  record: UserRecord,
): Promise<void> => {
  await writeRecord(kv, userKey(userId), record);
  if (record.device_hash) {
    await putDeviceRecord(kv, record.device_hash, record);
    await setLegacyMapping(kv, userId, record.device_hash);
  }
};

const findByStripeCustomerId = async (
  kv: KVNamespace,
  prefix: string,
  formatter: (name: string) => string,
  resolver: (identifier: string) => Promise<UserRecord | null>,
  stripeCustomerId: string,
): Promise<{ identifier: string; record: UserRecord } | null> => {
  let cursor: string | undefined;

  do {
    const result = await kv.list<{ stripe_customer_id?: string | null }>({
      prefix,
      cursor,
    });

    for (const entry of result.keys) {
      if ((entry.metadata as { stripe_customer_id?: string | null } | undefined)?.stripe_customer_id === stripeCustomerId) {
        const identifier = formatter(entry.name);
        const record = await resolver(identifier);
        if (record) {
          return { identifier, record };
        }
      }
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return null;
};

export const findDeviceByStripeCustomerId = async (
  kv: KVNamespace,
  stripeCustomerId: string,
): Promise<{ deviceHash: string; record: UserRecord } | null> => {
  const deviceResult = await findByStripeCustomerId(
    kv,
    DEVICE_KEY_PREFIX,
    (name) => name.replace(DEVICE_KEY_PREFIX, ""),
    (deviceHash) => getDeviceRecord(kv, deviceHash),
    stripeCustomerId,
  );

  if (deviceResult) {
    return { deviceHash: deviceResult.identifier, record: deviceResult.record };
  }

  const legacyResult = await findByStripeCustomerId(
    kv,
    USER_KEY_PREFIX,
    (name) => name.replace(USER_KEY_PREFIX, ""),
    async (userId) => {
      const { deviceHash, record } = await resolveRecordByLegacyUserId(kv, userId);
      if (record && deviceHash) {
        return record;
      }
      return record;
    },
    stripeCustomerId,
  );

  if (!legacyResult) {
    return null;
  }

  const { identifier, record } = legacyResult;
  const mapping = await getLegacyMapping(kv, identifier);
  if (mapping) {
    return { deviceHash: mapping, record };
  }
  return record?.device_hash
    ? { deviceHash: record.device_hash, record }
    : null;
};

export const linkLegacyUserId = async (
  kv: KVNamespace,
  userId: string,
  deviceHash: string | null,
): Promise<void> => {
  await setLegacyMapping(kv, userId, deviceHash);
};
