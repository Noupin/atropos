import { getDeviceRecord, isEntitled, KVNamespace, TransferState, UserRecord } from "../kv";
import { mutateDeviceRecord } from "../kv/user";
import { getSigningMaterial, verifyJwt } from "../lib/jwt";
import { EmailDeliveryError, sendEmail } from "../email/sender";
import { createTransferEmailTemplate } from "../email/templates";
import {
  clearedTransferState,
  jsonResponse,
  resolveDeepLinkScheme,
  resolveDownloadUrl,
  resolveTransferTtlSeconds,
  TransferEnvConfig,
} from "./common";

interface TransferInitiateEnv extends TransferEnvConfig {
  LICENSING_KV: KVNamespace;
  JWT_PRIVATE_KEY?: string;
  RESEND_API_KEY?: string;
}

interface LicenseClaims extends Record<string, unknown> {
  sub?: string;
  device_hash?: string | null;
  epoch?: number;
  exp?: number;
  tier?: string | null;
}

const extractBearerToken = (request: Request): string | null => {
  const header = request.headers.get("authorization");

  if (header) {
    const [scheme, ...rest] = header.split(" ");

    if (scheme && scheme.toLowerCase() === "bearer") {
      const token = rest.join(" ").trim();

      if (token.length > 0) {
        return token;
      }
    }
  }

  const url = new URL(request.url);
  const tokenParam = url.searchParams.get("token");

  if (tokenParam && tokenParam.trim().length > 0) {
    return tokenParam.trim();
  }

  return null;
};

const isPaidSubscription = (record: UserRecord): boolean => {
  const status = (record.status ?? "").toLowerCase();
  if (status === "active") {
    return true;
  }

  if (record.plan_price_id) {
    return true;
  }

  return false;
};

export const handleTransferInitiateRequest = async (
  request: Request,
  env: TransferInitiateEnv,
): Promise<Response> => {
  const token = extractBearerToken(request);

  if (!token) {
    return jsonResponse({ error: "missing_token" }, { status: 401 });
  }

  let claims: LicenseClaims;

  try {
    const material = await getSigningMaterial(env);
    const verification = await verifyJwt(token, material);
    claims = verification.payload as LicenseClaims;
  } catch (error) {
    return jsonResponse({ error: "invalid_token" }, { status: 401 });
  }

  if (!claims || typeof claims !== "object") {
    return jsonResponse({ error: "invalid_token" }, { status: 401 });
  }

  const subjectClaim = typeof claims.sub === "string" ? claims.sub.trim() : "";
  const claimedDeviceHash = typeof claims.device_hash === "string" ? claims.device_hash.trim() : "";
  const deviceHash = claimedDeviceHash || subjectClaim;

  if (!deviceHash) {
    return jsonResponse({ error: "invalid_subject" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  if (typeof claims.exp !== "number" || Number.isNaN(claims.exp) || claims.exp <= now) {
    return jsonResponse({ error: "token_expired" }, { status: 401 });
  }

  const record = await getDeviceRecord(env.LICENSING_KV, deviceHash);

  if (!record) {
    return jsonResponse({ error: "device_not_found" }, { status: 404 });
  }

  let jti: string | null = null;
  let expiresAt: number | null = null;
  let recipientEmail: string | null = null;
  let errorResponse: Response | null = null;

  const ttlSeconds = resolveTransferTtlSeconds(env);

  await mutateDeviceRecord(env.LICENSING_KV, deviceHash, ({ current, now: mutationNow }) => {
    if (!isEntitled(current.status, current.current_period_end)) {
      errorResponse = jsonResponse({ error: "not_entitled" }, { status: 403 });
      return null;
    }

    if (!isPaidSubscription(current)) {
      errorResponse = jsonResponse({ error: "subscription_required" }, { status: 403 });
      return null;
    }

    if (!current.device_hash || current.device_hash !== deviceHash) {
      errorResponse = jsonResponse({ error: "device_mismatch" }, { status: 409 });
      return null;
    }

    if (
      typeof current.epoch === "number" &&
      typeof claims.epoch === "number" &&
      current.epoch !== claims.epoch
    ) {
      errorResponse = jsonResponse({ error: "stale_epoch" }, { status: 409 });
      return null;
    }

    if (!current.email) {
      errorResponse = jsonResponse({ error: "email_not_found" }, { status: 400 });
      return null;
    }

    const existingTransfer = current.transfer;
    if (existingTransfer?.pending && typeof existingTransfer.exp === "number" && existingTransfer.exp > mutationNow) {
      errorResponse = jsonResponse({ error: "transfer_already_pending" }, { status: 409 });
      return null;
    }

    jti = crypto.randomUUID();
    expiresAt = mutationNow + ttlSeconds;
    recipientEmail = current.email;

    const transferState: TransferState = {
      pending: true,
      jti,
      exp: expiresAt,
      email: current.email,
      initiated_at: mutationNow,
    };

    return { transfer: transferState };
  });

  if (errorResponse) {
    return errorResponse;
  }

  if (!jti || !expiresAt || !recipientEmail) {
    return jsonResponse({ error: "transfer_initialization_failed" }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  const acceptUrl = `${origin}/transfer/accept?device_hash=${encodeURIComponent(deviceHash)}&token=${encodeURIComponent(jti)}`;
  const deepLinkScheme = resolveDeepLinkScheme(env);
  const deepLinkUrl = `${deepLinkScheme}://accept-transfer?device_hash=${encodeURIComponent(deviceHash)}&token=${encodeURIComponent(
    jti,
  )}`;
  const downloadUrl = resolveDownloadUrl(env);
  const { subject, html, text } = createTransferEmailTemplate({
    acceptUrl,
    deepLinkUrl,
    downloadUrl,
    expiresInMinutes: Math.max(1, Math.round(ttlSeconds / 60)),
  });

  try {
    await sendEmail(env, {
      to: recipientEmail,
      subject,
      html,
      text,
    });
  } catch (error) {
    console.error("Failed to send transfer email", error);
    await mutateDeviceRecord(env.LICENSING_KV, deviceHash, () => ({ transfer: clearedTransferState() }));

    const status = error instanceof EmailDeliveryError ? 502 : 500;
    const detail = error instanceof EmailDeliveryError ? error.message : "email_failed";
    return jsonResponse({ error: "transfer_email_failed", detail }, { status });
  }

  return jsonResponse(
    {
      transfer: {
        status: "pending",
        expires_at: expiresAt,
      },
    },
    { status: 200 },
  );
};
