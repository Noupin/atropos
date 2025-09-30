import { applyCorsHeaders, createPreflightResponse, parseAllowedOrigins } from "./cors";

type RouteHandler = (
  request: Request,
  env: Record<string, unknown>,
  ctx: ExecutionContext,
) => Promise<Response> | Response;

interface RouteDefinition {
  method: string;
  path: string;
  handler: RouteHandler;
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

export class Router {
  private readonly routes: RouteDefinition[] = [];

  get(path: string, handler: RouteHandler): this {
    return this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): this {
    return this.add("POST", path, handler);
  }

  private add(method: string, path: string, handler: RouteHandler): this {
    this.routes.push({ method: method.toUpperCase(), path, handler });
    return this;
  }

  async handle(request: Request, env: Record<string, unknown>, ctx: ExecutionContext): Promise<Response> {
    const allowedOrigins = parseAllowedOrigins(env);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      const requestedMethod = request.headers.get("Access-Control-Request-Method")?.toUpperCase();

      if (!requestedMethod || requestedMethod === "GET" || requestedMethod === "POST") {
        return createPreflightResponse(request, allowedOrigins);
      }

      const methodNotAllowed = new Response(null, { status: 405 });
      methodNotAllowed.headers.set("Allow", "GET, POST, OPTIONS");
      return applyCorsHeaders(request, methodNotAllowed, allowedOrigins);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const route = this.routes.find((entry) => entry.method === method && entry.path === path);

    let response: Response;

    if (!route) {
      response = jsonResponse({ error: "Not found" }, { status: 404 });
    } else {
      try {
        const result = await route.handler(request, env, ctx);

        if (result instanceof Response) {
          response = result;
        } else {
          response = jsonResponse({ error: "internal_error" }, { status: 500 });
        }
      } catch (error) {
        console.error("Unhandled error while processing request", error);
        response = jsonResponse({ error: "internal_error" }, { status: 500 });
      }
    }

    return applyCorsHeaders(request, response, allowedOrigins);
  }
}

export const createRouter = (): Router => new Router();

