import type Stripe from "stripe";

export interface BillingEnv extends Record<string, unknown> {
  STRIPE_SECRET_KEY?: string;
  PRICE_ID_MONTHLY?: string;
}

export interface CheckoutRequestBody {
  user_id: string;
  email?: string;
  price_id?: string;
  success_url?: string;
  cancel_url?: string;
}

export interface PortalRequestBody {
  user_id: string;
  return_url?: string;
}

export interface BillingUrlResponse {
  url: string;
}

const BILLABLE_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

export const isBillableStatus = (status: string | null | undefined): boolean => {
  if (!status) {
    return false;
  }

  return BILLABLE_SUBSCRIPTION_STATUSES.has(status);
};

export const buildCustomerQuery = (userId: string): string => {
  const escaped = userId.replace(/['\\]/g, "\\$&");
  return `metadata['user_id']:'${escaped}'`;
};

export const ensureUrl = (value: string | undefined | null, field: string): string => {
  if (!value || typeof value !== "string") {
    throw new Error(`${field} is required`);
  }

  try {
    return new URL(value).toString();
  } catch (error) {
    throw new Error(`${field} must be a valid URL`);
  }
};

export const ensureUserId = (value: unknown): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("user_id is required");
  }

  return value.trim();
};

export const ensurePriceId = (value: string | undefined | null, fallback?: string): string => {
  const candidate = value ?? fallback;
  if (!candidate || typeof candidate !== "string") {
    throw new Error("price_id is required");
  }

  return candidate;
};

export const normalizeEmail = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
};

export const computeIdempotencyKey = async (
  prefix: string,
  parts: Array<string | undefined>,
): Promise<string> => {
  const encoder = new TextEncoder();
  const digestInput = encoder.encode(parts.filter(Boolean).join("|"));
  const hashBuffer = await crypto.subtle.digest("SHA-256", digestInput);
  const hex = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${prefix}_${hex.slice(0, 48)}`;
};

export type StripeClient = Stripe;
