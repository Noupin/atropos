# Desktop Client

Atropos desktop is an Electron + Vite application that orchestrates local video processing and surfaces licensing status fetched from the Cloudflare Worker.

## Environment variables

Create a `.env` file in `desktop/` or export variables before running:

| Variable                    | Purpose                                     | Dev default                                  | Production guidance                                                                |
| --------------------------- | ------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`         | Base URL for Python services                | `http://127.0.0.1:8787` (FastAPI dev server) | Set to hosted API (`https://api.atropos.dev`/`.com`). Never ship with `localhost`. |
| `VITE_LICENSE_API_BASE_URL` | Licensing worker host                       | `https://licensing.dev.atropos.workers.dev`  | Use production worker host.                                                        |
| `VITE_BACKEND_MODE`         | `api` (default) or `mock` for demo data     | `api`                                        | Leave unset in packaged builds.                                                    |
| `VITE_RELEASE_CHANNEL`      | `dev`, `beta`, or `stable` channel metadata | `dev`                                        | Set via CI during release pipelines.                                               |

The renderer and the access overlay both call the licensing service through the same helper in `src/renderer/src/services/licensing.ts`. Updating entitlement logic here automatically keeps the overlay badge and the UI snapshot in sync—do not fork this logic elsewhere.

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

#### Build flow

To build the desktop client for release, follow this step-by-step process:

1. **Type check:** Run the type checker to catch TypeScript errors before building.
   ```bash
   npm run type-check
   ```
2. **Build:** Compile the renderer and main process.
   ```bash
   npm run build
   ```
3. **Platform-specific build:** Package the app for your target platform.
   ```bash
   npm run build:mac
   # or
   npm run build:win
   # or
   npm run build:linux
   ```
4. **Fix errors as needed:** If you encounter errors at any step, fix them and repeat the process from step 1.

## Updating app icons

**Note:** All commands below should be run from the `desktop/` folder of the repo.

### Windows (.ico)

**Generate `build/icon.ico` from `favicon.png`:**

```bash
magick favicon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

### Cross-platform (.png)

**Generate `build/icon.png` (512x512) from `favicon.png`:**

```bash
sips -z 512 512 favicon.png --out build/icon.png
```

### macOS (.icns)

**Generate `build/icon.icns` for macOS:**

```bash
mkdir -p build/icon.iconset
sips -z 16 16     favicon.png --out build/icon.iconset/icon_16x16.png
sips -z 32 32     favicon.png --out build/icon.iconset/icon_16x16@2x.png
sips -z 32 32     favicon.png --out build/icon.iconset/icon_32x32.png
sips -z 64 64     favicon.png --out build/icon.iconset/icon_32x32@2x.png
sips -z 128 128   favicon.png --out build/icon.iconset/icon_128x128.png
sips -z 256 256   favicon.png --out build/icon.iconset/icon_128x128@2x.png
sips -z 256 256   favicon.png --out build/icon.iconset/icon_256x256.png
sips -z 512 512   favicon.png --out build/icon.iconset/icon_256x256@2x.png
sips -z 512 512   favicon.png --out build/icon.iconset/icon_512x512.png
cp build/icon.png build/icon.iconset/icon_512x512@2x.png
iconutil -c icns build/icon.iconset -o build/icon.icns
```

## Adding new UI modules

- Create new pages under `src/renderer/src/pages/FeatureName/` and export a route component.
- Place shared UI primitives in `src/renderer/src/components/` and hooks in `src/renderer/src/hooks/`.
- Add service adapters under `src/renderer/src/services/featureName.ts` that encapsulate API calls. Reuse the entitlement helpers from `licensing.ts` for access gating.
- When introducing cross-cutting state, create a dedicated store module (e.g., `src/renderer/src/stores/featureName.ts`) instead of expanding existing stores beyond a single responsibility.

## Access overlay

The access overlay widget (the badge that reflects entitlement status) reads from the same licensing snapshot used by the renderer. If you introduce new access control states:

1. Extend `src/renderer/src/services/licensing.ts` to expose the new status.
2. Update the overlay component under `src/renderer/src/components/AccessOverlay` to render it.
3. Add tests or storybook stories alongside the component.

Avoid duplicating entitlement fetches or caching logic elsewhere.
