# Agent & Automation Playbook

## How to consume context

1. Start with [ARCHITECTURE.md](ARCHITECTURE.md) to understand the runtime boundaries and environment selection rules.
2. Drill into the service-level READMEs listed in the repository [README](../README.md) (desktop, server, licensing, infrastructure).
3. Review recent ADRs under [docs/ADRS](ADRS/) to confirm whether a decision affects your feature area.
4. Scan [CHANGELOG.md](../CHANGELOG.md) for recent operational changes that may alter defaults or workflows.

## File creation policy

- Create a **new file** whenever you add a route, endpoint, worker handler, UI page, provider integration, or adapter. Wire it into the appropriate index rather than expanding large files.
- When a file grows beyond a single responsibility (UI component plus service logic, router plus validation), split helpers into a sibling module and import them.
- Keep individual files under roughly 300–400 LOC. Prefer composing smaller helpers over editing monolithic modules.
- Colocate tests with the module they verify (e.g., `feature.ts` with `feature.test.ts`).

## Naming & locations

| Area | Directory | Naming notes |
| --- | --- | --- |
| Desktop renderer services | `desktop/src/renderer/src/services/` | Use camelCase filenames that describe the capability (`licensing.ts`, `device.ts`). |
| Desktop UI components | `desktop/src/renderer/src/components/` or `.../pages/` | Components PascalCase; hooks live under `.../hooks/`. |
| Python FastAPI routers | `server/interfaces/<feature>.py` | Router modules snake_case; include a `router` object exported for inclusion. |
| Python services/helpers | `server/common/<topic>/` | Keep pure logic separate from I/O for easier testing. |
| Licensing worker routes | `services/licensing/src/routes/<feature>.ts` | Export `onRequest` handlers; register via central router. |
| Worker utilities | `services/licensing/src/lib/` | Suffix helpers with role (`jwt.ts`, `kv.ts`). |
| Infrastructure IaC | `infrastructure/terraform/`, `infrastructure/wrangler/` | Keep workspaces scoped by environment name (dev/prod). |

## Environment & URL rules

- Never hardcode `localhost` for APIs in shipping code. Desktop builds must rely on `VITE_*` env vars with sensible dev/prod defaults.
- Cloudflare Worker URLs resolve from `VITE_LICENSE_API_BASE_URL` (desktop) and `LICENSING_ENV` (worker). Respect the mapping table in [ARCHITECTURE.md](ARCHITECTURE.md).
- Stripe keys and webhook secrets are environment-specific; use the env loader modules documented in service READMEs.
- Prefer adapter modules that read configuration once and export typed helpers to the rest of the layer.

## Safety rails

- Do **not** modify billing logic, entitlement checks, or trial math without explicit direction and an ADR update.
- Keep Ed25519 key handling confined to the dedicated helpers (`services/licensing/src/lib/jwt.ts`, `server/common/security/jwt.py`).
- New features should add adapters instead of bypassing existing access control or license verification.
- Use feature flags or configuration toggles when rolling out behavioral changes; avoid altering defaults silently.

## Canonical sources & before-you-change checklist

| Topic | Check this file first |
| --- | --- |
| Trial storage schema | `services/licensing/src/lib/kv.ts` |
| License JWT shape | `services/licensing/src/lib/jwt.ts` and `server/common/security/jwt.py` |
| Billing + Stripe flows | `services/licensing/src/lib/stripe.ts` |
| Desktop entitlement caching | `desktop/src/renderer/src/services/licensing.ts` |
| Device fingerprint logic | `desktop/src/renderer/src/services/device.ts` |
| Upload orchestration | `server/pipeline.py` and `server/interfaces/jobs.py` |

## Operational guardrails

- Favor small, tightly scoped PRs. If a change spans multiple domains, split work into sequential PRs per area.
- Update ADRs when decisions affect APIs, security posture, or environment handling.
- Document new environment variables in both the relevant README and `docs/ARCHITECTURE.md`.
- When uncertain, leave notes in the PR description and flag the appropriate CODEOWNER for guidance.
