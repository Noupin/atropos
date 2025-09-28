# Infrastructure & Deployment

This directory contains Terraform modules and Cloudflare Wrangler configuration for deploying the licensing worker and related infrastructure.

## Workflow overview

1. **Bootstrap** – Install Terraform and Wrangler CLI (`npm install -g wrangler`). Authenticate with Cloudflare using `wrangler login`.
2. **Select workspace** – Set `TF_WORKSPACE` (`dev` or `prod`) and run `terraform init` within `infrastructure/terraform`.
3. **Plan changes** – Use `terraform plan -var-file=env/<workspace>.tfvars` to preview modifications. Keep state remote via Terraform Cloud or an S3 backend.
4. **Apply** – Run `terraform apply` for the chosen workspace. This provisions KV namespaces, Secrets, and any auxiliary services.
5. **Deploy worker** – Use `wrangler deploy --env dev` (or `production`) from `services/licensing`. Terraform outputs the binding names consumed by Wrangler.

## Environment mapping

| Workspace | API host | KV namespace | Stripe mode |
| --- | --- | --- | --- |
| `dev` | `https://licensing.dev.atropos.workers.dev` | `atropos-licensing-dev` | Test keys |
| `prod` | `https://licensing.atropos.app` | `atropos-licensing-prod` | Live keys |

Export these values for downstream services or publish them via CI for the desktop app to consume.

## Secrets management

- Manage Stripe keys, Ed25519 signing seeds, and webhook secrets through Terraform variables or secret managers. Avoid committing secrets to the repo.
- Rotate keys regularly and update both the worker environment and the Python services (`server/common/security/jwt.py`).
- Record major rotations in an ADR and update [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## Local testing

- Use `wrangler dev --env dev` to run the worker locally against the dev KV namespace.
- Seed KV with fixture data using `wrangler kv:key put` commands scripted per environment.
- Verify Terraform formatting with `terraform fmt` and lint modules using `terraform validate` before committing.

## Adding infrastructure features

- Create new Terraform modules under `infrastructure/terraform/modules/<feature>` when provisioning additional resources.
- Update the root module to wire new modules, keeping environment-specific variables in `env/<workspace>.tfvars` files.
- Document any new outputs so application layers can reference them without hardcoding.
