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
  verifyStripeSignature,
} from "./stripe";
import {
  getSubscriptionRecord,
  getUserRecord,
  putSubscriptionRecord,
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

function getAllowedOrigins(env: Env): string[] {
  return (env.CORS_ALLOW_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeStatus(status: string | null | undefined): string {
  return status ? status.toLowerCase() : "unknown";
}

function isEntitled(status: string, currentPeriodEnd?: number | null): boolean {
  const normalized = normalizeStatus(status);
  if (normalized === "active" || normalized === "trialing") {
    if (!currentPeriodEnd) {
      return true;
    }
    const now = Math.floor(Date.now() / 1000);
    return currentPeriodEnd > now;
  }
  return false;
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

  const idempotencyKey =
    request.headers.get("Idempotency-Key") ?? crypto.randomUUID();
  const session = await createCheckoutSession(env, {
    userId,
    email,
    priceId: price,
    successUrl,
    cancelUrl,
    customerId: userRecord?.stripe_customer_id || undefined,
    idempotencyKey,
  });

  const updated = {
    email,
    stripe_customer_id: userRecord?.stripe_customer_id ?? "",
    status: userRecord?.status ?? "pending",
    current_period_end: userRecord?.current_period_end,
    plan_price_id: price,
    updated_at: Date.now(),
  };
  await putUserRecord(env, userId, updated);

  console.log(
    `[${context.requestId}] Created checkout session ${session.id} for ${userId}`
  );

  return jsonResponse({ url: session.url }, 200, corsHeaders);
}

async function handlePortal(
  env: Env,
  url: URL,
  corsHeaders: HeadersInit,
  context: RequestContext,
  request: Request
): Promise<Response> {
  const userId = url.searchParams.get("user_id");
  if (!userId) {
    throw new HttpError(400, "invalid_request", "user_id is required");
  }

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
    env.RETURN_URL_SUCCESS,
    idempotencyKey
  );
  console.log(`[${context.requestId}] Generated portal session for ${userId}`);
  return jsonResponse({ url: portal.url }, 200, corsHeaders);
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
        const customerId = String(object.customer ?? "");
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
            updated_at: Date.now(),
          });
          await putSubscriptionRecord(env, customerId, {
            user_id: userId,
            status,
            current_period_end: existing?.current_period_end,
            updated_at: Date.now(),
          });
          console.log(
            `[${context.requestId}] Checkout complete for ${userId} (${customerId}) subscription=${subscriptionId}`
          );
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = object as unknown as StripeSubscription;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : "";
        const userId =
          subscription.metadata?.user_id ??
          (await getSubscriptionRecord(env, customerId))?.user_id;
        if (!customerId || !userId) {
          console.warn(
            `[${context.requestId}] Subscription event missing user_id`
          );
          break;
        }
        const status = subscription.status ?? "unknown";
        const currentPeriodEnd =
          typeof subscription.current_period_end === "number"
            ? subscription.current_period_end
            : undefined;
        const planPriceId = subscription.items?.data?.[0]?.price?.id;
        const existingUser = await getUserRecord(env, userId);
        await putUserRecord(env, userId, {
          email: subscription.customer_email ?? existingUser?.email ?? "",
          stripe_customer_id: customerId,
          status,
          current_period_end: currentPeriodEnd,
          plan_price_id: planPriceId ?? env.PRICE_ID_MONTHLY,
          updated_at: Date.now(),
        });
        await putSubscriptionRecord(env, customerId, {
          user_id: userId,
          status,
          current_period_end: currentPeriodEnd,
          updated_at: Date.now(),
        });
        console.log(
          `[${context.requestId}] Subscription ${subscription.id} -> ${status}`
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
