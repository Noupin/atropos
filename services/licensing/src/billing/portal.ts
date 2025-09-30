import Stripe from "stripe";
import { ensureCustomer, getStripeClient } from "./client";
import { resolveIdentity } from "../lib/identity";
import type { KVNamespace } from "../kv";
import { BillingEnv, PortalRequestBody, PortalResponseBody } from "./types";

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

const buildIdempotencyKey = (request: Request, deviceHash: string): string => {
  return request.headers.get("Idempotency-Key") ?? `portal:${deviceHash}:${crypto.randomUUID()}`;
};

const normalizeErrorDetails = (error: unknown): Record<string, string> => {
  const details: Record<string, string> = {};

  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    details.code = (error as { code: string }).code;
  }

  details.name = error instanceof Error ? error.name : "unknown_error";

  return details;
};

export const createPortalSession = async (
  stripe: Stripe,
  params: { customerId: string; returnUrl?: string; idempotencyKey: string },
): Promise<Stripe.BillingPortal.Session> => {
  const session = await stripe.billingPortal.sessions.create(
    {
      customer: params.customerId,
      return_url: params.returnUrl,
    },
    { idempotencyKey: params.idempotencyKey },
  );

  return session;
};

export const handlePortalRequest = async (
  request: Request,
  env: BillingEnv & { LICENSING_KV: KVNamespace },
): Promise<Response> => {
  let payload: PortalRequestBody;

  try {
    payload = (await request.json()) as PortalRequestBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, { status: 400 });
  }

  const identity = await resolveIdentity(env.LICENSING_KV, {
    deviceHash: payload.device_hash,
    legacyUserId: payload.user_id,
  });

  if (!identity.deviceHash) {
    return jsonResponse({ error: "device_hash_required" }, { status: 400 });
  }

  try {
    const stripe = getStripeClient(env);
    const customer = await ensureCustomer(stripe, {
      deviceHash: identity.deviceHash,
      legacyUserId: identity.legacyUserId,
      existingCustomerId: identity.record?.stripe_customer_id ?? null,
    });
    const returnUrl = isNonEmptyString(payload.return_url) ? payload.return_url : undefined;
    const idempotencyKey = buildIdempotencyKey(request, identity.deviceHash);

    const session = await createPortalSession(stripe, {
      customerId: customer.id,
      returnUrl,
      idempotencyKey,
    });

    if (!session.url) {
      return jsonResponse({ error: "session_url_missing" }, { status: 502 });
    }

    const responseBody: PortalResponseBody = {
      url: session.url,
    };

    return jsonResponse(responseBody, { status: 200 });
  } catch (error) {
    console.error("billing_portal_error", normalizeErrorDetails(error));
    return jsonResponse({ error: "internal_error" }, { status: 500 });
  }
};
