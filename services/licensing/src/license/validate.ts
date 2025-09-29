import { getUserRecord, isEntitled, KVNamespace, UserRecord } from "../kv";
import { getSigningMaterial, verifyJwt } from "../lib/jwt";

interface LicensingEnv extends Record<string, unknown> {
  LICENSING_KV: KVNamespace;
  JWT_PRIVATE_KEY?: string;
}

interface LicenseClaims extends Record<string, unknown> {
  sub?: string;
  email?: string | null;
  tier?: string | null;
  device_hash?: string | null;
  epoch?: number;
  iat?: number;
  exp?: number;
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

export const handleValidateRequest = async (
  request: Request,
  env: LicensingEnv,
): Promise<Response> => {
  const token = extractBearerToken(request);

  if (!token) {
    return jsonResponse({ valid: false, error: "missing_token" }, { status: 400 });
  }

  let claims: LicenseClaims;

  try {
    const material = await getSigningMaterial(env);
    const verification = await verifyJwt(token, material);
    claims = verification.payload as LicenseClaims;
  } catch (error) {
    return jsonResponse({ valid: false, error: "invalid_token" }, { status: 401 });
  }

  if (!claims || typeof claims !== "object") {
    return jsonResponse({ valid: false, error: "invalid_token" }, { status: 401 });
  }

  if (typeof claims.sub !== "string" || claims.sub.trim().length === 0) {
    return jsonResponse({ valid: false, error: "invalid_subject" }, { status: 400 });
  }

  const now = Math.floor(Date.now() / 1000);

  if (typeof claims.exp !== "number" || Number.isNaN(claims.exp) || claims.exp <= now) {
    return jsonResponse({ valid: false, error: "token_expired" }, { status: 401 });
  }

  const record = await getUserRecord(env.LICENSING_KV, claims.sub);

  if (!record) {
    return jsonResponse({ valid: false, error: "user_not_found" }, { status: 404 });
  }

  if (!isEntitled(record.status, record.current_period_end)) {
    return jsonResponse({ valid: false, error: "not_entitled" }, { status: 403 });
  }

  if (record.device_hash && record.device_hash !== claims.device_hash) {
    return jsonResponse({ valid: false, error: "device_mismatch" }, { status: 409 });
  }

  if (typeof record.epoch === "number" && typeof claims.epoch === "number" && record.epoch !== claims.epoch) {
    return jsonResponse({ valid: false, error: "stale_epoch" }, { status: 409 });
  }

  return jsonResponse(
    {
      valid: true,
      license: {
        sub: claims.sub,
        email: claims.email ?? record.email,
        tier: claims.tier ?? determineTier(record),
        device_hash: claims.device_hash ?? record.device_hash,
        epoch: claims.epoch ?? record.epoch,
        iat: claims.iat,
        exp: claims.exp,
      },
    },
    { status: 200 },
  );
};
