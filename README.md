# Atropos

Atropos is a hybrid desktop + cloud platform for planning, rendering, and licensing short-form video workflows backed by automated billing and entitlement enforcement. The repository hosts the Electron desktop client, the Python orchestration services, and the Cloudflare Worker stack that keeps licensing and subscription state in sync.

## Orientation

- 📐 [System architecture](docs/ARCHITECTURE.md)
- 🤖 [Agent and automation playbook](docs/AGENTS.md)
- 🧭 [Contribution guidelines](CONTRIBUTING.md)
- 📜 [Architecture decision records](docs/ADRS)
- 🗒️ [Changelog](CHANGELOG.md)
- 🎬 [Project export guide](docs/exporting.md)

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
