import Stripe from "stripe";
import { BillingEnv } from "./types";

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2023-10-16";

let cachedStripe: Stripe | null = null;
let cachedSecretKey: string | null = null;

const escapeSearchValue = (value: string): string => {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
};

export const getStripeClient = (env: BillingEnv): Stripe => {
  const secretKey = env.STRIPE_SECRET_KEY;

  if (!secretKey || typeof secretKey !== "string") {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  if (!cachedStripe || cachedSecretKey !== secretKey) {
    cachedStripe = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
      maxNetworkRetries: 2,
    });
    cachedSecretKey = secretKey;
  }

  return cachedStripe;
};

export const findCustomerByUserId = async (
  stripe: Stripe,
  userId: string,
): Promise<Stripe.Customer | null> => {
  const query = `metadata['user_id']:'${escapeSearchValue(userId)}'`;
  const result = await stripe.customers.search({ query, limit: 1 });

  if (!result.data.length) {
    return null;
  }

  const customer = result.data[0];

  if ((customer as Stripe.DeletedCustomer).deleted) {
    return null;
  }

  return customer as Stripe.Customer;
};

export const ensureCustomer = async (
  stripe: Stripe,
  userId: string,
  email?: string,
): Promise<Stripe.Customer> => {
  const existing = await findCustomerByUserId(stripe, userId);

  if (existing) {
    if (email && typeof email === "string" && email.length > 0 && existing.email !== email) {
      const updated = await stripe.customers.update(existing.id, {
        email,
        metadata: {
          ...existing.metadata,
          user_id: userId,
        },
      });

      return updated as Stripe.Customer;
    }

    if (!existing.metadata?.user_id) {
      await stripe.customers.update(existing.id, {
        metadata: {
          ...existing.metadata,
          user_id: userId,
        },
      });
    }

    return existing;
  }

  const created = await stripe.customers.create({
    email: email && typeof email === "string" && email.length > 0 ? email : undefined,
    metadata: { user_id: userId },
  });

  return created;
};
