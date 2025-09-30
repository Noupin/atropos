import { isEntitled, KVNamespace, UserRecord } from "../kv";
import { mutateUserRecord } from "../kv/user";
import { getSigningMaterial, signJwt } from "../lib/jwt";
import { clearedTransferState, jsonResponse, TransferEnvConfig } from "./common";

interface TransferCompleteEnv extends TransferEnvConfig {
  LICENSING_KV: KVNamespace;
  JWT_PRIVATE_KEY?: string;
}

interface TransferCompleteRequestBody {
  user_id?: unknown;
  token?: unknown;
  device_hash?: unknown;
}

const determineTier = (record: UserRecord): string => {
  if (record.plan_price_id) {
    return record.plan_price_id;
  }

  const status = (record.status ?? "").toLowerCase();

  if (status === "trialing") {
    return "trial";
  }

  if (status === "active") {
    return "paid";
  }

  return "free";
};

export const handleTransferCompleteRequest = async (
  request: Request,
  env: TransferCompleteEnv,
): Promise<Response> => {
  let body: TransferCompleteRequestBody;

  try {
    body = (await request.json()) as TransferCompleteRequestBody;
  } catch (error) {
    return jsonResponse({ error: "invalid_request", detail: "Body must be valid JSON" }, { status: 400 });
  }

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const deviceHash = typeof body.device_hash === "string" ? body.device_hash.trim() : "";

  if (!userId || !token || !deviceHash) {
    return jsonResponse(
      { error: "invalid_request", detail: "user_id, token, and device_hash are required" },
      { status: 400 },
    );
  }

  let nextEpoch: number | null = null;
  let errorResponse: Response | null = null;

  const record = await mutateUserRecord(env.LICENSING_KV, userId, ({ current, now }) => {
    const transfer = current.transfer;

    if (!transfer?.pending) {
      errorResponse = jsonResponse({ error: "transfer_not_pending" }, { status: 404 });
      return null;
    }

    if (!transfer.jti || transfer.jti !== token) {
      errorResponse = jsonResponse({ error: "transfer_token_invalid" }, { status: 403 });
      return null;
    }

    if (typeof transfer.exp !== "number" || transfer.exp <= now) {
      errorResponse = jsonResponse({ error: "transfer_token_expired" }, { status: 410 });
      return { transfer: clearedTransferState() };
    }

    if (!isEntitled(current.status, current.current_period_end)) {
      errorResponse = jsonResponse({ error: "not_entitled" }, { status: 403 });
      return { transfer: clearedTransferState() };
    }

    nextEpoch = (current.epoch ?? 0) + 1;

    return {
      device_hash: deviceHash,
      epoch: nextEpoch,
      transfer: clearedTransferState(),
    };
  });

  if (errorResponse) {
    return errorResponse;
  }

  if (!record || !record.device_hash || nextEpoch === null) {
    return jsonResponse({ error: "transfer_completion_failed" }, { status: 500 });
  }

  const now = Math.floor(Date.now() / 1000);
  const issuedAt = now;
  const expiresAt = issuedAt + 15 * 60;

  let material: Awaited<ReturnType<typeof getSigningMaterial>>;

  try {
    material = await getSigningMaterial(env);
  } catch (error) {
    return jsonResponse({ error: "signing_unavailable" }, { status: 500 });
  }

  const payload = {
    sub: userId,
    email: record.email,
    tier: determineTier(record),
    device_hash: record.device_hash,
    epoch: record.epoch ?? nextEpoch,
    iat: issuedAt,
    exp: expiresAt,
  };

  let signedToken: string;

  try {
    signedToken = await signJwt(payload, material);
  } catch (error) {
    return jsonResponse({ error: "signing_failed" }, { status: 500 });
  }

  return jsonResponse(
    {
      token: signedToken,
      issued_at: issuedAt,
      expires_at: expiresAt,
      epoch: payload.epoch,
      device_hash: payload.device_hash,
    },
    { status: 200 },
  );
};
