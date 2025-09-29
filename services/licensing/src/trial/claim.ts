import { isEntitled, KVNamespace, TrialState } from "../kv";
import { mutateUserRecord } from "../kv/user";
import { encodeTrialToken, generateTrialJti, TrialTokenPayload } from "./token";

interface TrialClaimRequestBody {
  user_id?: unknown;
  device_hash?: unknown;
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

export const handleTrialClaimRequest = async (
  request: Request,
  env: TrialEnv,
): Promise<Response> => {
  let body: TrialClaimRequestBody;

  try {
    body = (await request.json()) as TrialClaimRequestBody;
  } catch (error) {
    return jsonResponse(
      { error: "invalid_request", detail: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const deviceHash = typeof body.device_hash === "string" ? body.device_hash.trim() : "";

  if (!userId || !deviceHash) {
    return jsonResponse(
      { error: "invalid_request", detail: "user_id and device_hash are required" },
      { status: 400 },
    );
  }

  if (!env.LICENSING_KV) {
    return jsonResponse({ error: "kv_unavailable" }, { status: 500 });
  }

  let tokenPayload: TrialTokenPayload | null = null;
  let errorResponse: Response | null = null;

  const record = await mutateUserRecord(env.LICENSING_KV, userId, ({ current, now }) => {
    if (isEntitled(current.status, current.current_period_end)) {
      errorResponse = jsonResponse({ error: "already_entitled" }, { status: 409 });
      return null;
    }

    const trial = current.trial;
    if (!trial) {
      errorResponse = jsonResponse({ error: "trial_not_started" }, { status: 400 });
      return null;
    }

    if (trial.allowed <= 0) {
      errorResponse = jsonResponse({ error: "trial_not_allowed" }, { status: 403 });
      return null;
    }

    if (trial.remaining <= 0) {
      errorResponse = jsonResponse({ error: "trial_exhausted" }, { status: 403 });
      return null;
    }

    if (trial.device_hash && trial.device_hash !== deviceHash) {
      errorResponse = jsonResponse({ error: "device_conflict" }, { status: 409 });
      return null;
    }

    const jti = generateTrialJti();
    const exp = now + 15 * 60;

    tokenPayload = { trial: true, jti, exp };

    const nextTrial: TrialState = {
      ...trial,
      device_hash: trial.device_hash ?? deviceHash,
      started: trial.started ?? now,
      jti,
      exp,
    };

    return { trial: nextTrial };
  });

  if (errorResponse) {
    return errorResponse;
  }

  if (!record.trial || !tokenPayload) {
    return jsonResponse({ error: "trial_claim_failed" }, { status: 500 });
  }

  const token = encodeTrialToken(tokenPayload);

  return jsonResponse(
    {
      token,
      exp: tokenPayload.exp,
      jti: tokenPayload.jti,
      trial: {
        remaining: record.trial.remaining,
        total: record.trial.total,
      },
    },
    { status: 200 },
  );
};
