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
  const allowAllOrigins = allowedOrigins.includes("*");

  if (!origin) {
    return {};
  }

  if (allowAllOrigins || allowedOrigins.includes(origin)) {
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
    } satisfies HeadersInit;
  }

  throw new HttpError(403, "forbidden_origin", "Origin is not allowed");
}

export function corsPreflightResponse(
  origin: string | null,
  allowedOrigins: string[],
): Response {
  const allowAllOrigins = allowedOrigins.includes("*");

  if (!origin) {
    if (allowAllOrigins) {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers":
            "content-type,authorization,idempotency-key",
          "access-control-max-age": "600",
        },
      });
    }

    return new Response(null, { status: 403 });
  }

  if (allowAllOrigins || allowedOrigins.includes(origin)) {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers":
          "content-type,authorization,idempotency-key",
        "access-control-max-age": "600",
      },
    });
  }

  return new Response(null, { status: 403 });
}
