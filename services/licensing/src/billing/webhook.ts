import Stripe from "stripe";
import { KVNamespace, UserRecord } from "../kv";
import { findUserIdByStripeCustomerId, mutateUserRecord } from "../kv/user";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
};

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const extractCustomerId = (source: { customer?: string | Stripe.Customer | Stripe.DeletedCustomer | null }): string | null => {
  const { customer } = source;

  if (!customer) {
    return null;
  }

  if (typeof customer === "string") {
    return customer;
  }

  if (typeof customer === "object" && "id" in customer && typeof customer.id === "string") {
    return customer.id;
  }

  return null;
};

const extractUserIdFromMetadata = (metadata: Stripe.Metadata | null | undefined): string | null => {
  if (!metadata) {
    return null;
  }

  return toNonEmptyString(metadata.user_id);
};

const resolveUserId = async (
  kv: KVNamespace,
  params: {
    metadataUserId?: string | null;
    customerId?: string | null;
  },
): Promise<string | null> => {
  if (params.metadataUserId) {
    return params.metadataUserId;
  }

  if (params.customerId) {
    const result = await findUserIdByStripeCustomerId(kv, params.customerId);
    if (result) {
      return result.userId;
    }
  }

  return null;
};

const selectPlanPriceId = (subscription: Stripe.Subscription): string | null => {
  const items = subscription.items?.data ?? [];

  for (const item of items) {
    const price = item?.price;
    if (price && typeof price === "object" && typeof price.id === "string" && price.id.length > 0) {
      return price.id;
    }
  }

  return null;
};

const normalizeSubscriptionStatus = (status: string | null | undefined): string | null => {
  if (typeof status !== "string") {
    return null;
  }

  const normalized = status.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

interface BillingWebhookEnv {
  STRIPE_WEBHOOK_SECRET?: string;
  LICENSING_KV: KVNamespace;
}

const logWarning = (message: string, details: Record<string, unknown> = {}): void => {
  console.warn(message, details);
};

const logError = (message: string, details: Record<string, unknown> = {}): void => {
  console.error(message, details);
};

const handleCheckoutSessionCompleted = async (
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  env: BillingWebhookEnv,
): Promise<void> => {
  const customerId = extractCustomerId(session);
  const metadataUserId = extractUserIdFromMetadata(session.metadata);
  const userId = await resolveUserId(env.LICENSING_KV, { metadataUserId, customerId });

  if (!userId) {
    logWarning("checkout_session_completed_user_missing", {
      event_id: event.id,
      customer_id: customerId,
    });
    return;
  }

  const emailCandidates = [
    toNonEmptyString(session.customer_details?.email ?? null),
    typeof session.customer === "object" && session.customer && "email" in session.customer
      ? toNonEmptyString((session.customer as Stripe.Customer).email ?? null)
      : null,
  ].filter((value): value is string => typeof value === "string");

  const email = emailCandidates.length > 0 ? emailCandidates[0] : null;

  await mutateUserRecord(
    env.LICENSING_KV,
    userId,
    ({ current }): Partial<UserRecord> | null => {
      const updates: Partial<UserRecord> = {};

      if (customerId && current.stripe_customer_id !== customerId) {
        updates.stripe_customer_id = customerId;
      }

      if (email && current.email !== email) {
        updates.email = email;
      }

      return Object.keys(updates).length > 0 ? updates : null;
    },
    { eventTimestamp: event.created },
  );
};

const handleSubscriptionChange = async (
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  env: BillingWebhookEnv,
): Promise<void> => {
  const customerId = extractCustomerId(subscription);
  const metadataUserId = extractUserIdFromMetadata(subscription.metadata);
  const userId = await resolveUserId(env.LICENSING_KV, { metadataUserId, customerId });

  if (!userId) {
    logWarning("subscription_event_user_missing", {
      event_id: event.id,
      customer_id: customerId,
    });
    return;
  }

  const status = normalizeSubscriptionStatus(subscription.status);
  const currentPeriodEnd = typeof subscription.current_period_end === "number" ? subscription.current_period_end : null;
  const cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  const planPriceId = selectPlanPriceId(subscription);
  const subscriptionEmail = toNonEmptyString(subscription.customer_email ?? null);

  await mutateUserRecord(
    env.LICENSING_KV,
    userId,
    ({ current }): Partial<UserRecord> | null => {
      const updates: Partial<UserRecord> = {};

      if (customerId && current.stripe_customer_id !== customerId) {
        updates.stripe_customer_id = customerId;
      }

      if (status) {
        updates.status = status;
      }

      if (currentPeriodEnd !== null) {
        updates.current_period_end = currentPeriodEnd;
      }

      updates.cancel_at_period_end = cancelAtPeriodEnd;

      updates.plan_price_id = planPriceId ?? null;

      if (subscriptionEmail && current.email !== subscriptionEmail) {
        updates.email = subscriptionEmail;
      }

      if (event.type === "customer.subscription.deleted") {
        const now = Math.floor(Date.now() / 1000);
        updates.status = "canceled";
        updates.current_period_end = now;
        updates.cancel_at_period_end = false;
        updates.plan_price_id = null;
        updates.epoch = Math.max((current.epoch ?? 0) + 1, now);
      }

      updates.trial = {
        allowed: 0,
        total: Math.max(current.trial?.total ?? 0, 0),
        remaining: 0,
        started: current.trial?.started ?? null,
        used_at: current.trial?.used_at ?? null,
        device_hash: current.trial?.device_hash ?? null,
        jti: null,
        exp: null,
      };

      return Object.keys(updates).length > 0 ? updates : null;
    },
    { eventTimestamp: event.created },
  );
};

const verifyStripeSignature = (
  payload: string,
  signature: string,
  secret: string,
): Stripe.Event => {
  return Stripe.webhooks.constructEvent(payload, signature, secret);
};

export const handleWebhookRequest = async (
  request: Request,
  env: BillingWebhookEnv,
): Promise<Response> => {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  const kv = env.LICENSING_KV;
  if (!secret || typeof secret !== "string") {
    logError("stripe_webhook_secret_missing");
    return jsonResponse({ error: "webhook_not_configured" }, { status: 500 });
  }

  if (!kv) {
    logError("licensing_kv_missing");
    return jsonResponse({ error: "kv_not_available" }, { status: 500 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse({ error: "signature_required" }, { status: 400 });
  }

  let payload: string;
  try {
    payload = await request.text();
  } catch (error) {
    logError("webhook_read_error", { error: (error as Error)?.message });
    return jsonResponse({ error: "invalid_payload" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = verifyStripeSignature(payload, signature, secret);
  } catch (error) {
    logWarning("stripe_signature_verification_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "invalid_signature" }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        await handleCheckoutSessionCompleted(event, event.data.object as Stripe.Checkout.Session, env);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await handleSubscriptionChange(event, event.data.object as Stripe.Subscription, env);
        break;
      }
      default: {
        logWarning("stripe_event_unhandled", { event_type: event.type });
      }
    }
  } catch (error) {
    logError("billing_webhook_handler_error", {
      event_id: event.id,
      event_type: event.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse({ error: "internal_error" }, { status: 500 });
  }

  return jsonResponse({ received: true }, { status: 200 });
};
