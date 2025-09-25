export interface Env {
  USERS_KV: KVNamespace;
  TRANSFERS_KV: KVNamespace;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  JWT_PRIVATE_KEYS: string;
  JWT_ACTIVE_KID: string;
  PRICE_ID_MONTHLY: string;
  STRIPE_PORTAL_CONFIGURATION_ID?: string;
  EMAIL_SERVICE_URL?: string;
  EMAIL_SERVICE_API_KEY?: string;
  EMAIL_FROM?: string;
  TIER?: string;
  RETURN_URL_SUCCESS?: string;
  RETURN_URL_CANCEL?: string;
  CORS_ALLOW_ORIGINS?: string;
}

export interface RequestContext {
  requestId: string;
}
