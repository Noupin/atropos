# Atropos

Atropos is a hybrid desktop + cloud platform for planning, rendering, and licensing short-form video workflows backed by automated billing and entitlement enforcement. The repository hosts the Electron desktop client, the Python orchestration services, and the Cloudflare Worker stack that keeps licensing and subscription state in sync.

## Orientation

- 📐 [System architecture](docs/ARCHITECTURE.md)
- 🤖 [Agent and automation playbook](docs/AGENTS.md)
- 🧭 [Contribution guidelines](CONTRIBUTING.md)
- 📜 [Architecture decision records](docs/ADRS)
- 🗒️ [Changelog](CHANGELOG.md)

## Run modes

The platform combines a local-first desktop experience with remote licensing. The following entry points explain how to configure each layer:

- **Development:** Start the Electron/Vite desktop app with the dev API hosts described in [desktop/README.md](desktop/README.md). The desktop app invokes the local Python services documented in [server/README.md](server/README.md) for orchestration. Licensing calls target the dev Cloudflare Worker per [services/licensing/README.md](services/licensing/README.md).
- **Production:** Build the packaged desktop app using the release workflow in [desktop/README.md](desktop/README.md). Production builds resolve API hosts via the environment selection rules in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and rely on the infrastructure process in [infrastructure/README.md](infrastructure/README.md).

## Surface map

| Area | Description | Local README |
| --- | --- | --- |
| Desktop client | Electron + Vite UI used by operators | [desktop/README.md](desktop/README.md) |
| Python services | Orchestration, upload, and automation scripts | [server/README.md](server/README.md) |
| Licensing worker | Cloudflare Worker + Stripe-backed entitlement APIs | [services/licensing/README.md](services/licensing/README.md) |
| Infrastructure | Terraform, Wrangler, and deployment automation | [infrastructure/README.md](infrastructure/README.md) |

For additional background on historical workflows, see [server/README.md](server/README.md) which incorporates the earlier bulk upload guide.

## Marketing site hero metrics

The static marketing site under [`web/`](web/) renders follower and subscriber counts through the Python API in [`api/`](api/). The pipeline supports official APIs with a server-side scraping fallback and exposes three endpoints:

- `GET /api/social/config` — returns the configured handles per platform and the client-facing enable flags.
- `GET /api/social/stats?platform=<yt|ig|tt|fb>&handles=<comma-separated>` — returns per-account results, totals, and the active data source.
- `GET /api/social/overview` — aggregates enabled platforms and includes a grand-total audience count.

### Configuration & feature flags

- `SOCIAL_HANDLES` — optional JSON object overriding the default handle list per platform. Example:
  ```json
  {
    "youtube": ["ExampleChannel"],
    "instagram": ["example.ig"],
    "tiktok": [],
    "facebook": []
  }
  ```
- `ENABLE_SOCIAL_PLATFORMS` — optional JSON object toggling platform visibility on the web surface (default: YouTube/Instagram enabled, TikTok/Facebook hidden).

### Data sources & fallbacks

- `ENABLE_SOCIAL_APIS` — master switch for first-party API integrations (default: `false`).
- `ENABLE_YT_API`, `ENABLE_IG_API`, `ENABLE_TT_API`, `ENABLE_FB_API` — per-platform API toggles.
- `YOUTUBE_API_KEY` — API key for the YouTube Data API v3 (`ENABLE_YT_API` must be enabled).
- `INSTAGRAM_ACCESS_TOKEN` — long-lived token for the Instagram Graph API.
- `INSTAGRAM_ID_MAP` — optional JSON mapping of Instagram handles to Graph API user IDs.
- `FACEBOOK_ACCESS_TOKEN` — token for the Facebook Graph API.
- `FACEBOOK_ID_MAP` — optional JSON mapping of Facebook page slugs to numeric page IDs.
- `ENABLE_SOCIAL_SCRAPER` — enables the HTML scraping fallback (default: `true`).
- `CACHE_TTL_SECONDS` — TTL for in-memory stats cache (default: `300`).
- `SCRAPER_TIMEOUT_SECONDS` / `SCRAPER_RETRIES` — tune scraper request timeouts and retry count.
- `DATA_DIR` — optional directory for subscriber data when running the Flask app locally. Defaults to `/data` in
  Docker and falls back to `<repo>/data` when `/data` is read-only.
- `PUBLIC_BASE_URL` — optional override for unsubscribe and welcome email links. When unset, the app derives the
  host from the active Flask request, so local runs generate working URLs automatically.

When API access is disabled or fails, the scraper provides approximate counts and the UI labels them with a `~` badge plus tooltip. If both API and scraping fail, the UI renders an em dash and marks the element with `data-status="unavailable"`.

### Running the marketing API locally

The Flask app mirrors the Docker image defaults and now works on macOS without mounting `/data`. A minimal local
workflow:

1. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install the lightweight dependencies used by the Docker image:
   ```bash
   pip install flask requests
   ```
3. Point the app at a writable data directory (optional — defaults to `<repo>/data` when `/data` is unavailable):
   ```bash
   export DATA_DIR="$(pwd)/data"
   ```
4. Start the development server on port 5001:
   ```bash
   export FLASK_APP=api.app:app
   export FLASK_RUN_PORT=5001
   flask run --reload
   ```

The first run will create `data/subscribers.json` and `data/unsub_tokens.json`. Docker Compose keeps writing to
`/data` as before, so the container workflow remains unchanged.

When you open `web/index.html` from another local static server (e.g. `http://localhost:8080`), the
marketing JavaScript first tries the page's origin and then automatically falls back to
`http://127.0.0.1:5001/api/social/` so a standalone Flask app keeps serving metrics without an extra proxy.
To point the site at a different API host, add a `<meta name="marketing-api-base-url" ...>` tag in
`index.html` with the full base URL (including `/api/social/`).
