# Licensing Worker

The licensing service is a Cloudflare Worker that verifies device entitlements, manages trials, and synchronizes billing with Stripe.

## Endpoints

| Path | Method | Description |
| --- | --- | --- |
| `/license/verify` | `POST` | Validates a device + license token, returning a signed entitlement JWT. |
| `/license/issue` | `POST` | Issues a short-lived license token bound to a device fingerprint. |
| `/transfer/initiate` | `POST` | Starts a paid license transfer by emailing a one-time approval link. |
| `/transfer/accept` | `GET` | HTML shim that launches the desktop deep link for approving a transfer. |
| `/transfer/accept` | `POST` | Completes an approved transfer, rebinding the license to a new device. |
| `/trial/consume` | `POST` | Consumes one trial credit for a device and returns remaining quota. |
| `/billing/webhook` | `POST` | Stripe webhook endpoint that updates subscription status and KV state. |
| `/billing/portal` | `GET` | Generates a Stripe customer portal link for account management. |

## Environment variables & secrets

Configure secrets via `wrangler secret` or environment variables in CI:

- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET`
- `LICENSING_ENV` (`dev` or `prod`)
- `ED25519_PRIVATE_KEY` (base64-encoded seed used for signing entitlements)
- `KV_LICENSE_NAMESPACE` (Workers KV binding name)
- `TRIAL_MAX_PER_DEVICE` (default `3`)
- `CORS_ALLOW_ORIGINS` (comma-separated list of allowed origins for CORS responses; defaults to `*`)
- `RESEND_API_KEY` (Resend email API token used for transfer notifications)
- `APP_DOWNLOAD_URL` (desktop download URL surfaced in transfer shims and emails)
- `DEEPLINK_SCHEME` (custom deep link scheme for launching the desktop client; defaults to `atropos`)
- `TRANSFER_LINK_TTL_SECONDS` (lifetime for transfer approval links; defaults to 900 seconds)

## Development vs production

| Mode | Host | Notes |
| --- | --- | --- |
| Dev | `https://licensing.dev.atropos.workers.dev` | Uses test Stripe keys and a dev KV namespace. |
| Prod | `https://licensing.atropos.app` | Uses live Stripe keys and production KV namespace. |

Set `VITE_LICENSE_API_BASE_URL` in the desktop `.env` to select the host. The worker reads `LICENSING_ENV` to bind to the correct KV namespace and Stripe credentials.

## Testing & deployment

- Run unit tests with `npm test` inside `services/licensing` (todo: add coverage harness).
- Use `wrangler dev` for local testing; provide mock secrets via `.dev.vars`.
- Deploy with `wrangler deploy --env dev` or `--env production` depending on the target workspace.

## Curl examples

```bash
# Verify a license and retrieve entitlement JWT
curl -X POST "$VITE_LICENSE_API_BASE_URL/license/verify" \
  -H "Content-Type: application/json" \
  -d '{"deviceFingerprint":"abc123","licenseKey":"LIC-XXXX"}'

# Consume a trial credit
curl -X POST "$VITE_LICENSE_API_BASE_URL/trial/consume" \
  -H "Content-Type: application/json" \
  -d '{"deviceFingerprint":"abc123"}'
```

## Related files

- Worker routes: `services/licensing/src/routes`
- Stripe helpers: `services/licensing/src/lib/stripe.ts`
- KV utilities: `services/licensing/src/lib/kv.ts`
- JWT signing: `services/licensing/src/lib/jwt.ts`
