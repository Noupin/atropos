# Licensing Worker

The licensing service is a Cloudflare Worker that verifies device entitlements, manages trials, and synchronizes billing with Stripe.

## Endpoints

| Path | Method | Description |
| --- | --- | --- |
| `/health` | `GET` | Returns `{ "status": "ok" }` for monitoring and readiness checks. |
| `/billing/subscription` | `GET` | Reads the cached subscription snapshot from KV, including entitlement state, epoch, and `updated_at`. |
| `/billing/checkout` | `POST` | Creates a Stripe Checkout session (or returns the portal URL if already billable). |
| `/billing/portal` | `POST` | Creates a Stripe billing-portal session for the given user. |
| `/billing/webhook` | `POST` | Stripe webhook receiver that keeps the KV subscription snapshot authoritative. |
| `/license/issue` | `POST` | Issues a short-lived Ed25519 JWT bound to a device hash for entitled users. |
| `/license/validate` | `GET` | Validates a Worker-issued license token and returns the embedded claims. |
| `/license/public-key` | `GET` | Returns the Ed25519 public JWK used to verify issued license tokens. |
| `/trial/start` | `POST` | Starts an automatic trial for an eligible user/device pair. |
| `/trial/claim` | `POST` | Issues a single-use trial claim token for manual redemption. |
| `/trial/consume` | `POST` | Consumes a claimed trial token and decrements remaining allowance. |
| `/transfer/initiate` | `POST` | Begins a paid license transfer and emails the recipient a deep link. |
| `/transfer/accept` | `GET` | HTML shim that launches the desktop client to approve a pending transfer. |
| `/transfer/accept` | `POST` | Completes a transfer, rebinds the device hash, bumps the epoch, and returns a fresh paid token. |

## How Desktop integrates

The Electron desktop app uses the Worker as the single source of truth for billing, trials, and license issuance. The flow is:

1. **Startup** – `accessStore` loads the configured `user_id`/`device_hash` and calls `GET /billing/subscription`.
2. **License acquisition** – When the subscription response reports `entitled: true`, the app immediately calls `POST /license/issue` to mint a 10–15 minute Ed25519 JWT. The Python localhost API receives that token on every request.
3. **Token refresh** – If the issued JWT expires or the localhost API responds with `401`, the desktop client automatically re-issues via `POST /license/issue`. The `epoch` returned by `/billing/subscription` ensures stale tokens are discarded after billing changes.
4. **Trials** – When no active subscription exists, the desktop client can start or claim trials via `/trial/start`, `/trial/claim`, and `/trial/consume` before running local pipelines.
5. **Transfers** – Approving a transfer deep link triggers `POST /transfer/accept` with the new device hash and returns a fresh paid token for continued use.

All other Stripe, email, and KV interactions remain inside the Worker under `services/licensing/src/**`.

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

Executable snippets for every endpoint live under [`services/licensing/scripts/`](scripts/). Set `BASE_URL=https://dev.api.atropos-video.com` (or another host) and run the desired script, e.g. `./scripts/get-billing-subscription.sh USER_ID=user_123`.

## Related files

- Worker routes: `services/licensing/src/routes`
- Stripe helpers: `services/licensing/src/lib/stripe.ts`
- KV utilities: `services/licensing/src/lib/kv.ts`
- JWT signing: `services/licensing/src/lib/jwt.ts`
