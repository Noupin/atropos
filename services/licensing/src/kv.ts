import { Env } from "./env";

export interface UserRecord {
  email: string;
  stripe_customer_id: string;
  status: string;
  current_period_end?: number;
  plan_price_id?: string;
  cancel_at_period_end?: boolean;
  updated_at: number;
}

export async function getUserRecord(env: Env, userId: string): Promise<UserRecord | null> {
  const raw = await env.LICENSING_KV.get(`user:${userId}`);
  return raw ? (JSON.parse(raw) as UserRecord) : null;
}

export async function putUserRecord(env: Env, userId: string, record: UserRecord): Promise<void> {
  await env.LICENSING_KV.put(`user:${userId}`, JSON.stringify(record));
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
        const record = JSON.parse(raw) as UserRecord;
        if (record.stripe_customer_id === customerId) {
          const userId = key.name.slice(prefix.length);
          return { userId, record };
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
