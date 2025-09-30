import { TransferState } from "../kv";

export interface TransferEnvConfig extends Record<string, unknown> {
  TRANSFER_LINK_TTL_SECONDS?: number | string;
  DEEPLINK_SCHEME?: string;
  APP_DOWNLOAD_URL?: string;
}

const DEFAULT_TRANSFER_TTL_SECONDS = 15 * 60;
const DEFAULT_DEEPLINK_SCHEME = "atropos";
const DEFAULT_DOWNLOAD_URL = "https://atropos-video.com/download";

export const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
};

export const resolveTransferTtlSeconds = (env: TransferEnvConfig): number => {
  const raw = env.TRANSFER_LINK_TTL_SECONDS;

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(60, Math.floor(raw));
  }

  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number.parseInt(raw, 10);

    if (Number.isFinite(parsed)) {
      return Math.max(60, parsed);
    }
  }

  return DEFAULT_TRANSFER_TTL_SECONDS;
};

export const resolveDeepLinkScheme = (env: TransferEnvConfig): string => {
  const raw = typeof env.DEEPLINK_SCHEME === "string" ? env.DEEPLINK_SCHEME.trim() : "";
  return raw.length > 0 ? raw : DEFAULT_DEEPLINK_SCHEME;
};

export const resolveDownloadUrl = (env: TransferEnvConfig): string => {
  const raw = typeof env.APP_DOWNLOAD_URL === "string" ? env.APP_DOWNLOAD_URL.trim() : "";
  return raw.length > 0 ? raw : DEFAULT_DOWNLOAD_URL;
};

export const clearedTransferState = (): TransferState => ({
  pending: false,
  jti: null,
  exp: null,
  email: null,
  initiated_at: null,
});
