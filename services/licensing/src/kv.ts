import { Env } from "./env";
import { HttpError } from "./http";

export interface UserRecord {
  client_id: string;
  email: string;
  stripe_customer_id?: string;
  status: string;
  current_period_end?: number;
  plan_price_id?: string;
  device_hash?: string;
  key_version: number;
  cancel_at_period_end?: boolean;
  epoch: number;
  updated_at: number;
}

export interface TransferRequestRecord {
  otp_hash: string;
  new_device_hash: string;
  expires_at: number;
  attempts: number;
}

const RATE_LIMIT_MAX_ATTEMPTS = 10;

function userKey(userId: string): string {
  return `user:${userId}`;
}

function transferKey(userId: string): string {
  return `transfer:${userId}`;
}

function rateLimitKey(scope: string): string {
  return `rl:${scope}`;
}

export async function getUserRecord(env: Env, userId: string): Promise<UserRecord | null> {
  const raw = await env.USERS_KV.get(userKey(userId));
  return raw ? (JSON.parse(raw) as UserRecord) : null;
}

export type UserRecordUpdate = Partial<Omit<UserRecord, "updated_at">> & {
  updated_at?: number;
};

export async function putUserRecord(
  env: Env,
  userId: string,
  update: UserRecordUpdate,
): Promise<UserRecord> {
  const existing = await getUserRecord(env, userId);
  const now = Date.now();
  const normalizeEpochSeconds = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
    }

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        return undefined;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        return undefined;
      }
      return parsed > 1e12 ? Math.floor(parsed / 1000) : Math.floor(parsed);
    }

    return undefined;
  };

  const normalizedExistingCurrentPeriodEnd =
    normalizeEpochSeconds(existing?.current_period_end) ?? existing?.current_period_end;
  const normalizedCurrentPeriodEnd =
    normalizeEpochSeconds(update.current_period_end) ?? normalizedExistingCurrentPeriodEnd;

  const record: UserRecord = {
    client_id: update.client_id ?? existing?.client_id ?? userId,
    email: update.email ?? existing?.email ?? "",
    stripe_customer_id: update.stripe_customer_id ?? existing?.stripe_customer_id,
    status: update.status ?? existing?.status ?? "inactive",
    current_period_end: normalizedCurrentPeriodEnd,
    plan_price_id: update.plan_price_id ?? existing?.plan_price_id,
    device_hash: update.device_hash ?? existing?.device_hash,
    key_version: update.key_version ?? existing?.key_version ?? 1,
    cancel_at_period_end:
      update.cancel_at_period_end ?? existing?.cancel_at_period_end ?? false,
    epoch: update.epoch ?? existing?.epoch ?? 0,
    updated_at: update.updated_at ?? now,
  };

  await env.USERS_KV.put(userKey(userId), JSON.stringify(record));

  return record;
}

export async function saveTransferRequest(
  env: Env,
  userId: string,
  record: TransferRequestRecord,
  ttlSeconds: number,
): Promise<void> {
  await env.TRANSFERS_KV.put(transferKey(userId), JSON.stringify(record), {
    expirationTtl: Math.max(1, Math.ceil(ttlSeconds)),
  });
}

export async function getTransferRequest(
  env: Env,
  userId: string,
): Promise<TransferRequestRecord | null> {
  const raw = await env.TRANSFERS_KV.get(transferKey(userId));
  return raw ? (JSON.parse(raw) as TransferRequestRecord) : null;
}

export async function deleteTransferRequest(env: Env, userId: string): Promise<void> {
  await env.TRANSFERS_KV.delete(transferKey(userId));
}

interface RateLimitState {
  count: number;
  reset_at: number;
}

export async function assertRateLimit(
  env: Env,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  if (limit <= 0 || windowSeconds <= 0) {
    return;
  }

  const key = rateLimitKey(scope);
  const existingRaw = await env.TRANSFERS_KV.get(key);
  const now = Date.now();
  let state: RateLimitState;

  if (existingRaw) {
    try {
      state = JSON.parse(existingRaw) as RateLimitState;
    } catch {
      state = { count: 0, reset_at: now + windowSeconds * 1000 };
    }
  } else {
    state = { count: 0, reset_at: now + windowSeconds * 1000 };
  }

  if (state.reset_at <= now) {
    state = { count: 0, reset_at: now + windowSeconds * 1000 };
  }

  if (state.count >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.reset_at - now) / 1000));
    throw new HttpError(429, "rate_limited", "Too many requests", {
      retry_after: retryAfterSeconds,
    });
  }

  state.count += 1;
  const ttlSeconds = Math.max(1, Math.ceil((state.reset_at - now) / 1000));
  await env.TRANSFERS_KV.put(key, JSON.stringify(state), { expirationTtl: ttlSeconds });
}

export async function markTokenRevoked(env: Env, jti: string, ttlSeconds: number): Promise<void> {
  const key = `jti:${jti}`;
  await env.TRANSFERS_KV.put(key, "revoked", { expirationTtl: Math.max(ttlSeconds, 1) });
}

export async function isTokenRevoked(env: Env, jti: string): Promise<boolean> {
  const value = await env.TRANSFERS_KV.get(`jti:${jti}`);
  return value === "revoked";
}

export async function incrementFailedTransferAttempts(env: Env, userId: string): Promise<void> {
  const existing = (await getTransferRequest(env, userId)) ?? null;
  if (!existing) {
    return;
  }

  const attempts = existing.attempts + 1;
  if (attempts >= RATE_LIMIT_MAX_ATTEMPTS) {
    await deleteTransferRequest(env, userId);
    throw new HttpError(
      429,
      "transfer_attempts_exceeded",
      "Too many invalid transfer attempts",
    );
  }

  const ttlSeconds = Math.max(1, Math.ceil((existing.expires_at - Date.now()) / 1000));
  await saveTransferRequest(env, userId, { ...existing, attempts }, ttlSeconds);
}
