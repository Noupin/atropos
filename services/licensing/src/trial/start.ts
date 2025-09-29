import { isEntitled, KVNamespace, TrialState } from "../kv";
import { mutateUserRecord } from "../kv/user";

interface TrialStartRequestBody {
  user_id?: unknown;
  device_hash?: unknown;
}

interface TrialEnv extends Record<string, unknown> {
  LICENSING_KV: KVNamespace;
  TRIAL_MAX_PER_DEVICE?: string | number;
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

const resolveTrialAllowance = (env: TrialEnv, current: TrialState | null): number => {
  if (current && typeof current.allowed === "number") {
    return Math.max(0, current.allowed);
  }

  const raw = env.TRIAL_MAX_PER_DEVICE;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.floor(raw));
  }

  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }

  return 3;
};

export const handleTrialStartRequest = async (
  request: Request,
  env: TrialEnv,
): Promise<Response> => {
  let body: TrialStartRequestBody;

  try {
    body = (await request.json()) as TrialStartRequestBody;
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

  let errorResponse: Response | null = null;

  const record = await mutateUserRecord(env.LICENSING_KV, userId, ({ current, now }) => {
    if (isEntitled(current.status, current.current_period_end)) {
      errorResponse = jsonResponse({ error: "already_entitled" }, { status: 409 });
      return null;
    }

    const allowance = resolveTrialAllowance(env, current.trial);
    if (allowance <= 0) {
      errorResponse = jsonResponse({ error: "trial_not_allowed" }, { status: 403 });
      return null;
    }

    const existingTrial = current.trial;
    if (existingTrial?.device_hash && existingTrial.device_hash !== deviceHash) {
      errorResponse = jsonResponse({ error: "device_conflict" }, { status: 409 });
      return null;
    }

    const started = existingTrial?.started ?? now;
    const total = Math.max(existingTrial?.total ?? allowance, allowance);
    const remaining = Math.max(0, Math.min(total, existingTrial?.remaining ?? total));

    const nextTrial: TrialState = {
      allowed: allowance,
      total,
      remaining,
      started,
      used_at: existingTrial?.used_at ?? null,
      device_hash: existingTrial?.device_hash ?? deviceHash,
      jti: null,
      exp: null,
    };

    return { trial: nextTrial };
  });

  if (errorResponse) {
    return errorResponse;
  }

  if (!record.trial) {
    return jsonResponse({ error: "trial_initialization_failed" }, { status: 500 });
  }

  return jsonResponse(
    {
      trial: {
        allowed: record.trial.allowed,
        total: record.trial.total,
        remaining: record.trial.remaining,
        started: record.trial.started,
        device_hash: record.trial.device_hash,
      },
    },
    { status: 200 },
  );
};
