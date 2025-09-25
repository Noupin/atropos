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

export interface SubscriptionRecord {
  user_id: string;
  status: string;
  current_period_end?: number;
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

export async function getSubscriptionRecord(
  env: Env,
  customerId: string,
): Promise<SubscriptionRecord | null> {
  const raw = await env.LICENSING_KV.get(`sub:${customerId}`);
  return raw ? (JSON.parse(raw) as SubscriptionRecord) : null;
}

export async function putSubscriptionRecord(
  env: Env,
  customerId: string,
  record: SubscriptionRecord,
): Promise<void> {
  await env.LICENSING_KV.put(`sub:${customerId}`, JSON.stringify(record));
}

export async function markTokenRevoked(env: Env, jti: string, ttlSeconds: number): Promise<void> {
  await env.LICENSING_KV.put(`jti:${jti}`, "revoked", { expirationTtl: ttlSeconds });
}

export async function isTokenRevoked(env: Env, jti: string): Promise<boolean> {
  const value = await env.LICENSING_KV.get(`jti:${jti}`);
  return value === "revoked";
}
