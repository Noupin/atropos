export interface Env {
  LICENSING_KV: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_PRIVATE_KEY: string;
  PRICE_ID_MONTHLY: string;
  TIER?: string;
  STRIPE_PORTAL_CONFIGURATION_ID?: string;
  RETURN_URL_SUCCESS?: string;
  RETURN_URL_CANCEL?: string;
  CORS_ALLOW_ORIGINS?: string;
}

export interface RequestContext {
  requestId: string;
}
