export interface BillingEnv {
  STRIPE_SECRET_KEY?: string;
  PRICE_ID_MONTHLY?: string;
  BILLING_SUCCESS_URL?: string;
  BILLING_CANCEL_URL?: string;
}

export interface CheckoutRequestBody {
  device_hash?: unknown;
  user_id?: unknown;
  email?: unknown;
  price_id?: unknown;
  success_url?: unknown;
  cancel_url?: unknown;
}

export interface CheckoutResponseBody {
  url: string;
  type: "portal" | "checkout";
}

export interface PortalRequestBody {
  device_hash?: unknown;
  user_id?: unknown;
  return_url?: unknown;
}

export interface PortalResponseBody {
  url: string;
}
