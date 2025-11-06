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

The marketing site under [`web/`](web/) can display live follower counts from YouTube and Instagram in the homepage hero.

1. Copy [`web/js/social.config.example.js`](web/js/social.config.example.js) to `web/js/social.config.js` and fill in your credentials. The example file is ignored by Git so secrets stay local.
2. **YouTube:** Enable the YouTube Data API v3 for your Google Cloud project, then create an API key under **APIs & Services → Credentials**. Locate your channel ID from the YouTube Studio advanced settings.
3. **Instagram:** Create a Meta app and connect your Instagram Business or Creator account to the Instagram Graph API. Generate a User Access Token with the `instagram_basic` permission and capture the Instagram user ID from the Graph API Explorer.
4. Optionally adjust `refreshIntervalMs` (milliseconds) to refresh counts on a cadence; omit it to load counts only once per visit.

Without credentials, the hero falls back to the static figures baked into the markup so the layout remains consistent.

### Local scrape fallback (development only)

If you need to exercise the HTML scraping fallback while developing locally:

1. Start the Flask API using the commands in [api/README.md](api/README.md). By default it listens on `http://127.0.0.1:5001`.
2. Add `localApiBaseUrl: "http://127.0.0.1:5001"` (or the host/port you chose) to your local `web/js/social.config.js` file.

The marketing site only attempts to call the scrape fallback when loaded from a local hostname or `file://` URL. Production deployments continue to rely solely on the official platform APIs.
