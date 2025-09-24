# Licensing Worker

Cloudflare Worker powering the Atropos licensing API. It handles Stripe billing
flow, updates user entitlements in Cloudflare KV, and issues short-lived
Ed25519 JWTs for the desktop client.

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Stripe CLI (for local webhook forwarding)

Install dependencies once:

```bash
cd services/licensing
npm install
```

## Configuration

All secrets are managed via Wrangler and are **not** stored in Git or Terraform
state.

Set the required secrets for each environment:

```bash
# Repeat for each environment (omit --env for production)
wrangler secret put STRIPE_SECRET_KEY --env dev
wrangler secret put STRIPE_WEBHOOK_SECRET --env dev
wrangler secret put JWT_PRIVATE_KEY --env dev
```

> `JWT_PRIVATE_KEY` should be a base64 (URL-safe) encoded 32-byte Ed25519 secret
> seed. The helper below prints the matching public key.

Non-secret variables such as `PRICE_ID_MONTHLY`, `TIER`, and optional return
URLs are defined in `wrangler.toml`. Update the per-environment overrides once
Terraform has provisioned the KV namespace IDs.

## Deploying

The Worker uses the script name `licensing-api` for both environments.

```bash
# Preview deployment (uses Wrangler's dev environment)
wrangler deploy --env dev --dry-run

# Publish to development (api.atropos-video.com route must already exist)
wrangler deploy --env dev

# Publish to production
wrangler deploy --env prod
```

Ensure the `LICENSING_KV` namespace binding in `wrangler.toml` matches the
`kv_namespace_id` output from Terraform (for each environment).

## Stripe Webhooks

Use the Stripe CLI to forward webhook events to the Worker during development.

```bash
stripe login
stripe listen --forward-to http://localhost:8787/billing/webhook
```

When using `wrangler dev`, Stripe should target the local dev server:

```bash
wrangler dev --env dev
```

## Deriving the public key

Generate the Ed25519 public key that your Python verifier will use:

```bash
npm run derive-public-key -- <base64-private-key>
# or read from the JWT_PRIVATE_KEY environment variable
JWT_PRIVATE_KEY=... npm run derive-public-key
```

The command prints the base64url-encoded public key.

## Verifying JWTs in Python

The desktop Python helper can validate tokens issued by the Worker using the
public key derived above.

```python
import base64
import json
import time
from nacl.signing import VerifyKey

PUBLIC_KEY_B64URL = "<paste-from-helper>"

verify_key = VerifyKey(base64.urlsafe_b64decode(PUBLIC_KEY_B64URL + "=="))

def decode_jwt(token: str) -> dict:
    header_b64, payload_b64, signature_b64 = token.split(".")
    message = f"{header_b64}.{payload_b64}".encode()
    signature = base64.urlsafe_b64decode(signature_b64 + "==")
    verify_key.verify(message, signature)
    payload = json.loads(base64.urlsafe_b64decode(payload_b64 + "==").decode())
    if payload["exp"] <= int(time.time()):
        raise RuntimeError("License expired")
    return payload
```

Handle storage/revocation of JTIs on the client side as needed.
