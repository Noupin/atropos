import { isEntitled, KVNamespace } from "../kv";
import { mutateDeviceRecord } from "../kv/user";
import { resolveIdentity } from "../lib/identity";
import { decodeTrialToken, TrialTokenPayload } from "./token";

interface TrialConsumeRequestBody {
  user_id?: unknown;
  device_hash?: unknown;
  token?: unknown;
}

interface TrialEnv extends Record<string, unknown> {
  LICENSING_KV: KVNamespace;
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

export const handleTrialConsumeRequest = async (
  request: Request,
  env: TrialEnv,
): Promise<Response> => {
  let body: TrialConsumeRequestBody;

  try {
    body = (await request.json()) as TrialConsumeRequestBody;
  } catch (error) {
    return jsonResponse(
      { error: "invalid_request", detail: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";

  if (!env.LICENSING_KV) {
    return jsonResponse({ error: "kv_unavailable" }, { status: 500 });
  }

  const identity = await resolveIdentity(env.LICENSING_KV, {
    deviceHash: body.device_hash,
    legacyUserId: body.user_id,
  });

  if (!identity.deviceHash || !token) {
    return jsonResponse(
      { error: "invalid_request", detail: "device_hash and token are required" },
      { status: 400 },
    );
  }

  let payload: TrialTokenPayload;

  try {
    payload = decodeTrialToken(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_token";
    return jsonResponse({ error: message }, { status: 400 });
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return jsonResponse({ error: "token_expired" }, { status: 400 });
  }

  let errorResponse: Response | null = null;

  const record = await mutateDeviceRecord(
    env.LICENSING_KV,
    identity.deviceHash,
    ({ current, now }) => {
      if (isEntitled(current.status, current.current_period_end)) {
        errorResponse = jsonResponse({ error: "already_entitled" }, { status: 409 });
        return null;
      }

      const trial = current.trial;
      if (!trial) {
        errorResponse = jsonResponse({ error: "trial_not_started" }, { status: 400 });
        return null;
      }

      if (trial.device_hash && trial.device_hash !== identity.deviceHash) {
        errorResponse = jsonResponse({ error: "device_conflict" }, { status: 409 });
        return null;
      }

      if (!trial.jti || trial.jti !== payload.jti) {
        errorResponse = jsonResponse({ error: "invalid_token" }, { status: 400 });
        return null;
      }

      if (!trial.exp || trial.exp !== payload.exp) {
        errorResponse = jsonResponse({ error: "invalid_token" }, { status: 400 });
        return null;
      }

      if (trial.exp <= now) {
        errorResponse = jsonResponse({ error: "token_expired" }, { status: 400 });
        return null;
      }

      if (trial.remaining <= 0) {
        errorResponse = jsonResponse({ error: "trial_exhausted" }, { status: 403 });
        return null;
      }

      const remaining = Math.max(0, trial.remaining - 1);

      return {
        trial: {
          ...trial,
          device_hash: trial.device_hash ?? identity.deviceHash,
          remaining,
          used_at: now,
          jti: null,
          exp: null,
        },
      };
    },
    { legacyUserId: identity.legacyUserId ?? undefined },
  );

  if (errorResponse) {
    return errorResponse;
  }

  if (!record.trial) {
    return jsonResponse({ error: "trial_consume_failed" }, { status: 500 });
  }

  return jsonResponse(
    {
      trial: {
        remaining: record.trial.remaining,
        total: record.trial.total,
        used_at: record.trial.used_at,
      },
    },
    { status: 200 },
  );
};
