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
import { handleTransferInitiateRequest } from "./transfer/initiate";
import { handleTransferAcceptView } from "./transfer/accept";
import { handleTransferCompleteRequest } from "./transfer/complete";
import { createRouter } from "./http/router";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
};

const router = createRouter();

router.get("/health", () => jsonResponse({ status: "ok" }, { status: 200 }));
router.get("/billing/subscription", handleSubscriptionRequest);
router.post("/billing/checkout", handleCheckoutRequest);
router.post("/billing/portal", handlePortalRequest);
router.post("/billing/webhook", handleWebhookRequest);
router.post("/license/issue", handleIssueRequest);
router.get("/license/validate", handleValidateRequest);
router.get("/license/public-key", handlePublicKeyRequest);
router.post("/trial/start", handleTrialStartRequest);
router.post("/trial/claim", handleTrialClaimRequest);
router.post("/trial/consume", handleTrialConsumeRequest);
router.post("/transfer/initiate", handleTransferInitiateRequest);
router.get("/transfer/accept", handleTransferAcceptView);
router.post("/transfer/accept", handleTransferCompleteRequest);

export default {
  async fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    return router.handle(request, env, ctx);
  },
};

