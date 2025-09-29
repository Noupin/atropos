/*
 * Workers KV is eventually consistent across global points of presence (POPs).
 * Avoid issuing read-after-write operations that expect fresh data immediately
 * after a mutation, especially if the follow-up request may land in a different
 * POP. Prefer idempotent retries or delaying dependent reads when possible.
 */

// KV key format: user:<user_id>
const USER_KEY_PREFIX = "user:";

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

export const userKey = (userId: string): string => `${USER_KEY_PREFIX}${userId}`;

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

export const getUserRecord = async (
  kv: KVNamespace,
  userId: string,
): Promise<UserRecord | null> => {
  const record = await kv.get<UserRecord>(userKey(userId), { type: "json" });
  if (!record) {
    return null;
  }

  return {
    ...record,
    trial: normalizeTrialState(record.trial),
    transfer: record.transfer ?? null,
  };
};

export const putUserRecord = async (
  kv: KVNamespace,
  userId: string,
  record: UserRecord,
): Promise<void> => {
  const payload: UserRecord = {
    ...record,
    trial: normalizeTrialState(record.trial),
    transfer: record.transfer ?? null,
  };

  await kv.put(userKey(userId), JSON.stringify(payload), {
    metadata: {
      stripe_customer_id: record.stripe_customer_id ?? null,
    },
  });
};

export const findUserByStripeCustomerId = async (
  kv: KVNamespace,
  stripeCustomerId: string,
): Promise<{ userId: string; record: UserRecord } | null> => {
  let cursor: string | undefined;

  do {
    const result = await kv.list<{ stripe_customer_id?: string | null }>({
      prefix: USER_KEY_PREFIX,
      cursor,
    });

    for (const entry of result.keys) {
      if ((entry.metadata as { stripe_customer_id?: string | null } | undefined)?.stripe_customer_id === stripeCustomerId) {
        const userId = entry.name.replace(USER_KEY_PREFIX, "");
        const record = await getUserRecord(kv, userId);
        if (record) {
          return { userId, record };
        }
      }
    }

    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);

  return null;
};
