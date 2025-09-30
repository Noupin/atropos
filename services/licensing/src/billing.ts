import { getDeviceRecord, isEntitled, KVNamespace, TrialState } from "./kv";
import { resolveIdentity } from "./lib/identity";

interface BillingResponseBody {
  status: string | null;
  entitled: boolean;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  trial: TrialState | null;
  epoch: number;
  updated_at: number | null;
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

const isDevEnvironment = (env: Record<string, unknown>): boolean => {
  const candidates = [
    env?.ENVIRONMENT,
    env?.ENV,
    env?.WORKERS_ENV,
    env?.NODE_ENV,
  ]
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .filter((value) => value.length > 0);

  if (candidates.length === 0) {
    return false;
  }

  return candidates.some((value) => value === "dev" || value === "development");
};

export const handleSubscriptionRequest = async (
  request: Request,
  env: { LICENSING_KV: KVNamespace } & Record<string, unknown>,
): Promise<Response> => {
  const url = new URL(request.url);
  const deviceHashParam = url.searchParams.get("device_hash");
  const legacyUserId = url.searchParams.get("user_id");
  const forceRefresh = url.searchParams.get("force")?.toLowerCase() === "true";

  const identity = await resolveIdentity(env.LICENSING_KV, {
    deviceHash: deviceHashParam,
    legacyUserId,
  });

  if (!identity.deviceHash) {
    const body: Record<string, unknown> = { error: "device_hash_required", code: "device_hash_required" };
    if (!isDevEnvironment(env)) {
      delete body.code;
    }
    return jsonResponse(body, { status: 400 });
  }

  if (forceRefresh && !isDevEnvironment(env)) {
    return jsonResponse({ error: "force refresh is only available in dev" }, { status: 403 });
  }

  const record = identity.record ?? (await getDeviceRecord(env.LICENSING_KV, identity.deviceHash));

  if (!record) {
    return jsonResponse({ error: "subscription not found" }, { status: 404 });
  }

  const responseBody: BillingResponseBody = {
    status: record.status ?? null,
    entitled: isEntitled(record.status, record.current_period_end),
    current_period_end: record.current_period_end ?? null,
    cancel_at_period_end: Boolean(record.cancel_at_period_end),
    trial: record.trial,
    epoch: record.epoch ?? 0,
    updated_at: typeof record.updated_at === "number" ? record.updated_at : null,
  };

  return jsonResponse(responseBody, { status: 200 });
};
