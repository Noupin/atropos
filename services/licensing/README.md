# Licensing Worker

The licensing service is a Cloudflare Worker that tracks device trials and coordinates license transfers between machines.

## Endpoints

| Path | Method | Description |
| --- | --- | --- |
| `/health` | `GET` | Simple health check endpoint. |
| `/trial/status` | `GET` | Returns trial usage details for the provided `device_hash`. |
| `/trial/start` | `POST` | Initializes a trial record for a device if one does not exist. |
| `/trial/consume` | `POST` | Consumes one trial run for the device and returns the updated quota. |
| `/subscription/status` | `GET` | Returns the combined subscription + trial access state for a device. |
| `/subscribe` | `POST` | Creates a Stripe Checkout session so the device can start a subscription. |
| `/portal` | `POST` | Creates a Stripe Billing Portal session so the subscriber can manage billing. |
| `/transfer/initiate` | `POST` | Creates a one-time transfer token and magic link for moving a device record to a new machine. |
| `/transfer/accept` | `POST` | Applies a valid transfer token to the requesting device, reassigning the device record. |
| `/transfer/cancel` | `POST` | Cancels a pending transfer so access remains with the original device. |
| `/billing/webhook` | `POST` | Primary Stripe webhook route used in production. |
| `/webhooks/stripe` | `POST` | Receives Stripe webhook notifications for checkout and subscription lifecycle events. |
| `/webhooks/diagnostics` | `GET` | Lightweight route to confirm webhook routing in each environment. |

## Environment variables & secrets

Configure secrets via `wrangler secret` or environment variables in CI:

- `LICENSING_ENV` (`dev` or `prod`)
- `LICENSING_KV` (Workers KV namespace binding for trial and transfer records)
- `STRIPE_SECRET_KEY` (Stripe API key for the workspace)
- `STRIPE_WEBHOOK_SECRET` (Signing secret for the configured webhook endpoint)
- `STRIPE_PRICE_ID` (Recurring price ID used for subscriptions)
- `SUBSCRIPTION_SUCCESS_URL` (Deep link invoked after a successful checkout)
- `SUBSCRIPTION_CANCEL_URL` (Deep link invoked when a checkout is cancelled)
- `TIER` (Text label advertised to clients; defaults to `pro` in Wrangler config)
- `CORS_ALLOW_ORIGINS` (Comma-delimited allow-list for frontend origins permitted to call the worker)

## Development vs production

| Mode | Host | Notes |
| --- | --- | --- |
| Dev | `https://dev.api.atropos-video.com` | Routes to the `license-api-dev` worker and the development KV namespace. |
| Prod | `https://api.atropos-video.com` | Routes to the `license-api` worker and the production KV namespace. |

Set `VITE_LICENSE_API_BASE_URL` in the desktop `.env` to select the host. The worker reads `LICENSING_ENV` to bind to the correct KV namespace.

## Stripe webhook configuration & diagnostics

Configure the Stripe dashboard with the following HTTPS endpoints (the worker accepts both paths in every environment):

- Dev primary: `https://dev.api.atropos-video.com/billing/webhook`
- Dev legacy: `https://dev.api.atropos-video.com/webhooks/stripe`
- Prod primary: `https://api.atropos-video.com/billing/webhook`
- Prod legacy: `https://api.atropos-video.com/webhooks/stripe`

Store the signing secrets with Wrangler:

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET --env dev
wrangler secret put STRIPE_WEBHOOK_SECRET --env production
```

Tail structured request logs during development to observe request IDs and routing:

```bash
wrangler tail --env dev
```

Quick diagnostics from any machine with curl:

```bash
# Confirm routing + CORS headers
curl -i https://dev.api.atropos-video.com/webhooks/diagnostics

# Verify webhook method guards (expects 400 stripe_signature_missing)
curl -i -X POST https://dev.api.atropos-video.com/billing/webhook \
  -H "Content-Type: application/json" \
  -d '{}'
```

The diagnostics endpoint returns `{ "ok": true, "routes": ["/billing/webhook", "/webhooks/stripe"] }` and the webhook POST emits a structured log containing the generated `requestId`.

## Testing & deployment

- Run unit tests with `npm test` inside `services/licensing` (todo: add coverage harness).
- Use `wrangler dev` for local testing; provide mock secrets via `.dev.vars`.
- Deploy with `wrangler deploy --env dev` or `--env production` depending on the target workspace.
- The desktop app listens for the deep links `atropos://subscription/success` and `atropos://subscription/cancel` after checkout.
- Manual test flow:
  1. `curl https://dev.api.atropos-video.com/webhooks/diagnostics` to confirm routing.
  2. Call `POST /subscribe` with a known `device_hash` and open the returned `checkoutUrl`.
  3. Complete the checkout in Stripe test mode and ensure `GET /subscription/status` reports `status: active` with the trial exhausted.
  4. Trigger `POST /portal`, cancel the subscription in the Stripe portal, and confirm subsequent status responses report `status: canceled` with access revoked.

## Curl examples

```bash
# Fetch trial status
curl "$VITE_LICENSE_API_BASE_URL/trial/status?device_hash=abc123"

# Start a trial for a new device
curl -X POST "$VITE_LICENSE_API_BASE_URL/trial/start" \
  -H "Content-Type: application/json" \
  -d '{"device_hash":"abc123"}'

# Consume one trial run
curl -X POST "$VITE_LICENSE_API_BASE_URL/trial/consume" \
  -H "Content-Type: application/json" \
  -d '{"device_hash":"abc123"}'

# Fetch subscription status summary
curl "$VITE_LICENSE_API_BASE_URL/subscription/status?device_hash=abc123"

# Start a subscription checkout session
curl -X POST "$VITE_LICENSE_API_BASE_URL/subscribe" \
  -H "Content-Type: application/json" \
  -d '{"device_hash":"abc123"}'

# Request the billing portal
curl -X POST "$VITE_LICENSE_API_BASE_URL/portal" \
  -H "Content-Type: application/json" \
  -d '{"device_hash":"abc123"}'

# Check webhook wiring
curl "$VITE_LICENSE_API_BASE_URL/webhooks/diagnostics"

# Initiate a transfer to another device
curl -X POST "$VITE_LICENSE_API_BASE_URL/transfer/initiate" \
  -H "Content-Type: application/json" \
  -d '{"device_hash":"abc123","email":"user@example.com"}'
```

## Related files

- Worker entrypoint: `services/licensing/src/index.ts`
- Subscription routes: `services/licensing/src/routes/subscription.ts`
- Stripe webhooks: `services/licensing/src/routes/webhooks.ts`
- Trial routes: `services/licensing/src/routes/trial.ts`
- Transfer routes: `services/licensing/src/routes/transfer.ts`
- Shared HTTP helpers: `services/licensing/src/lib/http.ts`
- Stripe helpers: `services/licensing/src/lib/stripe.ts`
- Logging utilities: `services/licensing/src/lib/log.ts`
- Request parsing helpers: `services/licensing/src/lib/request.ts`
- KV utilities: `services/licensing/src/lib/kv.ts`
