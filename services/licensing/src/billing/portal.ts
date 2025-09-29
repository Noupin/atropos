import { getStripeClient } from "./client";
import { createPortalSession, findOrCreateCustomer } from "./checkout";
import { BillingEnv, BillingUrlResponse, PortalRequestBody, ensureUrl, ensureUserId } from "./types";

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

const parseRequestBody = async (request: Request): Promise<PortalRequestBody> => {
  try {
    const payload = (await request.json()) as PortalRequestBody;
    return payload;
  } catch (error) {
    throw new RequestError("Invalid JSON body", 400);
  }
};

export const handlePortalRequest = async (
  request: Request,
  env: BillingEnv,
): Promise<Response> => {
  try {
    const payload = await parseRequestBody(request);
    const userId = validate(() => ensureUserId(payload.user_id));
    const returnUrl = validate(() => ensureUrl(payload.return_url, "return_url"));

    const stripe = getStripeClient(env);
    const customer = await findOrCreateCustomer(stripe, userId);
    const portalUrl = await createPortalSession(stripe, customer.id, returnUrl, userId);

    const responseBody: BillingUrlResponse = { url: portalUrl };
    return jsonResponse(responseBody, { status: 200 });
  } catch (error) {
    if (error instanceof RequestError) {
      return jsonResponse({ error: error.message }, { status: error.status });
    }

    console.error("Portal handler failure", error);
    return jsonResponse({ error: "Internal server error" }, { status: 500 });
  }
};
