import { Env, RequestContext } from "./env";
import {
  baseCorsHeaders,
  corsPreflightResponse,
  errorResponse,
  HttpError,
  jsonResponse,
} from "./http";
import {
  createBillingPortalSession,
  createCheckoutSession,
  createCustomer,
  hasActiveStripeSubscription,
  verifyStripeSignature,
} from "./stripe";
import {
  assertRateLimit,
  deleteTransferRequest,
  getTransferRequest,
  getUserIdByCustomerId,
  getUserRecord,
  incrementFailedTransferAttempts,
  putUserRecord,
  saveTransferRequest,
  setUserIdForCustomer,
} from "./kv";
import { derivePublicKey, getJwks, issueLicenseToken, verifyLicenseToken } from "./jwt";

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

interface StripeSubscription {
  id: string;
  customer: string;
  status?: string;
  metadata?: Record<string, string>;
  current_period_end?: number;
  cancel_at_period_end?: boolean;
  items?: { data?: Array<{ price?: { id?: string } }> };
  customer_email?: string | null;
}

interface CheckoutRequestBody {
  user_id: string;
  email: string;
  price_id?: string;
  success_url?: string;
  cancel_url?: string;
}

interface LicenseIssueBody {
  user_id: string;
  device_hash: string;
}

interface BillingPortalRequestBody {
  user_id?: string;
  return_url?: string;
}

interface LicenseTransferRequestBody {
  user_id: string;
  new_device_hash: string;
}

interface LicenseTransferConfirmBody {
  user_id: string;
  otp: string;
}

const LIFECYCLE_STATUSES = new Set([
  "inactive",
  "active",
  "trialing",
  "grace_period",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
]);

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 10 * 60;
const RATE_LIMIT_ISSUE_LIMIT = 10;
const RATE_LIMIT_ISSUE_WINDOW_SECONDS = 60;
const RATE_LIMIT_TRANSFER_REQUEST_LIMIT = 3;
const RATE_LIMIT_TRANSFER_REQUEST_WINDOW_SECONDS = 10 * 60;
const RATE_LIMIT_TRANSFER_CONFIRM_LIMIT = 10;
const RATE_LIMIT_TRANSFER_CONFIRM_WINDOW_SECONDS = 10 * 60;

function getAllowedOrigins(env: Env): string[] {
  const origins = (env.CORS_ALLOW_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (origins.length === 0) {
    return ["*"];
  }

  return origins;
}

function normalizeStatus(status: string | null | undefined): string {
  return status ? status.toLowerCase() : "unknown";
}

function toLifecycleStatus(status: string | null | undefined): string {
  const normalized = normalizeStatus(status);
  if (LIFECYCLE_STATUSES.has(normalized)) {
    return normalized;
  }
  return "inactive";
}

function normalizeEpochSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed > 1e12 ? Math.floor(parsed / 1000) : Math.floor(parsed);
  }

  return null;
}

function toIsoTimestamp(value?: number | string | null): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const seconds = normalizeEpochSeconds(value);
  if (seconds === null) {
    return null;
  }
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function isEntitled(status: string, currentPeriodEnd?: number | string | null): boolean {
  const normalized = normalizeStatus(status);
  if (normalized !== "active" && normalized !== "trialing") {
    return false;
  }
  const seconds = normalizeEpochSeconds(currentPeriodEnd);
  if (seconds === null) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return seconds > now;
}

function extractStripeId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (value && typeof value === "object" && "id" in value) {
    const candidate = (value as { id?: unknown }).id;
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }

  return null;
}

function sanitizeDeviceHash(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  const value = array[0] % 10 ** OTP_LENGTH;
  return value.toString().padStart(OTP_LENGTH, "0");
}

async function hashOtp(otp: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(otp));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureActiveSubscriptionSnapshot(
  env: Env,
  userId: string,
  userRecord: Awaited<ReturnType<typeof getUserRecord>>,
  stripeCustomerId: string,
  context: RequestContext,
): Promise<boolean> {
  if (!stripeCustomerId) {
    return false;
  }

  if (userRecord && isEntitled(userRecord.status, userRecord.current_period_end)) {
    return true;
  }

  try {
    const active = await hasActiveStripeSubscription(env, stripeCustomerId);
    if (!active) {
      return false;
    }

    const status = active.status ?? "active";
    const planPriceId = active.items?.data?.[0]?.price?.id ?? undefined;
    const existingPeriodEndSeconds = normalizeEpochSeconds(
      userRecord?.current_period_end,
    );
    const currentPeriodEnd =
      normalizeEpochSeconds(active.current_period_end) ??
      existingPeriodEndSeconds ??
      undefined;
    const cancelAtPeriodEnd = Boolean(active.cancel_at_period_end);
    const updatedAt = Date.now();

    const nextRecord = await putUserRecord(env, userId, {
      client_id: userId,
      stripe_customer_id: stripeCustomerId,
      status,
      current_period_end: currentPeriodEnd,
      plan_price_id: planPriceId ?? userRecord?.plan_price_id,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: updatedAt,
    });
    await setUserIdForCustomer(env, stripeCustomerId, userId);
    return isEntitled(nextRecord.status, nextRecord.current_period_end);
  } catch (error) {
    console.error(
      `[${context.requestId}] Failed to refresh subscription status for ${userId}`,
      error,
    );
    return false;
  }
}

async function sendTransferOtpEmail(
  env: Env,
  email: string,
  otp: string,
  context: RequestContext,
): Promise<void> {
  if (!env.EMAIL_SERVICE_URL || !env.EMAIL_SERVICE_API_KEY) {
    throw new HttpError(
      500,
      "email_not_configured",
      "Email service is not configured",
    );
  }

  const subject = "Device transfer verification code";
  const from = env.EMAIL_FROM ?? "support@atropos-video.com";
  const body =
    `Your Atropos device transfer code is ${otp}.\n` +
    "This code expires in 10 minutes. If you did not request this transfer, please contact support.";

  const response = await fetch(env.EMAIL_SERVICE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.EMAIL_SERVICE_API_KEY}`,
    },
    body: JSON.stringify({
      to: email,
      from,
      subject,
      text: body,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `[${context.requestId}] Failed to dispatch transfer OTP email`,
      response.status,
      errorText,
    );
    throw new HttpError(
      502,
      "email_delivery_failed",
      "Failed to dispatch transfer verification email",
    );
  }
}

async function handleCheckout(
  env: Env,
  request: Request,
  corsHeaders: HeadersInit,
  context: RequestContext
): Promise<Response> {
  const body = await request.json().catch(() => {
    throw new HttpError(400, "invalid_request", "Body must be valid JSON");
  });

  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, "invalid_request", "Body must be an object");
  }

  const {
    user_id: userId,
    email,
    price_id: priceId,
    success_url: successUrl,
    cancel_url: cancelUrl,
  } = body as CheckoutRequestBody;
  if (!userId || !email) {
    throw new HttpError(
      400,
      "invalid_request",
      "user_id and email are required"
    );
  }

  const price = priceId ?? env.PRICE_ID_MONTHLY;
  if (!price) {
    throw new HttpError(
      500,
      "missing_price",
      "PRICE_ID_MONTHLY is not configured"
    );
  }

  const idempotencyRoot =
    request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
  const customerIdempotencyKey = `${idempotencyRoot}:customer`;
  const checkoutIdempotencyKey = `${idempotencyRoot}:checkout`;

  let userRecord = await getUserRecord(env, userId);
  let stripeCustomerId = userRecord?.stripe_customer_id;
  if (!stripeCustomerId) {
    const customer = await createCustomer(
      env,
      userId,
      email,
      customerIdempotencyKey,
    );
    stripeCustomerId = customer.id;
  }

  if (!stripeCustomerId) {
    throw new HttpError(
      500,
      "stripe_customer_unavailable",
      "Failed to determine Stripe customer ID",
    );
  }

  if (!userRecord || userRecord.stripe_customer_id !== stripeCustomerId || userRecord.email !== email) {
    userRecord = await putUserRecord(env, userId, {
      client_id: userId,
      email,
      stripe_customer_id: stripeCustomerId,
      plan_price_id: userRecord?.plan_price_id ?? price,
    });
  }

  await setUserIdForCustomer(env, stripeCustomerId, userId);

  const hasSubscription = await ensureActiveSubscriptionSnapshot(
    env,
    userId,
    userRecord,
    stripeCustomerId,
    context,
  );

  if (hasSubscription) {
    try {
      const portal = await createBillingPortalSession(
        env,
        stripeCustomerId,
        successUrl,
        `${checkoutIdempotencyKey}:portal`,
      );
      console.log(
        `[${context.requestId}] Returning portal session for existing subscription ${userId}`,
      );
      return jsonResponse({ url: portal.url, alreadySubscribed: true }, 200, corsHeaders);
    } catch (error) {
      if (error instanceof HttpError && error.code === "stripe_error") {
        throw new HttpError(
          502,
          "portal_unavailable",
          "Stripe Billing Portal is not configured. Configure a Billing Portal session in your Stripe dashboard.",
        );
      }
      throw error;
    }
  }

  const session = await createCheckoutSession(env, {
    userId,
    email,
    priceId: price,
    successUrl,
    cancelUrl,
    customerId: stripeCustomerId,
    idempotencyKey: checkoutIdempotencyKey,
  });

  userRecord = await putUserRecord(env, userId, {
    client_id: userId,
    email,
    stripe_customer_id: stripeCustomerId,
    status: userRecord?.status ?? "pending",
    current_period_end: userRecord?.current_period_end,
    plan_price_id: price,
  });

  console.log(
    `[${context.requestId}] Created checkout session ${session.id} for ${userId}`
  );

  return jsonResponse({ url: session.url }, 200, corsHeaders);
}

async function resolvePortalRequest(
  request: Request,
  url: URL
): Promise<{ userId: string; returnUrl?: string | null }> {
  let userId = url.searchParams.get("user_id");
  let returnUrl = url.searchParams.get("return_url");

  if (request.method === "POST") {
    const body = await request.json().catch(() => {
      throw new HttpError(400, "invalid_request", "Body must be valid JSON");
    });

    if (typeof body !== "object" || body === null) {
      throw new HttpError(400, "invalid_request", "Body must be an object");
    }

    const { user_id: bodyUserId, return_url: bodyReturnUrl } =
      body as BillingPortalRequestBody;
    if (bodyUserId) {
      userId = bodyUserId;
    }
    if (bodyReturnUrl) {
      returnUrl = bodyReturnUrl;
    }
  }

  if (!userId) {
    throw new HttpError(400, "invalid_request", "user_id is required");
  }

  return { userId, returnUrl };
}

async function handlePortal(
  env: Env,
  url: URL,
  corsHeaders: HeadersInit,
  context: RequestContext,
  request: Request
): Promise<Response> {
  const { userId, returnUrl } = await resolvePortalRequest(request, url);

  const userRecord = await getUserRecord(env, userId);
  if (!userRecord || !userRecord.stripe_customer_id) {
    throw new HttpError(
      404,
      "user_not_found",
      "User is not registered with Stripe"
    );
  }

  const idempotencyKey =
    request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
  try {
    const portal = await createBillingPortalSession(
      env,
      userRecord.stripe_customer_id,
      returnUrl ?? env.RETURN_URL_SUCCESS,
      `${idempotencyKey}:portal`,
    );
    console.log(`[${context.requestId}] Generated portal session for ${userId}`);
    return jsonResponse({ url: portal.url }, 200, corsHeaders);
  } catch (error) {
    if (error instanceof HttpError && error.code === "stripe_error") {
      throw new HttpError(
        502,
        "portal_unavailable",
        "Stripe Billing Portal is not configured. Configure a Billing Portal session in your Stripe dashboard.",
      );
    }
    throw error;
  }
}

async function handleSubscription(
  env: Env,
  url: URL,
  corsHeaders: HeadersInit
): Promise<Response> {
  const userId = url.searchParams.get("user_id");
  if (!userId) {
    throw new HttpError(400, "invalid_request", "user_id is required");
  }

  const record = await getUserRecord(env, userId);
  if (!record) {
    return jsonResponse(
      {
        status: "inactive",
        planPriceId: null,
        current_period_end: null,
        currentPeriodEndIso: null,
        entitled: false,
        cancel_at_period_end: false,
        stripeCustomerId: null,
        deviceHash: null,
        keyVersion: null,
        epoch: 0,
      },
      200,
      corsHeaders
    );
  }

  const currentPeriodEnd = normalizeEpochSeconds(record.current_period_end);

  return jsonResponse(
    {
      status: toLifecycleStatus(record.status),
      planPriceId: record.plan_price_id ?? null,
      current_period_end: currentPeriodEnd ?? null,
      currentPeriodEndIso: toIsoTimestamp(currentPeriodEnd),
      entitled: isEntitled(record.status, currentPeriodEnd),
      cancel_at_period_end: Boolean(record.cancel_at_period_end),
      stripeCustomerId: record.stripe_customer_id ?? null,
      deviceHash: record.device_hash ?? null,
      keyVersion: record.key_version,
      epoch: record.epoch ?? 0,
    },
    200,
    corsHeaders
  );
}

async function handleWebhook(
  env: Env,
  request: Request,
  context: RequestContext
): Promise<Response> {
  const rawBody = await request.text();
  await verifyStripeSignature(
    env,
    rawBody,
    request.headers.get("stripe-signature")
  );
  const event = JSON.parse(rawBody) as StripeEvent;

  const eventType = event.type;
  const object = event.data?.object as Record<string, unknown>;

  try {
    switch (eventType) {
      case "checkout.session.completed": {
        const customerId = extractStripeId(object.customer);
        const userId =
          (object.metadata as Record<string, string> | undefined)?.user_id ??
          (object.client_reference_id as string | undefined);
        const email =
          (object.customer_details as { email?: string } | undefined)?.email ??
          (object.customer_email as string | undefined) ??
          "";
        const subscriptionId = object.subscription as string | undefined;
        if (customerId && userId) {
          const existing = await getUserRecord(env, userId);
          const paymentStatus = (
            object.payment_status as string | undefined
          )?.toLowerCase();
          const sessionStatus = (
            object.status as string | undefined
          )?.toLowerCase();
          const status =
            paymentStatus === "paid" || sessionStatus === "complete"
              ? "active"
              : existing?.status ?? "pending";
          const planPriceId =
            (object.metadata as Record<string, string> | undefined)?.price_id ??
            existing?.plan_price_id ??
            env.PRICE_ID_MONTHLY;
          const cancelAtPeriodEnd = existing?.cancel_at_period_end ?? false;
          const updatedAt = Date.now();

          await putUserRecord(env, userId, {
            client_id: userId,
            email,
            stripe_customer_id: customerId,
            status,
            current_period_end: existing?.current_period_end,
            plan_price_id: planPriceId,
            cancel_at_period_end: cancelAtPeriodEnd,
            updated_at: updatedAt,
          });
          await setUserIdForCustomer(env, customerId, userId);
          console.log(
            `[${context.requestId}] Checkout complete for ${userId} (${customerId}) subscription=${subscriptionId}`
          );
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = object as unknown as StripeSubscription;
        const customerId = extractStripeId(subscription.customer);
        const userId =
          subscription.metadata?.user_id ??
          (customerId ? await getUserIdByCustomerId(env, customerId) : null);
        if (!customerId || !userId) {
          console.warn(
            `[${context.requestId}] Subscription event missing user_id`
          );
          break;
        }
        const existingUser = await getUserRecord(env, userId);
        const status = subscription.status ?? "unknown";
        const planPriceId =
          subscription.items?.data?.[0]?.price?.id ??
          existingUser?.plan_price_id ??
          env.PRICE_ID_MONTHLY;
        const normalizedExistingPeriodEnd = normalizeEpochSeconds(
          existingUser?.current_period_end,
        );
        const currentPeriodEnd =
          normalizeEpochSeconds(subscription.current_period_end) ??
          normalizedExistingPeriodEnd ??
          undefined;
        const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
        const updatedAt = Date.now();
        await setUserIdForCustomer(env, customerId, userId);
        await putUserRecord(env, userId, {
          client_id: userId,
          email: subscription.customer_email ?? existingUser?.email ?? "",
          stripe_customer_id: customerId,
          status,
          current_period_end: currentPeriodEnd,
          plan_price_id: planPriceId ?? undefined,
          cancel_at_period_end: cancelAtPeriodEnd,
          updated_at: updatedAt,
        });
        console.log(
          `[${context.requestId}] Subscription ${subscription.id} -> ${status}`
        );
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = object as unknown as StripeSubscription;
        const customerId = extractStripeId(subscription.customer);
        const userId =
          subscription.metadata?.user_id ??
          (customerId ? await getUserIdByCustomerId(env, customerId) : null);
        if (!customerId || !userId) {
          console.warn(
            `[${context.requestId}] Subscription deleted event missing user_id`
          );
          break;
        }
        const existingUser = await getUserRecord(env, userId);
        const planPriceId =
          existingUser?.plan_price_id ??
          subscription.items?.data?.[0]?.price?.id ??
          env.PRICE_ID_MONTHLY;
        const updatedAt = Date.now();
        const nowSeconds = Math.floor(updatedAt / 1000);
        const nextEpoch = (existingUser?.epoch ?? 0) + 1;
        await setUserIdForCustomer(env, customerId, userId);
        await putUserRecord(env, userId, {
          client_id: userId,
          email: existingUser?.email ?? subscription.customer_email ?? "",
          stripe_customer_id: customerId,
          status: "canceled",
          current_period_end: nowSeconds,
          plan_price_id: planPriceId ?? undefined,
          cancel_at_period_end: false,
          epoch: nextEpoch,
          updated_at: updatedAt,
        });
        console.log(
          `[${context.requestId}] Subscription ${subscription.id} canceled for ${userId}`
        );
        break;
      }
      default:
        // Ignore other events to remain fast
        break;
    }
  } catch (error) {
    console.error(
      `[${context.requestId}] Failed to process event ${eventType}`,
      error
    );
    throw new HttpError(
      500,
      "webhook_processing_failed",
      "Failed to handle webhook event"
    );
  }

  return new Response(null, { status: 200 });
}

async function handleIssue(
  env: Env,
  request: Request,
  corsHeaders: HeadersInit
): Promise<Response> {
  const body = await request.json().catch(() => {
    throw new HttpError(400, "invalid_request", "Body must be valid JSON");
  });

  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, "invalid_request", "Body must be an object");
  }

  const { user_id: userId, device_hash: deviceHash } = body as LicenseIssueBody;
  if (!userId) {
    throw new HttpError(400, "invalid_request", "user_id is required");
  }

  await assertRateLimit(
    env,
    `issue:${userId}`,
    RATE_LIMIT_ISSUE_LIMIT,
    RATE_LIMIT_ISSUE_WINDOW_SECONDS,
  );

  const sanitizedDeviceHash = sanitizeDeviceHash(deviceHash);
  if (!sanitizedDeviceHash) {
    throw new HttpError(400, "invalid_request", "device_hash is required");
  }

  const userRecord = await getUserRecord(env, userId);
  if (!userRecord) {
    throw new HttpError(
      404,
      "user_not_found",
      "User has no active subscription"
    );
  }

  if (!userRecord.stripe_customer_id) {
    throw new HttpError(
      409,
      "stripe_customer_missing",
      "Stripe customer is not linked to this user",
    );
  }

  if (!isEntitled(userRecord.status, userRecord.current_period_end)) {
    throw new HttpError(
      403,
      "subscription_inactive",
      "Subscription is not active"
    );
  }

  let updatedRecord = userRecord;
  if (!userRecord.device_hash) {
    updatedRecord = await putUserRecord(env, userId, {
      client_id: userId,
      device_hash: sanitizedDeviceHash,
    });
  } else if (userRecord.device_hash !== sanitizedDeviceHash) {
    throw new HttpError(403, "device_mismatch", "Device is not authorized");
  }

  const tier = env.TIER ?? "pro";
  const token = await issueLicenseToken(env, {
    userId: updatedRecord.client_id ?? userId,
    email: updatedRecord.email,
    tier,
    customerId: updatedRecord.stripe_customer_id,
    keyVersion: updatedRecord.key_version ?? 1,
    deviceHash: sanitizedDeviceHash,
    epoch: updatedRecord.epoch ?? 0,
    lifetimeSeconds: 600,
  });

  return jsonResponse({ token: token.token, exp: token.exp, kid: token.kid }, 200, corsHeaders);
}

async function handleTransferRequest(
  env: Env,
  request: Request,
  corsHeaders: HeadersInit,
  context: RequestContext,
): Promise<Response> {
  const body = await request.json().catch(() => {
    throw new HttpError(400, "invalid_request", "Body must be valid JSON");
  });

  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, "invalid_request", "Body must be an object");
  }

  const { user_id: userId, new_device_hash: newDeviceHashRaw } =
    body as LicenseTransferRequestBody;
  if (!userId) {
    throw new HttpError(400, "invalid_request", "user_id is required");
  }

  const sanitizedDeviceHash = sanitizeDeviceHash(newDeviceHashRaw);
  if (!sanitizedDeviceHash) {
    throw new HttpError(400, "invalid_request", "new_device_hash is required");
  }

  await assertRateLimit(
    env,
    `transfer-request:${userId}`,
    RATE_LIMIT_TRANSFER_REQUEST_LIMIT,
    RATE_LIMIT_TRANSFER_REQUEST_WINDOW_SECONDS,
  );

  const userRecord = await getUserRecord(env, userId);
  if (!userRecord) {
    throw new HttpError(404, "user_not_found", "User is not registered");
  }

  if (!userRecord.stripe_customer_id) {
    throw new HttpError(409, "stripe_customer_missing", "Stripe customer is not linked");
  }

  if (!isEntitled(userRecord.status, userRecord.current_period_end)) {
    throw new HttpError(403, "subscription_inactive", "Subscription is not active");
  }

  if (!userRecord.email) {
    throw new HttpError(
      409,
      "email_missing",
      "User record does not contain an email address",
    );
  }

  const otp = generateOtp();
  const otpHash = await hashOtp(otp);
  const expiresAt = Date.now() + OTP_TTL_SECONDS * 1000;
  await saveTransferRequest(env, userId, {
    otp_hash: otpHash,
    new_device_hash: sanitizedDeviceHash,
    expires_at: expiresAt,
    attempts: 0,
  }, OTP_TTL_SECONDS);

  try {
    await sendTransferOtpEmail(env, userRecord.email, otp, context);
  } catch (error) {
    await deleteTransferRequest(env, userId);
    throw error;
  }
  console.log(`[${context.requestId}] Issued device transfer OTP for ${userId}`);

  return jsonResponse({ success: true, expires_in: OTP_TTL_SECONDS }, 200, corsHeaders);
}

async function handleTransferConfirm(
  env: Env,
  request: Request,
  corsHeaders: HeadersInit,
  context: RequestContext,
): Promise<Response> {
  const body = await request.json().catch(() => {
    throw new HttpError(400, "invalid_request", "Body must be valid JSON");
  });

  if (typeof body !== "object" || body === null) {
    throw new HttpError(400, "invalid_request", "Body must be an object");
  }

  const { user_id: userId, otp } = body as LicenseTransferConfirmBody;
  if (!userId || !otp) {
    throw new HttpError(400, "invalid_request", "user_id and otp are required");
  }

  await assertRateLimit(
    env,
    `transfer-confirm:${userId}`,
    RATE_LIMIT_TRANSFER_CONFIRM_LIMIT,
    RATE_LIMIT_TRANSFER_CONFIRM_WINDOW_SECONDS,
  );

  const requestRecord = await getTransferRequest(env, userId);
  if (!requestRecord) {
    throw new HttpError(404, "transfer_request_missing", "No transfer request found");
  }

  if (requestRecord.expires_at <= Date.now()) {
    await deleteTransferRequest(env, userId);
    throw new HttpError(410, "transfer_request_expired", "Transfer request has expired");
  }

  const otpHash = await hashOtp(otp);
  if (!timingSafeEqual(otpHash, requestRecord.otp_hash)) {
    await incrementFailedTransferAttempts(env, userId);
    throw new HttpError(400, "invalid_otp", "Verification code is invalid");
  }

  const userRecord = await getUserRecord(env, userId);
  if (!userRecord) {
    await deleteTransferRequest(env, userId);
    throw new HttpError(404, "user_not_found", "User is not registered");
  }

  if (!userRecord.stripe_customer_id) {
    await deleteTransferRequest(env, userId);
    throw new HttpError(409, "stripe_customer_missing", "Stripe customer is not linked");
  }

  const updatedRecord = await putUserRecord(env, userId, {
    client_id: userId,
    device_hash: requestRecord.new_device_hash,
    key_version: (userRecord.key_version ?? 1) + 1,
  });

  await deleteTransferRequest(env, userId);

  const tier = env.TIER ?? "pro";
  if (!updatedRecord.stripe_customer_id) {
    throw new HttpError(409, "stripe_customer_missing", "Stripe customer is not linked");
  }
  const token = await issueLicenseToken(env, {
    userId: updatedRecord.client_id ?? userId,
    email: updatedRecord.email,
    tier,
    customerId: updatedRecord.stripe_customer_id,
    keyVersion: updatedRecord.key_version ?? 1,
    deviceHash: updatedRecord.device_hash,
    epoch: updatedRecord.epoch ?? 0,
    lifetimeSeconds: 600,
  });

  console.log(`[${context.requestId}] Completed device transfer for ${userId}`);

  return jsonResponse({ token: token.token, exp: token.exp, kid: token.kid }, 200, corsHeaders);
}

async function handleHealth(
  env: Env,
  corsHeaders: HeadersInit
): Promise<Response> {
  return jsonResponse(
    {
      status: "ok",
      service: "licensing",
      tier: env.TIER ?? "pro",
      time: new Date().toISOString(),
    },
    200,
    corsHeaders
  );
}

async function handleValidate(
  env: Env,
  request: Request,
  corsHeaders: HeadersInit
): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const url = new URL(request.url);
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : url.searchParams.get("token");

  if (!token) {
    throw new HttpError(400, "invalid_request", "Token is required");
  }

  const claims = await verifyLicenseToken(env, token);
  const userRecord = await getUserRecord(env, claims.sub);
  if (!userRecord) {
    throw new HttpError(404, "user_not_found", "User record not found");
  }

  const recordEpoch = userRecord.epoch ?? 0;
  if (claims.epoch === undefined || claims.epoch !== recordEpoch) {
    throw new HttpError(
      401,
      "epoch_mismatch",
      "Token epoch does not match record",
    );
  }

  if (userRecord.key_version !== claims.kv) {
    throw new HttpError(401, "token_invalidated", "Token has been superseded");
  }

  if (userRecord.stripe_customer_id && userRecord.stripe_customer_id !== claims.cus) {
    throw new HttpError(401, "customer_mismatch", "Token customer does not match record");
  }

  if (
    userRecord.device_hash &&
    (!claims.device_hash || userRecord.device_hash !== claims.device_hash)
  ) {
    throw new HttpError(401, "device_mismatch", "Token device does not match record");
  }

  return jsonResponse({ status: "ok", claims }, 200, corsHeaders);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const context: RequestContext = {
      requestId: crypto.randomUUID(),
    };

    const url = new URL(request.url);
    const allowedOrigins = getAllowedOrigins(env);
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return corsPreflightResponse(origin, allowedOrigins);
    }

    try {
      const apiPath = url.pathname;
      const corsHeaders = baseCorsHeaders(origin, allowedOrigins);

      switch (request.method) {
        case "POST": {
          if (apiPath === "/billing/checkout") {
            return await handleCheckout(env, request, corsHeaders, context);
          }
          if (apiPath === "/billing/portal") {
            return await handlePortal(env, url, corsHeaders, context, request);
          }
          if (apiPath === "/billing/webhook") {
            return await handleWebhook(env, request, context);
          }
          if (apiPath === "/license/issue") {
            return await handleIssue(env, request, corsHeaders);
          }
          if (apiPath === "/license/transfer/request") {
            return await handleTransferRequest(env, request, corsHeaders, context);
          }
          if (apiPath === "/license/transfer/confirm") {
            return await handleTransferConfirm(env, request, corsHeaders, context);
          }
          break;
        }
        case "GET": {
          if (apiPath === "/health") {
            return await handleHealth(env, corsHeaders);
          }
          if (apiPath === "/billing/portal") {
            return await handlePortal(env, url, corsHeaders, context, request);
          }
          if (apiPath === "/billing/subscription") {
            return await handleSubscription(env, url, corsHeaders);
          }
          if (apiPath === "/license/validate") {
            return await handleValidate(env, request, corsHeaders);
          }
          if (apiPath === "/license/public-key") {
            const publicKey = await derivePublicKey(env);
            return jsonResponse(
              { public_key: publicKey, kid: env.JWT_ACTIVE_KID },
              200,
              corsHeaders,
            );
          }
          if (apiPath === "/.well-known/jwks.json") {
            const jwks = await getJwks(env);
            return jsonResponse(jwks, 200, corsHeaders);
          }
          break;
        }
        default:
          break;
      }

      throw new HttpError(404, "not_found", "Route not found");
    } catch (error) {
      const corsHeaders = (() => {
        try {
          return baseCorsHeaders(origin, allowedOrigins);
        } catch {
          return {};
        }
      })();
      const response = errorResponse(error, context, corsHeaders);
      if (error instanceof HttpError && error.code === "rate_limited") {
        const retryAfter = (error.details as { retry_after?: unknown } | undefined)?.retry_after;
        if (typeof retryAfter === "number") {
          response.headers.set("retry-after", String(retryAfter));
        }
      }
      return response;
    }
  },
};
