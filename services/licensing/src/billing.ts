import { getUserRecord, isEntitled, KVNamespace, TrialState } from "./kv";

interface BillingResponseBody {
  status: string | null;
  entitled: boolean;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  trial: TrialState | null;
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
  const userId = url.searchParams.get("user_id");
  const forceRefresh = url.searchParams.get("force")?.toLowerCase() === "true";

  if (!userId) {
    return jsonResponse({ error: "user_id is required" }, { status: 400 });
  }

  if (forceRefresh && !isDevEnvironment(env)) {
    return jsonResponse({ error: "force refresh is only available in dev" }, { status: 403 });
  }

  const record = await getUserRecord(env.LICENSING_KV, userId);

  if (!record) {
    return jsonResponse({ error: "subscription not found" }, { status: 404 });
  }

  const responseBody: BillingResponseBody = {
    status: record.status ?? null,
    entitled: isEntitled(record.status, record.current_period_end),
    current_period_end: record.current_period_end ?? null,
    cancel_at_period_end: Boolean(record.cancel_at_period_end),
    trial: record.trial,
  };

  return jsonResponse(responseBody, { status: 200 });
};
