# Licensing Worker

The licensing service is a Cloudflare Worker that tracks device trials and coordinates license transfers between machines.

## Endpoints

| Path | Method | Description |
| --- | --- | --- |
| `/health` | `GET` | Simple health check endpoint. |
| `/trial/status` | `GET` | Returns trial usage details for the provided `device_hash`. |
| `/trial/start` | `POST` | Initializes a trial record for a device if one does not exist. |
| `/trial/consume` | `POST` | Consumes one trial run for the device and returns the updated quota. |
| `/transfer/initiate` | `POST` | Creates a one-time transfer token for moving a device record to a new machine. |
| `/transfer/accept` | `POST` | Applies a valid transfer token to the requesting device, reassigning the trial record. |

## Environment variables & secrets

Configure secrets via `wrangler secret` or environment variables in CI:

- `LICENSING_ENV` (`dev` or `prod`)
- `LICENSING_KV` (Workers KV namespace binding for trial and transfer records)

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
