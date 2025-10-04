# Desktop Client

Atropos desktop is an Electron + Vite application that orchestrates local video processing and surfaces licensing status fetched from the Cloudflare Worker.

## Environment variables

Create a `.env` file in `desktop/` or export variables before running:

| Variable | Purpose | Dev default | Production guidance |
| --- | --- | --- | --- |
| `VITE_API_BASE_URL` | Base URL for Python services | `http://127.0.0.1:8787` (FastAPI dev server) | Set to hosted API (`https://api.atropos.dev`/`.com`). Never ship with `localhost`. |
| `VITE_LICENSE_API_BASE_URL` | Licensing worker host | `https://licensing.dev.atropos.workers.dev` | Use production worker host. |
| `VITE_BACKEND_MODE` | `api` (default) or `mock` for demo data | `api` | Leave unset in packaged builds. |
| `VITE_RELEASE_CHANNEL` | `dev`, `beta`, or `stable` channel metadata | `dev` | Set via CI during release pipelines. |

The renderer and the global access store both call the licensing service through the helpers in `src/renderer/src/services/accessApi.ts`, which are consumed by `src/renderer/src/providers/AccessProvider.tsx`. Updating entitlement logic there automatically keeps the badge, navigation state, and gated routes in sync—do not fork this logic elsewhere.

## Project setup

```bash
npm install
```

### Development

Start the renderer with hot reload and the Electron main process:

```bash
npm run dev
```

Ensure the Python FastAPI service is running on the host specified by `VITE_API_BASE_URL`. Refer to [server/README.md](../server/README.md) for details.

### Building packages

Use platform-specific build scripts:

```bash
npm run build:mac
npm run build:win
npm run build:linux
```

CI injects the correct `VITE_*` values for production builds. Manual builds should export the same variables to avoid falling back to localhost.

## Adding new UI modules

- Create new pages under `src/renderer/src/pages/FeatureName/` and export a route component.
- Place shared UI primitives in `src/renderer/src/components/` and hooks in `src/renderer/src/hooks/`.
- Add service adapters under `src/renderer/src/services/featureName.ts` that encapsulate API calls. Reuse the entitlement helpers from `licensing.ts` for access gating.
- When introducing cross-cutting state, create a dedicated store module (e.g., `src/renderer/src/stores/featureName.ts`) instead of expanding existing stores beyond a single responsibility.

## Access indicator

The access badge pinned in the header and the gated route wrapper derive their state from `AccessProvider`. If you introduce new access control states:

1. Extend `src/renderer/src/services/accessApi.ts` and `src/renderer/src/providers/AccessProvider.tsx` with the new fields.
2. Update the badge (`src/renderer/src/components/AccessBadge.tsx`) and gate (`src/renderer/src/components/AccessGate.tsx`) to display the state.
3. Add tests or storybook stories alongside the new UI states.

Avoid duplicating licensing fetches or caching logic outside of the provider.
