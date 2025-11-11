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

The marketing site under [`web/`](web/) now reads follower counts from the Flask
API served out of [`api/app.py`](api/app.py). The backend scrapes each platform
with resilient fallbacks, caches the results, and exposes incremental endpoints
that the homepage uses to update the UI as soon as each handle resolves.

### Run the API locally

**Local (macOS):**

```bash
python3 -m venv env && source env/bin/activate
pip install -r requirements.txt
export FLASK_APP=api.app:app FLASK_RUN_PORT=5001
flask run --reload
```

**Docker:** the existing `docker-compose.yml` continues to work without
modification.

### Frontend wiring

- When the marketing site runs on `localhost`, loopback, or private-network
  hosts, the JavaScript automatically targets `http://127.0.0.1:5001`. In
  production it falls back to the relative `/api` prefix so the site works
  behind the same host.
- Set the optional `WEB_API_BASE` environment variable to override the API
  origin, and `WEB_ENABLE_MOCKS=true` if you want to keep showing the baked-in
  numbers when every fetch stage fails.
- Configure marketing/API cross-origin access with `API_CORS_ALLOW_ORIGINS`
  (comma-delimited; defaults to `*`). Optional knobs
  `API_CORS_ALLOW_METHODS`, `API_CORS_ALLOW_HEADERS`, and
  `API_CORS_MAX_AGE` adjust the response headers.

### Data directory

- The API now writes to a project-local `./data/` directory when running
  outside Docker. In containers it still uses `/data`. Override with
  `DATA_DIR=/your/path` if you need a different location; setting
  `IN_DOCKER=1` forces Docker semantics for custom environments.

### Configure social handles

- Edit [`api/social_handles.json`](api/social_handles.json) to control which
  accounts the marketing API fetches. The JSON maps each platform name to an
  array of handles.
- Override the file location with the `SOCIAL_CONFIG_FILE` environment
  variable or inject a full configuration via `SOCIAL_OVERVIEW_HANDLES`
  (JSON string) when deploying.
