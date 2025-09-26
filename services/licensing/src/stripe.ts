import { Env } from "./env";
import { HttpError } from "./http";

interface StripeCheckoutSessionRequest {
  userId: string;
  email: string;
  priceId: string;
  successUrl?: string;
  cancelUrl?: string;
  customerId?: string;
  idempotencyKey?: string;
}

interface StripeCheckoutSessionResponse {
  url: string;
  id: string;
}

interface StripePortalSessionResponse {
  url: string;
}

interface StripeCustomerResponse {
  id: string;
}

function toHex(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function stripeRequest<T>(
  env: Env,
  path: string,
  method: string,
  body?: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
  };

  if (body && method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  const init: RequestInit = {
    method,
    headers,
  };

  if (body && method !== "GET") {
    init.body = body;
  }

  const response = await fetch(`https://api.stripe.com${path}`, init);

  const text = await response.text();
  const json = text ? (JSON.parse(text) as T & { error?: { message: string; type: string } }) : {};

  if (!response.ok) {
    const message = json && typeof json === "object" && "error" in json && json.error
      ? `${(json.error as { type: string; message: string }).type}: ${(json.error as { message: string }).message}`
      : `Stripe API request failed with status ${response.status}`;
    throw new HttpError(502, "stripe_error", message);
  }

  return json as T;
}

export async function createCheckoutSession(
  env: Env,
  payload: StripeCheckoutSessionRequest,
): Promise<StripeCheckoutSessionResponse> {
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("client_reference_id", payload.userId);
  params.set("line_items[0][price]", payload.priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("allow_promotion_codes", "true");
  params.set(
    "success_url",
    payload.successUrl ?? env.RETURN_URL_SUCCESS ??
      "https://atropos-video.com/app/settings/billing?status=success"
  );
  params.set(
    "cancel_url",
    payload.cancelUrl ?? env.RETURN_URL_CANCEL ??
      "https://atropos-video.com/app/settings/billing?status=cancelled"
  );
  params.set("subscription_data[metadata][user_id]", payload.userId);
  params.set("metadata[user_id]", payload.userId);
  params.set("metadata[price_id]", payload.priceId);
  params.set("subscription_data[metadata][price_id]", payload.priceId);

  if (payload.customerId) {
    params.set("customer", payload.customerId);
  } else {
    params.set("customer_email", payload.email);
  }

  const response = await stripeRequest<StripeCheckoutSessionResponse>(
    env,
    "/v1/checkout/sessions",
    "POST",
    params,
    payload.idempotencyKey,
  );
  return response;
}

export async function createBillingPortalSession(
  env: Env,
  customerId: string,
  returnUrl?: string,
  configurationId?: string,
  idempotencyKey?: string,
): Promise<StripePortalSessionResponse> {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  if (returnUrl ?? env.RETURN_URL_SUCCESS) {
    params.set("return_url", returnUrl ?? env.RETURN_URL_SUCCESS!);
  }

  if (configurationId) {
    params.set("configuration", configurationId);
  }

  return stripeRequest<StripePortalSessionResponse>(
    env,
    "/v1/billing_portal/sessions",
    "POST",
    params,
    idempotencyKey,
  );
}

export async function createCustomer(
  env: Env,
  userId: string,
  email: string,
  idempotencyKey?: string,
): Promise<StripeCustomerResponse> {
  const params = new URLSearchParams();
  params.set("email", email);
  params.set("metadata[user_id]", userId);

  return stripeRequest<StripeCustomerResponse>(
    env,
    "/v1/customers",
    "POST",
    params,
    idempotencyKey,
  );
}

export interface StripeSubscriptionSummary {
  id: string;
  status?: string | null;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean | null;
  metadata?: Record<string, string> | null;
}

interface StripeSubscriptionListResponse {
  data?: StripeSubscriptionSummary[];
}

export async function listCustomerSubscriptions(
  env: Env,
  customerId: string,
): Promise<StripeSubscriptionSummary[]> {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  params.set("status", "all");

  const response = await stripeRequest<StripeSubscriptionListResponse>(
    env,
    `/v1/subscriptions?${params.toString()}`,
    "GET",
  );

  return response.data ?? [];
}

export interface StripeWebhookVerificationResult {
  timestamp: number;
  signatures: string[];
}

export async function verifyStripeSignature(
  env: Env,
  payload: string,
  signatureHeader: string | null,
  toleranceSeconds = 300,
): Promise<StripeWebhookVerificationResult> {
  if (!signatureHeader) {
    throw new HttpError(400, "missing_signature", "Stripe signature header is required");
  }

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) {
      return acc;
    }
    acc[key] = acc[key] ? [...acc[key], value] : [value];
    return acc;
  }, {});

  const timestampRaw = parts["t"]?.[0];
  const signatures = parts["v1"] ?? [];

  if (!timestampRaw || signatures.length === 0) {
    throw new HttpError(400, "invalid_signature", "Stripe signature header is malformed");
  }

  const timestamp = Number(timestampRaw);
  if (Number.isNaN(timestamp)) {
    throw new HttpError(400, "invalid_signature", "Stripe signature timestamp is invalid");
  }

  const message = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(env.STRIPE_WEBHOOK_SECRET);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  const expected = toHex(digest);

  const matches = signatures.some((signature) => timingSafeEqual(signature, expected));
  if (!matches) {
    throw new HttpError(400, "invalid_signature", "Stripe signature does not match");
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    throw new HttpError(400, "signature_expired", "Stripe webhook signature is outside the tolerance window");
  }

  return { timestamp, signatures };
}

function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let result = 0;
  for (let i = 0; i < length; i += 1) {
    const charCodeA = i < a.length ? a.charCodeAt(i) : 0;
    const charCodeB = i < b.length ? b.charCodeAt(i) : 0;
    result |= charCodeA ^ charCodeB;
  }
  return result === 0 && a.length === b.length;
}
