# Licensing Worker

The licensing service is a Cloudflare Worker that tracks device trials, manages per-device Stripe subscriptions, and coordinates license transfers between machines.

## Endpoints

| Path | Method | Description |
| --- | --- | --- |
| `/health` | `GET` | Simple health check endpoint. |
| `/trial/status` | `GET` | Returns trial usage details for the provided `device_hash`. |
| `/trial/start` | `POST` | Initializes a trial record for a device if one does not exist. |
| `/trial/consume` | `POST` | Consumes one trial run for the device and returns the updated quota. |
| `/subscribe` | `POST` | Creates (or reuses) a Stripe customer for the device and returns a Checkout Session for the configured subscription price. |
| `/portal` | `POST` | Creates a Stripe billing portal session so the device owner can manage their subscription. |
| `/subscription/status` | `GET` | Returns combined subscription + trial access state for the provided `device_hash`. |
| `/webhooks/stripe` | `POST` | Receives Stripe webhook events to update subscription status. |
| `/transfer/initiate` | `POST` | Creates a one-time transfer token for moving a device record to a new machine. |
| `/transfer/accept` | `POST` | Applies a valid transfer token to the requesting device, reassigning the trial record. |

## Environment variables & secrets

Configure the following secrets via `wrangler secret` or environment variables in CI:

- `LICENSING_ENV` (`dev` or `prod`)
- `LICENSING_KV` (Workers KV namespace binding for trial and transfer records)
- `STRIPE_SECRET_KEY` (Stripe API key for the environment)
- `STRIPE_PRICE_ID` (Recurring price used for subscriptions)
- `STRIPE_WEBHOOK_SECRET` (Signing secret for `/webhooks/stripe`)

Non-sensitive configuration such as deep links can live in `wrangler.toml` under `[vars]`/`[env.*.vars]`:

- `SUBSCRIPTION_SUCCESS_URL` (Desktop deep link the Checkout session redirects to on success)
- `SUBSCRIPTION_CANCEL_URL` (Desktop deep link for cancelled Checkout sessions)
- `SUBSCRIPTION_PORTAL_RETURN_URL` (Return URL for the billing portal, typically another deep link)

The repository defaults point these URLs at `atropos://subscription/*` so Stripe sends the user back into the Electron app after payment flows complete.

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

# Start a subscription checkout for a device
curl -X POST "$VITE_LICENSE_API_BASE_URL/subscribe" \
  -H "Content-Type: application/json" \
  -d '{"device_hash":"abc123"}'

# Open the Stripe billing portal for an existing subscriber
curl -X POST "$VITE_LICENSE_API_BASE_URL/portal" \
  -H "Content-Type: application/json" \
  -d '{"device_hash":"abc123"}'

# Initiate a transfer to another device
curl -X POST "$VITE_LICENSE_API_BASE_URL/transfer/initiate" \
  -H "Content-Type: application/json" \
  -d '{"device_hash":"abc123","email":"user@example.com"}'
```

## Related files

- Worker entrypoint: `services/licensing/src/index.ts`
- Trial routes: `services/licensing/src/routes/trial.ts`
- Transfer routes: `services/licensing/src/routes/transfer.ts`
- Shared HTTP helpers: `services/licensing/src/lib/http.ts`
- KV utilities: `services/licensing/src/lib/kv.ts`
- Stripe helpers & webhook processing: `services/licensing/src/lib/stripe.ts`, `services/licensing/src/routes/subscription.ts`, `services/licensing/src/routes/webhooks/stripe.ts`
