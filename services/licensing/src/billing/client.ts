import Stripe from "stripe";
import type { BillingEnv, StripeClient } from "./types";

const clients = new Map<string, StripeClient>();

export const getStripeClient = (env: BillingEnv): StripeClient => {
  const secretKey = typeof env.STRIPE_SECRET_KEY === "string" ? env.STRIPE_SECRET_KEY.trim() : "";

  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }

  const existing = clients.get(secretKey);
  if (existing) {
    return existing;
  }

  const stripe = new Stripe(secretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  clients.set(secretKey, stripe);
  return stripe;
};
