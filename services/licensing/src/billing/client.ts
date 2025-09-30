import Stripe from "stripe";
import { BillingEnv } from "./types";

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2023-10-16";

let cachedStripe: Stripe | null = null;
let cachedSecretKey: string | null = null;

const escapeSearchValue = (value: string): string => {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
};

const DEVICE_METADATA_KEY = "device_hash";
const LEGACY_USER_METADATA_KEY = "user_id";

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

const findCustomerByMetadata = async (
  stripe: Stripe,
  key: string,
  value: string,
): Promise<Stripe.Customer | null> => {
  const query = `metadata['${key}']:'${escapeSearchValue(value)}'`;
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

export const findCustomerByDeviceHash = async (
  stripe: Stripe,
  deviceHash: string,
): Promise<Stripe.Customer | null> => {
  return findCustomerByMetadata(stripe, DEVICE_METADATA_KEY, deviceHash);
};

export const findCustomerByLegacyUserId = async (
  stripe: Stripe,
  userId: string,
): Promise<Stripe.Customer | null> => {
  return findCustomerByMetadata(stripe, LEGACY_USER_METADATA_KEY, userId);
};

export const ensureCustomer = async (
  stripe: Stripe,
  options: { deviceHash: string; email?: string; legacyUserId?: string | null; existingCustomerId?: string | null },
): Promise<Stripe.Customer> => {
  const { deviceHash, email, legacyUserId, existingCustomerId } = options;

  if (existingCustomerId) {
    const existing = await stripe.customers.retrieve(existingCustomerId);
    if (!(existing as Stripe.DeletedCustomer).deleted) {
      return existing as Stripe.Customer;
    }
  }

  let customer = await findCustomerByDeviceHash(stripe, deviceHash);

  if (!customer && legacyUserId) {
    customer = await findCustomerByLegacyUserId(stripe, legacyUserId);
  }

  if (customer) {
    const metadata = {
      ...customer.metadata,
      [DEVICE_METADATA_KEY]: deviceHash,
    };

    if (legacyUserId) {
      metadata[LEGACY_USER_METADATA_KEY] = legacyUserId;
    }

    if (email && typeof email === "string" && email.length > 0 && customer.email !== email) {
      const updated = await stripe.customers.update(customer.id, {
        email,
        metadata,
      });
      return updated as Stripe.Customer;
    }

    const needsMetadataUpdate =
      customer.metadata?.[DEVICE_METADATA_KEY] !== deviceHash ||
      (legacyUserId && customer.metadata?.[LEGACY_USER_METADATA_KEY] !== legacyUserId);

    if (needsMetadataUpdate) {
      await stripe.customers.update(customer.id, { metadata });
    }

    return customer;
  }

  const created = await stripe.customers.create({
    email: email && typeof email === "string" && email.length > 0 ? email : undefined,
    metadata: {
      [DEVICE_METADATA_KEY]: deviceHash,
      ...(legacyUserId ? { [LEGACY_USER_METADATA_KEY]: legacyUserId } : {}),
    },
  });

  return created;
};
