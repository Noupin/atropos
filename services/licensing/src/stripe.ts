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

interface StripeCustomerDetailResponse {
  id: string;
  metadata?: Record<string, string> | null;
  email?: string | null;
}

interface StripeSubscriptionListResponse {
  data: Array<{
    id: string;
    status: string;
    current_period_end?: number;
    cancel_at_period_end?: boolean;
    items?: { data?: Array<{ price?: { id?: string | null } | null }> } | null;
  }>;
}

interface StripeErrorPayload {
  error?: {
    type?: string;
    message?: string;
    code?: string;
  };
}

function toHex(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

interface StripeRequestOptions {
  method?: string;
  body?: URLSearchParams | null;
  idempotencyKey?: string;
  headers?: HeadersInit;
}

async function stripeRequest<T>(
  env: Env,
  path: string,
  options: StripeRequestOptions = {},
): Promise<T> {
  const method = options.method ?? (options.body ? "POST" : "GET");
  const headers: HeadersInit = {
    Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    ...options.headers,
  };

  if (method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }

  const response = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers,
    body: method === "GET" ? undefined : options.body,
  });

  const text = await response.text();
  let json: StripeErrorPayload | T = {} as T;
  if (text) {
    try {
      json = JSON.parse(text) as StripeErrorPayload | T;
    } catch (error) {
      console.error("Failed to parse Stripe response", error, text);
      throw new HttpError(502, "stripe_error", "Invalid response from Stripe");
    }
  }

  if (!response.ok) {
    const errorPayload = json as StripeErrorPayload;
    const stripeError = errorPayload?.error;
    const message = stripeError?.message ?? `Stripe API request failed with status ${response.status}`;
    throw new HttpError(502, "stripe_error", message, {
      status: response.status,
      type: stripeError?.type,
      code: stripeError?.code,
    });
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
  params.set("subscription_data[metadata][user_id]", payload.userId);
  params.set("metadata[user_id]", payload.userId);
  params.set("metadata[price_id]", payload.priceId);
  params.set("subscription_data[metadata][price_id]", payload.priceId);
  params.set("subscription_data[trial_settings][end_behavior][missing_payment_method]", "cancel");

  params.set(
    "success_url",
    payload.successUrl ??
      env.RETURN_URL_SUCCESS ??
      "https://atropos-video.com/app/settings/billing?status=success",
  );
  params.set(
    "cancel_url",
    payload.cancelUrl ??
      env.RETURN_URL_CANCEL ??
      "https://atropos-video.com/app/settings/billing?status=cancelled",
  );

  if (payload.customerId) {
    params.set("customer", payload.customerId);
  } else {
    params.set("customer_email", payload.email);
  }

  return stripeRequest<StripeCheckoutSessionResponse>(env, "/v1/checkout/sessions", {
    method: "POST",
    body: params,
    idempotencyKey: payload.idempotencyKey,
  });
}

export async function createBillingPortalSession(
  env: Env,
  customerId: string,
  returnUrl?: string,
  idempotencyKey?: string,
): Promise<StripePortalSessionResponse> {
  const params = new URLSearchParams();
  params.set("customer", customerId);
  if (returnUrl ?? env.RETURN_URL_SUCCESS) {
    params.set("return_url", returnUrl ?? env.RETURN_URL_SUCCESS!);
  }

  if (env.STRIPE_PORTAL_CONFIGURATION_ID) {
    params.set("configuration", env.STRIPE_PORTAL_CONFIGURATION_ID);
  }

  return stripeRequest<StripePortalSessionResponse>(env, "/v1/billing_portal/sessions", {
    method: "POST",
    body: params,
    idempotencyKey,
  });
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

  return stripeRequest<StripeCustomerResponse>(env, "/v1/customers", {
    method: "POST",
    body: params,
    idempotencyKey,
  });
}

export async function retrieveCustomer(
  env: Env,
  customerId: string,
): Promise<StripeCustomerDetailResponse> {
  return stripeRequest<StripeCustomerDetailResponse>(
    env,
    `/v1/customers/${encodeURIComponent(customerId)}`,
    { method: "GET" },
  );
}

export async function hasActiveStripeSubscription(
  env: Env,
  customerId: string,
): Promise<StripeSubscriptionListResponse["data"][number] | null> {
  const query = new URLSearchParams({
    customer: customerId,
    status: "all",
    limit: "3",
  });
  const response = await stripeRequest<StripeSubscriptionListResponse>(
    env,
    `/v1/subscriptions?${query.toString()}`,
    {
      method: "GET",
    },
  );

  const now = Math.floor(Date.now() / 1000);
  return (
    response.data.find((subscription) => {
      const status = subscription.status?.toLowerCase();
      if (!status) {
        return false;
      }
      if (status === "active" || status === "trialing") {
        return true;
      }
      if (status === "past_due" || status === "incomplete" || status === "incomplete_expired") {
        return subscription.current_period_end ? subscription.current_period_end > now : false;
      }
      return false;
    }) ?? null
  );
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
