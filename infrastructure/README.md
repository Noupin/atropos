# Cloudflare Infrastructure

Terraform configuration for the licensing API. It provisions the Cloudflare KV
namespace, Worker shell (with non-secret bindings), DNS record, and the
route mapping for `https://api.atropos-video.com/api/*`.

## Required variables

Provide the variables below via a `terraform.tfvars` file or CLI flags:

| Variable | Description |
| --- | --- |
| `cloudflare_account_id` | Cloudflare account identifier |
| `cloudflare_api_token` | API token with permissions for Workers, KV, and DNS |
| `cloudflare_zone_id` | Zone ID for `atropos-video.com` |
| `cloudflare_zone_name` | Zone name (e.g. `atropos-video.com`) |
| `price_id_monthly` | Default Stripe price ID (unique per environment) |
| `environment` | Environment label (`dev`, `prod`, etc.) |
| `api_hostname` | Fully qualified API hostname (default `api.atropos-video.com`) |
| `tier` | Default license tier label (default `pro`) |
| `return_url_success` | Optional success redirect for Stripe portal |
| `return_url_cancel` | Optional cancel redirect for checkout |
| `cors_allow_origins` | Optional list of allowed origins for CORS |

## Usage

```bash
cd infrastructure
terraform init
terraform plan -out tfplan \
  -var cloudflare_account_id=... \
  -var cloudflare_api_token=... \
  -var cloudflare_zone_id=... \
  -var cloudflare_zone_name=atropos-video.com \
  -var price_id_monthly=price_123 \
  -var environment=dev
terraform apply tfplan
```

After `terraform apply`, copy the `kv_namespace_id` output into
`services/licensing/wrangler.toml` (both `id` and `preview_id` for the matching
environment). Wrangler secrets must be set manually (`wrangler secret put ...`).

Terraform only manages the Worker shell and bindings. Deploy the actual script
with Wrangler after Terraform finishes.
