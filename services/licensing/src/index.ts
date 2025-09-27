import { Env, RequestContext } from "./env";
import {
  baseCorsHeaders,
  corsPreflightResponse,
  errorResponse,
  fallbackCorsHeaders,
  HttpError,
  jsonResponse,
} from "./http";
import {
  createBillingPortalSession,
  createCheckoutSession,
  createCustomer,
  listCustomerSubscriptions,
  verifyStripeSignature,
} from "./stripe";
import type { StripeSubscriptionSummary } from "./stripe";
import {
  findUserByStripeCustomerId,
  getUserRecord,
  normalizeTrialState,
  putUserRecord,
  TrialState,
  UserRecord,
} from "./kv";
import {
  derivePublicKey,
  issueLicenseToken,
  issueTrialToken,
  verifyLicenseToken,
  verifyTrialToken,
} from "./jwt";

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

interface TrialStartRequestBody {
  user_id: string;
  device_hash: string;
}

interface TrialClaimRequestBody {
  user_id: string;
  device_hash: string;
}

interface TrialConsumeRequestBody {
  user_id: string;
  token: string;
  device_hash: string;
}

interface BillingPortalRequestBody {
  user_id?: string;
  return_url?: string;
}

const PORTAL_ELIGIBLE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "paused",
]);

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

const SUBSCRIPTION_HISTORY_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
  "unpaid",
  "canceled",
  "grace_period",
  "paused",
]);

function hasSubscriptionHistory(status: string | null | undefined): boolean {
  const normalized = normalizeStatus(status);
  return SUBSCRIPTION_HISTORY_STATUSES.has(normalized);
}

export function isEntitled(status: string, currentPeriodEnd?: number | null): boolean {
  const normalized = normalizeStatus(status);
  if (normalized !== "active" && normalized !== "trialing") {
    return false;
  }

  if (typeof currentPeriodEnd !== "number" || !Number.isFinite(currentPeriodEnd)) {
    return true;
  }

  const now = Math.floor(Date.now() / 1000);
  return currentPeriodEnd > now;
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

function mergeUserRecord(
  existing: UserRecord | null,
  updates: Partial<UserRecord> & { trial?: TrialState }
): UserRecord {
  const base: UserRecord = existing
    ? { ...existing, trial: normalizeTrialState(existing.trial) }
    : {
        email: "",
        stripe_customer_id: "",
        status: "inactive",
        current_period_end: undefined,
        plan_price_id: undefined,
        cancel_at_period_end: false,
        updated_at: Date.now(),
        epoch: 0,
        device_hash: undefined,
        trial: normalizeTrialState(null),
      };

  const normalizedTrial = normalizeTrialState(updates.trial ?? base.trial);
  const resolvedStatus = updates.status ?? base.status;
  const trialWasDisabled = base.trial.allowed === false;
  const shouldDisableTrial =
    trialWasDisabled || hasSubscriptionHistory(resolvedStatus) || hasSubscriptionHistory(base.status);
  const mergedTrial: TrialState = {
    ...normalizedTrial,
    allowed: shouldDisableTrial ? false : normalizedTrial.allowed,
  };

  return {
    ...base,
    ...updates,
    status: resolvedStatus,
    trial: mergedTrial,
  };
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

  const userRecord = await getUserRecord(env, userId);

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

  const existingCustomerId = userRecord?.stripe_customer_id;
  if (existingCustomerId) {
    const subscriptions = await listCustomerSubscriptions(env, existingCustomerId);
    const hasBillableSubscription = subscriptions.some(
      (subscription: StripeSubscriptionSummary) => {
        const normalized = subscription.status?.toLowerCase() ?? null;
        return (
          normalized !== null &&
          PORTAL_ELIGIBLE_SUBSCRIPTION_STATUSES.has(normalized)
        );
      },
    );

    if (hasBillableSubscription) {
      const portalIdempotencyKey = `${idempotencyRoot}:portal`;
      const portal = await createBillingPortalSession(
        env,
        existingCustomerId,
        successUrl ?? env.RETURN_URL_SUCCESS,
        env.STRIPE_PORTAL_CONFIGURATION_ID,
        portalIdempotencyKey,
      );

      console.log(
        `[${context.requestId}] Redirecting ${userId} to portal due to existing subscription`,
      );

      return jsonResponse({ portal_url: portal.url }, 200, corsHeaders);
    }
  }

  let stripeCustomerId = existingCustomerId;
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

  const session = await createCheckoutSession(env, {
    userId,
    email,
    priceId: price,
    successUrl,
    cancelUrl,
    customerId: stripeCustomerId,
    idempotencyKey: checkoutIdempotencyKey,
  });

  const updated = mergeUserRecord(userRecord, {
    email,
    stripe_customer_id: stripeCustomerId,
    status: userRecord?.status ?? "pending",
    current_period_end: userRecord?.current_period_end,
    plan_price_id: price,
    updated_at: Date.now(),
    cancel_at_period_end: userRecord?.cancel_at_period_end ?? false,
    epoch: userRecord?.epoch ?? 0,
    device_hash: userRecord?.device_hash,
  });
  await putUserRecord(env, userId, updated);

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
  let portal: Awaited<ReturnType<typeof createBillingPortalSession>>;
  try {
    portal = await createBillingPortalSession(
      env,
      userRecord.stripe_customer_id,
      returnUrl ?? env.RETURN_URL_SUCCESS,
      env.STRIPE_PORTAL_CONFIGURATION_ID,
      idempotencyKey
    );
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.code === "stripe_error" &&
      /invalid_request_error: no configuration provided/i.test(error.message)
    ) {
      throw new HttpError(
        409,
        "portal_not_configured",
        "Stripe billing portal is not configured. " +
          "Configure the customer portal in the Stripe Dashboard for both test and live modes.",
      );
    }

    throw error;
  }
  console.log(`[${context.requestId}] Generated portal session for ${userId}`);
  return jsonResponse({ url: portal.url }, 200, corsHeaders);
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

  const forceParam = url.searchParams.get("force");
  const shouldForce = forceParam?.toLowerCase() === "true";
  const isDevEnvironment = env.STRIPE_SECRET_KEY.startsWith("sk_test");

  let record = await getUserRecord(env, userId);
  let trial = normalizeTrialState(record?.trial);

  if (shouldForce && !isDevEnvironment) {
    console.warn(
      `Ignoring forced subscription refresh for ${userId} outside development`
    );
  }

  if (
    shouldForce &&
    isDevEnvironment &&
    record &&
    record.stripe_customer_id
  ) {
    const subscriptions = await listCustomerSubscriptions(
      env,
      record.stripe_customer_id
    );

    const subscription =
      subscriptions.find((candidate) => candidate.metadata?.user_id === userId) ??
      subscriptions.find((candidate) => {
        const normalized = normalizeStatus(candidate.status);
        return normalized === "active" || normalized === "trialing";
      }) ??
      subscriptions[0];

    if (subscription) {
      const subscriptionStatus = subscription.status ?? record.status;
      const subscriptionPeriodEnd =
        typeof subscription.current_period_end === "number"
          ? subscription.current_period_end
          : record.current_period_end;
      const subscriptionCancelAtPeriodEnd =
        typeof subscription.cancel_at_period_end === "boolean"
          ? subscription.cancel_at_period_end
          : record.cancel_at_period_end ?? false;

      const updatedRecord = {
        ...record,
        status: subscriptionStatus ?? record.status,
        current_period_end: subscriptionPeriodEnd,
        cancel_at_period_end: subscriptionCancelAtPeriodEnd,
        updated_at: Date.now(),
      };
      await putUserRecord(env, userId, updatedRecord);
      record = updatedRecord;
    }
  }

  if (!record) {
    trial = normalizeTrialState(null);
    return jsonResponse(
      {
        status: "inactive",
        entitled: false,
        current_period_end: null,
        cancel_at_period_end: false,
        trial: {
          allowed: trial.allowed,
          started: trial.started,
          total: trial.total,
          remaining: trial.remaining,
          used_at: trial.used_at,
          device_hash: trial.device_hash,
        },
      },
      200,
      corsHeaders
    );
  }

  const status = normalizeStatus(record.status);
  const currentPeriodEnd = record.current_period_end ?? null;
  const cancelAtPeriodEnd = record.cancel_at_period_end ?? false;
  trial = normalizeTrialState(record.trial);

  return jsonResponse(
    {
      status,
      entitled: isEntitled(status, currentPeriodEnd ?? undefined),
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      trial: {
        allowed: trial.allowed,
        started: trial.started,
        total: trial.total,
        remaining: trial.remaining,
        used_at: trial.used_at,
        device_hash: trial.device_hash,
      },
    },
    200,
    corsHeaders
  );
}

async function handleTrialStart(
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

  const { user_id: userIdRaw, device_hash: deviceHashRaw } =
    body as TrialStartRequestBody;

  if (typeof userIdRaw !== "string" || userIdRaw.trim().length === 0) {
    throw new HttpError(400, "invalid_request", "user_id is required");
  }
  if (typeof deviceHashRaw !== "string" || deviceHashRaw.trim().length === 0) {
    throw new HttpError(400, "invalid_request", "device_hash is required");
  }

  const userId = userIdRaw.trim();
  const deviceHash = deviceHashRaw.trim();

  const record = await getUserRecord(env, userId);
  if (record && isEntitled(record.status, record.current_period_end)) {
    throw new HttpError(409, "already_subscribed", "User already subscribed");
  }

  const trial = normalizeTrialState(record?.trial);
  if (!trial.allowed) {
    throw new HttpError(403, "trial_not_allowed", "Trial is not permitted");
  }

  if (
    trial.started &&
    trial.device_hash &&
    trial.device_hash !== deviceHash
  ) {
    throw new HttpError(
      409,
      "trial_already_started_on_other_device",
      "Trial already started on another device",
    );
  }

  const now = Date.now();
  const updatedTrial = normalizeTrialState({
    ...trial,
    started: true,
    total: trial.total,
    remaining:
      trial.started && trial.device_hash === deviceHash
        ? trial.remaining
        : trial.total,
    device_hash: trial.device_hash ?? deviceHash,
    jti: null,
    exp: null,
  });

  const updatedRecord = mergeUserRecord(record, {
    updated_at: now,
    status: record?.status ?? "inactive",
    trial: updatedTrial,
  });
  await putUserRecord(env, userId, updatedRecord);

  console.log(
    `[${context.requestId}] Trial started for ${userId} remaining=${updatedTrial.remaining}`,
  );

  return jsonResponse(
    {
      started: true,
      total: updatedTrial.total,
      remaining: updatedTrial.remaining,
    },
    200,
    corsHeaders,
  );
}

async function handleTrialClaim(
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

  const { user_id: userIdRaw, device_hash: deviceHashRaw } =
    body as TrialClaimRequestBody;

  if (typeof userIdRaw !== "string" || userIdRaw.trim().length === 0) {
    throw new HttpError(400, "invalid_request", "user_id is required");
  }
  if (typeof deviceHashRaw !== "string" || deviceHashRaw.trim().length === 0) {
    throw new HttpError(400, "invalid_request", "device_hash is required");
  }

  const userId = userIdRaw.trim();
  const deviceHash = deviceHashRaw.trim();

  const record = await getUserRecord(env, userId);
  if (!record || isEntitled(record.status, record.current_period_end)) {
    throw new HttpError(403, "trial_invalid", "Trial is unavailable");
  }

  const trial = normalizeTrialState(record.trial);
  if (!trial.allowed || !trial.started) {
    throw new HttpError(403, "trial_invalid", "Trial is not active");
  }

  if (!trial.device_hash || trial.device_hash !== deviceHash) {
    throw new HttpError(403, "trial_invalid", "Trial device mismatch");
  }

  if (trial.remaining <= 0) {
    throw new HttpError(409, "trial_exhausted", "Trial quota exhausted");
  }

  const token = await issueTrialToken(env, userId);
  const updatedTrial = normalizeTrialState({
    ...trial,
    jti: token.jti,
    exp: token.exp,
    device_hash: deviceHash,
    started: true,
  });

  const updatedRecord = mergeUserRecord(record, {
    updated_at: Date.now(),
    trial: updatedTrial,
  });
  await putUserRecord(env, userId, updatedRecord);

  console.log(
    `[${context.requestId}] Trial claim for ${userId} exp=${token.exp} remaining=${updatedTrial.remaining}`,
  );

  return jsonResponse(
    { token: token.token, exp: token.exp, remaining: updatedTrial.remaining },
    200,
    corsHeaders,
  );
}

async function handleTrialConsume(
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

  const { user_id: userIdRaw, token, device_hash: deviceHashRaw } =
    body as TrialConsumeRequestBody;

  if (typeof userIdRaw !== "string" || userIdRaw.trim().length === 0) {
    throw new HttpError(400, "invalid_request", "user_id is required");
  }
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new HttpError(400, "invalid_request", "token is required");
  }
  if (typeof deviceHashRaw !== "string" || deviceHashRaw.trim().length === 0) {
    throw new HttpError(400, "invalid_request", "device_hash is required");
  }

  const userId = userIdRaw.trim();
  const deviceHash = deviceHashRaw.trim();

  const record = await getUserRecord(env, userId);
  if (!record || isEntitled(record.status, record.current_period_end)) {
    throw new HttpError(403, "trial_invalid", "Trial is unavailable");
  }

  const trial = normalizeTrialState(record.trial);

  if (!trial.started || !trial.device_hash || trial.device_hash !== deviceHash) {
    throw new HttpError(403, "trial_invalid", "Trial is not active");
  }

  if (!trial.jti || !trial.exp) {
    throw new HttpError(403, "trial_invalid", "Trial token is not available");
  }

  const claims = await verifyTrialToken(env, token.trim());
  if (claims.sub !== userId || claims.jti !== trial.jti) {
    throw new HttpError(403, "trial_invalid", "Trial token mismatch");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (trial.exp <= nowSeconds) {
    throw new HttpError(403, "trial_invalid", "Trial token expired");
  }

  if (trial.remaining <= 0) {
    throw new HttpError(403, "trial_invalid", "Trial quota exhausted");
  }

  const remaining = Math.max(0, trial.remaining - 1);
  const updatedTrial = normalizeTrialState({
    ...trial,
    remaining,
    used_at: Date.now(),
    jti: null,
    exp: null,
    device_hash: deviceHash,
  });

  const updatedRecord = mergeUserRecord(record, {
    updated_at: Date.now(),
    trial: updatedTrial,
  });
  await putUserRecord(env, userId, updatedRecord);

  console.log(
    `[${context.requestId}] Trial consume for ${userId} remaining=${remaining}`,
  );

  return jsonResponse({ success: true, remaining }, 200, corsHeaders);
}

async function handleWebhook(
  env: Env,
  request: Request,
  context: RequestContext,
  corsHeaders: HeadersInit
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
              : (existing?.status ?? "pending");
          const planPriceId =
            (object.metadata as Record<string, string> | undefined)?.price_id ??
            existing?.plan_price_id ??
            env.PRICE_ID_MONTHLY;
          const updatedRecord = mergeUserRecord(existing, {
            email,
            stripe_customer_id: customerId,
            status,
            current_period_end: existing?.current_period_end,
            plan_price_id: planPriceId,
            cancel_at_period_end: existing?.cancel_at_period_end ?? false,
            updated_at: Date.now(),
            epoch: existing?.epoch ?? 0,
            device_hash: existing?.device_hash,
          });
          await putUserRecord(env, userId, updatedRecord);
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
        let userId = subscription.metadata?.user_id ?? null;
        let existingUser = userId ? await getUserRecord(env, userId) : null;

        if ((!userId || !existingUser) && customerId) {
          const match = await findUserByStripeCustomerId(env, customerId);
          if (match) {
            userId = match.userId;
            existingUser = match.record;
          }
        }

        if (!customerId || !userId) {
          console.warn(
            `[${context.requestId}] Subscription event missing user_id`
          );
          break;
        }

        const status = subscription.status ?? existingUser?.status ?? "unknown";
        const currentPeriodEnd =
          typeof subscription.current_period_end === "number"
            ? subscription.current_period_end
            : existingUser?.current_period_end;
        const cancelAtPeriodEnd =
          typeof subscription.cancel_at_period_end === "boolean"
            ? subscription.cancel_at_period_end
            : existingUser?.cancel_at_period_end ?? false;
        const planPriceId =
          subscription.items?.data?.[0]?.price?.id ??
          existingUser?.plan_price_id ??
          env.PRICE_ID_MONTHLY;
        const updatedAt = Date.now();
        const updatedRecord = mergeUserRecord(existingUser, {
          email: subscription.customer_email ?? existingUser?.email ?? "",
          stripe_customer_id: customerId,
          status,
          current_period_end: currentPeriodEnd,
          plan_price_id: planPriceId,
          cancel_at_period_end: cancelAtPeriodEnd,
          updated_at: updatedAt,
          epoch: existingUser?.epoch ?? 0,
          device_hash: existingUser?.device_hash,
        });
        await putUserRecord(env, userId, updatedRecord);
        console.log(
          `[${context.requestId}] Subscription ${subscription.id} -> ${status}`
        );
        break;
      }
      case "customer.subscription.deleted": {
        const subscription = object as unknown as StripeSubscription;
        const customerId = extractStripeId(subscription.customer);
        let userId = subscription.metadata?.user_id ?? null;
        let existingUser = userId ? await getUserRecord(env, userId) : null;

        if ((!userId || !existingUser) && customerId) {
          const match = await findUserByStripeCustomerId(env, customerId);
          if (match) {
            userId = match.userId;
            existingUser = match.record;
          }
        }

        if (!customerId || !userId) {
          console.warn(
            `[${context.requestId}] Subscription event missing user_id`
          );
          break;
        }
        const updatedAt = Date.now();
        const currentPeriodEnd = Math.floor(updatedAt / 1000);
        const planPriceId =
          existingUser?.plan_price_id ??
          subscription.items?.data?.[0]?.price?.id ??
          env.PRICE_ID_MONTHLY;
        const previousEpoch = existingUser?.epoch ?? 0;
        const updatedRecord = mergeUserRecord(existingUser, {
          email: existingUser?.email ?? subscription.customer_email ?? "",
          stripe_customer_id: customerId,
          status: "canceled",
          current_period_end: currentPeriodEnd,
          plan_price_id: planPriceId,
          cancel_at_period_end: false,
          updated_at: updatedAt,
          epoch: previousEpoch + 1,
          device_hash: existingUser?.device_hash,
        });
        await putUserRecord(env, userId, updatedRecord);
        console.log(
          `[${context.requestId}] Subscription ${subscription.id} canceled`
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

  return new Response(null, { status: 200, headers: corsHeaders });
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

  if (typeof deviceHash !== "string" || deviceHash.trim().length === 0) {
    throw new HttpError(400, "invalid_request", "device_hash is required");
  }
  const normalizedDeviceHash = deviceHash.trim();

  const userRecord = await getUserRecord(env, userId);
  if (!userRecord) {
    throw new HttpError(
      404,
      "user_not_found",
      "User has no active subscription"
    );
  }

  if (
    userRecord.device_hash &&
    userRecord.device_hash !== normalizedDeviceHash
  ) {
    throw new HttpError(403, "device_mismatch", "Device hash mismatch");
  }

  if (!isEntitled(userRecord.status, userRecord.current_period_end)) {
    throw new HttpError(
      403,
      "subscription_inactive",
      "Subscription is not active"
    );
  }

  if (!userRecord.device_hash) {
    const updatedRecord = {
      ...userRecord,
      device_hash: normalizedDeviceHash,
      updated_at: Date.now(),
    };
    await putUserRecord(env, userId, updatedRecord);
  }

  const tier = env.TIER ?? "pro";
  const token = await issueLicenseToken(env, {
    userId,
    email: userRecord.email,
    tier,
    deviceHash: normalizedDeviceHash,
    epoch: userRecord.epoch,
  });

  return jsonResponse({ token: token.token, exp: token.exp }, 200, corsHeaders);
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
  if (!userRecord || claims.epoch !== userRecord.epoch) {
    throw new HttpError(401, "invalid_token", "Token is no longer valid");
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

    let corsHeaders: HeadersInit;

    try {
      corsHeaders = baseCorsHeaders(origin, allowedOrigins);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(
          error,
          context,
          fallbackCorsHeaders(origin, allowedOrigins)
        );
      }

      throw error;
    }

    try {
      const apiPath = url.pathname;

      switch (request.method) {
        case "POST": {
          if (apiPath === "/billing/checkout") {
            return await handleCheckout(env, request, corsHeaders, context);
          }
          if (apiPath === "/billing/portal") {
            return await handlePortal(env, url, corsHeaders, context, request);
          }
          if (apiPath === "/billing/webhook") {
            return await handleWebhook(env, request, context, corsHeaders);
          }
          if (apiPath === "/license/issue") {
            return await handleIssue(env, request, corsHeaders);
          }
          if (apiPath === "/trial/start") {
            return await handleTrialStart(env, request, corsHeaders, context);
          }
          if (apiPath === "/trial/claim") {
            return await handleTrialClaim(env, request, corsHeaders, context);
          }
          if (apiPath === "/trial/consume") {
            return await handleTrialConsume(env, request, corsHeaders, context);
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
            return jsonResponse({ public_key: publicKey }, 200, corsHeaders);
          }
          break;
        }
        default:
          break;
      }

      throw new HttpError(404, "not_found", "Route not found");
    } catch (error) {
      return errorResponse(error, context, corsHeaders);
    }
  },
};
