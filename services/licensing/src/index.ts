import { handleSubscriptionRequest } from "./billing";
import { handleCheckoutRequest } from "./billing/checkout";
import { handlePortalRequest } from "./billing/portal";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
};

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return jsonResponse({ status: "ok" }, { status: 200 });
    }

    if (path === "/billing/subscription" && request.method === "GET") {
      return handleSubscriptionRequest(request, env);
    }

    if (path === "/billing/checkout" && request.method === "POST") {
      return handleCheckoutRequest(request, env);
    }

    if (path === "/billing/portal" && request.method === "POST") {
      return handlePortalRequest(request, env);
    }

    // TODO: route other endpoints
    // e.g. if path.startsWith("/license") → license handler
    // else if path.startsWith("/trial") → trial handler
    // else return 404

    return jsonResponse({ error: "Not found" }, { status: 404 });
  },
};
