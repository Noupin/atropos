const DEFAULT_ALLOW_ORIGINS = ["*"];
const DEFAULT_ALLOW_METHODS = ["GET", "POST", "OPTIONS"];
const DEFAULT_ALLOW_HEADERS = ["Content-Type", "Authorization"];

const parseCsv = (value: string): string[] => {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export const parseAllowedOrigins = (
  env: Record<string, unknown>,
): string[] => {
  const raw = typeof env?.CORS_ALLOW_ORIGINS === "string" ? env.CORS_ALLOW_ORIGINS : "";
  const parsed = parseCsv(raw);

  if (parsed.length === 0) {
    return [...DEFAULT_ALLOW_ORIGINS];
  }

  return Array.from(new Set(parsed));
};

const resolveAllowedOrigin = (request: Request, allowedOrigins: string[]): string => {
  const origin = request.headers.get("Origin");

  if (allowedOrigins.includes("*")) {
    if (origin) {
      return origin;
    }
    return "*";
  }

  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }

  return allowedOrigins[0] ?? (origin ?? "*");
};

const ensureVaryIncludesOrigin = (headers: Headers, allowOrigin: string): void => {
  if (allowOrigin === "*") {
    return;
  }

  const varyHeader = headers.get("Vary");

  if (!varyHeader) {
    headers.set("Vary", "Origin");
    return;
  }

  const varyValues = varyHeader
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  if (!varyValues.includes("origin")) {
    headers.set("Vary", `${varyHeader}, Origin`);
  }
};

export const applyCorsHeaders = (
  request: Request,
  response: Response,
  allowedOrigins: string[],
): Response => {
  const headers = response.headers;
  const allowOrigin = resolveAllowedOrigin(request, allowedOrigins);
  const requestedHeaders = request.headers.get("Access-Control-Request-Headers");

  headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set("Access-Control-Allow-Methods", DEFAULT_ALLOW_METHODS.join(","));

  if (requestedHeaders) {
    headers.set("Access-Control-Allow-Headers", requestedHeaders);
  } else if (!headers.has("Access-Control-Allow-Headers")) {
    headers.set("Access-Control-Allow-Headers", DEFAULT_ALLOW_HEADERS.join(","));
  }

  ensureVaryIncludesOrigin(headers, allowOrigin);

  return response;
};

export const createPreflightResponse = (
  request: Request,
  allowedOrigins: string[],
): Response => {
  const response = new Response(null, { status: 204 });
  response.headers.set("Access-Control-Max-Age", "86400");
  return applyCorsHeaders(request, response, allowedOrigins);
};

