# Architecture Overview

Atropos is composed of three cooperating runtimes:

1. **Electron desktop** (Vite + React renderer, Electron main process) that operators install locally.
2. **Python orchestration services** that the desktop process shells into for video ingestion, rendering, and distribution tasks.
3. **Licensing & billing surface** built on a Cloudflare Worker backed by Workers KV and Stripe for subscription and entitlement management.

## System interactions

```
+-------------+         IPC/HTTP         +----------------+         HTTPS         +-------------------+
| Desktop UI  | <----------------------> | Python services | <------------------> | Cloudflare Worker |
| (Electron)  |                         |  (FastAPI + CLI)|                     |  (KV + Stripe)    |
+-------------+                         +----------------+                     +---------+---------+
        |                                                                              |
        |                                                                        Stripe API
        |                                                                              |
        +---------------------------------------------------+--------------------------+
                                                            |
                                                      Workers KV (license/trial state)
```

- The desktop renderer issues authenticated HTTP calls to the local FastAPI endpoints exposed by `server/app.py` and runs CLI helpers for bulk upload flows.
- The Python services request entitlements from the licensing worker before unlocking uploads; they pass device fingerprints and license keys obtained by the desktop app.
- The Cloudflare Worker signs and validates device entitlements, synchronizes subscription status with Stripe, and persists lightweight state in Workers KV.

## Responsibilities

| Layer | Responsibilities | Key artifacts |
| --- | --- | --- |
| Desktop UI | Auth UX, device fingerprinting, job orchestration UI, streaming progress | `desktop/src/main`, `desktop/src/renderer`, `desktop/src/renderer/src/providers/AccessProvider.tsx` |
| Python services | Media normalization, upload scheduling, provider integrations, websocket progress | `server/app.py`, `server/common`, `server/integrations` |
| Licensing worker | Key management, license validation, entitlement issuance, billing webhooks | `services/licensing/src`, `services/licensing/wrangler.toml`, `infrastructure/terraform` |
| Infrastructure | Provision Workers KV, secret rotation, Stripe webhook endpoints, release automation | `infrastructure/terraform`, `infrastructure/wrangler`, GitHub Actions |

## Data flow & configuration

1. Desktop obtains configuration from `VITE_*` env vars at build/start time. `VITE_API_BASE_URL` and `VITE_LICENSE_API_BASE_URL` choose between dev/prod hosts. Never default to `localhost` in packaged builds—use the host mapping rules below.
2. Desktop requests job creation via local FastAPI (`server/app.py`). The FastAPI app honors `ENVIRONMENT` to select credentials and remote dependencies.
3. Before uploads, desktop calls `/license/verify` on the Cloudflare Worker using the device fingerprint and license token. The worker checks Workers KV for the device record and Stripe for subscription status.
4. The worker issues a signed JWT (Ed25519) representing entitlement scope and expiration, which the desktop caches in memory and persists to secure storage.
5. Python services validate the JWT via shared public keys before processing, ensuring expired or revoked entitlements are denied.

### Environment selection

- `VITE_API_BASE_URL` → Desktop → Python HTTP target (default dev: `http://127.0.0.1:8787`, packaged: `https://api.atropos.dev`/`.com`).
- `VITE_LICENSE_API_BASE_URL` → Desktop → Cloudflare Worker host (dev: `https://licensing.dev.atropos.workers.dev`, prod: `https://licensing.atropos.app`).
- `VITE_SUBSCRIPTION_URL` → Desktop → External purchase or billing portal link surfaced when access lapses.
- `SERVER_ENV` / `ENVIRONMENT` → Python services → selects credentials in `server/config.py` and toggles webhook hosts.
- `LICENSING_ENV` → Worker → selects Stripe keys and KV namespace bindings.
- `CLOUDFLARE_ACCOUNT_ID` → Deployment tooling → populates Wrangler's `account_id` placeholder so `wrangler deploy --env <env>` resolves the correct Cloudflare account.

### Cloudflare worker environments

- We deploy two fully isolated Cloudflare Worker stacks managed via Wrangler environments ([docs](https://developers.cloudflare.com/workers/platform/environments/)).
  - `license-api` (prod) handles `api.atropos-video.com/*` requests and binds to the production KV namespace, secrets, DNS records, and route configuration.
  - `license-api-dev` (dev) serves `dev.api.atropos-video.com/*` with its own KV namespace, secrets, DNS records, and route configuration.
- Wrangler automatically appends the environment suffix to the worker name (e.g., `license-api-dev`) when deploying with `--env`, so each environment publishes a separate worker instance and route ([routes docs](https://developers.cloudflare.com/workers/configuration/routes/)).

## Layering guidelines

- Keep UI orchestration in renderer service modules that call into adapters under `desktop/src/renderer/src/services`. Heavy logic should move to new modules rather than expanding component files.
- Python services should expose thin FastAPI routers per concern (`server/interfaces/*`). When adding a new route, create a new router module and include it in the main app.
- Worker handlers should live in `services/licensing/src/routes/<feature>.ts`. Compose shared utilities under `services/licensing/src/lib` instead of extending the entrypoint.

## Extending the system

- Create **new files** for features that add new endpoints, providers, or adapters. Only touch existing files to keep wiring thin.
- Prefer adding a module in the right layer (UI → service proxy → Python endpoint → worker) instead of skipping layers.
- Record any change that alters inter-service contracts or environment resolution rules as an ADR under `docs/ADRS`.
- When a feature crosses layers, stage the work in multiple PRs, each focusing on a single layer, to keep reviews bounded.

## When to add new modules vs extend

| Scenario | Action |
| --- | --- |
| Introducing a new licensing capability (e.g., gifting) | Add a new worker route module and a matching desktop service helper. Do not expand existing `index.ts` beyond wiring. |
| Adding a provider integration | Add a module under `server/integrations/<provider>.py` and register it in a lightweight orchestrator file. |
| Extending UI panels | Create a component per panel under `desktop/src/renderer/src/pages`. Keep hooks/services in separate files. |
| Modifying device fingerprinting | Update the dedicated helper under `desktop/src/renderer/src/services/device.ts` and document in an ADR. |

By following these boundaries the repository stays modular, predictable, and safe for automated agents to evolve.
