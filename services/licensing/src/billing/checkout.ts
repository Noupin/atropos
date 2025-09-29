import Stripe from "stripe";
import { ensureCustomer, getStripeClient } from "./client";
import { createPortalSession } from "./portal";
import { BillingEnv, CheckoutRequestBody, CheckoutResponseBody } from "./types";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === "string" && value.trim().length > 0;
};

const buildIdempotencyKey = (request: Request, userId: string): string => {
  return request.headers.get("Idempotency-Key") ?? `checkout:${userId}:${crypto.randomUUID()}`;
};

const normalizeErrorDetails = (error: unknown): Record<string, string> => {
  const details: Record<string, string> = {};

  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    details.code = (error as { code: string }).code;
  }

  details.name = error instanceof Error ? error.name : "unknown_error";

  return details;
};

const BILLABLE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid", "paused"]);

const isBillableSubscription = (subscription: Stripe.Subscription): boolean => {
  const status = subscription.status?.toLowerCase();

  if (status && BILLABLE_STATUSES.has(status)) {
    return true;
  }

  if (subscription.pause_collection) {
    return true;
  }

  return false;
};

const customerHasBillableSubscription = async (
  stripe: Stripe,
  customerId: string,
): Promise<boolean> => {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  });

  return subscriptions.data.some((subscription) => isBillableSubscription(subscription));
};

const resolveSuccessUrl = (env: BillingEnv, payload: CheckoutRequestBody): string | null => {
  if (isNonEmptyString(payload.success_url)) {
    return payload.success_url;
  }

  if (isNonEmptyString(env.BILLING_SUCCESS_URL)) {
    return env.BILLING_SUCCESS_URL;
  }

  return null;
};

const resolveCancelUrl = (env: BillingEnv, payload: CheckoutRequestBody, fallback: string): string => {
  if (isNonEmptyString(payload.cancel_url)) {
    return payload.cancel_url;
  }

  if (isNonEmptyString(env.BILLING_CANCEL_URL)) {
    return env.BILLING_CANCEL_URL;
  }

  return fallback;
};

const resolvePriceId = (env: BillingEnv, payload: CheckoutRequestBody): string | null => {
  if (isNonEmptyString(payload.price_id)) {
    return payload.price_id;
  }

  if (isNonEmptyString(env.PRICE_ID_MONTHLY)) {
    return env.PRICE_ID_MONTHLY;
  }

  return null;
};

export const handleCheckoutRequest = async (
  request: Request,
  env: BillingEnv,
): Promise<Response> => {
  let payload: CheckoutRequestBody;

  try {
    payload = (await request.json()) as CheckoutRequestBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const userId = isNonEmptyString(payload.user_id) ? payload.user_id.trim() : null;

  if (!userId) {
    return jsonResponse({ error: "user_id_required" }, { status: 400 });
  }

  const successUrl = resolveSuccessUrl(env, payload);
  if (!successUrl) {
    return jsonResponse({ error: "success_url_required" }, { status: 400 });
  }

  const priceId = resolvePriceId(env, payload);
  if (!priceId) {
    return jsonResponse({ error: "price_id_required" }, { status: 400 });
  }

  const cancelUrl = resolveCancelUrl(env, payload, successUrl);
  const email = isNonEmptyString(payload.email) ? payload.email : undefined;

  try {
    const stripe = getStripeClient(env);
    const customer = await ensureCustomer(stripe, userId, email);

    const hasBillable = await customerHasBillableSubscription(stripe, customer.id);

    if (hasBillable) {
      const portalSession = await createPortalSession(stripe, {
        customerId: customer.id,
        returnUrl: successUrl,
        idempotencyKey: buildIdempotencyKey(request, userId).replace("checkout:", "portal:"),
      });

      const responseBody: CheckoutResponseBody = {
        url: portalSession.url,
        type: "portal",
      };

      return jsonResponse(responseBody, { status: 200 });
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customer.id,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        allow_promotion_codes: true,
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: {
          metadata: {
            user_id: userId,
          },
        },
        metadata: {
          user_id: userId,
        },
      },
      { idempotencyKey: buildIdempotencyKey(request, userId) },
    );

    if (!session.url) {
      return jsonResponse({ error: "session_url_missing" }, { status: 502 });
    }

    const responseBody: CheckoutResponseBody = {
      url: session.url,
      type: "checkout",
    };

    return jsonResponse(responseBody, { status: 200 });
  } catch (error) {
    console.error("billing_checkout_error", normalizeErrorDetails(error));
    return jsonResponse({ error: "internal_error" }, { status: 500 });
  }
};
