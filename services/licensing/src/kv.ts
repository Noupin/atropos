import { Env } from "./env";

export interface TrialState {
  allowed: boolean;
  started: boolean;
  total: number;
  remaining: number;
  used_at: number | null;
  jti: string | null;
  exp: number | null;
  device_hash: string | null;
}

export interface UserRecord {
  email: string;
  stripe_customer_id: string;
  status: string;
  current_period_end?: number;
  plan_price_id?: string;
  cancel_at_period_end?: boolean;
  updated_at: number;
  epoch: number;
  device_hash?: string;
  trial: TrialState;
}

const DEFAULT_TRIAL_TOTAL = 3;

function normalizeRemaining(total: number, remaining: number | undefined): number {
  if (!Number.isFinite(total) || total <= 0) {
    return DEFAULT_TRIAL_TOTAL;
  }
  if (!Number.isFinite(remaining ?? NaN)) {
    return Math.max(0, Math.floor(total));
  }
  return Math.max(0, Math.min(Math.floor(total), Math.floor(remaining ?? 0)));
}

export function normalizeTrialState(trial?: Partial<TrialState> | null): TrialState {
  const totalRaw = trial?.total ?? DEFAULT_TRIAL_TOTAL;
  const total = Number.isFinite(totalRaw) && totalRaw > 0
    ? Math.floor(totalRaw)
    : DEFAULT_TRIAL_TOTAL;
  const remaining = normalizeRemaining(total, trial?.remaining);
  return {
    allowed: trial?.allowed ?? true,
    started: trial?.started ?? false,
    total,
    remaining: trial?.started ? remaining : total,
    used_at:
      typeof trial?.used_at === "number" && Number.isFinite(trial.used_at)
        ? trial.used_at
        : null,
    jti: typeof trial?.jti === "string" && trial.jti.trim().length > 0 ? trial.jti : null,
    exp:
      typeof trial?.exp === "number" && Number.isFinite(trial.exp)
        ? trial.exp
        : null,
    device_hash:
      typeof trial?.device_hash === "string" && trial.device_hash.trim().length > 0
        ? trial.device_hash.trim()
        : null,
  };
}

export async function getUserRecord(env: Env, userId: string): Promise<UserRecord | null> {
  const raw = await env.LICENSING_KV.get(`user:${userId}`);
  if (!raw) {
    return null;
  }

  const record = JSON.parse(raw) as UserRecord & { epoch?: number; trial?: Partial<TrialState> };
  return {
    ...record,
    epoch: typeof record.epoch === "number" ? record.epoch : 0,
    trial: normalizeTrialState(record.trial),
  };
}

export async function putUserRecord(env: Env, userId: string, record: UserRecord): Promise<void> {
  const normalized: UserRecord = {
    ...record,
    epoch: typeof record.epoch === "number" ? record.epoch : 0,
    trial: normalizeTrialState(record.trial),
  };
  await env.LICENSING_KV.put(`user:${userId}`, JSON.stringify(normalized));
}

interface KVListResult {
  keys: Array<{ name: string }>;
  list_complete: boolean;
  cursor?: string;
}

export async function findUserByStripeCustomerId(
  env: Env,
  customerId: string,
): Promise<{ userId: string; record: UserRecord } | null> {
  const prefix = "user:";
  let cursor: string | undefined;

  while (true) {
    const listResult = (await env.LICENSING_KV.list({
      prefix,
      cursor,
    })) as KVListResult;

    for (const key of listResult.keys) {
      const raw = await env.LICENSING_KV.get(key.name);
      if (!raw) {
        continue;
      }

      try {
        const record = JSON.parse(raw) as UserRecord & { epoch?: number };
        const normalized: UserRecord = {
          ...record,
          epoch: typeof record.epoch === "number" ? record.epoch : 0,
        };
        if (normalized.stripe_customer_id === customerId) {
          const userId = key.name.slice(prefix.length);
          return { userId, record: normalized };
        }
      } catch (error) {
        console.warn("Failed to parse user record", key.name, error);
      }
    }

    if (listResult.list_complete) {
      break;
    }

    cursor = listResult.cursor;
  }

  return null;
}

export async function markTokenRevoked(env: Env, jti: string, ttlSeconds: number): Promise<void> {
  await env.LICENSING_KV.put(`jti:${jti}`, "revoked", { expirationTtl: ttlSeconds });
}

export async function isTokenRevoked(env: Env, jti: string): Promise<boolean> {
  const value = await env.LICENSING_KV.get(`jti:${jti}`);
  return value === "revoked";
}
