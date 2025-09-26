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
  verifyStripeSignature,
} from "./stripe";
import {
  findUserByStripeCustomerId,
  getUserRecord,
  putUserRecord,
} from "./kv";
import { derivePublicKey, issueLicenseToken, verifyLicenseToken } from "./jwt";

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
  device_hash?: string;
}

interface BillingPortalRequestBody {
  user_id?: string;
  return_url?: string;
}

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

function isEntitled(status: string, currentPeriodEnd?: number | null): boolean {
  const normalized = normalizeStatus(status);
  if (normalized !== "active" && normalized !== "trialing") {
    return false;
  }

  if (typeof currentPeriodEnd !== "number") {
    return false;
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

  const session = await createCheckoutSession(env, {
    userId,
    email,
    priceId: price,
    successUrl,
    cancelUrl,
    customerId: stripeCustomerId,
    idempotencyKey: checkoutIdempotencyKey,
  });

  const updated = {
    email,
    stripe_customer_id: stripeCustomerId,
    status: userRecord?.status ?? "pending",
    current_period_end: userRecord?.current_period_end,
    plan_price_id: price,
    updated_at: Date.now(),
    cancel_at_period_end: userRecord?.cancel_at_period_end ?? false,
    epoch: userRecord?.epoch ?? 0,
  };
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
  const portal = await createBillingPortalSession(
    env,
    userRecord.stripe_customer_id,
    returnUrl ?? env.RETURN_URL_SUCCESS,
    idempotencyKey
  );
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

  const record = await getUserRecord(env, userId);
  if (!record) {
    return jsonResponse(
      {
        status: "inactive",
        entitled: false,
        current_period_end: null,
        cancel_at_period_end: false,
      },
      200,
      corsHeaders
    );
  }

  const status = normalizeStatus(record.status);
  const currentPeriodEnd = record.current_period_end ?? null;
  const cancelAtPeriodEnd = record.cancel_at_period_end ?? false;

  return jsonResponse(
    {
      status,
      entitled: isEntitled(status, currentPeriodEnd ?? undefined),
      current_period_end: currentPeriodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
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
              : (existing?.status ?? "pending");
          const planPriceId =
            (object.metadata as Record<string, string> | undefined)?.price_id ??
            existing?.plan_price_id ??
            env.PRICE_ID_MONTHLY;
          await putUserRecord(env, userId, {
            email,
            stripe_customer_id: customerId,
            status,
            current_period_end: existing?.current_period_end,
            plan_price_id: planPriceId,
            cancel_at_period_end: existing?.cancel_at_period_end ?? false,
            updated_at: Date.now(),
            epoch: existing?.epoch ?? 0,
          });
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
        await putUserRecord(env, userId, {
          email: subscription.customer_email ?? existingUser?.email ?? "",
          stripe_customer_id: customerId,
          status,
          current_period_end: currentPeriodEnd,
          plan_price_id: planPriceId,
          cancel_at_period_end: cancelAtPeriodEnd,
          updated_at: updatedAt,
          epoch: existingUser?.epoch ?? 0,
        });
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
        await putUserRecord(env, userId, {
          email: existingUser?.email ?? subscription.customer_email ?? "",
          stripe_customer_id: customerId,
          status: "canceled",
          current_period_end: currentPeriodEnd,
          plan_price_id: planPriceId,
          cancel_at_period_end: false,
          updated_at: updatedAt,
          epoch: previousEpoch + 1,
        });
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

  const userRecord = await getUserRecord(env, userId);
  if (!userRecord) {
    throw new HttpError(
      404,
      "user_not_found",
      "User has no active subscription"
    );
  }

  if (!isEntitled(userRecord.status, userRecord.current_period_end)) {
    throw new HttpError(
      403,
      "subscription_inactive",
      "Subscription is not active"
    );
  }

  const tier = env.TIER ?? "pro";
  const token = await issueLicenseToken(env, {
    userId,
    email: userRecord.email,
    tier,
    deviceHash,
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
      const corsHeaders = (() => {
        try {
          return baseCorsHeaders(origin, allowedOrigins);
        } catch {
          return {};
        }
      })();
      return errorResponse(error, context, corsHeaders);
    }
  },
};
