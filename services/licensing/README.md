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
| `/transfer/initiate` | `POST` | Creates a one-time transfer token for moving a device record to a new machine. |
| `/transfer/accept` | `POST` | Applies a valid transfer token to the requesting device, reassigning the device record. |
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

## Development vs production

| Mode | Host | Notes |
| --- | --- | --- |
| Dev | `https://licensing.dev.atropos.workers.dev` | Uses the development KV namespace. |
| Prod | `https://licensing.atropos.app` | Uses the production KV namespace. |

Set `VITE_LICENSE_API_BASE_URL` in the desktop `.env` to select the host. The worker reads `LICENSING_ENV` to bind to the correct KV namespace.

## Testing & deployment

- Run unit tests with `npm test` inside `services/licensing` (todo: add coverage harness).
- Use `wrangler dev` for local testing; provide mock secrets via `.dev.vars`.
- Deploy with `wrangler deploy --env dev` or `--env production` depending on the target workspace.
- Configure Stripe webhooks to point at:
  - Dev: `https://licensing.dev.atropos.workers.dev/webhooks/stripe`
  - Prod: `https://licensing.atropos.app/webhooks/stripe`
- The desktop app listens for the deep links `atropos://subscription/success` and `atropos://subscription/cancel` after checkout.
- Manual test flow:
  1. `curl https://licensing.dev.atropos.workers.dev/webhooks/diagnostics` to confirm routing.
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
