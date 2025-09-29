import type { KVNamespace } from "../kv";
import { getPublicKeyResponse } from "../lib/jwt";

interface LicensingEnv extends Record<string, unknown> {
  LICENSING_KV: KVNamespace;
  JWT_PRIVATE_KEY?: string;
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

export const handlePublicKeyRequest = async (
  _request: Request,
  env: LicensingEnv,
): Promise<Response> => {
  try {
    const body = await getPublicKeyResponse(env);
    return jsonResponse(body, { status: 200 });
  } catch (error) {
    return jsonResponse({ error: "signing_unavailable" }, { status: 500 });
  }
};
