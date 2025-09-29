import type Stripe from "stripe";
import { getStripeClient } from "./client";
import {
  BillingEnv,
  BillingUrlResponse,
  CheckoutRequestBody,
  computeIdempotencyKey,
  ensurePriceId,
  ensureUrl,
  ensureUserId,
  isBillableStatus,
  normalizeEmail,
  buildCustomerQuery,
} from "./types";

const isDeletedCustomer = (
  candidate: Stripe.Customer | Stripe.DeletedCustomer,
): candidate is Stripe.DeletedCustomer => {
  return "deleted" in candidate && candidate.deleted === true;
};

class RequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
};

const validate = <T>(resolver: () => T): T => {
  try {
    return resolver();
  } catch (error) {
    if (error instanceof RequestError) {
      throw error;
    }

    if (error instanceof Error) {
      throw new RequestError(error.message, 400);
    }

    throw new RequestError("Invalid request", 400);
  }
};

const parseRequestBody = async (request: Request): Promise<CheckoutRequestBody> => {
  try {
    const payload = (await request.json()) as CheckoutRequestBody;
    return payload;
  } catch (error) {
    throw new RequestError("Invalid JSON body", 400);
  }
};

export const findOrCreateCustomer = async (
  stripe: Stripe,
  userId: string,
  email?: string,
): Promise<Stripe.Customer> => {
  const query = buildCustomerQuery(userId);
  let customer: Stripe.Customer | null = null;

  try {
    const result = await stripe.customers.search({
      query,
      limit: 1,
      expand: ["data.subscriptions"],
    });
    if (result.data.length > 0 && !isDeletedCustomer(result.data[0])) {
      customer = result.data[0] as Stripe.Customer;
    }
  } catch (error) {
    console.error("Stripe customer search failed", error);
  }

  if (!customer && email) {
    const list = await stripe.customers.list({ email, limit: 5 });
    for (const candidate of list.data) {
      if (isDeletedCustomer(candidate)) {
        continue;
      }

      if (candidate.metadata?.user_id && candidate.metadata.user_id !== userId) {
        continue;
      }

      customer = candidate as Stripe.Customer;
      break;
    }
  }

  if (!customer) {
    const params: Stripe.CustomerCreateParams = {
      metadata: { user_id: userId },
    };

    if (email) {
      params.email = email;
    }

    customer = await stripe.customers.create(params);
    return customer;
  }

  const updates: Stripe.CustomerUpdateParams = {};
  if (email && customer.email !== email) {
    updates.email = email;
  }
  if (!customer.metadata?.user_id) {
    updates.metadata = { ...customer.metadata, user_id: userId };
  }

  if (Object.keys(updates).length > 0) {
    customer = await stripe.customers.update(customer.id, updates);
  }

  return customer;
};

const findBillableSubscription = async (
  stripe: Stripe,
  customerId: string,
): Promise<Stripe.Subscription | null> => {
  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
  });

  for (const subscription of subscriptions.data) {
    if (isBillableStatus(subscription.status)) {
      return subscription;
    }
  }

  return null;
};

export const createPortalSession = async (
  stripe: Stripe,
  customerId: string,
  returnUrl: string,
  userId: string,
): Promise<string> => {
  const idempotencyKey = await computeIdempotencyKey("portal", [userId, returnUrl]);
  const session = await stripe.billingPortal.sessions.create(
    {
      customer: customerId,
      return_url: returnUrl,
    },
    { idempotencyKey },
  );

  if (!session.url) {
    throw new Error("Portal session missing URL");
  }

  return session.url;
};

export const handleCheckoutRequest = async (
  request: Request,
  env: BillingEnv,
): Promise<Response> => {
  try {
    const payload = await parseRequestBody(request);
    const userId = validate(() => ensureUserId(payload.user_id));
    const email = normalizeEmail(payload.email);
    const priceId = validate(() =>
      ensurePriceId(
        payload.price_id,
        typeof env.PRICE_ID_MONTHLY === "string" ? env.PRICE_ID_MONTHLY : undefined,
      ),
    );
    const successUrl = validate(() => ensureUrl(payload.success_url, "success_url"));
    const cancelUrl = validate(() => ensureUrl(payload.cancel_url, "cancel_url"));

    const stripe = getStripeClient(env);
    const customer = await findOrCreateCustomer(stripe, userId, email);
    const billableSubscription = await findBillableSubscription(stripe, customer.id);

    if (billableSubscription) {
      const portalUrl = await createPortalSession(stripe, customer.id, successUrl, userId);
      const responseBody: BillingUrlResponse = { url: portalUrl };
      return jsonResponse(responseBody, { status: 200 });
    }

    const idempotencyKey = await computeIdempotencyKey("checkout", [
      userId,
      priceId,
      successUrl,
      cancelUrl,
    ]);

    const session = await stripe.checkout.sessions.create(
      {
        mode: "subscription",
        customer: customer.id,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        client_reference_id: userId,
        metadata: {
          user_id: userId,
        },
        subscription_data: {
          metadata: {
            user_id: userId,
          },
        },
      },
      { idempotencyKey },
    );

    if (!session.url) {
      throw new Error("Checkout session missing URL");
    }

    const responseBody: BillingUrlResponse = { url: session.url };
    return jsonResponse(responseBody, { status: 200 });
  } catch (error) {
    if (error instanceof RequestError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }

    console.error("Checkout handler failure", error);
    return jsonResponse({ error: "Internal server error" }, { status: 500 });
  }
};
