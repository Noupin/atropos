import { getDeviceRecord, isEntitled, KVNamespace, UserRecord } from "../kv";
import { mutateDeviceRecord } from "../kv/user";
import { resolveIdentity } from "../lib/identity";
import { getSigningMaterial, signJwt } from "../lib/jwt";

interface LicensingEnv extends Record<string, unknown> {
  LICENSING_KV: KVNamespace;
  JWT_PRIVATE_KEY?: string;
}

interface IssueRequestBody {
  user_id?: unknown;
  device_hash?: unknown;
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

export const handleIssueRequest = async (
  request: Request,
  env: LicensingEnv,
): Promise<Response> => {
  let body: IssueRequestBody;

  try {
    body = (await request.json()) as IssueRequestBody;
  } catch (error) {
    return jsonResponse({ error: "invalid_request", detail: "Body must be valid JSON" }, { status: 400 });
  }

  const identity = await resolveIdentity(env.LICENSING_KV, {
    deviceHash: body.device_hash,
    legacyUserId: body.user_id,
  });

  if (!identity.deviceHash) {
    return jsonResponse({ error: "invalid_request", detail: "device_hash is required" }, { status: 400 });
  }

  const existingRecord = identity.record ?? (await getDeviceRecord(env.LICENSING_KV, identity.deviceHash));

  if (!existingRecord) {
    return jsonResponse({ error: "device_not_found" }, { status: 404 });
  }

  let deviceMismatch = false;

  const record = await mutateDeviceRecord(
    env.LICENSING_KV,
    identity.deviceHash,
    ({ current }) => {
      if (current.device_hash && current.device_hash !== identity.deviceHash) {
        deviceMismatch = true;
        return null;
      }

      if (!current.device_hash) {
        return { device_hash: identity.deviceHash };
      }

      return null;
    },
    { legacyUserId: identity.legacyUserId ?? undefined },
  );

  if (deviceMismatch) {
    return jsonResponse({ error: "device_conflict", detail: "license already bound to another device" }, { status: 409 });
  }

  if (!isEntitled(record.status, record.current_period_end)) {
    return jsonResponse({ error: "not_entitled" }, { status: 403 });
  }

  if (!record.device_hash) {
    return jsonResponse({ error: "device_binding_failed" }, { status: 500 });
  }

  let material: Awaited<ReturnType<typeof getSigningMaterial>>;

  try {
    material = await getSigningMaterial(env);
  } catch (error) {
    return jsonResponse({ error: "signing_unavailable" }, { status: 500 });
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 15 * 60;
  const payload = {
    sub: identity.deviceHash,
    email: record.email,
    tier: determineTier(record),
    device_hash: record.device_hash,
    epoch: record.epoch ?? 0,
    iat: issuedAt,
    exp: expiresAt,
  };

  let token: string;

  try {
    token = await signJwt(payload, material);
  } catch (error) {
    return jsonResponse({ error: "signing_failed" }, { status: 500 });
  }

  return jsonResponse(
    {
      token,
      issued_at: issuedAt,
      expires_at: expiresAt,
      epoch: payload.epoch,
      device_hash: payload.device_hash,
    },
    { status: 200 },
  );
};
