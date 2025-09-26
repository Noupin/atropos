import { RequestContext } from "./env";

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function jsonResponse<T>(
  data: T,
  status = 200,
  headers: HeadersInit = {},
): Response {
  const body = JSON.stringify(data);
  return new Response(body, {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function errorResponse(
  error: unknown,
  context: RequestContext,
  corsHeaders?: HeadersInit,
): Response {
  if (error instanceof HttpError) {
    console.warn(`[${context.requestId}] ${error.code}: ${error.message}`);
    return jsonResponse<ErrorBody>(
      {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      error.status,
      corsHeaders,
    );
  }

  console.error(`[${context.requestId}] unexpected error`, error);
  return jsonResponse<ErrorBody>(
    {
      error: {
        code: "internal_error",
        message: "Unexpected server error",
      },
    },
    500,
    corsHeaders,
  );
}

export function ensureJson<T>(body: unknown, schema: (data: unknown) => data is T): T {
  if (!schema(body)) {
    throw new HttpError(400, "invalid_request", "Malformed request body");
  }
  return body;
}

export function baseCorsHeaders(
  origin: string | null,
  allowedOrigins: string[],
): HeadersInit {
  const allowedOrigin = resolveAllowedOrigin(origin, allowedOrigins);
  return createCorsHeaders(allowedOrigin);
}

export function corsPreflightResponse(
  origin: string | null,
  allowedOrigins: string[],
): Response {
  try {
    const allowedOrigin = resolveAllowedOrigin(origin, allowedOrigins);
    const headers: Record<string, string> = {
      ...createCorsHeaders(allowedOrigin),
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    return new Response(null, {
      status: 204,
      headers,
    });
  } catch (error) {
    if (error instanceof HttpError) {
      const headers: Record<string, string> = {
        ...fallbackCorsHeaders(origin, allowedOrigins),
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
      };

      return new Response(null, { status: error.status, headers });
    }

    throw error;
  }
}

function resolveAllowedOrigin(
  origin: string | null,
  allowedOrigins: string[],
): string {
  const normalizedOrigin = origin?.trim() ?? null;
  const allowAllOrigins = allowedOrigins.includes("*");

  if (allowAllOrigins) {
    return "*";
  }

  if (normalizedOrigin && allowedOrigins.includes(normalizedOrigin)) {
    return normalizedOrigin;
  }

  if (!normalizedOrigin) {
    return allowedOrigins[0] ?? "*";
  }

  throw new HttpError(403, "forbidden_origin", "Origin is not allowed");
}

function createCorsHeaders(allowedOrigin: string): HeadersInit {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allowedOrigin,
    Vary: "Origin",
  };

  if (allowedOrigin !== "*") {
    headers["Access-Control-Allow-Credentials"] = "true";
  }

  return headers;
}

export function fallbackCorsHeaders(
  origin: string | null,
  allowedOrigins: string[],
): HeadersInit {
  const allowAllOrigins = allowedOrigins.includes("*");

  if (allowAllOrigins) {
    return createCorsHeaders("*");
  }

  if (origin && allowedOrigins.includes(origin)) {
    return createCorsHeaders(origin);
  }

  return createCorsHeaders(allowedOrigins[0] ?? "*");
}
