import { handleSubscriptionRequest } from "./billing";
import { handleCheckoutRequest } from "./billing/checkout";
import { handlePortalRequest } from "./billing/portal";
import { handleWebhookRequest } from "./billing/webhook";
import { handleIssueRequest } from "./license/issue";
import { handleValidateRequest } from "./license/validate";
import { handlePublicKeyRequest } from "./license/keys";
import { handleTrialStartRequest } from "./trial/start";
import { handleTrialClaimRequest } from "./trial/claim";
import { handleTrialConsumeRequest } from "./trial/consume";

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

    if (path === "/billing/webhook" && request.method === "POST") {
      return handleWebhookRequest(request, env);
    }

    if (path === "/license/issue" && request.method === "POST") {
      return handleIssueRequest(request, env);
    }

    if (path === "/license/validate" && request.method === "GET") {
      return handleValidateRequest(request, env);
    }

    if (path === "/license/public-key" && request.method === "GET") {
      return handlePublicKeyRequest(request, env);
    }

    if (path === "/trial/start" && request.method === "POST") {
      return handleTrialStartRequest(request, env);
    }

    if (path === "/trial/claim" && request.method === "POST") {
      return handleTrialClaimRequest(request, env);
    }

    if (path === "/trial/consume" && request.method === "POST") {
      return handleTrialConsumeRequest(request, env);
    }

    return jsonResponse({ error: "Not found" }, { status: 404 });
  },
};
