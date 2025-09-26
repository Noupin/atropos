import { Env } from "./env";

export interface TrialState {
  allowed: boolean;
  used: boolean;
  used_at: number | null;
  jti: string | null;
  exp: number | null;
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

export function createDefaultTrialState(): TrialState {
  return {
    allowed: true,
    used: false,
    used_at: null,
    jti: null,
    exp: null,
  };
}

function normalizeTrialState(candidate: Partial<TrialState> | undefined): TrialState {
  const defaults = createDefaultTrialState();
  return {
    allowed:
      typeof candidate?.allowed === "boolean" ? candidate.allowed : defaults.allowed,
    used: typeof candidate?.used === "boolean" ? candidate.used : defaults.used,
    used_at:
      typeof candidate?.used_at === "number" && Number.isFinite(candidate.used_at)
        ? candidate.used_at
        : defaults.used_at,
    jti: typeof candidate?.jti === "string" ? candidate.jti : defaults.jti,
    exp:
      typeof candidate?.exp === "number" && Number.isFinite(candidate.exp)
        ? candidate.exp
        : defaults.exp,
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
        const record = JSON.parse(raw) as UserRecord & {
          epoch?: number;
          trial?: Partial<TrialState>;
        };
        const normalized: UserRecord = {
          ...record,
          epoch: typeof record.epoch === "number" ? record.epoch : 0,
          trial: normalizeTrialState(record.trial),
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
